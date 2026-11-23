/** Frame pacing and dynamic resolution, as pure functions so they can be tested
 * against simulated vsync at any refresh rate. Nothing here schedules work: the
 * FrameClock's requestAnimationFrame is the only pacer, so every dispatch lands
 * on a real vsync. */

/** True when a vsync at `now` should run the clock's subscribers.
 * `lastDispatch` is the ideal time of the previous dispatch (see
 * {@link advanceDispatch}), so a 60 fps cap on a 144 Hz display alternates two
 * and three vsyncs and averages 60 instead of rounding to 72 or 48. The half
 * vsync of slack lets a target equal to the refresh rate pass every vsync even
 * with timestamp jitter. */
export function shouldDispatch(
  now: number,
  lastDispatch: number,
  vsyncMs: number,
  targetFps: number,
): boolean {
  if (!(targetFps > 0)) return true;
  return now - lastDispatch >= 1000 / targetFps - vsyncMs / 2;
}

/** The ideal time of the dispatch that just ran at `now`. It advances by one
 * target interval, and resynchronises to `now` after a stall (a long task, a
 * hidden window) instead of bursting to catch up. */
export function advanceDispatch(now: number, lastDispatch: number, targetFps: number): number {
  if (!(targetFps > 0)) return now;
  const interval = 1000 / targetFps,
    ideal = lastDispatch + interval;
  return now - ideal >= interval ? now : ideal;
}

/** The value at fraction `q` of the sorted samples (nearest rank, rounded down). */
export function percentile(samples: readonly number[], q: number): number {
  if (!samples.length) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.floor(q * (sorted.length - 1))];
}

/** Vsync as the median rAF interval, robust to the odd long frame. */
export function refreshFromGaps(gapsMs: readonly number[]): number {
  const median = percentile(gapsMs, 0.5);
  return median > 0 ? Math.round(1000 / median) : 0;
}

/** The longest gap a frame may take at `targetFps` while still on time. On
 * vsync a capped rate alternates whole intervals (60 fps at 144 Hz is 2 and 3
 * vsyncs), so the budget is the target interval rounded up to whole vsyncs. */
export function frameBudget(targetFps: number, refreshHz: number): number {
  const vsync = 1000 / (refreshHz > 0 ? refreshHz : 60),
    interval = targetFps > 0 ? 1000 / targetFps : vsync;
  return vsync * Math.max(1, Math.ceil(interval / vsync - 0.05));
}

/** True when the measured vsync and the OS's figure differ by more than 8%. */
export function refreshMismatch(measuredHz: number, displayHz: number): boolean {
  return measuredHz > 0 && displayHz > 0 && Math.abs(measuredHz - displayHz) / displayHz > 0.08;
}

export const DYNAMIC = {
  /** The render scale never drops below half of the tier's base. */
  min: 0.5,
  max: 1,
  down: 0.85,
  up: 1.1,
  /** p90 over this multiple of the frame budget is a miss. */
  over: 1.2,
  /** p90 at or under this multiple counts toward recovery. */
  under: 1.05,
  /** Consecutive on-budget windows before the scale rises again. */
  recover: 3,
  /** Consecutive missing windows at the floor before the tier steps down. */
  floorMisses: 3,
  /** At most one canvas resize per this many ms. */
  settleMs: 500,
  /** Active frames per decision window. */
  window: 60,
} as const;

export interface RenderScaleState {
  /** Multiplies the tier's base render scales, within [DYNAMIC.min, 1]. */
  dyn: number;
  /** The streak of consecutive windows: positive while on budget, negative
   * while still missing at the floor, 0 otherwise. */
  good: number;
  /** performance.now() of the last scale change. */
  lastResize: number;
}
export interface RenderScaleDecision extends RenderScaleState {
  /** Why the scale changed this window, for diagnostics; null when it held. */
  reason: string | null;
  /** True when the floor kept missing and the tier itself must step down. */
  stepTier: boolean;
}

const ms = (value: number) => `${value.toFixed(1)} ms`;
const factor = (value: number) => `${value.toFixed(2)}×`;

/** One dynamic-resolution decision from a window of dispatched frame gaps.
 * Frame rate is never traded: a miss lowers the render scale by 15% (at most
 * once per 500 ms), three on-budget windows raise it by 10%, and only a floor
 * that keeps missing for three windows asks for the next tier down. The band
 * between 1.05× and 1.2× of the budget holds, so the scale does not oscillate. */
export function nextRenderScale(
  state: RenderScaleState,
  gapsMs: readonly number[],
  targetMs: number,
  now: number,
): RenderScaleDecision {
  const held = (good: number): RenderScaleDecision => ({
    ...state,
    good,
    reason: null,
    stepTier: false,
  });
  if (!gapsMs.length || !(targetMs > 0)) return held(state.good);
  const p90 = percentile(gapsMs, 0.9),
    budget = `p90 ${ms(p90)}`,
    settled = now - state.lastResize >= DYNAMIC.settleMs;
  if (p90 > DYNAMIC.over * targetMs) {
    if (state.dyn > DYNAMIC.min + 1e-6) {
      if (!settled) return held(0);
      const dyn = Math.max(DYNAMIC.min, Math.round(state.dyn * DYNAMIC.down * 100) / 100);
      return {
        dyn,
        good: 0,
        lastResize: now,
        reason: `dynamic resolution ${factor(dyn)} (${budget} > ${ms(targetMs)})`,
        stepTier: false,
      };
    }
    const misses = state.good < 0 ? state.good - 1 : -1;
    if (misses > -DYNAMIC.floorMisses) return held(misses);
    return {
      dyn: state.dyn,
      good: 0,
      lastResize: now,
      reason: `tier step at ${factor(state.dyn)} (${budget} > ${ms(targetMs)})`,
      stepTier: true,
    };
  }
  if (p90 <= DYNAMIC.under * targetMs) {
    const streak = state.good > 0 ? state.good + 1 : 1;
    if (streak < DYNAMIC.recover || state.dyn >= DYNAMIC.max || !settled) return held(streak);
    const dyn = Math.min(DYNAMIC.max, Math.round(state.dyn * DYNAMIC.up * 100) / 100);
    return {
      dyn,
      good: 0,
      lastResize: now,
      reason: `dynamic resolution ${factor(dyn)} (${budget} ≤ ${ms(targetMs)})`,
      stepTier: false,
    };
  }
  return held(0);
}
