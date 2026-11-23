import type { MachineDef, Step } from '../../domain/contracts';
import { buildDiagram } from '../../diagram/layout';
import {
  type Camera,
  type Vec3,
  dot,
  inverseDirection,
  normalize,
  project,
  ray,
  rayDistance,
  scale,
  sub,
  transformPoint,
} from './camera';
import { FIELD_SPRINGS, Spring } from './springs';

export const JACK_CAP = 32;
export const CABLE_CAP = 48;
/** World half-extent of the normalised layout. */
export const JACK_SPAN = 3.2;
/** Floats per instance; the renderer's attribute layout mirrors these. */
export const JACK_FLOATS = 9;
export const CABLE_FLOATS = 18;
/** Leaving and arriving objects coexist during a morph. */
export const JACK_CAPACITY = JACK_CAP * 2;
export const CABLE_CAPACITY = (CABLE_CAP + 1) * 2;

export interface JackModel {
  id: string;
  position: Vec3;
  start: boolean;
}
export interface CableModel {
  id: string;
  from: string;
  to: string;
  loop: boolean;
  /** Reciprocal pairs take opposite lanes so their cables do not overlap. */
  lane: -1 | 0 | 1;
  stub: boolean;
}
export interface SceneModel {
  kind: 'mealy' | 'moore';
  jacks: JackModel[];
  cables: CableModel[];
  dropped: { jacks: number; cables: number };
  /** Jack scale, below 1 only when neighbours would otherwise overlap. */
  jackSize: number;
}

/** Same key as the layout's edge id, so playback steps find their cable. */
export const cableId = (from: string, to: string) => JSON.stringify([from, to]);
const STUB = '\u0000start';

/** Jacks and cables from the 2D layout: positions normalised to [−1, 1] and
 * scaled to JACK_SPAN, depth alternating ±0.35 by state order. Parallel
 * transitions are already merged into one edge per ordered pair. */
export function deriveScene(machine: MachineDef): SceneModel {
  const layout = buildDiagram(machine, { w: 1000, h: 600 }),
    kept = layout.nodes.filter((node) => node.order < JACK_CAP);
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity;
  for (const node of kept) {
    minX = Math.min(minX, node.x);
    maxX = Math.max(maxX, node.x);
    minY = Math.min(minY, node.y);
    maxY = Math.max(maxY, node.y);
  }
  const half = Math.max((maxX - minX) / 2, (maxY - minY) / 2) || 1,
    cx = (minX + maxX) / 2,
    cy = (minY + maxY) / 2,
    ids = new Set(kept.map((node) => node.id));
  const jacks = kept.map((node): JackModel => ({
    id: node.id,
    position: [
      ((node.x - cx) / half) * JACK_SPAN,
      (-(node.y - cy) / half) * JACK_SPAN,
      node.order % 2 ? -0.35 : 0.35,
    ],
    start: node.id === machine.start,
  }));
  const edges = layout.edges.filter((edge) => ids.has(edge.from) && ids.has(edge.to)),
    pairs = new Set(edges.map((edge) => edge.id));
  const cables = edges.slice(0, CABLE_CAP).map((edge): CableModel => ({
    id: edge.id,
    from: edge.from,
    to: edge.to,
    loop: edge.from === edge.to,
    lane:
      edge.from !== edge.to && pairs.has(cableId(edge.to, edge.from))
        ? edge.from < edge.to
          ? 1
          : -1
        : 0,
    stub: false,
  }));
  if (ids.has(machine.start))
    cables.push({
      id: STUB,
      from: machine.start,
      to: machine.start,
      loop: false,
      lane: 0,
      stub: true,
    });
  let nearest = Infinity;
  for (let i = 0; i < jacks.length; i++)
    for (let j = i + 1; j < jacks.length; j++) {
      const a = jacks[i].position,
        b = jacks[j].position;
      nearest = Math.min(nearest, Math.hypot(a[0] - b[0], a[1] - b[1]));
    }
  return {
    kind: machine.outputs.kind,
    jacks,
    cables,
    dropped: {
      jacks: layout.nodes.length - kept.length,
      cables: Math.max(0, edges.length - CABLE_CAP),
    },
    jackSize: Math.max(0.45, Math.min(1, nearest / 1.05)),
  };
}

