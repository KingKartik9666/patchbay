import { describe, expect, it, vi } from 'vitest';
import { FrameClock, type FrameStats, type SignalsInit } from '../src/rendering/frame-clock';
import {
  DYNAMIC,
  advanceDispatch,
  frameBudget,
  nextRenderScale,
  percentile,
  refreshFromGaps,
  refreshMismatch,
  shouldDispatch,
  type RenderScaleDecision,
  type RenderScaleState,
} from '../src/rendering/pacing';

const RATES = [60, 75, 120, 144, 165, 240] as const;

/** Vsync timestamps at `hz` for `seconds`, with ±`jitter` ms of timestamp noise. */
function vsyncs(hz: number, seconds: number, jitter = 0.05): number[] {
  const out: number[] = [];
  let seed = 7;
  const noise = () => {
    seed = (seed * 16807) % 2147483647;
    return ((seed / 2147483647) * 2 - 1) * jitter;
  };
  for (let i = 0; i < hz * seconds; i++) out.push(1000 + (i * 1000) / hz + noise());
  return out;
}

/** Runs the clock's dispatch rule over vsyncs; 'match' dispatches every vsync. */
function dispatches(hz: number, target: number | 'match', seconds = 10): number[] {
  const times: number[] = [];
  let base = 0;
  for (const now of vsyncs(hz, seconds)) {
    if (target === 'match') {
      times.push(now);
      continue;
    }
    const fps = Math.min(target, hz);
    if (shouldDispatch(now, base, 1000 / hz, fps)) {
      base = advanceDispatch(now, base, fps);
      times.push(now);
    }
  }
  return times;
}

