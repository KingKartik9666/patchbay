import type { GraphDraft, GraphTransition } from '../domain/contracts';

export interface Point {
  x: number;
  y: number;
}
export interface Curve {
  transition: GraphTransition;
  a: Point;
  b: Point;
  c: Point;
  d: Point;
  label: Point;
  bounds: { left: number; top: number; right: number; bottom: number };
}

export const STATE_RADIUS = 34;

export function curvePoint(curve: Curve, t: number): Point {
  const u = 1 - t;
  return {
    x:
      u * u * u * curve.a.x +
      3 * u * u * t * curve.b.x +
      3 * u * t * t * curve.c.x +
      t * t * t * curve.d.x,
    y:
      u * u * u * curve.a.y +
      3 * u * u * t * curve.b.y +
      3 * u * t * t * curve.c.y +
      t * t * t * curve.d.y,
  };
}

/** Separate parallel arrows and spread self-loops around each state. */
export function graphCurves(draft: GraphDraft): Curve[] {
  const states = new Map(draft.states.map((state) => [state.id, state]));
  const groups = new Map<string, GraphTransition[]>();
  const pairKey = (from: string, to: string) => JSON.stringify([from, to]);
  for (const transition of draft.transitions) {
    const key = pairKey(transition.from, transition.to);
    const group = groups.get(key);
    if (group) group.push(transition);
    else groups.set(key, [transition]);
  }
  const result: Curve[] = [];
  for (const group of groups.values()) {
    for (let i = 0; i < group.length; i++) {
      const transition = group[i];
      const from = states.get(transition.from),
        to = states.get(transition.to);
      if (!from || !to) continue;
      let a: Point, b: Point, c: Point, d: Point;
      if (from.id === to.id) {
        const angle = -Math.PI / 2 + ((i % 4) * Math.PI) / 2;
        const ring = Math.floor(i / 4);
        const outward = { x: Math.cos(angle), y: Math.sin(angle) };
        const side = { x: -outward.y, y: outward.x };
        const reach = 90 + ring * 40;
        const half = 48 + ring * 16;
        a = { x: from.x + outward.x * 24 - side.x * 24, y: from.y + outward.y * 24 - side.y * 24 };
        d = { x: from.x + outward.x * 24 + side.x * 24, y: from.y + outward.y * 24 + side.y * 24 };
        b = {
          x: from.x + outward.x * reach - side.x * half,
          y: from.y + outward.y * reach - side.y * half,
        };
        c = {
          x: from.x + outward.x * reach + side.x * half,
          y: from.y + outward.y * reach + side.y * half,
        };
      } else {
        let dx = to.x - from.x,
          dy = to.y - from.y;
        let length = Math.hypot(dx, dy);
        if (length < 1) {
          dx = 90;
          dy = from.id < to.id ? 55 : -55;
          length = Math.hypot(dx, dy);
        }
        const side = { x: -dy / length, y: dx / length };
        const reciprocal = groups.has(pairKey(to.id, from.id));
        const offset = reciprocal ? 36 + i * 44 : (i - (group.length - 1) / 2) * 44;
        b = { x: from.x + dx / 3 + side.x * offset, y: from.y + dy / 3 + side.y * offset };
        c = { x: to.x - dx / 3 + side.x * offset, y: to.y - dy / 3 + side.y * offset };
        const startLength = Math.max(1, Math.hypot(b.x - from.x, b.y - from.y));
        const endLength = Math.max(1, Math.hypot(to.x - c.x, to.y - c.y));
        a = {
          x: from.x + ((b.x - from.x) / startLength) * STATE_RADIUS,
          y: from.y + ((b.y - from.y) / startLength) * STATE_RADIUS,
        };
        d = {
          x: to.x - ((to.x - c.x) / endLength) * STATE_RADIUS,
          y: to.y - ((to.y - c.y) / endLength) * STATE_RADIUS,
        };
      }
      const bounds = {
        left: Math.min(a.x, b.x, c.x, d.x),
        top: Math.min(a.y, b.y, c.y, d.y),
        right: Math.max(a.x, b.x, c.x, d.x),
        bottom: Math.max(a.y, b.y, c.y, d.y),
      };
      const curve: Curve = { transition, a, b, c, d, label: a, bounds };
      curve.label = curvePoint(curve, 0.5);
      result.push(curve);
    }
  }
  return result;
}
