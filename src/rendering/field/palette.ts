import type { Vec3 } from './camera';
import { toLinear } from './shaders';

export type { Vec3 } from './camera';

/** Linear-light colours and lighting weights the field shaders read for one theme. */
export interface Palette {
  top: Vec3;
  bot: Vec3;
  haze: Vec3;
  fog: Vec3;
  sky: Vec3;
  gnd: Vec3;
  key: Vec3;
  jack: Vec3;
  cable: Vec3;
  sleeve: Vec3;
  bezel: Vec3;
  live: Vec3;
  fault: Vec3;
  glow: Vec3;
  amb: number;
  halo: number;
  glowStrength: number;
}

/** '#RRGGBB' to linear-light RGB. */
export function hex(value: string): Vec3 {
  return [1, 3, 5].map((i) => toLinear(parseInt(value.slice(i, i + 2), 16) / 255)) as Vec3;
}

/**
 * Night: sage-graphite jacks under the reference's pistachio live signal. Every non-live value
 * stays under the field cap and the glass clamp handles the rest (DESIGN.md, The field).
 */
export const DARK: Palette = {
  top: hex('#0C0D0D'),
  bot: hex('#0C0D0D'),
  haze: hex('#121413'),
  fog: hex('#0C0D0D'),
  sky: hex('#151816'),
  gnd: hex('#080908'),
  // The cursor key light, a touch of pistachio warmth.
  key: hex('#F1F6EE'),
  jack: hex('#222524'),
  cable: hex('#2B2F2D'),
  sleeve: hex('#3A3F3C'),
  bezel: hex('#1A1C1B'),
  live: hex('#DCF1CF'),
  fault: hex('#EFB0AA'),
  glow: hex('#CBEABA'),
  amb: 3,
  halo: 0.38,
  glowStrength: 0.95,
};

/** Pearl: pearl jacks on a luminous floor, black plug sleeves, PlayStation blue live signal. */
export const LIGHT: Palette = {
  top: hex('#F6F7FA'),
  bot: hex('#DFE3EA'),
  haze: hex('#FFFFFF'),
  fog: hex('#E8EBF1'),
  sky: hex('#FFFFFF'),
  gnd: hex('#CFD5DE'),
  key: hex('#FFFFFF'),
  jack: hex('#E9ECF1'),
  cable: hex('#9BA3B0'),
  sleeve: hex('#2C3038'),
  bezel: hex('#D3D8E0'),
  live: hex('#0070D1'),
  fault: hex('#C9504A'),
  glow: hex('#2E8BEA'),
  amb: 1,
  halo: 0.3,
  glowStrength: 0.5,
};

/** The light clamp's floor colour (Pearl --field-1). */
export const FLOOR_COLOUR: Vec3 = hex('#F3F4F7');

/** Night at 0, Pearl at 1; channels interpolate in linear light. */
export function mixPalette(t: number): Palette {
  const out = {} as Record<keyof Palette, Vec3 | number>;
  for (const key of Object.keys(DARK) as (keyof Palette)[]) {
    const a = DARK[key],
      b = LIGHT[key];
    out[key] =
      typeof a === 'number'
        ? a + ((b as number) - a) * t
        : (a.map((v, i) => v + ((b as Vec3)[i] - v) * t) as Vec3);
  }
  return out as unknown as Palette;
}