describe('frame pacing on vsync', () => {
  it.each(RATES)('matches a %i Hz display on every vsync', (hz) => {
    const times = dispatches(hz, 'match');
    expect(times).toHaveLength(hz * 10);
    // A fixed-rate rule at the display's own rate must not drop a vsync either.
    expect(dispatches(hz, hz)).toHaveLength(hz * 10);
  });

  it.each(RATES)('caps a %i Hz display at 60 and 30 fps on whole vsyncs', (hz) => {
    for (const cap of [60, 30]) {
      const times = dispatches(hz, cap),
        expected = Math.min(cap, hz) * 10;
      // Within 1% of the cap's average rate, never above the display.
      expect(Math.abs(times.length - expected) / expected).toBeLessThan(0.01);
      // Every dispatch is a vsync: gaps are whole multiples of the interval.
      const vsync = 1000 / hz;
      for (let i = 1; i < times.length; i++) {
        const whole = (times[i] - times[i - 1]) / vsync;
        expect(Math.abs(whole - Math.round(whole))).toBeLessThan(0.1);
        expect(Math.round(whole)).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it('alternates 2 and 3 vsyncs for 60 fps at 144 Hz instead of rounding to 72 or 48', () => {
    const times = dispatches(144, 60, 2),
      vsync = 1000 / 144,
      steps = new Set(times.slice(1).map((time, i) => Math.round((time - times[i]) / vsync)));
    expect([...steps].sort()).toEqual([2, 3]);
  });

  it('resynchronises after a stall instead of bursting to catch up', () => {
    const fps = 60;
    let base = advanceDispatch(1000, 0, fps);
    expect(base).toBe(1000);
    // A 500 ms long task: the next dispatch rebases on now.
    expect(shouldDispatch(1500, base, 1000 / 144, fps)).toBe(true);
    base = advanceDispatch(1500, base, fps);
    expect(base).toBe(1500);
    expect(shouldDispatch(1500 + 1000 / 144, base, 1000 / 144, fps)).toBe(false);
  });

  it('budgets whole vsyncs for capped rates', () => {
    expect(frameBudget(144, 144)).toBeCloseTo(1000 / 144, 6);
    expect(frameBudget(60, 60)).toBeCloseTo(1000 / 60, 6);
    expect(frameBudget(60, 144)).toBeCloseTo(3000 / 144, 6);
    expect(frameBudget(60, 75)).toBeCloseTo(2000 / 75, 6);
    expect(frameBudget(30, 240)).toBeCloseTo(8000 / 240, 6);
    expect(frameBudget(0, 0)).toBeCloseTo(1000 / 60, 6);
  });
});

describe('refresh measurement', () => {
  it.each(RATES)('reads %i Hz from the median rAF interval', (hz) => {
    const times = vsyncs(hz, 1),
      gaps = times.slice(1).map((time, i) => time - times[i]);
    // A few long frames do not move the median.
    gaps.splice(5, 3, 40, 50, 33);
    expect(refreshFromGaps(gaps.slice(-60))).toBe(hz);
  });
  it('flags only disagreements over 8%', () => {
    expect(refreshMismatch(144, 144)).toBe(false);
    expect(refreshMismatch(139, 144)).toBe(false);
    expect(refreshMismatch(60, 144)).toBe(true);
    expect(refreshMismatch(144, 0)).toBe(false);
    expect(refreshMismatch(0, 144)).toBe(false);
  });
  it('takes nearest-rank percentiles', () => {
    expect(percentile([], 0.9)).toBe(0);
    expect(percentile([5, 1, 3, 2, 4], 0.5)).toBe(3);
    expect(
      percentile(
        Array.from({ length: 60 }, (_, i) => i + 1),
        0.9,
      ),
    ).toBe(54);
  });
});

describe('dynamic resolution', () => {
  const target = 1000 / 144,
    fresh: RenderScaleState = { dyn: 1, good: 0, lastResize: -Infinity },
    window = (gap: number, late = 0, lateGap = gap * 2) =>
      Array.from({ length: DYNAMIC.window }, (_, i) => (i < late ? lateGap : gap));
  /** Feeds windows to the rule the way the field does, carrying its state. */
  const engine = (initial: RenderScaleState) => {
    const state = { ...initial };
    const step = (gaps: number[], now: number): RenderScaleDecision => {
      const decision = nextRenderScale(state, gaps, target, now);
      Object.assign(state, {
        dyn: decision.dyn,
        good: decision.good,
        lastResize: decision.lastResize,
      });
      return decision;
    };
    return { state, step };
  };

  it('holds full scale while frames land on vsync', () => {
    expect(engine(fresh).step(window(target), 1000)).toMatchObject({
      dyn: 1,
      reason: null,
      stepTier: false,
    });
  });

  it('lowers the scale by 15% when p90 misses the budget, at most every 500 ms', () => {
    // 10 of 60 frames at two vsyncs puts p90 over 1.2× the budget.
    const missing = window(target, 10),
      { step } = engine(fresh);
    const first = step(missing, 1000);
    expect(first.dyn).toBe(0.85);
    expect(first.reason).toBe('dynamic resolution 0.85× (p90 13.9 ms > 6.9 ms)');
    expect(step(missing, 1300)).toMatchObject({ dyn: 0.85, reason: null });
    expect(step(missing, 1600).dyn).toBe(0.72);
  });

  it('ignores a few late frames (p90 is on budget)', () => {
    expect(engine(fresh).step(window(target, 5), 1000).dyn).toBe(1);
  });

  it('never drops below the floor and steps the tier only after three floor misses', () => {
    const { step } = engine(fresh),
      steps: RenderScaleDecision[] = [];
    for (let now = 600; now <= 12_000 && !steps.at(-1)?.stepTier; now += 600)
      steps.push(step(window(target, 30), now));
    for (const decision of steps) expect(decision.dyn).toBeGreaterThanOrEqual(DYNAMIC.min);
    const last = steps.at(-1)!;
    expect(last.stepTier).toBe(true);
    expect(last.reason).toMatch(/^tier step at 0\.50×/);
    // The scale reached the floor first, then missed there three times.
    const floor = steps.findIndex((decision) => decision.dyn === DYNAMIC.min);
    expect(floor).toBeGreaterThan(0);
    expect(steps.slice(0, floor).every((decision) => !decision.stepTier)).toBe(true);
    expect(steps.length - 1 - floor).toBe(DYNAMIC.floorMisses);
  });

  it('recovers by 10% after three on-budget windows, with hysteresis between', () => {
    const { step } = engine({ dyn: 0.5, good: 0, lastResize: 0 });
    step(window(target), 1000);
    expect(step(window(target), 1500).dyn).toBe(0.5);
    const up = step(window(target), 2000);
    expect(up.dyn).toBe(0.55);
    expect(up.reason).toMatch(/^dynamic resolution 0\.55×/);
    // In the hysteresis band (1.05–1.2× the budget) the streak resets and the scale holds.
    step(window(target * 1.1), 3000);
    step(window(target), 3500);
    expect(step(window(target), 4000).dyn).toBe(0.55);
    expect(step(window(target), 4500).dyn).toBe(0.61);
  });

  it('a recovered window resets the floor-miss streak', () => {
    const { state, step } = engine({ dyn: 0.5, good: 0, lastResize: 0 });
    step(window(target, 30), 1000);
    step(window(target, 30), 2000);
    expect(state.good).toBe(-2);
    step(window(target), 3000);
    expect(step(window(target, 30), 4000).stepTier).toBe(false);
    expect(state.good).toBe(-1);
  });
});

describe('frame clock', () => {
  /** A fake vsync: requestAnimationFrame callbacks run on `step(now)`. */
  function harness() {
    let pending: FrameRequestCallback | null = null,
      time = 0;
    const listeners = new Map<string, () => void>(),
      dataset: Record<string, string> = {},
      globals = globalThis as unknown as Record<string, unknown>,
      saved = ['document', 'requestAnimationFrame', 'cancelAnimationFrame'].map(
        (key) => [key, globals[key]] as const,
      );
    globals.document = {
      hidden: false,
      documentElement: { dataset },
      addEventListener: (type: string, listener: () => void) => listeners.set(type, listener),
      removeEventListener: (type: string) => listeners.delete(type),
    };
    globals.requestAnimationFrame = (callback: FrameRequestCallback) => {
      pending = callback;
      return 1;
    };
    globals.cancelAnimationFrame = () => {
      pending = null;
    };
    const now = vi.spyOn(performance, 'now').mockImplementation(() => time);
    return {
      dataset,
      pending: () => pending !== null,
      run(hz: number, seconds: number, from = time) {
        for (let i = 1; i <= hz * seconds; i++) {
          time = from + (i * 1000) / hz;
          const callback = pending;
          pending = null;
          callback?.(time);
        }
      },
      restore() {
        now.mockRestore();
        for (const [key, value] of saved) globals[key] = value;
      },
    };
  }
  const signals = (): SignalsInit => ({
    pointer: { x: 0, y: 0 },
    energy: 0,
    phase: 'idle',
    quality: 'medium',
    glass: 'solid',
    refreshHz: 60,
    reducedMotion: false,
    focusMode: false,
    boardRate: 60,
    glowPasses: 2,
  });

  it.each(RATES)('dispatches every vsync at %i Hz and reports it', (hz) => {
    const fake = harness();
    try {
      const clock = new FrameClock(signals()),
        reports: FrameStats[] = [];
      let frames = 0;
      clock.subscribe(() => frames++);
      clock.onStats((stats) => reports.push(stats));
      clock.setDisplay({ refreshHz: hz, source: 'win32', device: null });
      clock.start();
      fake.run(hz, 3);
      expect(frames).toBeGreaterThanOrEqual(hz * 3 - 1);
      const last = reports.at(-1)!;
      expect(last.refreshHz).toBe(hz);
      expect(Math.abs(last.fps - hz)).toBeLessThanOrEqual(1);
      expect(clock.signals).toMatchObject({ displayHz: hz, targetFps: hz, refreshNote: null });
      expect(fake.dataset.displayHz).toBe(String(hz));
      expect(Math.abs(Number(fake.dataset.fps) - hz)).toBeLessThanOrEqual(1);
      clock.stop();
    } finally {
      fake.restore();
    }
  });

  it('caps at 60 and 30 fps on a 144 Hz display, with dt to match', () => {
    const fake = harness();
    try {
      const clock = new FrameClock(signals());
      clock.setDisplay({ refreshHz: 144, source: 'win32', device: null });
      for (const cap of ['60', '30'] as const) {
        const dts: number[] = [];
        const off = clock.subscribe((dt) => dts.push(dt));
        clock.setFrameRate(cap);
        clock.start();
        fake.run(144, 5);
        clock.stop();
        off();
        expect(clock.signals.targetFps).toBe(Number(cap));
        expect(Math.abs(dts.length / 5 - Number(cap))).toBeLessThanOrEqual(1);
        const mean = dts.slice(1).reduce((sum, dt) => sum + dt, 0) / (dts.length - 1);
        expect(mean).toBeCloseTo(1 / Number(cap), 3);
      }
    } finally {
      fake.restore();
    }
  });

  it('parks with nothing to draw and wakes on the next subscribe', () => {
    const fake = harness();
    try {
      const clock = new FrameClock(signals());
      clock.setDisplay({ refreshHz: 144, source: 'win32', device: null });
      let frames = 0;
      const off = clock.subscribe(() => frames++);
      clock.start();
      fake.run(144, 2);
      expect(frames).toBeGreaterThanOrEqual(144 * 2 - 1);
      off();
      fake.run(144, 0.1);
      // Parked: no requestAnimationFrame is pending, so nothing runs.
      expect(fake.pending()).toBe(false);
      expect(fake.dataset.fps).toBe('0');
      frames = 0;
      clock.subscribe(() => frames++);
      expect(fake.pending()).toBe(true);
      fake.run(144, 2);
      expect(frames).toBeGreaterThanOrEqual(144 * 2 - 2);
      expect(Math.abs(Number(fake.dataset.fps) - 144)).toBeLessThanOrEqual(1);
      clock.stop();
    } finally {
      fake.restore();
    }
  });

  it('asks the OS again, then notes a lasting disagreement, while pacing on vsync', () => {
    const fake = harness();
    try {
      const clock = new FrameClock(signals());
      let asked = 0,
        frames = 0;
      clock.onRedetect(() => asked++);
      clock.subscribe(() => frames++);
      // Windows says 144 Hz, but vsync arrives at 60 (a dynamic refresh rate).
      clock.setDisplay({ refreshHz: 144, source: 'win32', device: null });
      clock.start();
      fake.run(60, 4.5);
      expect(asked).toBe(1);
      expect(clock.signals.refreshNote).toBeNull();
      fake.run(60, 3.5);
      expect(clock.signals.refreshNote).toBe('measured 60 Hz, display reports 144 Hz');
      expect(asked).toBe(1);
      expect(frames).toBeGreaterThanOrEqual(60 * 8 - 1);
      // Agreement clears the note.
      clock.setDisplay({ refreshHz: 60, source: 'win32', device: null });
      fake.run(60, 1.5);
      expect(clock.signals.refreshNote).toBeNull();
      clock.stop();
    } finally {
      fake.restore();
    }
  });
});
