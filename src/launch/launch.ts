/** The launch's runtime half. The stage, its CSS and every beat up to the
 * hand-off are inline in index.html and run on the compositor before this
 * bundle loads; Rust's initialization script picks the variant and skips it on
 * the first key, press, wheel or touch. This module only watches: it fires the
 * hand-off when the condense ends, flies the jack to the Bench's active jack
 * (WAAPI, composited), and removes the stage when the ground has faded. */

export type LaunchMode = 'off' | 'full' | 'short' | 'still';
export const LAUNCH_HANDOFF_EVENT = 'patchbay:launch-handoff';
/** Fired once when a launch that played ends; detail {mode, skipped}. */
export const LAUNCH_EVENT = 'patchbay:launch';
export interface LaunchDetail {
  mode: LaunchMode;
  skipped: boolean;
}
declare global {
  interface Window {
    __patchbayBoot?: {
      theme: 'dark' | 'light';
      launch: LaunchMode;
      version: string;
      /** High contrast from the saved session (the stage drops its colour). */
      contrast?: boolean;
    };
  }
}

const FLIGHT_MS = 600;
/** A hand-off seen later than this would fly from a stale frame. */
const LATE_MS = 100;
/** Past the ground's end, a missing animationend cannot keep the stage up. */
const WATCHDOG_MS = 800;
const OUT = 'cubic-bezier(0.23, 1, 0.32, 1)';
const MOVE = 'cubic-bezier(0.77, 0, 0.175, 1)';
const ACTIVE = new Set(['full', 'short', 'still']);

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}
export interface Flight {
  dx: number;
  dy: number;
  scale: number;
}

/** Where the jack flies: centre to centre, landing at the target's size. Null
 * (fade in place) when the target is missing, collapsed or off-screen. */
export function flightPlan(
  jack: Box,
  target: Box | null,
  viewport: { width: number; height: number },
): Flight | null {
  if (!target || jack.width <= 0 || target.width <= 0 || target.height <= 0) return null;
  const x = target.left + target.width / 2,
    y = target.top + target.height / 2;
  if (x < 0 || y < 0 || x > viewport.width || y > viewport.height) return null;
  return {
    dx: x - (jack.left + jack.width / 2),
    dy: y - (jack.top + jack.height / 2),
    scale: target.width / jack.width,
  };
}

/** The flight lands, then dissolves into the real jack it covers. */
export function flightKeyframes(plan: Flight | null): Keyframe[] {
  if (!plan)
    return [
      { transform: 'none', opacity: 1, easing: OUT },
      { transform: 'scale(0.6)', opacity: 0 },
    ];
  const landed = `translate(${plan.dx.toFixed(2)}px, ${plan.dy.toFixed(2)}px) scale(${plan.scale.toFixed(4)})`;
  return [
    { transform: 'translate(0px, 0px) scale(1)', opacity: 1, easing: MOVE },
    { transform: landed, opacity: 1, offset: 0.85, easing: 'linear' },
    { transform: landed, opacity: 0 },
  ];
}

const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const forced = () => matchMedia('(forced-colors: active)').matches;

/** The variant playing this start. The CSS turns full and short into still
 * under OS reduced motion, and forced colours show no launch at all. */
export function launchMode(): LaunchMode {
  if (typeof window === 'undefined') return 'off';
  const mode = window.__patchbayBoot?.launch ?? 'off';
  if (mode === 'off' || forced()) return 'off';
  return mode !== 'still' && reduced() ? 'still' : mode;
}

let started = false,
  settled = false,
  handedOff = false,
  watchdog: ReturnType<typeof setTimeout> | undefined,
  observer: MutationObserver | undefined;
const listeners = new Set<() => void>();

