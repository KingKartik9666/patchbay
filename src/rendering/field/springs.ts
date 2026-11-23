/** Field springs. Self-contained (no import from src/motion) and stepped by the
 * FrameClock's dt in closed form, so a long frame never destabilises them. */
export interface SpringParams {
  duration: number;
  bounce: number;
}

export const FIELD_SPRINGS = {
  drift: { duration: 1.8, bounce: 0 },
  light: { duration: 0.35, bounce: 0 },
  parallax: { duration: 0.9, bounce: 0 },
  cable: { duration: 1.1, bounce: 0.12 },
  tilt: { duration: 0.6, bounce: 0 },
} satisfies Record<string, SpringParams>;

/** Apple's duration/bounce model with unit mass: k = (2π/d)², ζ = 1 − b. */
export function springCoefficients(p: SpringParams): { k: number; c: number; zeta: number } {
  const k = ((2 * Math.PI) / p.duration) ** 2;
  const zeta = p.bounce >= 0 ? 1 - p.bounce : 1 / (1 + p.bounce);
  return { k, c: 2 * zeta * Math.sqrt(k), zeta };
}

/** Exact displacement and velocity after `dt` seconds, from displacement `x`
 * (value minus target) and velocity `v`. */
export function springStep(
  x: number,
  v: number,
  omega: number,
  zeta: number,
  dt: number,
): [number, number] {
  if (zeta < 0.9999) {
    const wd = omega * Math.sqrt(1 - zeta * zeta),
      decay = Math.exp(-zeta * omega * dt),
      b = (v + zeta * omega * x) / wd,
      cos = Math.cos(wd * dt),
      sin = Math.sin(wd * dt);
    return [
      decay * (x * cos + b * sin),
      decay * ((b * wd - zeta * omega * x) * cos - (x * wd + zeta * omega * b) * sin),
    ];
  }
  const c = v + omega * x,
    decay = Math.exp(-omega * dt);
  return [(x + c * dt) * decay, (c - omega * (x + c * dt)) * decay];
}

export class Spring {
  value: number;
  target: number;
  velocity = 0;
  private omega: number;
  private zeta: number;
  constructor(params: SpringParams, value = 0) {
    const { k, zeta } = springCoefficients(params);
    this.omega = Math.sqrt(k);
    this.zeta = zeta;
    this.value = this.target = value;
  }
  step(dt: number): number {
    if (dt > 0 && !this.settled()) {
      const [x, v] = springStep(this.value - this.target, this.velocity, this.omega, this.zeta, dt);
      this.value = this.target + x;
      this.velocity = v;
    }
    return this.value;
  }
  snap(value = this.target): void {
    this.value = this.target = value;
    this.velocity = 0;
  }
  /** Adds velocity without moving the target: an impulse that returns to rest. */
  kick(velocity: number): void {
    this.velocity += velocity;
  }
  settled(epsilon = 1e-4): boolean {
    return Math.abs(this.value - this.target) < epsilon && Math.abs(this.velocity) < epsilon * 10;
  }
}

/** Independent X and Y springs, so 2D motion never desynchronises. */
export class Spring2 {
  readonly x: Spring;
  readonly y: Spring;
  constructor(params: SpringParams, x = 0, y = 0) {
    this.x = new Spring(params, x);
    this.y = new Spring(params, y);
  }
  set(x: number, y: number): void {
    this.x.target = x;
    this.y.target = y;
  }
  step(dt: number): void {
    this.x.step(dt);
    this.y.step(dt);
  }
  snap(x: number, y: number): void {
    this.x.snap(x);
    this.y.snap(y);
  }
  settled(epsilon?: number): boolean {
    return this.x.settled(epsilon) && this.y.settled(epsilon);
  }
}
