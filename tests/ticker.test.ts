import { afterEach, describe, expect, it, vi } from 'vitest';
import { Ticker, type Stats } from '../src/ticker';
import type { Signals } from '../src/signals';

afterEach(() => vi.unstubAllGlobals());

function clock() {
  let pending: FrameRequestCallback | undefined;
  let visibility: (() => void) | undefined;
  let now = 1000;
  const document = {
    hidden: false,
    addEventListener: (_: string, callback: () => void) => { visibility = callback; },
    removeEventListener: () => { visibility = undefined; },
  };
  vi.stubGlobal('document', document);
  vi.stubGlobal('PerformanceObserver', { supportedEntryTypes: [] });
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { pending = callback; return 1; });
  vi.stubGlobal('cancelAnimationFrame', () => { pending = undefined; });
  return {
    advance(milliseconds: number) {
      now += milliseconds;
      const callback = pending;
      pending = undefined;
      callback?.(now);
    },
    hide(hidden: boolean) { document.hidden = hidden; visibility?.(); },
    get scheduled() { return Boolean(pending); },
  };
}

function signals(): Signals {
  return { pointer: { x: 0, y: 0 }, energy: 0, phase: 'idle', quality: 'high',
    glass: 'baked', refreshHz: 60, reducedMotion: false, focusMode: false, boardRate: 60, glowPasses: 3 };
}

describe('frame diagnostics and visibility', () => {
  it('counts long stalls, clamps motion, and reduces work without changing detected refresh', () => {
    const frames = clock(), state = signals(), reports: Stats[] = [], deltas: number[] = [];
    const ticker = new Ticker(state, dt => deltas.push(dt), stats => reports.push({ ...stats }), () => {});
    try {
      ticker.start();
      for (let i = 0; i < 61; i++) frames.advance(1000 / 120);
      expect(state.refreshHz).toBe(120);
      expect(state.boardRate).toBe(120);
      for (let i = 0; i < 10; i++) frames.advance(300);
      expect(reports.some(report => report.p95 >= 300)).toBe(true);
      expect(deltas.at(-1)).toBe(.05);
      expect(state.boardRate).toBe(60);
      expect(state.refreshHz).toBe(120);
    } finally { ticker.dispose(); }
  });

  it('cancels hidden work and resumes without treating hidden time as a slow frame', () => {
    const frames = clock(), state = signals(), deltas: number[] = [];
    const ticker = new Ticker(state, dt => deltas.push(dt), () => {}, () => {});
    try {
      ticker.start();
      frames.advance(16);
      frames.hide(true);
      expect(frames.scheduled).toBe(false);
      frames.advance(10_000);
      expect(deltas).toHaveLength(1);
      frames.hide(false);
      expect(frames.scheduled).toBe(true);
      frames.advance(16);
      expect(deltas.at(-1)).toBe(0);
      expect(state.quality).toBe('high');
    } finally { ticker.dispose(); }
    expect(frames.scheduled).toBe(false);
  });
});
