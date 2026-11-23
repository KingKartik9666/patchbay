/**
 * Theme wave: the dark/light toggle reveals the new theme as a slow beach wave
 * rolling out of the toggle button.
 *
 * Technique (measured in .work/wave-proto): a View Transition whose new
 * snapshot is clipped by a WAAPI `clip-path: path()` animation. The 49 path
 * keyframes share one command list, so the compositor interpolates them and the
 * edge keeps moving at the display's native refresh rate even while the main
 * thread is busy. The foam rim is a small 2D canvas in its own live view
 * transition group, drawn from the shared FrameClock (vsync-paced, never capped).
 *
 * Rules: input is never blocked. A press on the toggle mid-wave reverses it; any
 * other press, key, wheel, a screenshot (html[data-capture]) or a hidden window
 * ends it at once and the input still lands. Reduced motion is a 160 ms
 * cross-fade; html[data-capture], html[data-theme-instant], forced colours and a
 * WebView without View Transitions switch instantly.
 *
 * Native sync: while the wave rolls the Mica frame paints a solid --mask
 * (theme-wave.css), so the DWM tint never shows the wrong theme. Once the
 * transition has finished the native theme is pinned, two clock frames pass,
 * and only then does html[data-theme-wave] go, returning the frame to Mica.
 */
import type { FrameClock } from '../rendering/frame-clock';
import type { Signals } from '../signals';
import './theme-wave.css';

export type Theme = 'light' | 'dark';

/** window event, detail { theme }: the theme, native frame included, has landed. */
export const THEME_SETTLED_EVENT = 'patchbay:theme-settled';

export interface ThemeWaveHost {
  /**
   * Commit the theme synchronously: flushSync(onChange({ theme })) moves
   * html[data-theme]; the field snaps (no 700 ms tween) and draws one frame,
   * and 2D canvases redraw. Runs inside the view transition's update callback.
   */
  apply(theme: Theme): void;
  /** Pin the native window theme (Mica tint, WebView2 colour scheme). */
  syncNative(theme: Theme): Promise<void> | void;
  /** OS or app reduced motion. */
  reduced(): boolean;
  /** Foam is drawn only when this is true (quality not 'low', not high contrast). */
  foam(): boolean;
  /** The app's only frame loop; the foam and the wave's fps probe ride on it. */
  clock: FrameClock;
}

/* ------------------------------------------------------------------ geometry */

export const WAVE = {
  durationMs: 1600,
  keyframes: 48, // 49 clip samples (one per ~33 ms); the compositor lerps between them
  points: 144, // fixed vertex count so every keyframe has the same commands
  lobes1: 11, // primary undulations around the front (integer: seamless)
  lobes2: 19, // secondary, travelling the other way
  ampK: 0.02, // primary amplitude, fraction of the window diagonal
  amp2: 0.38, // secondary amplitude relative to the primary
  ampGrowK: 0.3, // amplitude is full once the radius passes 30% of the diagonal
  drift1: 1.6, // radians of phase travel over the wave
  drift2: -2.3,
  surges: 2, // two pushes, like two sets of water rolling in
  surgeDepth: 0.42, // speed swings 1 ± 0.42; < 1 keeps the front monotonic
  foamPx: 30, // the rim's reach beyond the front
  backwash: 1.6, // a reversed wave recedes 1.6x faster than it rolled in
  fadeMs: 160, // reduced-motion cross-fade
  foamPixels: 1_300_000, // foam canvas backing-store budget
} as const;

const TAU = Math.PI * 2;

/** Normalised radius at normalised time t: two surges, never drawing back. */
export function progress(t: number): number {
  const m = WAVE.surges;
  const u = t - (WAVE.surgeDepth / (TAU * m)) * Math.sin(TAU * m * t);
  return Math.min(1, Math.max(0, u));
}

