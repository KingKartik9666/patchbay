import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FrameClock } from '../src/rendering/frame-clock';
import type { Signals } from '../src/signals';
import {
  THEME_SETTLED_EVENT,
  WAVE,
  createThemeWave,
  frontPoints,
  pathD,
  progress,
  type Theme,
  type ThemeWave,
} from '../src/motion/theme-wave';

describe('wave geometry', () => {
  it('rolls out in two surges without ever drawing back', () => {
    expect(progress(0)).toBe(0);
    expect(progress(1)).toBeCloseTo(1, 12);
    let last = -1;
    let fastest = 0;
    let slowest = Infinity;
    const step = 1 / 2000;
    for (let t = 0; t <= 1 + 1e-9; t += step) {
      const u = progress(t);
      expect(u).toBeGreaterThanOrEqual(last);
      if (last >= 0) {
        fastest = Math.max(fastest, (u - last) / step);
        slowest = Math.min(slowest, (u - last) / step);
      }
      last = u;
    }
    // Speed swings 1 ± surgeDepth around the average.
    expect(fastest).toBeCloseTo(1 + WAVE.surgeDepth, 2);
    expect(slowest).toBeCloseTo(1 - WAVE.surgeDepth, 2);
  });

  it('covers the farthest corner, troughs included, at t = 1', () => {
    const windows: Array<[number, number]> = [
      [1440, 900],
      [2560, 1440],
      [390, 844],
      [360, 640],
    ];
    for (const [w, h] of windows)
      for (const [ox, oy] of [
        [w - 120, 22],
        [w / 2, h / 2],
        [0, 0],
        [w, h],
      ]) {
        const far = Math.max(
          Math.hypot(ox, oy),
          Math.hypot(w - ox, oy),
          Math.hypot(ox, h - oy),
          Math.hypot(w - ox, h - oy),
        );
        const p = frontPoints(1, w, h, ox, oy);
        const n = p.length / 2;
        let nearest = Infinity;
        for (let i = 0; i < n; i++) {
          const j = (i + 1) % n;
          // The drawn curve passes through the vertices' edge midpoints.
          const mx = (p[2 * i] + p[2 * j]) / 2;
          const my = (p[2 * i + 1] + p[2 * j + 1]) / 2;
          nearest = Math.min(
            nearest,
            Math.hypot(p[2 * i] - ox, p[2 * i + 1] - oy),
            Math.hypot(mx - ox, my - oy),
          );
        }
        expect(nearest, `${w}x${h} from ${ox},${oy}`).toBeGreaterThan(far);
      }
  });

  it('starts as a point at the button', () => {
    const p = frontPoints(0, 1440, 900, 1300, 22);
    for (let i = 0; i < p.length; i += 2) {
      expect(p[i]).toBeCloseTo(1300, 9);
      expect(p[i + 1]).toBeCloseTo(22, 9);
    }
  });

  it('keeps one command list for every keyframe, so the compositor can interpolate', () => {
    const shape = (d: string) => d.replace(/-?\d+(\.\d+)?/g, '#');
    const first = shape(pathD(frontPoints(0, 1440, 900, 1300, 22)));
    expect(first.match(/Q/g)).toHaveLength(WAVE.points);
    for (let k = 0; k <= WAVE.keyframes; k++)
      expect(shape(pathD(frontPoints(k / WAVE.keyframes, 1440, 900, 1300, 22)))).toBe(first);
  });
});

/* ------------------------------------------------------------ a small fake DOM */

interface FakeAnimation {
  keyframes: Keyframe[] | PropertyIndexedKeyframes;
  options: KeyframeAnimationOptions;
  playbackRate: number;
  currentTime: number;
  playState: AnimationPlayState;
  onfinish: (() => void) | null;
  updatePlaybackRate: ReturnType<typeof vi.fn>;
  play: ReturnType<typeof vi.fn>;
  cancel: ReturnType<typeof vi.fn>;
}

interface FakeTransition {
  ready: Promise<void>;
  finished: Promise<void>;
  updateCallbackDone: Promise<void>;
  skipTransition: ReturnType<typeof vi.fn>;
  /** Ends the transition as if its animations had finished. */
  end(): void;
}

const camel = (attribute: string) =>
  attribute.slice(5).replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());

