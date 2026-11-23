import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MachineDef } from '../src/domain/contracts';
import { buildDiagram } from '../src/diagram/layout';
import { DiagramInk, type DiagramPresentation } from '../src/rendering/diagram-ink';
import type { Signals } from '../src/signals';

function fakeContext() {
  const gradient = { addColorStop: vi.fn() };
  const calls = new Map<string, ReturnType<typeof vi.fn>>();
  const values = { globalAlpha: 1 };
  const context = new Proxy(values, {
    get(target, key: string) {
      if (key in target) return target[key as keyof typeof target];
      if (key === 'createLinearGradient' || key === 'createRadialGradient') return () => gradient;
      if (!calls.has(key)) calls.set(key, vi.fn());
      return calls.get(key);
    },
    set(target, key, value) {
      Reflect.set(target, key, value);
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  return { context, calls };
}
class Canvas extends EventTarget {
  width = 1;
  height = 1;
  clientWidth = 0;
  clientHeight = 0;
  dataset: Record<string, string> = {};
  remove = vi.fn();
  constructor(readonly context: CanvasRenderingContext2D) {
    super();
  }
  getContext(kind: string) {
    return kind === '2d' ? this.context : null;
  }
}
class Host extends EventTarget {
  scrollLeft = 0;
  scrollTop = 0;
}
const initialSignals = (): Signals => ({
  pointer: { x: 0, y: 0 },
  energy: 0,
  phase: 'idle',
  quality: 'medium',
  glass: 'baked',
  refreshHz: 120,
  displayHz: 120,
  targetFps: 120,
  measuredFps: 120,
  refreshNote: null,
  reducedMotion: false,
  focusMode: false,
  boardRate: 30,
  glowPasses: 2,
});
const machine = (count: number): MachineDef => ({
  states: Array.from({ length: count }, (_, i) => `S${i}`),
  alphabet: ['0'],
  start: 'S0',
  delta: Object.fromEntries(
    Array.from({ length: count }, (_, i) => [`S${i}`, { '0': `S${(i + 1) % count}` }]),
  ),
  outputs: {
    kind: 'moore',
    lambda: Object.fromEntries(Array.from({ length: count }, (_, i) => [`S${i}`, String(i % 2)])),
  },
});

let windowStub: EventTarget & { innerWidth: number; innerHeight: number; devicePixelRatio: number };
let resolveFonts: () => void;
let createElement: ReturnType<typeof vi.fn>;
beforeEach(() => {
  windowStub = Object.assign(new EventTarget(), {
    innerWidth: 1440,
    innerHeight: 1000,
    devicePixelRatio: 2,
  });
  const ready = new Promise<void>((resolve) => {
    resolveFonts = resolve;
  });
  createElement = vi.fn((tag: string) => {
    if (tag !== 'canvas') throw new Error(`Renderer tried to create React-owned ${tag} markup`);
    return new Canvas(fakeContext().context);
  });
  vi.stubGlobal('window', windowStub);
  vi.stubGlobal('document', {
    fonts: { ready, status: 'loaded' },
    createElement,
    querySelector: () => null,
  });
  vi.stubGlobal('getComputedStyle', () => ({ getPropertyValue: () => '#161616' }));
  vi.stubGlobal('requestAnimationFrame', vi.fn());
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('diagram Canvas rendering and presentation milestones', () => {
  function setup(signals = initialSignals()) {
    const host = new Host(),
      context = fakeContext(),
      canvas = new Canvas(context.context),
      glyph = new Canvas(fakeContext().context);
    const presentations: DiagramPresentation[] = [];
    const renderer = new DiagramInk(
      host as unknown as HTMLElement,
      canvas as unknown as HTMLCanvasElement,
      glyph as unknown as HTMLCanvasElement,
      (value) => presentations.push(value),
      signals,
      () => null,
    );
    return { renderer, host, canvas, glyph, context, presentations, signals };
  }
  it('forms small machines within three seconds and publishes only changed React milestones', () => {
    const { renderer, presentations, signals, canvas } = setup();
    const definition = machine(12),
      data = buildDiagram(definition, { w: 800, h: 280 });
    renderer.configure(definition, data, 800, 280, 0);
    expect(presentations.at(-1)?.building).toBe(true);
    for (let i = 0; i < 61; i++) renderer.update(0.05, signals, { progress: 0 }, 'S0');
    const complete = presentations.at(-1)!;
    expect(complete.building).toBe(false);
    expect([...complete.nodeStages.values()].every((stage) => stage === 'formed')).toBe(true);
    expect(complete.visibleEdges.size).toBe(data.edges.length);
    const count = presentations.length,
      draws = canvas.dataset.draws;
    for (let i = 0; i < 120; i++) renderer.update(1 / 120, signals, { progress: 0 }, 'S0');
    expect(presentations).toHaveLength(count);
    expect(canvas.dataset.draws).toBe(draws);
    expect(count).toBeLessThan(61);
    expect(requestAnimationFrame).not.toHaveBeenCalled();
    expect(createElement).not.toHaveBeenCalled();
    renderer.dispose();
  });
  it('renders large machines immediately on a viewport canvas and draws only after scrolling', () => {
    const { renderer, host, canvas, presentations, signals } = setup();
    const definition = machine(256),
      data = buildDiagram(definition, { w: 800, h: 280 });
    renderer.configure(definition, data, 800, 280, 0);
    expect(data.width).toBeGreaterThan(800 * 10);
    expect(canvas.width).toBe(800);
    expect(canvas.height).toBe(280);
    expect(presentations.at(-1)?.building).toBe(false);
    expect(presentations.at(-1)?.nodeStages.size).toBe(256);
    const before = Number(canvas.dataset.draws);
    renderer.update(0.05, signals, { progress: 0 }, 'S0');
    expect(Number(canvas.dataset.draws)).toBe(before);
    host.scrollLeft = data.width - 800;
    host.dispatchEvent(new Event('scroll'));
    renderer.update(0.05, signals, { progress: 0 }, 'S0');
    expect(Number(canvas.dataset.draws)).toBe(before + 1);
    renderer.dispose();
    host.dispatchEvent(new Event('scroll'));
    renderer.update(0.05, signals, { progress: 0 }, 'S0');
    expect(canvas.width).toBe(1);
  });
  it('finishes construction on travel and keeps read/arrival updates separate from cursor state', () => {
    const { renderer, presentations, signals } = setup();
    const definition = machine(2),
      step = { i: 0, from: 'S0', sym: '0', to: 'S1', out: '1' };
    renderer.configure(definition, buildDiagram(definition, { w: 800, h: 280 }), 800, 280, 0);
    renderer.update(0.01, signals, { step, progress: 0.2 }, 'S0');
    expect(presentations.at(-1)?.building).toBe(false);
    expect(presentations.at(-1)?.reading).toBe('S0');
    renderer.update(0.01, signals, { step, progress: 0.8 }, 'S0');
    expect(presentations.at(-1)?.reading).toBeUndefined();
    expect(presentations.at(-1)?.arriving).toBe('S1');
    renderer.update(0.01, signals, { progress: 0 }, 'S1');
    expect(presentations.at(-1)?.traversed).toBeUndefined();
    renderer.dispose();
  });
  it('applies reduced motion immediately, including replay, without creating private animation work', () => {
    const { renderer, presentations, signals } = setup();
    const definition = machine(2),
      data = buildDiagram(definition, { w: 800, h: 280 });
    renderer.configure(definition, data, 800, 280, 0);
    signals.reducedMotion = true;
    renderer.update(0.01, signals, { progress: 0 }, 'S0');
    expect(presentations.at(-1)?.building).toBe(false);
    renderer.configure(definition, data, 800, 280, 1);
    expect(presentations.at(-1)?.building).toBe(false);
    expect(presentations.at(-1)?.visibleEdges.size).toBe(data.edges.length);
    expect(requestAnimationFrame).not.toHaveBeenCalled();
    renderer.dispose();
  });
  it('releases both backing stores and ignores late fonts, scrolls and updates after disposal', async () => {
    const { renderer, host, canvas, glyph, presentations, signals } = setup();
    const definition = machine(2),
      data = buildDiagram(definition, { w: 800, h: 280 });
    renderer.configure(definition, data, 800, 280, 0);
    const count = presentations.length,
      draws = canvas.dataset.draws;
    renderer.dispose();
    renderer.dispose();
    resolveFonts();
    await Promise.resolve();
    host.dispatchEvent(new Event('scroll'));
    renderer.refreshTheme();
    renderer.configure(definition, data, 1600, 560, 1);
    renderer.update(0.05, signals, { progress: 0 }, 'S0');
    expect([canvas.width, canvas.height, glyph.width, glyph.height]).toEqual([1, 1, 1, 1]);
    expect(presentations).toHaveLength(count);
    expect(canvas.dataset.draws).toBe(draws);
    expect(requestAnimationFrame).not.toHaveBeenCalled();
  });
});