/** Front vertices at time t, flat [x0, y0, x1, y1, ...], around origin (ox, oy). */
export function frontPoints(t: number, w: number, h: number, ox: number, oy: number): Float64Array {
  const diag = Math.hypot(w, h);
  const far = Math.max(
    Math.hypot(ox, oy),
    Math.hypot(w - ox, oy),
    Math.hypot(ox, h - oy),
    Math.hypot(w - ox, h - oy),
  );
  const amp = WAVE.ampK * diag;
  // At t = 1 even the deepest trough lies past the farthest corner.
  const R = (far + amp * (1 + WAVE.amp2) + WAVE.foamPx + 4) * progress(t);
  const grow = Math.min(1, R / (WAVE.ampGrowK * diag));
  const A = amp * grow * grow * (3 - 2 * grow); // a round blob at the button, waves once it travels
  const n = WAVE.points;
  const out = new Float64Array(n * 2);
  for (let i = 0; i < n; i++) {
    const th = (i / n) * TAU - Math.PI / 2;
    const a1 = WAVE.lobes1 * th + WAVE.drift1 * t;
    const s1 = Math.sin(a1) + 0.22 * Math.sin(2 * a1 + 0.6); // crest sharper than trough
    const s2 = Math.sin(WAVE.lobes2 * th + WAVE.drift2 * t + 1.7);
    const r = Math.max(0, R + A * (0.82 * s1 + WAVE.amp2 * s2));
    out[2 * i] = ox + r * Math.cos(th);
    out[2 * i + 1] = oy + r * Math.sin(th);
  }
  return out;
}

const round = (v: number) => Math.round(v * 10) / 10;

/** Closed quadratic path through edge midpoints; same command list for every t. */
export function pathD(p: Float64Array): string {
  const n = p.length / 2;
  const mx = (i: number) => (p[2 * (i % n)] + p[2 * ((i + 1) % n)]) / 2;
  const my = (i: number) => (p[2 * (i % n) + 1] + p[2 * ((i + 1) % n) + 1]) / 2;
  let d = `M${round(mx(n - 1))} ${round(my(n - 1))}`;
  for (let i = 0; i < n; i++)
    d += `Q${round(p[2 * i])} ${round(p[2 * i + 1])} ${round(mx(i))} ${round(my(i))}`;
  return `${d}Z`;
}

/** The shape the compositor shows at t: a lerp of the neighbouring keyframes. */
function sampled(cache: Float64Array[], t: number): Float64Array {
  const x = Math.min(1, Math.max(0, t)) * WAVE.keyframes;
  const k = Math.min(WAVE.keyframes - 1, Math.floor(x));
  const a = cache[k];
  const b = cache[k + 1];
  const u = x - k;
  const out = new Float64Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = a[i] + (b[i] - a[i]) * u;
  return out;
}

/** The clock's dispatch interval: every vsync in 'match', longer on a fixed rate. */
function frameMs(signals: Readonly<Signals>): number {
  const hz = signals.targetFps || signals.refreshHz;
  return 1000 / Math.max(24, hz || 60);
}

/* ------------------------------------------------------------------- foam */

/**
 * Lip and spray of a wave bringing `theme` (rgb triplets; canvas only).
 * Pearl water: a white lip with PlayStation-blue mist ahead of it, over the old
 * dark page. Night water: a pistachio lip (--panel-signal) riding just inside
 * the edge with a faint silk haze behind it.
 */
const FOAM: Record<Theme, { lip: string; spray: string; sprayAlpha: number; inside: boolean }> = {
  light: { lip: '255,255,255', spray: '77,163,255', sprayAlpha: 1, inside: false },
  dark: { lip: '220,241,207', spray: '250,252,251', sprayAlpha: 0.35, inside: true },
};
const SPRAY: ReadonlyArray<readonly [width: number, alpha: number]> = [
  [34, 0.035],
  [20, 0.06],
  [10, 0.11],
];

