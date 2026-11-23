import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  REFERENCE_TRAVEL_PX,
  SPRINGS,
  linearEasing,
  settleTime,
  springCoefficients,
  springValue,
  type SpringName,
  type SpringToken,
} from '../src/motion/spring';

/** Semi-implicit Euler integration of the same spring, as an independent oracle. */
function integrate(token: SpringToken, until: number, v0 = 0): { x: number; v: number } {
  const { k, c } = springCoefficients(token);
  let x = 0;
  let v = v0;
  const dt = 1e-5;
  for (let t = 0; t < until - dt / 2; t += dt) {
    v += (-k * (x - 1) - c * v) * dt;
    x += v * dt;
  }
  return { x, v };
}

describe('spring model', () => {
  it("uses Apple's duration/bounce coefficients", () => {
    const { k, c, zeta } = springCoefficients({ duration: 0.5, bounce: 0.3 });
    expect(k).toBeCloseTo(157.9, 1);
    expect(c).toBeCloseTo(17.6, 1);
    expect(zeta).toBeCloseTo(0.7, 6);
    expect(springCoefficients({ duration: 0.5, bounce: -0.5 }).zeta).toBeCloseTo(2, 6);
  });

  it('matches numeric integration in all three damping regimes, with initial velocity', () => {
    const tokens: SpringToken[] = [SPRINGS.glass, SPRINGS.smooth, { duration: 0.5, bounce: -0.4 }];
    for (const token of tokens)
      for (const v0 of [0, 3, -2])
        for (const time of [0.05, 0.2, 0.45]) {
          const exact = springValue(token, time, v0);
          const numeric = integrate(token, time, v0);
          expect(exact.x).toBeCloseTo(numeric.x, 3);
          expect(exact.v).toBeCloseTo(numeric.v, 1);
        }
  });

  it('starts at rest offset and reaches the target', () => {
    expect(springValue(SPRINGS.sheet, 0, 2)).toEqual({ x: 0, v: 2 });
    expect(springValue(SPRINGS.cinematic, 3).x).toBeCloseTo(1, 6);
  });

  it('settles within 0.5px of rest for the given travel', () => {
    for (const name of Object.keys(SPRINGS) as SpringName[]) {
      const token = SPRINGS[name];
      for (const travel of [24, REFERENCE_TRAVEL_PX]) {
        const ms = settleTime(token, travel);
        const residual = (time: number) => Math.abs(1 - springValue(token, time / 1000).x) * travel;
        for (let time = ms; time < ms + 2000; time += 5) expect(residual(time)).toBeLessThan(0.5);
        expect(residual(ms - 2)).toBeGreaterThanOrEqual(0.5);
      }
    }
    expect(settleTime(SPRINGS.smooth, 0.25)).toBe(0);
  });

  it('places 90% of a 24px move inside the documented response times', () => {
    const at90 = (token: SpringToken) => {
      let time = 0;
      while (springValue(token, time / 1000).x < 0.9) time++;
      return time;
    };
    expect(at90(SPRINGS.snappy)).toBeCloseTo(203, -1);
    expect(at90(SPRINGS.smooth)).toBeCloseTo(310, -1);
    expect(at90(SPRINGS.cinematic)).toBeCloseTo(434, -1);
  });

  it('gives the theme glyph a visible, bounded bounce', () => {
    const token = SPRINGS.bounce;
    expect(token).toEqual({ duration: 0.6, bounce: 0.4 });
    expect(springCoefficients(token).zeta).toBeCloseTo(0.6, 6);
    let peak = 0;
    let peakAt = 0;
    for (let time = 0; time <= 1500; time++) {
      const { x } = springValue(token, time / 1000);
      if (x > peak) {
        peak = x;
        peakAt = time;
      }
    }
    // exp(−ζπ/√(1−ζ²)) = 9.48%: a clear overshoot that reads as a bounce, once.
    expect(peak).toBeCloseTo(1 + Math.exp((-0.6 * Math.PI) / 0.8), 4);
    expect(peak - 1).toBeGreaterThan(0.09);
    expect(peak - 1).toBeLessThan(0.1);
    expect(peakAt).toBeGreaterThanOrEqual(370);
    expect(peakAt).toBeLessThanOrEqual(380);
    expect(settleTime(token, REFERENCE_TRAVEL_PX)).toBe(971);
    // The −90° turn of the glyph swings about 8.5° past upright before settling.
    expect((peak - 1) * 90).toBeCloseTo(8.53, 1);
  });

  it('writes linear() curves that start at 0, end at 1 and follow the spring', () => {
    const curve = linearEasing(SPRINGS.glass);
    const stops = curve.slice('linear('.length, -1).split(',').map(Number);
    expect(stops).toHaveLength(32);
    expect(stops[0]).toBe(0);
    expect(stops[31]).toBe(1);
    const duration = settleTime(SPRINGS.glass, REFERENCE_TRAVEL_PX) / 1000;
    expect(stops[8]).toBeCloseTo(springValue(SPRINGS.glass, (duration * 8) / 31).x, 3);
    // Bounce overshoots past the target before settling.
    expect(Math.max(...stops)).toBeGreaterThan(1);
    expect(linearEasing(SPRINGS.smooth, 0, 8).split(',')).toHaveLength(8);
  });
});

describe('springs.css', () => {
  const css = readFileSync(new URL('../src/motion/springs.css', import.meta.url), 'utf8');
  const declared = (property: string) => {
    const match = new RegExp(`${property}:\\s*([^;]+);`).exec(css);
    return match?.[1]
      .replace(/\s+/g, ' ')
      .replace(/\(\s/, '(')
      .replace(/,?\s\)$/, ')')
      .trim();
  };

  it('matches the curves and settle times recomputed from spring.ts', () => {
    for (const name of Object.keys(SPRINGS) as SpringName[]) {
      expect(declared(`--spring-${name}`), name).toBe(linearEasing(SPRINGS[name]));
      expect(declared(`--spring-${name}-ms`), name).toBe(
        `${settleTime(SPRINGS[name], REFERENCE_TRAVEL_PX)}ms`,
      );
    }
  });
});