const FACE = 0.1;
/** Writes the cubic P0..P3 (12 floats) of a cable in group space. Cables hang
 * from plug to plug with a sag of 0.6–1.1 by span and bow 0.3 toward the
 * camera; a self-loop is a raised arc over its jack; the start stub enters
 * from the left. */
export function cableCurve(
  a: Vec3,
  b: Vec3,
  cable: Pick<CableModel, 'loop' | 'lane' | 'stub'>,
  out: Float32Array,
  at = 0,
  size = 1,
): void {
  const [x, y, z] = a,
    s = size;
  let points: number[];
  if (cable.stub) {
    // prettier-ignore
    points = [x, y, z + FACE, x - 0.9, y - 0.75, z + 0.6, x - 2.2, y - 1.3, z + 0.6, x - 3.4, y - 0.9, z + 0.4];
  } else if (cable.loop) {
    // prettier-ignore
    points = [x - 0.17 * s, y + 0.12 * s, z + FACE, x - 0.8 * s, y + 1.4 * s, z + 0.5, x + 0.8 * s, y + 1.4 * s, z + 0.5, x + 0.17 * s, y + 0.12 * s, z + FACE];
  } else {
    const dx = b[0] - x,
      dy = b[1] - y,
      dz = b[2] - z,
      planar = Math.hypot(dx, dy) || 1,
      sag = 0.6 + 0.5 * Math.min(1, Math.hypot(dx, dy, dz) / 6.4),
      k = 4 / 3,
      lane = cable.lane * 0.28,
      ox = (-dy / planar) * lane * k,
      oy = ((dx / planar) * lane - sag) * k,
      oz = 0.3 * k;
    // prettier-ignore
    points = [
      x, y, z + FACE,
      x + dx / 3 + ox, y + dy / 3 + oy, z + FACE + dz / 3 + oz,
      x + (2 * dx) / 3 + ox, y + (2 * dy) / 3 + oy, z + FACE + (2 * dz) / 3 + oz,
      b[0], b[1], b[2] + FACE,
    ];
  }
  out.set(points, at);
}

/** The cubic plus the bend term B·sin(πt), exactly as the vertex shader does. */
export function cubicPoint(c: ArrayLike<number>, at: number, t: number, bend: Vec3): Vec3 {
  const a = 1 - t,
    w0 = a * a * a,
    w1 = 3 * a * a * t,
    w2 = 3 * a * t * t,
    w3 = t * t * t,
    s = Math.sin(Math.PI * t);
  return [0, 1, 2].map(
    (i) =>
      w0 * c[at + i] + w1 * c[at + 3 + i] + w2 * c[at + 6 + i] + w3 * c[at + 9 + i] + bend[i] * s,
  ) as Vec3;
}

export interface PlaybackView {
  start: string;
  cursor: number;
  playing: boolean;
  steps: readonly Step[];
  travel: { step?: Step; progress: number };
  fault?: { at: number; state: string };
}
export interface LiveSignals {
  jack: string;
  cable: string | null;
  bead: { cable: string; progress: number } | null;
  running: boolean;
  done: boolean;
  fault: string | null;
}
/** Live jack and cable from the playback cursor; the bead follows the same
 * travel progress as the 2D pulse, so the two can never drift apart. */
export function liveSignals(view: PlaybackView): LiveSignals {
  const last = view.cursor > 0 ? view.steps[view.cursor - 1] : undefined,
    moving = view.travel.step,
    done = view.steps.length > 0 && view.cursor === view.steps.length && !view.playing,
    faulted =
      !!view.fault && !view.playing && view.cursor >= Math.min(view.fault.at, view.steps.length);
  return {
    jack: last?.to ?? view.start,
    cable: moving ? cableId(moving.from, moving.to) : last ? cableId(last.from, last.to) : null,
    bead: moving
      ? { cable: cableId(moving.from, moving.to), progress: view.travel.progress }
      : null,
    running: view.playing || (!!moving && view.travel.progress > 0),
    done,
    fault: faulted ? view.fault!.state : null,
  };
}

export interface SceneFrame {
  dt: number;
  cam: Camera;
  group: Float32Array;
  /** CSS pixels. */
  width: number;
  height: number;
  /** Smoothed pointer (the key light) in NDC, or null at rest. */
  pointer: { x: number; y: number } | null;
  /** Light position in group space, for jack tilt. */
  light: Vec3;
  /** 1, or 0.4 while the user works or a run plays. */
  calm: number;
  hover: string | null;
  live: LiveSignals | null;
}