function drawFoam(
  ctx: CanvasRenderingContext2D,
  p: Float64Array,
  t: number,
  ms: number,
  theme: Theme,
  pixels: number,
): void {
  const W = innerWidth;
  const H = innerHeight;
  const scale = Math.min(devicePixelRatio, Math.sqrt(pixels / (W * H)));
  const cw = Math.round(W * scale);
  const ch = Math.round(H * scale);
  const canvas = ctx.canvas;
  if (canvas.width !== cw || canvas.height !== ch) {
    canvas.width = cw;
    canvas.height = ch;
  }
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.clearRect(0, 0, W, H);
  const n = p.length / 2;
  const mid = (i: number, o: number) => (p[2 * (i % n) + o] + p[2 * ((i + 1) % n) + o]) / 2;
  const path = new Path2D();
  path.moveTo(mid(n - 1, 0), mid(n - 1, 1));
  for (let i = 0; i < n; i++) path.quadraticCurveTo(p[2 * i], p[2 * i + 1], mid(i, 0), mid(i, 1));
  path.closePath();
  const c = FOAM[theme];
  // In over the first 3%, out over the last 10%, so the rim never pops.
  const fade = t < 0.03 ? t / 0.03 : t > 0.9 ? Math.max(0, (1 - t) / 0.1) : 1;
  ctx.save();
  if (c.inside) ctx.clip(path);
  else {
    const outside = new Path2D();
    outside.rect(0, 0, W, H);
    outside.addPath(path);
    ctx.clip(outside, 'evenodd');
  }
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  for (const [width, alpha] of SPRAY) {
    ctx.strokeStyle = `rgba(${c.spray},${alpha * c.sprayAlpha * fade})`;
    ctx.lineWidth = width;
    ctx.stroke(path);
  }
  ctx.setLineDash([2, 6, 5, 11, 1.5, 8, 7, 14]); // bubbles drifting along the lip
  ctx.lineDashOffset = -ms * 0.03; // 30 px/s
  ctx.strokeStyle = `rgba(${c.lip},${0.5 * fade})`;
  ctx.lineWidth = 7;
  ctx.stroke(path);
  ctx.setLineDash([]);
  ctx.strokeStyle = `rgba(${c.lip},${0.92 * fade})`;
  ctx.lineWidth = 3; // half is clipped away: a 1.5 px lip
  ctx.stroke(path);
  ctx.restore();
}

/* -------------------------------------------------------------- controller */

interface Transition {
  kind: 'wave' | 'fade';
  from: Theme;
  target: Theme;
  vt: ViewTransition;
  /** The clip animation on ::view-transition-new(root) (wave only). */
  anim?: Animation;
  /** The update callback has committed a theme. */
  updated: boolean;
  /** skipTransition() has been called; the next press starts afresh. */
  ending: boolean;
  /** Releases this wave's FrameClock subscription. */
  release?: () => void;
  /** Clock frames seen while the clip ran, and the seconds between them. */
  frames: number;
  seconds: number;
}

export interface ThemeWave {
  /** Toggle from a theme button (pointer or keyboard); the wave starts at its centre. */
  toggle(origin: HTMLElement): void;
  /** The theme the user last asked for (drives the glyph and aria while waving). */
  intent(): Theme;
  subscribe(listener: () => void): () => void;
  /** End any wave now, landing on the requested theme. */
  settle(): void;
  /** Re-read the committed theme when idle (a theme set elsewhere, e.g. at boot). */
  sync(): void;
  dispose(): void;
}

const TOGGLES = '#theme-toggle,#theme-setting';
/** A hidden window must not strand the native sync on a stopped clock. */
const FRAME_WATCHDOG_MS = 250;

