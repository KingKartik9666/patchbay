/** Procedural meshes. Every vertex is interleaved floats; indices are 16-bit. */
export interface Mesh {
  data: Float32Array<ArrayBuffer>;
  index: Uint16Array<ArrayBuffer>;
  /** Floats per vertex. */
  stride: number;
}

/** Jack lathe profile (radius, height toward the camera): outer bezel, recessed
 * socket and pin hole. Ten points, radius 0.42. */
export const JACK_PROFILE = [
  0.42, -0.1, 0.42, 0.04, 0.4, 0.085, 0.34, 0.105, 0.27, 0.095, 0.25, 0.05, 0.24, -0.06, 0.12,
  -0.07, 0.075, -0.05, 0.05, -0.16,
];
/** Shader zone per profile point (0 body, 1 ring, 2 collar, 3 hole); zones decide
 * emission in the fragment shader. */
export const JACK_ZONES = [0, 0, 1, 1, 2, 2, 3, 3, 3];
/** Floor socket bezel, six points, lying on the floor plane. */
export const BEZEL_PROFILE = [0.3, 0, 0.3, 0.035, 0.26, 0.065, 0.18, 0.065, 0.15, 0.02, 0.1, 0];

/** Surface of revolution. Each profile segment gets its own vertex rings, so
 * normals stay crisp at the machined edges. Layout: position3, normal3, zone. */
export function lathe(profile: number[], zones: number[], segments: number, axis: 'y' | 'z'): Mesh {
  const points = profile.length / 2 - 1,
    ring = segments + 1,
    data = new Float32Array(points * ring * 2 * 7),
    index = new Uint16Array(points * segments * 6);
  let v = 0,
    i = 0;
  for (let s = 0; s < points; s++) {
    const r0 = profile[s * 2],
      h0 = profile[s * 2 + 1],
      r1 = profile[s * 2 + 2],
      h1 = profile[s * 2 + 3],
      length = Math.hypot(r1 - r0, h1 - h0) || 1,
      nr = (h1 - h0) / length,
      nh = -(r1 - r0) / length,
      base = v / 7;
    for (let end = 0; end < 2; end++) {
      const r = end ? r1 : r0,
        h = end ? h1 : h0;
      for (let k = 0; k < ring; k++) {
        const a = (k / segments) * Math.PI * 2,
          c = Math.cos(a),
          n = Math.sin(a);
        if (axis === 'z') data.set([r * c, r * n, h, nr * c, nr * n, nh, zones[s] ?? 0], v);
        else data.set([r * c, h, r * n, nr * c, nh, nr * n, zones[s] ?? 0], v);
        v += 7;
      }
    }
    for (let k = 0; k < segments; k++) {
      const a = base + k,
        b = a + ring;
      index.set([a, b, a + 1, a + 1, b, b + 1], i);
      i += 6;
    }
  }
  return { data, index, stride: 7 };
}

/** Grid of (t, angle) for the instanced cable tube; the vertex shader places it. */
export function tube(radial = 8, length = 32): Mesh {
  const data = new Float32Array((length + 1) * (radial + 1) * 2),
    index = new Uint16Array(length * radial * 6);
  let v = 0,
    i = 0;
  for (let l = 0; l <= length; l++)
    for (let r = 0; r <= radial; r++) {
      data[v++] = l / length;
      data[v++] = (r / radial) * Math.PI * 2;
    }
  for (let l = 0; l < length; l++)
    for (let r = 0; r < radial; r++) {
      const a = l * (radial + 1) + r,
        b = a + radial + 1;
      index.set([a, b, a + 1, a + 1, b, b + 1], i);
      i += 6;
    }
  return { data, index, stride: 2 };
}

/** Plug sleeves at t = 0 and t = 1 plus the Mealy ferrule at t = 0.5, as
 * profiles along the cable. Layout: at, s (along the cable), angle, radius,
 * radial normal, axial normal. */
export function fittings(radial = 12): Mesh {
  const parts: [number, number[]][] = [
    [0, [0, 0.048, 0.025, 0.07, 0.225, 0.07, 0.25, 0.05]],
    [1, [0, 0.048, 0.025, 0.07, 0.225, 0.07, 0.25, 0.05]],
    [0.5, [-0.07, 0.048, -0.05, 0.066, 0.05, 0.066, 0.07, 0.048]],
  ];
  const ring = radial + 1,
    segments = parts.reduce((sum, [, p]) => sum + p.length / 2 - 1, 0),
    data = new Float32Array(segments * ring * 2 * 6),
    index = new Uint16Array(segments * radial * 6);
  let v = 0,
    i = 0;
  for (const [at, p] of parts)
    for (let s = 0; s + 3 < p.length; s += 2) {
      const ds = p[s + 2] - p[s],
        dr = p[s + 3] - p[s + 1],
        length = Math.hypot(ds, dr) || 1,
        base = v / 6;
      for (let end = 0; end < 2; end++)
        for (let k = 0; k < ring; k++) {
          data.set(
            [
              at,
              p[s + end * 2],
              (k / radial) * Math.PI * 2,
              p[s + 1 + end * 2],
              ds / length,
              -dr / length,
            ],
            v,
          );
          v += 6;
        }
      for (let k = 0; k < radial; k++) {
        const a = base + k,
          b = a + ring;
        index.set([a, b, a + 1, a + 1, b, b + 1], i);
        i += 6;
      }
    }
  return { data, index, stride: 6 };
}

/** One quad for the signal bead billboard. */
export const QUAD = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]);