interface JackState {
  model: JackModel;
  p: [Spring, Spring, Spring];
  size: Spring;
  tilt: [Spring, Spring];
  keep: boolean;
}
interface CableState {
  model: CableModel;
  presence: Spring;
  bend: [Spring, Spring, Spring];
  keep: boolean;
}

const smoothstep = (edge0: number, edge1: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};

/** Morphs between scene models and fills the instance buffers each frame.
 * Per-frame CPU work is bounded by the caps: ≤ 64 jacks and ≤ 98 cables. */
export class SceneAnimator {
  readonly jackData = new Float32Array(JACK_CAPACITY * JACK_FLOATS);
  readonly cableData = new Float32Array(CABLE_CAPACITY * CABLE_FLOATS);
  jackCount = 0;
  cableCount = 0;
  readonly ferrule = new Spring(FIELD_SPRINGS.drift, 0);
  readonly collar = new Spring(FIELD_SPRINGS.drift, 0);
  readonly jackSize = new Spring(FIELD_SPRINGS.drift, 1);
  private jacks = new Map<string, JackState>();
  private cables = new Map<string, CableState>();
  private curve = new Float32Array(12);
  /** Cable index in cableData by id, for the bead and the live cable. */
  readonly cableIndex = new Map<string, number>();

  setModel(model: SceneModel, instant: boolean): void {
    for (const state of this.jacks.values()) state.keep = false;
    for (const state of this.cables.values()) state.keep = false;
    for (const jack of model.jacks) {
      let state = this.jacks.get(jack.id);
      if (!state) {
        state = {
          model: jack,
          p: jack.position.map((v) => new Spring(FIELD_SPRINGS.drift, v)) as JackState['p'],
          size: new Spring(FIELD_SPRINGS.drift, 0),
          tilt: [new Spring(FIELD_SPRINGS.tilt), new Spring(FIELD_SPRINGS.tilt)],
          keep: true,
        };
        this.jacks.set(jack.id, state);
      }
      state.model = jack;
      state.keep = true;
      state.size.target = 1;
      jack.position.forEach((v, i) => (state.p[i].target = v));
    }
    for (const cable of model.cables) {
      let state = this.cables.get(cable.id);
      if (!state) {
        state = {
          model: cable,
          presence: new Spring(FIELD_SPRINGS.drift, 0),
          bend: [
            new Spring(FIELD_SPRINGS.cable),
            new Spring(FIELD_SPRINGS.cable),
            new Spring(FIELD_SPRINGS.cable),
          ],
          keep: true,
        };
        this.cables.set(cable.id, state);
      }
      state.model = cable;
      state.keep = true;
      state.presence.target = 1;
    }
    for (const state of this.jacks.values()) if (!state.keep) state.size.target = 0;
    for (const state of this.cables.values()) if (!state.keep) state.presence.target = 0;
    this.ferrule.target = model.kind === 'mealy' ? 1 : 0;
    this.collar.target = model.kind === 'moore' ? 1 : 0;
    if (model.jacks.length) this.jackSize.target = model.jackSize;
    if (instant) this.snap();
  }

  /** Jumps every spring to its target (reduced motion and still frames). */
  snap(): void {
    for (const [id, state] of this.jacks) {
      if (!state.keep) this.jacks.delete(id);
      else {
        state.p.forEach((spring) => spring.snap());
        state.size.snap();
        state.tilt.forEach((spring) => spring.snap(0));
      }
    }
    for (const [id, state] of this.cables) {
      if (!state.keep) this.cables.delete(id);
      else {
        state.presence.snap();
        state.bend.forEach((spring) => spring.snap(0));
      }
    }
    this.ferrule.snap();
    this.collar.snap();
    this.jackSize.snap();
  }

  settled(): boolean {
    if (!this.ferrule.settled() || !this.collar.settled() || !this.jackSize.settled()) return false;
    for (const state of this.jacks.values())
      if (
        !state.size.settled() ||
        state.p.some((s) => !s.settled()) ||
        state.tilt.some((s) => !s.settled())
      )
        return false;
    for (const state of this.cables.values())
      if (!state.presence.settled() || state.bend.some((s) => !s.settled(2e-4))) return false;
    return true;
  }

