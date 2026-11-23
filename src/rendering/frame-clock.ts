import type { DisplayInfo, FrameRate } from '../domain/contracts';
import type { Signals } from '../signals';
import {
  advanceDispatch,
  percentile,
  refreshFromGaps,
  refreshMismatch,
  shouldDispatch,
} from './pacing';

export interface FrameStats {
  p50: number;
  p95: number;
  longFrames: number;
  subscribers: number;
  /** Frames dispatched to subscribers over the last report window. */
  fps: number;
  /** The OS's refresh rate for this window's monitor; 0 when unknown. */
  displayHz: number;
  /** The vsync rate measured from requestAnimationFrame; 0 until measured. */
  refreshHz: number;
  /** Set when the measurement and the OS keep disagreeing after a re-detect. */
  note: string | null;
}
type Frame = (dt: number, signals: Readonly<Signals>) => void;
/** The signals only the clock writes; callers may leave them out. */
type ClockSignals = 'displayHz' | 'targetFps' | 'measuredFps' | 'refreshNote';
export type SignalsInit = Omit<Signals, ClockSignals> & Partial<Pick<Signals, ClockSignals>>;

const UNKNOWN: DisplayInfo = { refreshHz: 0, source: 'unknown', device: null };
/** Consecutive mismatching reports before the OS is asked again. */
const MISMATCH_REPORTS = 3;
const REDETECT_EVERY_MS = 10_000;

/** One application clock and the app's only requestAnimationFrame loop.
 * Subscribers run on every vsync of the display the window is on (60, 120,
 * 144, 240 Hz…), or on a vsync-aligned subset when a power-saving frame rate is
 * chosen. Nothing caps the rate by timer; the loop stops while the document is
 * hidden. Renderers subscribe and release their own lifetimes, so an idle scene
 * draws nothing: with no subscriber and no stats reader the loop parks (no
 * requestAnimationFrame at all) and the next subscribe wakes it. */