function setup() {
  const win = new EventTarget();
  const transitions: FakeTransition[] = [];
  const animations: FakeAnimation[] = [];
  const dataset: Record<string, string> = { theme: 'dark' };
  const root = {
    dataset,
    hasAttribute: (name: string) => name.startsWith('data-') && camel(name) in dataset,
    animate: vi.fn((keyframes: FakeAnimation['keyframes'], options: KeyframeAnimationOptions) => {
      const animation: FakeAnimation = {
        keyframes,
        options,
        playbackRate: 1,
        currentTime: 0,
        playState: 'running',
        onfinish: null,
        updatePlaybackRate: vi.fn((rate: number) => {
          animation.playbackRate = rate;
        }),
        play: vi.fn(),
        cancel: vi.fn(),
      };
      animations.push(animation);
      return animation;
    }),
  };
  class Doc extends EventTarget {
    hidden = false;
    documentElement = root;
    body = { append: vi.fn() };
    createElement = () => ({
      className: '',
      setAttribute: vi.fn(),
      getContext: () => null,
      remove: vi.fn(),
    });
    querySelectorAll = () => [];
    getElementById = () => null;
    elementFromPoint = () => null;
    startViewTransition = vi.fn((update: () => void) => {
      let finish!: () => void;
      let skipped = false;
      const finished = new Promise<void>((resolve) => (finish = resolve));
      const updateCallbackDone = Promise.resolve().then(update);
      const transition: FakeTransition = {
        updateCallbackDone,
        finished,
        ready: updateCallbackDone.then(() => {
          if (skipped) throw new DOMException('Skipped', 'AbortError');
        }),
        skipTransition: vi.fn(() => {
          skipped = true;
          void updateCallbackDone.then(finish);
        }),
        end: () => finish(),
      };
      transitions.push(transition);
      return transition;
    });
  }
  const doc = new Doc();
  vi.stubGlobal('document', doc);
  vi.stubGlobal('window', globalThis);
  vi.stubGlobal('addEventListener', win.addEventListener.bind(win));
  vi.stubGlobal('removeEventListener', win.removeEventListener.bind(win));
  vi.stubGlobal('dispatchEvent', win.dispatchEvent.bind(win));
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
  vi.stubGlobal('innerWidth', 1440);
  vi.stubGlobal('innerHeight', 900);
  vi.stubGlobal('devicePixelRatio', 1);
  vi.stubGlobal('Element', class {});
  vi.stubGlobal('HTMLElement', class {});
  vi.stubGlobal(
    'MutationObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );

  // The shared FrameClock, ticked by hand at 144 Hz.
  const frames = new Set<(dt: number, signals: Readonly<Signals>) => void>();
  const signals = { refreshHz: 144, targetFps: 144 } as Signals;
  const clock = {
    signals,
    subscribe(callback: (dt: number, signals: Readonly<Signals>) => void) {
      frames.add(callback);
      return () => frames.delete(callback);
    },
  } as unknown as FrameClock;
  const tick = (count = 1) => {
    for (let i = 0; i < count; i++) for (const callback of [...frames]) callback(1 / 144, signals);
  };

  let theme: Theme = 'dark';
  const host = {
    apply: vi.fn((next: Theme) => {
      theme = next;
      dataset.theme = next;
    }),
    syncNative: vi.fn(async () => undefined),
    reduced: vi.fn(() => false),
    foam: () => false,
    clock,
  };
  const wave = createThemeWave(host, () => theme);
  const button = {
    isConnected: true,
    getBoundingClientRect: () => ({
      left: 1282,
      top: 4,
      right: 1318,
      bottom: 40,
      width: 36,
      height: 36,
    }),
  } as unknown as HTMLElement;
  return {
    wave,
    host,
    button,
    root,
    doc,
    win,
    transitions,
    animations,
    tick,
    theme: () => theme,
  };
}

/** Lets the fake transition's promise chain run. */
const settleMicrotasks = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('theme wave controller', () => {
  let env: ReturnType<typeof setup>;
  let wave: ThemeWave;
  beforeEach(() => {
    env = setup();
    wave = env.wave;
  });
  afterEach(() => {
    wave.dispose();
    vi.unstubAllGlobals();
  });

  it('flips the intent on press, before the new theme is committed', () => {
    const heard = vi.fn();
    wave.subscribe(heard);
    expect(wave.intent()).toBe('dark');
    expect(env.root.dataset.themeIntent).toBe('dark');
    wave.toggle(env.button);
    expect(wave.intent()).toBe('light');
    expect(env.root.dataset.themeIntent).toBe('light');
    expect(heard).toHaveBeenCalled();
    expect(env.host.apply).not.toHaveBeenCalled();
    expect(env.theme()).toBe('dark');
  });

  it('rolls a clip-path wave from the button over the new snapshot', async () => {
    wave.toggle(env.button);
    expect(env.root.dataset.themeWave).toBe('');
    await settleMicrotasks();
    expect(env.host.apply).toHaveBeenCalledWith('light');
    const clip = env.animations[0];
    expect(clip.options).toMatchObject({
      duration: WAVE.durationMs,
      easing: 'linear',
      pseudoElement: '::view-transition-new(root)',
    });
    const keyframes = clip.keyframes as Keyframe[];
    expect(keyframes).toHaveLength(WAVE.keyframes + 1);
    // The first frame is a point at the button's centre.
    expect(String(keyframes[0].clipPath)).toMatch(/^path\('M1300 22Q1300 22/);
  });

  it('lands natively first, then clears the wave, reports fps and announces it', async () => {
    const settled = vi.fn();
    env.win.addEventListener(THEME_SETTLED_EVENT, settled);
    wave.toggle(env.button);
    await settleMicrotasks();
    env.tick(231); // 1.6 s at 144 Hz
    env.transitions[0].end();
    await settleMicrotasks();
    expect(env.host.syncNative).toHaveBeenCalledWith('light');
    expect(env.root.dataset.waveFps).toBe('144');
    // The Mica frame stays opaque for two frames after the native theme moves.
    expect(env.root.dataset.themeWave).toBe('');
    env.tick(2);
    await settleMicrotasks();
    expect(env.root.dataset.themeWave).toBeUndefined();
    expect(settled).toHaveBeenCalledOnce();
    expect((settled.mock.calls[0][0] as CustomEvent).detail).toEqual({ theme: 'light' });
    expect(wave.intent()).toBe('light');
  });

  it('reverses a rolling wave on a second press and lands on the old theme', async () => {
    wave.toggle(env.button);
    await settleMicrotasks();
    const clip = env.animations[0];
    clip.currentTime = 600;
    wave.toggle(env.button);
    expect(clip.updatePlaybackRate).toHaveBeenLastCalledWith(-WAVE.backwash);
    expect(wave.intent()).toBe('dark');
    // A third press rolls it forward again.
    wave.toggle(env.button);
    expect(clip.updatePlaybackRate).toHaveBeenLastCalledWith(1);
    wave.toggle(env.button);
    // The receding edge nears the button: the old theme is committed a frame early.
    clip.currentTime = 10;
    env.tick();
    expect(env.theme()).toBe('dark');
    expect(env.transitions[0].skipTransition).toHaveBeenCalled();
  });

  it('collapses two presses before the first frame onto the final theme', async () => {
    wave.toggle(env.button);
    wave.toggle(env.button);
    await settleMicrotasks();
    expect(env.transitions[0].skipTransition).toHaveBeenCalled();
    expect(env.theme()).toBe('dark');
    expect(env.animations).toHaveLength(0);
  });

  it('ends at once on any other key, and the key is not swallowed', async () => {
    wave.toggle(env.button);
    await settleMicrotasks();
    const key = Object.assign(new Event('keydown', { cancelable: true }), { key: 'e' });
    env.win.dispatchEvent(key);
    expect(env.transitions[0].skipTransition).toHaveBeenCalled();
    expect(key.defaultPrevented).toBe(false);
    expect(env.theme()).toBe('light');
  });

  it('ends when the window is hidden', async () => {
    wave.toggle(env.button);
    await settleMicrotasks();
    env.doc.hidden = true;
    env.doc.dispatchEvent(new Event('visibilitychange'));
    expect(env.transitions[0].skipTransition).toHaveBeenCalled();
  });

  it('cross-fades under reduced motion: no wave, no clip', async () => {
    env.host.reduced.mockReturnValue(true);
    wave.toggle(env.button);
    expect(env.root.dataset.themeFade).toBe('');
    expect(env.root.dataset.themeWave).toBeUndefined();
    await settleMicrotasks();
    expect(env.animations).toHaveLength(1);
    expect(env.animations[0].keyframes).toEqual({ opacity: [0, 1] });
    expect(env.animations[0].options).toMatchObject({
      duration: WAVE.fadeMs,
      pseudoElement: '::view-transition-new(root)',
    });
  });

  it('switches instantly for screenshots and tests', () => {
    env.root.dataset.themeInstant = '';
    wave.toggle(env.button);
    expect(env.doc.startViewTransition).not.toHaveBeenCalled();
    expect(env.theme()).toBe('light');
    expect(wave.intent()).toBe('light');
  });

  it('follows a theme committed elsewhere when idle', () => {
    env.host.apply('light');
    expect(env.root.dataset.themeIntent).toBe('dark');
    wave.sync();
    expect(env.root.dataset.themeIntent).toBe('light');
  });
});