  /** Jack position in group space (current, animated). */
  jackPosition(id: string): Vec3 | undefined {
    const state = this.jacks.get(id);
    return state && [state.p[0].value, state.p[1].value, state.p[2].value];
  }

  update(frame: SceneFrame): void {
    const { dt, cam, group, pointer, calm, hover, live } = frame,
      dir = pointer && ray(cam, pointer.x, pointer.y),
      sigma = 0.14 * Math.min(frame.width, frame.height),
      maxTilt = (6 * Math.PI) / 180;
    this.ferrule.step(dt);
    this.collar.step(dt);
    const size = this.jackSize.step(dt);
    let j = 0;
    for (const [id, state] of this.jacks) {
      state.size.step(dt);
      state.p.forEach((spring) => spring.step(dt));
      if (!state.keep && state.size.value < 0.01 && state.size.target === 0) {
        this.jacks.delete(id);
        continue;
      }
      if (j >= JACK_CAPACITY) continue;
      const local: Vec3 = [state.p[0].value, state.p[1].value, state.p[2].value],
        world = transformPoint(group, local),
        near = dir ? smoothstep(1.2, 0.3, rayDistance(cam, dir, world)) : 0,
        toLight = sub(frame.light, local),
        depth = Math.max(0.5, toLight[2]);
      state.tilt[0].target = -Math.max(-1, Math.min(1, toLight[1] / depth)) * maxTilt * near;
      state.tilt[1].target = Math.max(-1, Math.min(1, toLight[0] / depth)) * maxTilt * near;
      state.tilt.forEach((spring) => spring.step(dt));
      this.jackData.set(
        [
          ...local,
          state.size.value * size,
          state.tilt[0].value,
          state.tilt[1].value,
          live && live.jack === id ? 1 : 0,
          0.12 * near + (hover === id ? 0.12 : 0),
          live && live.fault === id ? 1 : 0,
        ],
        j * JACK_FLOATS,
      );
      j++;
    }
    this.jackCount = j;
    this.cableIndex.clear();
    let c = 0;
    for (const [id, state] of this.cables) {
      state.presence.step(dt);
      const from = this.jackPosition(state.model.from),
        to = this.jackPosition(state.model.to);
      if (
        (!state.keep && state.presence.value < 0.01 && state.presence.target === 0) ||
        !from ||
        !to
      ) {
        if (!state.keep) this.cables.delete(id);
        continue;
      }
      if (c >= CABLE_CAPACITY) continue;
      cableCurve(from, to, state.model, this.curve, 0, size);
      const target: Vec3 = [0, 0, 0];
      if (dir && !state.model.stub) {
        const mid = transformPoint(group, cubicPoint(this.curve, 0, 0.5, [0, 0, 0])),
          screen = project(cam, mid),
          px = ((screen.x - pointer.x) * frame.width) / 2,
          py = ((screen.y - pointer.y) * frame.height) / 2,
          strength = 0.35 * Math.exp(-(px * px + py * py) / (2 * sigma * sigma)) * calm;
        if (strength > 1e-3 && screen.w > 0) {
          const along = dot(sub(mid, cam.eye), dir),
            toward = normalize(sub(scale(dir, along), sub(mid, cam.eye))),
            local = normalize(inverseDirection(group, toward));
          for (let i = 0; i < 3; i++) target[i] = local[i] * Math.min(0.4, strength);
        }
      }
      if (hover && (state.model.from === hover || state.model.to === hover)) target[1] += 0.1;
      state.bend.forEach((spring, i) => {
        spring.target = target[i];
        spring.step(dt);
      });
      this.cableIndex.set(id, c);
      this.cableData.set(this.curve, c * CABLE_FLOATS);
      this.cableData.set(
        [
          state.bend[0].value,
          state.bend[1].value,
          state.bend[2].value,
          state.presence.value,
          live && live.cable === id ? 1 : 0,
          0,
        ],
        c * CABLE_FLOATS + 12,
      );
      c++;
    }
    this.cableCount = c;
  }

  /** Bead position on a cable at `progress`, in group space, including bend. */
  beadPosition(id: string, progress: number): Vec3 | null {
    const index = this.cableIndex.get(id);
    if (index === undefined) return null;
    const at = index * CABLE_FLOATS,
      d = this.cableData;
    return cubicPoint(d, at, progress, [d[at + 12], d[at + 13], d[at + 14]]);
  }
}
