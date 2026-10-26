import type { Signals } from '../signals';
export interface FrameStats {
  p50: number;
  p95: number;
  longFrames: number;
  subscribers: number;
}
type Frame = (dt: number, signals: Readonly<Signals>) => void;
/** One application clock; renderers subscribe and release their own lifetimes. */
export class FrameClock {
  readonly signals: Signals;
  private callbacks = new Set<Frame>();
  private reporters = new Set<(stats: FrameStats) => void>();
  private frame = 0;
  private last = 0;
  private gaps: number[] = [];
  private reported = 0;
  private longFrames = 0;
  private running = false;
  private observer?: PerformanceObserver;
  constructor(signals: Signals) {
    this.signals = signals;
  }
  subscribe(callback: Frame): () => void {
    this.callbacks.add(callback);
    return () => {
      this.callbacks.delete(callback);
    };
  }
  onStats(callback: (stats: FrameStats) => void): () => void {
    this.reporters.add(callback);
    return () => {
      this.reporters.delete(callback);
    };
  }
  get subscriberCount(): number {
    return this.callbacks.size;
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
  private visibility = (): void => {
    cancelAnimationFrame(this.frame);
    this.last = 0;
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
    for (const callback of this.callbacks) callback(Math.min(gap / 1000, 0.05), this.signals);
    if (now - this.reported > 1000 && this.gaps.length === 60) {
      this.reported = now;
      const sorted = [...this.gaps].sort((a, b) => a - b);
      this.signals.refreshHz = Math.round(1000 / sorted[30]);
      const stats = {
        p50: sorted[30],
        p95: sorted[57],
        longFrames: this.longFrames,
        subscribers: this.callbacks.size,
      };
      for (const report of this.reporters) report(stats);
    }
    this.frame = requestAnimationFrame(this.tick);
  };
  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.frame);
    this.observer?.disconnect();
    this.observer = undefined;
    document.removeEventListener('visibilitychange', this.visibility);
  }
}