function finish(mode: LaunchMode, skipped: boolean) {
  if (settled) return;
  settled = true;
  clearTimeout(watchdog);
  observer?.disconnect();
  const root = document.documentElement;
  if (!skipped && ACTIVE.has(root.dataset.launch ?? '')) root.dataset.launch = 'done';
  document.querySelector('.launch')?.remove();
  if (mode !== 'off')
    window.dispatchEvent(
      new CustomEvent<LaunchDetail>(LAUNCH_EVENT, { detail: { mode, skipped } }),
    );
  for (const listener of [...listeners]) listener();
  listeners.clear();
}

function named(animations: Animation[], name: string) {
  return animations.find(
    (animation): animation is CSSAnimation =>
      animation instanceof CSSAnimation && animation.animationName === name,
  );
}
/** Milliseconds between an animation's end and now (0 if it has not ended). */
function lateness(animation: Animation): number {
  const now = Number(document.timeline.currentTime ?? 0),
    start = Number(animation.startTime ?? now),
    end = animation.effect?.getComputedTiming().endTime;
  return Math.max(0, now - start - Number(end ?? 0));
}

function handoff(stage: HTMLElement, mode: LaunchMode, condense: Animation, out: Animation) {
  // A stage that already cleared (the bundle loaded late) has nothing to hand over.
  if (settled || handedOff || out.playState === 'finished') return;
  handedOff = true;
  const late = lateness(condense) > LATE_MS;
  window.dispatchEvent(new CustomEvent(LAUNCH_HANDOFF_EVENT, { detail: { mode } }));
  // Short fades the jack in place in CSS; only the full launch flies it.
  if (mode !== 'full') return;
  const jack = stage.querySelector<HTMLElement>('.launch-jack');
  if (!jack) return;
  // Measured once: the Bench may replay its build under the flight.
  const target = late
    ? null
    : document.querySelector<HTMLElement>('#view-bench .diagram-node[aria-current="true"]');
  const plan = flightPlan(jack.getBoundingClientRect(), target?.getBoundingClientRect() ?? null, {
    width: innerWidth,
    height: innerHeight,
  });
  jack.animate(flightKeyframes(plan), { duration: FLIGHT_MS, fill: 'forwards' });
}

/** Attaches to the stage. Idempotent; main.tsx calls it before React mounts. */
export function startLaunch(): void {
  if (started || typeof document === 'undefined') return;
  started = true;
  const mode = launchMode(),
    root = document.documentElement,
    stage = document.querySelector<HTMLElement>('.launch');
  if (mode === 'off' || !stage || !ACTIVE.has(root.dataset.launch ?? '')) {
    // Skipped before the bundle ran, or never shown: settle straight away.
    finish(mode, root.dataset.launch === 'skip');
    return;
  }
  observer = new MutationObserver(() => {
    if (root.dataset.launch === 'skip') finish(mode, true);
  });
  observer.observe(root, { attributes: true, attributeFilter: ['data-launch'] });
  // getAnimations flushes style, so CSS animations exist even if no frame has
  // been produced yet; already-finished ones resolve their promise at once.
  const animations = stage.getAnimations({ subtree: true }),
    condense = named(animations, 'launch-condense'),
    out = named(animations, 'launch-out');
  if (!out) {
    finish(mode, false);
    return;
  }
  const ignore = () => undefined;
  if (condense) void condense.finished.then(() => handoff(stage, mode, condense, out), ignore);
  void out.finished.then(() => finish(mode, false), ignore);
  const end = Number(out.effect?.getComputedTiming().endTime ?? 0);
  watchdog = setTimeout(
    () => finish(mode, false),
    Math.max(0, end - Number(out.currentTime ?? 0)) + WATCHDOG_MS,
  );
}

/** True from the first frame until the stage is gone (done or skipped). */
export function isLaunchActive(): boolean {
  startLaunch();
  return started && !settled;
}

/** Calls back once the launch is done or skipped; immediately when it is off
 * or already over. Returns an unsubscribe. */
export function onLaunchSettled(callback: () => void): () => void {
  startLaunch();
  if (settled || typeof document === 'undefined') {
    callback();
    return () => undefined;
  }
  listeners.add(callback);
  return () => listeners.delete(callback);
}
