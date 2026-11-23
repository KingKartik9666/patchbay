import { describe, expect, it } from 'vitest';
import type { MachineDef, Step } from '../src/domain/contracts';
import {
  CABLE_CAP,
  JACK_CAP,
  SceneAnimator,
  cableCurve,
  cableId,
  cubicPoint,
  deriveScene,
  liveSignals,
} from '../src/rendering/field/scene';
import { decideMode, type ModeInput } from '../src/rendering/field/bridge';
import { FLOOR_COLOUR } from '../src/rendering/field/palette';
import {
  FIELD_SPRINGS,
  Spring,
  springCoefficients,
  springStep,
} from '../src/rendering/field/springs';
import {
  GLASS,
  capField,
  clampDark,
  floorLight,
  frostLod,
  lensOffset,
  luminance,
  toLinear,
} from '../src/rendering/field/shaders';

const ring = (count: number, kind: 'mealy' | 'moore' = 'mealy'): MachineDef => {
  const states = Array.from({ length: count }, (_, i) => `S${i}`);
  return {
    states,
    alphabet: ['0', '1'],
    start: 'S0',
    delta: Object.fromEntries(
      states.map((s, i) => [s, { '0': states[(i + 1) % count], '1': states[(i + 2) % count] }]),
    ),
    outputs:
      kind === 'mealy'
        ? {
            kind,
            lambda: Object.fromEntries(states.map((s) => [s, { '0': 'a', '1': 'b' }])),
          }
        : { kind, lambda: Object.fromEntries(states.map((s) => [s, 'x'])) },
  };
};

describe('field scene derivation', () => {
  it('caps jacks at 32 and cables at 48, plus the start stub', () => {
    const scene = deriveScene(ring(40));
    expect(scene.jacks).toHaveLength(JACK_CAP);
    expect(scene.dropped.jacks).toBe(8);
    const regular = scene.cables.filter((cable) => !cable.stub);
    expect(regular).toHaveLength(CABLE_CAP);
    expect(scene.dropped.cables).toBeGreaterThan(0);
    expect(scene.cables.filter((cable) => cable.stub)).toHaveLength(1);
    const ids = new Set(scene.jacks.map((jack) => jack.id));
    for (const cable of regular) expect(ids.has(cable.from) && ids.has(cable.to)).toBe(true);
  });

  it('normalises positions to the jack span and alternates depth', () => {
    const scene = deriveScene(ring(6));
    for (const jack of scene.jacks) {
      expect(Math.abs(jack.position[0])).toBeLessThanOrEqual(3.2 + 1e-9);
      expect(Math.abs(jack.position[1])).toBeLessThanOrEqual(3.2 + 1e-9);
      expect(Math.abs(jack.position[2])).toBe(0.35);
    }
    expect(scene.jacks.find((jack) => jack.start)?.id).toBe('S0');
  });

  it('merges parallel transitions and marks self-loops and reciprocal lanes', () => {
    const machine: MachineDef = {
      states: ['A', 'B'],
      alphabet: ['0', '1', '2'],
      start: 'A',
      delta: { A: { '0': 'B', '1': 'B', '2': 'A' }, B: { '0': 'A', '1': 'B', '2': 'B' } },
      outputs: { kind: 'moore', lambda: { A: '0', B: '1' } },
    };
    const cables = deriveScene(machine).cables.filter((cable) => !cable.stub);
    expect(cables.map((cable) => cable.id).sort()).toEqual(
      [cableId('A', 'B'), cableId('A', 'A'), cableId('B', 'A'), cableId('B', 'B')].sort(),
    );
    const ab = cables.find((cable) => cable.id === cableId('A', 'B'))!,
      ba = cables.find((cable) => cable.id === cableId('B', 'A'))!;
    expect(ab.lane + ba.lane).toBe(0);
    expect(Math.abs(ab.lane)).toBe(1);
    expect(
      cables
        .filter((cable) => cable.loop)
        .map((cable) => cable.from)
        .sort(),
    ).toEqual(['A', 'B']);
  });

  it('hangs cables with a 0.6–1.1 sag and a 0.3 bow toward the camera', () => {
    const out = new Float32Array(12);
    for (const span of [1, 3, 8]) {
      cableCurve([0, 0, 0], [span, 0, 0], { loop: false, lane: 0, stub: false }, out);
      const mid = cubicPoint(out, 0, 0.5, [0, 0, 0]);
      expect(mid[1]).toBeLessThanOrEqual(-0.6 + 1e-6);
      expect(mid[1]).toBeGreaterThanOrEqual(-1.1 - 1e-6);
      expect(mid[2] - 0.1).toBeCloseTo(0.3, 6);
    }
    cableCurve([0, 0, 0], [0, 0, 0], { loop: true, lane: 0, stub: false }, out);
    expect(cubicPoint(out, 0, 0.5, [0, 0, 0])[1]).toBeGreaterThan(0.9);
    const bent = cubicPoint(out, 0, 0.5, [0, 0.2, 0])[1] - cubicPoint(out, 0, 0.5, [0, 0, 0])[1];
    expect(bent).toBeCloseTo(0.2, 6);
  });

  it('flags Mealy ferrules and Moore collars', () => {
    const mealy = new SceneAnimator(),
      moore = new SceneAnimator();
    mealy.setModel(deriveScene(ring(3, 'mealy')), true);
    moore.setModel(deriveScene(ring(3, 'moore')), true);
    expect([mealy.ferrule.value, mealy.collar.value]).toEqual([1, 0]);
    expect([moore.ferrule.value, moore.collar.value]).toEqual([0, 1]);
    expect(deriveScene(ring(3, 'moore')).kind).toBe('moore');
  });
});