export function createThemeWave(host: ThemeWaveHost, current: () => Theme): ThemeWave {
  const root = document.documentElement;
  const listeners = new Set<() => void>();
  let active: Transition | null = null;
  /** Bumped by every new theme change; only the latest one clears the wave attributes. */
  let generation = 0;
  let forward: { x: number; y: number; done: Promise<unknown> } | null = null;
  // The click that follows a toggle press handled in pointerdown (one per press).
  let swallowClick = false;
  let origin: HTMLElement | null = null;
  let disposed = false;

  const foamCanvas = document.createElement('canvas');
  foamCanvas.className = 'theme-wave-foam';
  foamCanvas.setAttribute('aria-hidden', 'true');
  const foamCtx = foamCanvas.getContext('2d');

  const intent = (): Theme => (active ? active.target : current());
  const publish = () => {
    const now = intent();
    if (root.dataset.themeIntent === now) return;
    root.dataset.themeIntent = now;
    for (const listener of listeners) listener();
  };
  const instant = () =>
    root.hasAttribute('data-capture') ||
    root.hasAttribute('data-theme-instant') ||
    matchMedia('(forced-colors: active)').matches ||
    typeof document.startViewTransition !== 'function' ||
    document.hidden;

  /** Marks a new theme change; the wave and fade attributes belong to it alone. */
  function begin(kind: Transition['kind'] | null): number {
    generation += 1;
    if (kind === 'wave') root.dataset.themeWave = '';
    else delete root.dataset.themeWave;
    if (kind === 'fade') root.dataset.themeFade = '';
    else delete root.dataset.themeFade;
    return generation;
  }

  /** Resolves after `count` FrameClock frames, or at once when the window is hidden. */
  function frames(count: number): Promise<void> {
    return new Promise((resolve) => {
      let left = count;
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        release();
        clearTimeout(watchdog);
        document.removeEventListener('visibilitychange', onHidden);
        resolve();
      };
      const onHidden = () => {
        if (document.hidden) finish();
      };
      const release = host.clock.subscribe(() => {
        if (--left <= 0) finish();
      });
      const watchdog = window.setTimeout(finish, FRAME_WATCHDOG_MS);
      document.addEventListener('visibilitychange', onHidden);
      onHidden();
    });
  }

  /** Native theme first, two frames for DWM to repaint, then the frame returns to Mica. */
  async function land(token: number): Promise<void> {
    if (token !== generation) return;
    const theme = current();
    try {
      await host.syncNative(theme);
    } catch {
      // A refused native theme only leaves the legible system tint.
    }
    if (token !== generation || disposed) return;
    await frames(2);
    if (token !== generation || active || disposed) return;
    delete root.dataset.themeWave;
    delete root.dataset.themeFade;
    dispatchEvent(new CustomEvent(THEME_SETTLED_EVENT, { detail: { theme } }));
  }

  function toggle(button: HTMLElement): void {
    if (disposed) return;
    origin = button;
    const next: Theme = intent() === 'dark' ? 'light' : 'dark';
    if (active) {
      retarget(active, next);
      publish(); // the glyph answers the press at once
      return;
    }
    if (instant()) {
      const token = begin(null);
      host.apply(next);
      publish();
      void land(token);
      return;
    }
    const box = button.getBoundingClientRect();
    const shown = box.width > 0 && box.height > 0;
    start(
      host.reduced() ? 'fade' : 'wave',
      next,
      shown ? box.left + box.width / 2 : innerWidth / 2,
      shown ? box.top + box.height / 2 : 0,
    );
  }

  function start(kind: Transition['kind'], next: Theme, ox: number, oy: number): void {
    const token = begin(kind);
    foamCanvas.remove();
    const foam = kind === 'wave' && foamCtx !== null && host.foam();
    if (foam) document.body.append(foamCanvas);
    const t: Transition = {
      kind,
      from: current(),
      target: next,
      updated: false,
      ending: false,
      frames: 0,
      seconds: 0,
      // The callback reads t.target when it runs, so a second press before the
      // snapshot lands still commits the right theme.
      vt: document.startViewTransition(() => {
        host.apply(t.target);
        t.updated = true;
      }),
    };
    active = t;
    publish();
    t.vt.ready
      .then(() => {
        if (active !== t || t.ending) return;
        if (kind === 'fade') fade();
        else roll(t, ox, oy, foam);
      })
      .catch(() => undefined);
    t.vt.finished.catch(() => undefined).finally(() => finish(t, token));
  }

  /** Reduced motion: the new theme fades in over the old, no travel, no bounce. */
  function fade(): void {
    root.animate(
      { opacity: [0, 1] },
      {
        duration: WAVE.fadeMs,
        easing: 'ease',
        fill: 'both',
        pseudoElement: '::view-transition-new(root)',
      },
    );
  }

  function roll(t: Transition, ox: number, oy: number, foam: boolean): void {
    const W = innerWidth;
    const H = innerHeight;
    const cache: Float64Array[] = [];
    for (let k = 0; k <= WAVE.keyframes; k++)
      cache.push(frontPoints(k / WAVE.keyframes, W, H, ox, oy));
    const anim = root.animate(
      cache.map((p) => ({ clipPath: `path('${pathD(p)}')` })),
      {
        duration: WAVE.durationMs,
        easing: 'linear',
        fill: 'both',
        pseudoElement: '::view-transition-new(root)',
      },
    );
    t.anim = anim;
    // Backstop for a receding wave the clock did not land (e.g. a stalled frame).
    anim.onfinish = () => {
      if (anim.playbackRate < 0) collapse(t, t.from);
    };
    const water = t.target; // a receding wave is still the same water
    let pixels: number = WAVE.foamPixels;
    let drawing = foam && foamCtx !== null;
    t.release = host.clock.subscribe((dt, signals) => {
      if (active !== t || t.ending) return;
      if (t.frames > 0) t.seconds += dt;
      t.frames += 1;
      const ms = Number(anim.currentTime ?? 0);
      const vsync = frameMs(signals);
      // A receding wave lands one frame early on the old theme, before the clip
      // empties, so the transition never ends on a frame of the abandoned theme.
      if (anim.playbackRate < 0 && ms <= vsync * WAVE.backwash * 1.5) {
        collapse(t, t.from);
        return;
      }
      if (!drawing || !foamCtx) return;
      // Dynamic resolution, never a frame cap: a late frame halves the foam's
      // backing store (down to 1/4); a late frame at the floor drops the foam,
      // so the compositor-driven edge keeps the display's refresh rate. The
      // canvas is cleared, never detached: it is a named view-transition element,
      // and Chromium aborts the whole transition when one stops rendering.
      if (t.frames > 1 && dt * 1000 > vsync * 1.5) {
        if (pixels > WAVE.foamPixels / 4) pixels /= 2;
        else {
          drawing = false;
          foamCtx.setTransform(1, 0, 0, 1, 0, 0);
          foamCtx.clearRect(0, 0, foamCanvas.width, foamCanvas.height);
          return;
        }
      }
      const at = ms / WAVE.durationMs;
      drawFoam(foamCtx, sampled(cache, at), at, ms, water, pixels);
    });
  }

  function finish(t: Transition, token: number): void {
    t.release?.();
    t.release = undefined;
    t.anim?.cancel();
    if (t.kind === 'wave' && t.frames > 1 && t.seconds > 0)
      root.dataset.waveFps = String(Math.round(((t.frames - 1) / t.seconds) * 10) / 10);
    if (active !== t) return; // a newer change owns the attributes and the foam
    active = null;
    foamCanvas.remove();
    publish();
    void land(token);
  }

  /** End `t` now on `theme`; the input that caused it proceeds untouched. */
  function collapse(t: Transition, theme: Theme): void {
    t.target = theme;
    if (t.updated && current() !== theme) host.apply(theme);
    t.ending = true;
    t.vt.skipTransition();
  }

  function retarget(t: Transition, theme: Theme): void {
    // Before the first wave frame, during a fade, or while ending: collapse.
    if (t.kind === 'fade' || !t.anim || t.ending) return collapse(t, theme);
    t.target = theme;
    t.anim.updatePlaybackRate(theme === t.from ? -WAVE.backwash : 1);
    if (t.anim.playState === 'finished') t.anim.play();
  }

  function settle(): void {
    if (active) collapse(active, active.target);
  }

  /* While a view transition is active Chromium 156 hit-tests every pointer
     event to <html>. So the toggles are hit-tested by hand, and any other press
     ends the wave and its click is re-delivered to the control under it. */
  const toggleAt = (x: number, y: number): HTMLElement | null => {
    const candidates = [origin, ...document.querySelectorAll<HTMLElement>(TOGGLES)];
    for (const el of candidates) {
      if (!el?.isConnected) continue;
      const r = el.getBoundingClientRect();
      if (r.width > 0 && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return el;
    }
    return null;
  };
  const onPointerDown = (e: PointerEvent) => {
    swallowClick = false;
    if (!active || e.button !== 0) return;
    const hit = toggleAt(e.clientX, e.clientY);
    if (hit) {
      swallowClick = true;
      toggle(hit);
      return;
    }
    forward = { x: e.clientX, y: e.clientY, done: active.vt.finished.catch(() => undefined) };
    settle();
  };
  const onClick = (e: MouseEvent) => {
    if (swallowClick && e.isTrusted) {
      swallowClick = false;
      e.stopImmediatePropagation();
      return;
    }
    if (!forward || e.target !== root) {
      forward = null;
      return;
    }
    e.stopImmediatePropagation();
    const f = forward;
    forward = null;
    void f.done
      .then(() => frames(1))
      .then(() => {
        const el = document.elementFromPoint(f.x, f.y);
        if (el instanceof HTMLElement && el !== root) {
          if (el.matches('input,select,textarea,button,[tabindex]'))
            el.focus({ preventScroll: true });
          el.click();
        }
      });
  };
  const onWheel = (e: WheelEvent) => {
    if (!active) return;
    const done = active.vt.finished.catch(() => undefined);
    settle();
    // The notch hit <html>; give it to the scroller under the pointer.
    void done.then(() => {
      let el = document.elementFromPoint(e.clientX, e.clientY);
      while (
        el &&
        !(el.scrollHeight > el.clientHeight && /auto|scroll/.test(getComputedStyle(el).overflowY))
      )
        el = el.parentElement;
      el?.scrollBy({ top: e.deltaY, left: e.deltaX });
    });
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (!active) return;
    const onToggle =
      e.target instanceof Element &&
      e.target.closest(TOGGLES) !== null &&
      (e.key === 'Enter' || e.key === ' ');
    if (!onToggle) settle(); // keys stay instant; the key itself proceeds untouched
  };
  const onHidden = () => {
    if (document.hidden) settle();
  };
  const watch = new MutationObserver(() => {
    if (root.hasAttribute('data-capture') || root.hasAttribute('data-theme-instant')) settle();
  });
  addEventListener('pointerdown', onPointerDown, true);
  addEventListener('click', onClick, true);
  addEventListener('wheel', onWheel, { capture: true, passive: true });
  addEventListener('keydown', onKeyDown, true);
  document.addEventListener('visibilitychange', onHidden);
  watch.observe(root, {
    attributes: true,
    attributeFilter: ['data-capture', 'data-theme-instant'],
  });
  root.dataset.themeIntent = intent();

  return {
    toggle,
    intent,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    settle,
    sync() {
      if (!active) publish();
    },
    dispose() {
      settle();
      disposed = true;
      removeEventListener('pointerdown', onPointerDown, true);
      removeEventListener('click', onClick, true);
      removeEventListener('wheel', onWheel, { capture: true });
      removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('visibilitychange', onHidden);
      watch.disconnect();
      foamCanvas.remove();
    },
  };
}