export class FrameClock {
  readonly signals: Signals;
  private callbacks = new Set<Frame>();
  private reporters = new Set<(stats: FrameStats) => void>();
  private redetectors = new Set<() => void>();
  private frame = 0;
  private last = 0;
  private gaps: number[] = [];
  private reported = 0;
  private longFrames = 0;
  private running = false;
  private parked = false;
  private observer?: PerformanceObserver;
  private display: DisplayInfo = UNKNOWN;
  private frameRate: FrameRate = 'match';
  /** The measured vsync interval; seeded until the first report. */
  private vsyncMs = 1000 / 60;
  private measuredHz = 0;
  /** Ideal time of the last dispatch (decimation) and its real time (dt). */
  private dispatchBase = 0;
  private dispatchedAt = 0;
  private dispatched = 0;
  private windowStart = 0;
  private mismatches = 0;
  private redetectedAt = -Infinity;
  private latest: FrameStats = {
    p50: 0,
    p95: 0,
    longFrames: 0,
    subscribers: 0,
    fps: 0,
    displayHz: 0,
    refreshHz: 0,
    note: null,
  };
  constructor(signals: SignalsInit) {
    // The same object, so callers that keep a reference see every write.
    this.signals = Object.assign(signals, {
      displayHz: signals.displayHz ?? 0,
      targetFps: signals.targetFps ?? 0,
      measuredFps: signals.measuredFps ?? 0,
      refreshNote: signals.refreshNote ?? null,
    });
    this.retarget();
  }
  subscribe(callback: Frame): () => void {
    this.callbacks.add(callback);
    this.wake();
    return () => {
      this.callbacks.delete(callback);
    };
  }
  onStats(callback: (stats: FrameStats) => void): () => void {
    this.reporters.add(callback);
    this.wake();
    return () => {
      this.reporters.delete(callback);
    };
  }
  /** Asked when the measured vsync keeps disagreeing with the OS's figure. */
  onRedetect(callback: () => void): () => void {
    this.redetectors.add(callback);
    return () => {
      this.redetectors.delete(callback);
    };
  }
  /** The most recent report, for a reader that mounts between reports. */
  stats(): FrameStats {
    return this.latest;
  }
  get subscriberCount(): number {
    return this.callbacks.size;
  }
  /** The OS's refresh rate for the monitor the window is on (Rust detects it). */
  setDisplay(info: DisplayInfo): void {
    this.display = info;
    this.signals.displayHz = info.refreshHz;
    this.mismatches = 0;
    const root = document.documentElement;
    if (info.refreshHz > 0) root.dataset.displayHz = String(info.refreshHz);
    else delete root.dataset.displayHz;
    this.retarget();
    this.report({ ...this.latest, displayHz: info.refreshHz });
  }
  /** 'match' runs on every vsync; 60 and 30 skip vsyncs to save power. */
  setFrameRate(rate: FrameRate): void {
    if (rate === this.frameRate) return;
    this.frameRate = rate;
    this.dispatchBase = 0;
    this.retarget();
  }
  start(): void {
    if (this.running) return;
    this.running = true;
    document.addEventListener('visibilitychange', this.visibility);
    if (
      typeof PerformanceObserver !== 'undefined' &&
      PerformanceObserver.supportedEntryTypes.includes('long-animation-frame')
    ) {
      this.observer = new PerformanceObserver((list) => {
        this.longFrames += list.getEntries().length;
      });
      this.observer.observe({ type: 'long-animation-frame' });
    }
    this.visibility();
  }
  /** The rate subscribers run at: the display's, or the chosen cap below it. */
  private retarget(): void {
    const native = this.display.refreshHz || this.measuredHz || this.signals.refreshHz || 60;
    this.signals.targetFps =
      this.frameRate === 'match' ? native : Math.min(Number(this.frameRate), native);
  }
  /** Resumes a parked loop on the next vsync. */
  private wake(): void {
    if (!this.parked) return;
    this.parked = false;
    this.visibility();
  }
  private get idle(): boolean {
    return this.callbacks.size === 0 && this.reporters.size === 0;
  }
  private visibility = (): void => {
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.parked = false;
    this.last = this.dispatchedAt = this.dispatchBase = 0;
    this.dispatched = 0;
    this.windowStart = performance.now();
    if (this.running && !document.hidden) this.frame = requestAnimationFrame(this.tick);
  };
  private tick = (now: number): void => {
    if (!this.running || document.hidden) return;
    const gap = this.last ? now - this.last : 0;
    this.last = now;
    if (gap > 0) {
      this.gaps.push(gap);
      if (this.gaps.length > 60) this.gaps.shift();
    }
    const match = this.frameRate === 'match';
    if (match || shouldDispatch(now, this.dispatchBase, this.vsyncMs, this.signals.targetFps)) {
      const dt = this.dispatchedAt ? (now - this.dispatchedAt) / 1000 : 0;
      this.dispatchBase = match
        ? now
        : advanceDispatch(now, this.dispatchBase, this.signals.targetFps);
      this.dispatchedAt = now;
      this.dispatched++;
      for (const callback of this.callbacks) callback(Math.min(dt, 0.05), this.signals);
    }
    if (now - this.reported > 1000 && this.gaps.length === 60) this.measure(now);
    if (this.idle) {
      // Nothing moves and nobody reads stats: stop waking the GPU every vsync.
      this.parked = true;
      this.frame = 0;
      this.signals.measuredFps = 0;
      document.documentElement.dataset.fps = '0';
      return;
    }
    this.frame = requestAnimationFrame(this.tick);
  };
  /** About once a second: vsync, dispatch rate and the cross-check with the OS. */
  private measure(now: number): void {
    const elapsed = now - (this.windowStart || this.reported),
      fps = elapsed > 0 ? Math.round((this.dispatched * 1000) / elapsed) : 0;
    this.reported = this.windowStart = now;
    this.dispatched = 0;
    this.vsyncMs = percentile(this.gaps, 0.5);
    this.measuredHz = refreshFromGaps(this.gaps);
    this.signals.refreshHz = this.measuredHz;
    this.signals.measuredFps = fps;
    this.retarget();
    const displayHz = this.display.refreshHz;
    if (refreshMismatch(this.measuredHz, displayHz)) {
      if (++this.mismatches >= MISMATCH_REPORTS) {
        this.mismatches = 0;
        // A second run of mismatches after asking again is a real disagreement
        // (a dynamic refresh rate, a throttled window); pacing still follows vsync.
        if (this.redetectedAt > -Infinity)
          this.signals.refreshNote = `measured ${this.measuredHz} Hz, display reports ${displayHz} Hz`;
        if (now - this.redetectedAt >= REDETECT_EVERY_MS) {
          this.redetectedAt = now;
          for (const redetect of this.redetectors) redetect();
        }
      }
    } else {
      this.mismatches = 0;
      this.signals.refreshNote = null;
    }
    document.documentElement.dataset.fps = String(fps);
    this.report({
      p50: percentile(this.gaps, 0.5),
      p95: percentile(this.gaps, 0.95),
      longFrames: this.longFrames,
      subscribers: this.callbacks.size,
      fps,
      displayHz,
      refreshHz: this.measuredHz,
      note: this.signals.refreshNote,
    });
  }
  private report(stats: FrameStats): void {
    this.latest = stats;
    for (const report of this.reporters) report(stats);
  }
  stop(): void {
    this.running = false;
    this.parked = false;
    cancelAnimationFrame(this.frame);
    this.observer?.disconnect();
    this.observer = undefined;
    document.removeEventListener('visibilitychange', this.visibility);
  }
}
