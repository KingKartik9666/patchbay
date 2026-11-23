import type { Page } from '../../domain/contracts';

export type Vec3 = [number, number, number];
export const FOV = (28 * Math.PI) / 180;
export const NEAR = 0.1;
export const FAR = 40;
export const REST_EYE: Vec3 = [0, 0.9, 10];
export const REST_TARGET: Vec3 = [0.4, -0.2, -3];
const DEG = Math.PI / 180;

export interface Pose {
  yaw: number;
  pitch: number;
  distance: number;
  /** Extra x shift of the machine group (the Machines preview zone). */
  shift: number;
  /** Machine group scale, so the Machines preview fits the open right zone. */
  scale: number;
}
/** Degrees; `distance` is relative to the rest eye's 10 units. */
export const POSES: Record<Page, Pose> = {
  bench: { yaw: 0, pitch: 0, distance: 10, shift: 0, scale: 1 },
  machines: { yaw: 0, pitch: -14, distance: 10.5, shift: 1.9, scale: 0.55 },
  editor: { yaw: 0, pitch: -22, distance: 10, shift: 0, scale: 1 },
  learn: { yaw: 9, pitch: 0, distance: 10, shift: 0, scale: 1 },
};

export interface CameraInput {
  yaw: number;
  pitch: number;
  distance: number;
  /** Relative dolly, e.g. −0.05 is 5% closer. */
  dolly: number;
  /** Lateral translation in world units along the camera's right and up axes. */
  slideX: number;
  slideY: number;
  aspect: number;
}
export interface Camera {
  eye: Vec3;
  right: Vec3;
  up: Vec3;
  forward: Vec3;
  view: Float32Array;
  proj: Float32Array;
  viewProj: Float32Array;
  aspect: number;
  tanHalf: number;
}

export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const normalize = (a: Vec3): Vec3 => scale(a, 1 / (Math.hypot(...a) || 1));

export function multiply(a: Float32Array, b: Float32Array, out = new Float32Array(16)) {
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++)
      out[c * 4 + r] =
        a[r] * b[c * 4] +
        a[4 + r] * b[c * 4 + 1] +
        a[8 + r] * b[c * 4 + 2] +
        a[12 + r] * b[c * 4 + 3];
  return out;
}

/** Uniform scale and rotation (yaw about Y, then pitch about X), then a translation. */
export function rigid(
  yawDeg: number,
  pitchDeg: number,
  at: Vec3,
  size = 1,
  out = new Float32Array(16),
) {
  const cy = Math.cos(yawDeg * DEG),
    sy = Math.sin(yawDeg * DEG),
    cp = Math.cos(pitchDeg * DEG),
    sp = Math.sin(pitchDeg * DEG);
  // prettier-ignore
  out.set([cy, 0, -sy, 0, sy * sp, cp, cy * sp, 0, sy * cp, -sp, cy * cp, 0, at[0], at[1], at[2], 1]);
  for (let i = 0; i < 11; i++) out[i] *= size;
  return out;
}

export function transformPoint(m: Float32Array, p: Vec3): Vec3 {
  return [
    m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
    m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
    m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
  ];
}

/** Inverse rotation (transpose), for turning world directions into group space. */
export function inverseDirection(m: Float32Array, d: Vec3): Vec3 {
  return [
    m[0] * d[0] + m[1] * d[1] + m[2] * d[2],
    m[4] * d[0] + m[5] * d[1] + m[6] * d[2],
    m[8] * d[0] + m[9] * d[1] + m[10] * d[2],
  ];
}

/** Orbits the rest eye around the rest target; pitch < 0 raises the camera. */
export function camera(input: CameraInput): Camera {
  const offset = sub(REST_EYE, REST_TARGET),
    cy = Math.cos(input.yaw * DEG),
    sy = Math.sin(input.yaw * DEG);
  let o: Vec3 = [offset[0] * cy + offset[2] * sy, offset[1], -offset[0] * sy + offset[2] * cy];
  const flat = Math.hypot(o[0], o[2]),
    elevation = Math.atan2(o[1], flat) - input.pitch * DEG,
    length = Math.hypot(o[1], flat) * (input.distance / 10) * (1 + input.dolly);
  o = [
    (o[0] / flat) * Math.cos(elevation) * length,
    Math.sin(elevation) * length,
    (o[2] / flat) * Math.cos(elevation) * length,
  ];
  const forward = normalize(scale(o, -1)),
    right = normalize(cross(forward, [0, 1, 0])),
    up = cross(right, forward),
    eye = add(add(REST_TARGET, o), add(scale(right, input.slideX), scale(up, input.slideY))),
    tanHalf = Math.tan(FOV / 2),
    f = 1 / tanHalf;
  // prettier-ignore
  const view = new Float32Array([
    right[0], up[0], -forward[0], 0,
    right[1], up[1], -forward[1], 0,
    right[2], up[2], -forward[2], 0,
    -dot(right, eye), -dot(up, eye), dot(forward, eye), 1,
  ]);
  // prettier-ignore
  const proj = new Float32Array([
    f / input.aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, (FAR + NEAR) / (NEAR - FAR), -1,
    0, 0, (2 * FAR * NEAR) / (NEAR - FAR), 0,
  ]);
  return {
    eye,
    right,
    up,
    forward,
    view,
    proj,
    viewProj: multiply(proj, view),
    aspect: input.aspect,
    tanHalf,
  };
}

/** World point to NDC (x right, y up); `w <= 0` means behind the eye. */
export function project(cam: Camera, p: Vec3): { x: number; y: number; w: number } {
  const m = cam.viewProj,
    w = m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15];
  return {
    x: (m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12]) / w,
    y: (m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13]) / w,
    w,
  };
}

/** Unit ray direction through an NDC point. */
export function ray(cam: Camera, x: number, y: number): Vec3 {
  return normalize(
    add(
      cam.forward,
      add(scale(cam.right, x * cam.tanHalf * cam.aspect), scale(cam.up, y * cam.tanHalf)),
    ),
  );
}

/** Distance from point `p` to the ray from the eye along `dir`. */
export function rayDistance(cam: Camera, dir: Vec3, p: Vec3): number {
  const d = sub(p, cam.eye),
    t = Math.max(0, dot(d, dir));
  return Math.hypot(...sub(d, scale(dir, t)));
}