describe('field live signals', () => {
  const steps: Step[] = [
    { i: 0, from: 'S0', sym: '0', to: 'S1', out: 'a' },
    { i: 1, from: 'S1', sym: '1', to: 'S0', out: 'b' },
  ];
  it('lights the start jack at cursor 0 and follows the 2D travel progress', () => {
    const idle = liveSignals({
      start: 'S0',
      cursor: 0,
      playing: false,
      steps,
      travel: { progress: 0 },
    });
    expect(idle).toMatchObject({
      jack: 'S0',
      cable: null,
      bead: null,
      running: false,
      done: false,
    });
    const moving = liveSignals({
      start: 'S0',
      cursor: 1,
      playing: true,
      steps,
      travel: { step: steps[1], progress: 0.37 },
    });
    expect(moving.jack).toBe('S1');
    expect(moving.bead).toEqual({ cable: cableId('S1', 'S0'), progress: 0.37 });
    expect(moving.running).toBe(true);
  });
  it('reports a finished run and a reached fault', () => {
    const done = liveSignals({
      start: 'S0',
      cursor: 2,
      playing: false,
      steps,
      travel: { progress: 0 },
      fault: { at: 2, state: 'S0' },
    });
    expect(done).toMatchObject({ jack: 'S0', cable: cableId('S1', 'S0'), done: true, fault: 'S0' });
  });
});

describe('field mode decision', () => {
  const base: ModeInput = {
    off: false,
    forcedColors: false,
    quality: 'medium',
    webgl2: true,
    contextLosses: 0,
    autoTier: null,
  };
  it('decides off, then static, then webgl', () => {
    expect(decideMode(base)).toEqual({ mode: 'webgl', tier: 'medium', reason: null });
    expect(decideMode({ ...base, quality: 'high' }).tier).toBe('high');
    expect(decideMode({ ...base, off: true, quality: 'low' }).mode).toBe('off');
    expect(decideMode({ ...base, forcedColors: true }).mode).toBe('off');
    expect(decideMode({ ...base, quality: 'low' }).mode).toBe('static');
    expect(decideMode({ ...base, webgl2: false }).mode).toBe('static');
    expect(decideMode({ ...base, contextLosses: 1 }).mode).toBe('webgl');
    expect(decideMode({ ...base, contextLosses: 2 }).mode).toBe('static');
  });
  it('lets the auto-tier lower but never raise the preference', () => {
    expect(decideMode({ ...base, quality: 'high', autoTier: 'medium' })).toEqual({
      mode: 'webgl',
      tier: 'medium',
      reason: 'auto-tier',
    });
    expect(decideMode({ ...base, autoTier: 'high' }).tier).toBe('medium');
    expect(decideMode({ ...base, autoTier: 'static' }).mode).toBe('static');
  });
});

