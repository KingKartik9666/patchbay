/**
 * Apple's duration/bounce spring (SwiftUI `.spring(duration:bounce:)`), solved
 * in closed form so WAAPI and CSS can play it as a `linear()` curve.
 *
 * Model: unit mass, stiffness k = (2π / duration)², damping ratio
 * ζ = 1 − bounce for bounce ≥ 0 and 1 / (1 + bounce) below zero (overdamped),
 * damping coefficient c = 2ζ√k. Positions are normalised: 0 is the start,
 * 1 is the target, and velocities are in normalised units per second.
 */
export interface SpringToken {
  duration: number;
  bounce: number;
}

export type SpringName = 'snappy' | 'smooth' | 'fade' | 'glass' | 'sheet' | 'cinematic' | 'bounce';

export const SPRINGS: Record<SpringName, SpringToken> = {
  snappy: { duration: 0.4, bounce: 0.15 },
  smooth: { duration: 0.5, bounce: 0 },
  fade: { duration: 0.35, bounce: 0 },
  glass: { duration: 0.55, bounce: 0.12 },
  sheet: { duration: 0.6, bounce: 0.05 },
  cinematic: { duration: 0.7, bounce: 0 },
  /**
   * The theme toggle's sun/moon morph: a visible, playful overshoot (damping
   * ratio 0.6, 9.5% past the target) reserved for that one rare, deliberate press.
   */
  bounce: { duration: 0.6, bounce: 0.4 },
};

/** A spring has settled once it stays within this many pixels of rest. */
export const SETTLE_RESIDUAL_PX = 0.5;
/**
 * Curves shared by CSS and WAAPI are sampled until they sit within 0.5px of
 * rest over this travel (a 0.1% residual), so one curve serves any travel up
 * to 500px, such as Focus mode's sidebar slide, without a visible end jump.
 */
export const REFERENCE_TRAVEL_PX = 500;

const TAU = Math.PI * 2;
const SCAN_STEP_S = 0.001;
const SCAN_LIMIT_S = 10;

interface Solution {
  /** Displacement from the target (x − 1) and velocity at time t. */
  at(time: number): { y: number; v: number };
  /** An upper bound of |displacement| from time t onwards. */
  bound(time: number): number;
}

export function springCoefficients(token: SpringToken): { k: number; c: number; zeta: number } {
  const duration = Math.max(0.01, token.duration);
  const bounce = Math.min(0.95, Math.max(-0.95, token.bounce));
  const k = (TAU / duration) ** 2;
  const zeta = bounce >= 0 ? 1 - bounce : 1 / (1 + bounce);
  return { k, c: 2 * zeta * Math.sqrt(k), zeta };
}

function solve(token: SpringToken, v0: number): Solution {
  const { k, zeta } = springCoefficients(token);
  const omega = Math.sqrt(k);
  const a = -1; // starts one unit short of the target

  if (Math.abs(zeta - 1) < 1e-6) {
    const b = v0 + omega * a;
    return {
      at: (t) => {
        const decay = Math.exp(-omega * t);
        return { y: decay * (a + b * t), v: decay * (b - omega * (a + b * t)) };
      },
      bound: (t) => Math.exp(-omega * t) * (Math.abs(a) + Math.abs(b) * t),
    };
  }

  if (zeta < 1) {
    const damped = omega * Math.sqrt(1 - zeta * zeta);
    const decayRate = zeta * omega;
    const b = (v0 + decayRate * a) / damped;
    return {
      at: (t) => {
        const decay = Math.exp(-decayRate * t);
        const cos = Math.cos(damped * t);
        const sin = Math.sin(damped * t);
        return {
          y: decay * (a * cos + b * sin),
          v: decay * ((damped * b - decayRate * a) * cos - (decayRate * b + damped * a) * sin),
        };
      },
      bound: (t) => Math.exp(-decayRate * t) * Math.hypot(a, b),
    };
  }

  const root = Math.sqrt(zeta * zeta - 1);
  const r1 = -omega * (zeta - root);
  const r2 = -omega * (zeta + root);
  const c2 = (v0 - r1 * a) / (r2 - r1);
  const c1 = a - c2;
  return {
    at: (t) => {
      const e1 = Math.exp(r1 * t);
      const e2 = Math.exp(r2 * t);
      return { y: c1 * e1 + c2 * e2, v: r1 * c1 * e1 + r2 * c2 * e2 };
    },
    bound: (t) => Math.abs(c1) * Math.exp(r1 * t) + Math.abs(c2) * Math.exp(r2 * t),
  };
}

/** Normalised position (0 → 1) and velocity (units/s) at `timeS` seconds. */
export function springValue(token: SpringToken, timeS: number, v0 = 0): { x: number; v: number } {
  if (timeS <= 0) return { x: 0, v: v0 };
  const { y, v } = solve(token, v0).at(timeS);
  return { x: 1 + y, v };
}

/** Milliseconds until the spring stays within 0.5px of rest for `travelPx`. */
export function settleTime(token: SpringToken, travelPx: number, v0 = 0): number {
  const travel = Math.abs(travelPx);
  if (travel <= SETTLE_RESIDUAL_PX) return 0;
  const threshold = SETTLE_RESIDUAL_PX / travel;
  const solution = solve(token, v0);
  let last = 0;
  for (let t = 0; t <= SCAN_LIMIT_S; t += SCAN_STEP_S) {
    if (Math.abs(solution.at(t).y) >= threshold) last = t;
    else if (solution.bound(t) < threshold) break;
  }
  return Math.round((last + SCAN_STEP_S) * 1000);
}

function stop(value: number): string {
  const rounded = Math.round(value * 10000) / 10000;
  return Object.is(rounded, -0) ? '0' : String(rounded);
}

/**
 * The spring as a CSS `linear()` easing with evenly spaced stops, sampled over
 * `settleTime(token, REFERENCE_TRAVEL_PX, v0)`. Pair it with that duration.
 */
export function linearEasing(token: SpringToken, v0 = 0, stops = 32): string {
  const count = Math.max(2, Math.round(stops));
  const duration = settleTime(token, REFERENCE_TRAVEL_PX, v0) / 1000;
  const solution = solve(token, v0);
  const values: string[] = [];
  for (let index = 0; index < count; index++) {
    if (index === 0) values.push('0');
    else if (index === count - 1) values.push('1');
    else values.push(stop(1 + solution.at((duration * index) / (count - 1)).y));
  }
  return `linear(${values.join(', ')})`;
}

/** Duration and easing for one WAAPI or CSS run of a spring. */
export function springTiming(token: SpringToken, v0 = 0): { duration: number; easing: string } {
  return { duration: settleTime(token, REFERENCE_TRAVEL_PX, v0), easing: linearEasing(token, v0) };
}