describe('field springs', () => {
  it("uses Apple's duration/bounce model", () => {
    const { k, c } = springCoefficients({ duration: 0.5, bounce: 0.3 });
    expect(k).toBeCloseTo(157.9, 1);
    expect(c).toBeCloseTo(17.6, 1);
  });
  it('steps in closed form, so one long step equals many short ones', () => {
    for (const params of Object.values(FIELD_SPRINGS)) {
      const { k, zeta } = springCoefficients(params),
        omega = Math.sqrt(k);
      let [x, v] = [1, -2];
      for (let i = 0; i < 30; i++) [x, v] = springStep(x, v, omega, zeta, 1 / 60);
      const [x2, v2] = springStep(1, -2, omega, zeta, 0.5);
      expect(x).toBeCloseTo(x2, 9);
      expect(v).toBeCloseTo(v2, 9);
    }
  });
  it('settles critically damped springs without overshoot', () => {
    const spring = new Spring(FIELD_SPRINGS.drift, 0);
    spring.target = 1;
    let peak = 0;
    for (let i = 0; i < 600; i++) peak = Math.max(peak, spring.step(1 / 60));
    expect(peak).toBeLessThanOrEqual(1);
    expect(spring.settled()).toBe(true);
  });
});

describe('field glass clamp', () => {
  const hexL = (value: string) =>
    luminance(
      ...([1, 3, 5].map((i) => toLinear(parseInt(value.slice(i, i + 2), 16) / 255)) as [
        number,
        number,
        number,
      ]),
    );
  it('keeps dark glass backdrops under the audited #454545 even with dither', () => {
    const audited = hexL('#454545');
    for (const l of [0, 0.03, 0.04, 0.06, 0.2, 1, 50]) {
      const out = clampDark(l);
      expect(out).toBeLessThanOrEqual(GLASS.darkMax);
      expect(out).toBeLessThanOrEqual(l);
    }
    expect(GLASS.darkMax + 0.001).toBeLessThan(audited);
    expect(clampDark(0.03)).toBe(0.03);
  });
  it('lifts light glass backdrops over the audited #C4C4C4 toward the pearl floor', () => {
    const audited = hexL('#C4C4C4'),
      floor = hexL('#F3F4F7');
    // The shader's floor colour is Pearl's --field-1.
    expect(luminance(...FLOOR_COLOUR)).toBeCloseTo(floor, 9);
    for (const l of [0, 0.1, 0.4, 0.55])
      expect(floorLight(l, floor)).toBeCloseTo(GLASS.lightMin, 9);
    expect(floorLight(0.8, floor)).toBe(0.8);
    expect(GLASS.lightMin - 0.003).toBeGreaterThan(audited);
  });
  it('caps the field at #7A808A outside glass, except the live signal', () => {
    expect(GLASS.cap).toBeCloseTo(hexL('#7A808A'), 3);
    expect(capField(0.9, 0)).toBe(GLASS.cap);
    expect(capField(0.9, 1)).toBe(0.9);
    expect(capField(0.1, 0)).toBe(0.1);
  });
  it('bends the rim by up to 10 px and frosts at an 18 px equivalent', () => {
    expect(lensOffset(0)).toBe(10);
    expect(lensOffset(7)).toBeCloseTo(2.5, 9);
    expect(lensOffset(14)).toBe(0);
    expect(frostLod(0.5)).toBeCloseTo(Math.log2(9), 9);
    expect(frostLod(100)).toBe(5);
  });
});
