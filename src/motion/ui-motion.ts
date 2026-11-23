import { SPRINGS, springTiming, springValue, type SpringToken } from './spring';

export type Direction = 'left' | 'right' | 'top' | 'bottom';

export interface MotionOrigin {
  x: number;
  y: number;
  direction: Direction;
}

/** Keyboard navigation swaps instantly; pointer navigation animates. */
export type NavigationSource = 'pointer' | 'keyboard';

type MotionKind = 'page' | 'drawer' | 'content';

interface MotionPreferences {
  reduced: () => boolean;
}

/** Translation in CSS px, uniform scale and opacity, relative to rest. */
interface Pose {
  x: number;
  y: number;
  s: number;
  o: number;
}

interface ActiveMotion {
  target: HTMLElement;
  scope: HTMLElement;
  animation: Animation;
  settle: () => void;
}

/** The running entrance spring of a container, kept to derive its velocity. */
interface Flight {
  from: Pose;
  spring: SpringToken;
  v0: number;
  animation: Animation;
}

/**
 * Reduced motion turns route and sheet changes into an opacity-only fade of
 * this length. Exported so the native suites can reason about their waits.
 */
export const REDUCED_FADE_MS = 120;

// Strong ease-out (matches --ease) for the short, time-based exits.
const EASE_OUT = 'cubic-bezier(.23,1,.32,1)';
const ENTER: Record<MotionKind, { travel: number; scale: number; spring: SpringToken }> = {
  page: { travel: 24, scale: 0.985, spring: SPRINGS.cinematic },
  drawer: { travel: 24, scale: 0.96, spring: SPRINGS.sheet },
  content: { travel: 10, scale: 1, spring: SPRINGS.smooth },
};
const EXIT: Record<MotionKind, { duration: number; travel: number; scale: number }> = {
  page: { duration: 120, travel: 0, scale: 0.99 },
  drawer: { duration: 160, travel: 24, scale: 0.96 },
  content: { duration: 120, travel: 0, scale: 0.99 },
};
const STAGGER = { step: 40, max: 6, travel: 10, spring: SPRINGS.smooth };
const FEEDBACK = { duration: 120 };
/** A finished exit holds its last frame until the incoming view replaces it. */
const EXIT_HOLD_MS = 500;
const INVISIBLE = 0.02;
const REST: Pose = { x: 0, y: 0, s: 1, o: 1 };
const POSITIONED = '.graph-node,.graph-connect-handle,.graph-edge-label,.diagram-node';
const STAGGER_TARGETS = [
  'h1',
  'h2',
  'h3',
  '.preset-row',
  '.setting-row',
  '.tape-row',
  '.learn-comparison > article',
  '.graph-inspector-section',
  '.graph-canvas-heading',
  '.graph-toolbar',
  'tbody > tr',
  '[data-motion-item]',
].join(',');

function vector(direction: Direction, distance: number): [number, number] {
  switch (direction) {
    case 'left':
      return [-distance, 0];
    case 'right':
      return [distance, 0];
    case 'top':
      return [0, -distance];
    case 'bottom':
      return [0, distance];
  }
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function transformOf(pose: Pose, base: string): string {
  const own = `translate(${round(pose.x)}px, ${round(pose.y)}px) scale(${round(pose.s)})`;
  return base === 'none' ? own : `${own} ${base}`;
}

function matrix(transform: string): DOMMatrix {
  try {
    return new DOMMatrix(transform === 'none' ? undefined : transform);
  } catch {
    return new DOMMatrix();
  }
}

/** The presented translate/scale/opacity, with the element's own CSS transform removed. */
function presentedPose(transform: string, opacity: string, base: string): Pose {
  let shown = matrix(transform);
  if (base !== 'none') shown = shown.multiply(matrix(base).inverse());
  const alpha = Number.parseFloat(opacity);
  return {
    x: shown.e,
    y: shown.f,
    s: Math.hypot(shown.a, shown.b) || 1,
    o: Number.isFinite(alpha) ? alpha : 1,
  };
}

function opacityOf(style: CSSStyleDeclaration): number {
  const alpha = Number.parseFloat(style.opacity);
  return Number.isFinite(alpha) ? alpha : 1;
}

function seconds(animation: Animation): number {
  const time = animation.currentTime;
  return typeof time === 'number' ? Math.max(0, time / 1000) : 0;
}

/**
 * Finite, interruptible motion for the surrounding UI, driven by Apple-style
 * springs (src/motion/spring.ts) played through WAAPI as linear() curves.
 * Entrances start from the presented pose and inherit the running spring's
 * velocity, so a retarget never jumps. Only transform and opacity animate.
 */
export class UIMotion {
  private readonly active = new Set<ActiveMotion>();
  private readonly flights = new WeakMap<HTMLElement, Flight>();
  /** Where each drawer opened from, so it closes back toward that trigger. */
  private readonly anchors = new WeakMap<HTMLElement, string>();
  /** Inline will-change to restore once an element's last animation ends. */
  private readonly hints = new Map<
    HTMLElement,
    { count: number; value: string; priority: string }
  >();
  private lastOrigin?: MotionOrigin;
  private disposed = false;

  constructor(private readonly preferences: MotionPreferences) {}

  origin(trigger?: Element | null): MotionOrigin {
    if (!trigger) return this.lastOrigin ? { ...this.lastOrigin } : this.defaultOrigin();

    const bounds = trigger.getBoundingClientRect();
    const width = window.innerWidth || document.documentElement.clientWidth || 1;
    const height = window.innerHeight || document.documentElement.clientHeight || 1;
    const x = Math.max(0, Math.min(width, bounds.left + bounds.width / 2));
    const y = Math.max(0, Math.min(height, bounds.top + bounds.height / 2));
    const rail = trigger.closest('#rail,.rail,[data-motion-navigation]');
    const explicit = trigger
      .closest('[data-motion-direction]')
      ?.getAttribute('data-motion-direction');
    let direction: Direction;

    if (
      explicit === 'left' ||
      explicit === 'right' ||
      explicit === 'top' ||
      explicit === 'bottom'
    ) {
      direction = explicit;
    } else if (rail) {
      const railBounds = rail.getBoundingClientRect();
      // The same rail becomes a bottom navigation bar on narrow windows.
      direction =
        railBounds.width > railBounds.height
          ? railBounds.top + railBounds.height / 2 > height / 2
            ? 'bottom'
            : 'top'
          : railBounds.left + railBounds.width / 2 < width / 2
            ? 'left'
            : 'right';
    } else {
      const sides: Array<[Direction, number]> = [
        ['left', x / width],
        ['right', (width - x) / width],
        ['top', y / height],
        ['bottom', (height - y) / height],
      ];
      direction = sides.reduce((nearest, side) => (side[1] < nearest[1] ? side : nearest))[0];
    }

    this.lastOrigin = { x, y, direction };
    return { ...this.lastOrigin };
  }

  /**
   * Brings `element` to rest. A page travels 24px along `origin.direction`
   * (bottom = rises from below); a drawer slides in from its docked edge and
   * scales from the trigger. A visible element already in motion is retargeted
   * from its presented pose with the running spring's velocity.
   */
  enter(element: HTMLElement, origin = this.origin(), kind: MotionKind = 'page'): void {
    const moving = this.isMoving(element);
    const flight = this.flights.get(element);
    const velocity = flight ? this.velocity(flight) : null;
    const before = moving ? getComputedStyle(element) : null;
    const presentedTransform = before?.transform ?? 'none';
    const presentedOpacity = before?.opacity ?? '1';
    this.cancel(element);
    if (this.disposed) return;

    const rest = getComputedStyle(element);
    const base = rest.transform;
    const targetOpacity = opacityOf(rest);
    const presented = moving ? presentedPose(presentedTransform, presentedOpacity, base) : null;
    const retarget = presented !== null && presented.o > INVISIBLE;

    if (this.preferences.reduced()) {
      this.animate(
        element,
        element,
        [{ opacity: retarget ? presented.o : 0 }, { opacity: targetOpacity }],
        { duration: REDUCED_FADE_MS, easing: EASE_OUT, fill: 'both' },
        'opacity',
      );
      return;
    }

    const config = ENTER[kind];
    let from: Pose;
    let v0 = 0;
    if (retarget) {
      from = presented;
      v0 = velocity ? this.normalisedVelocity(from, velocity) : 0;
    } else {
      const direction = kind === 'drawer' ? this.dockedEdge(element) : origin.direction;
      const [x, y] = vector(direction, config.travel);
      from = { x, y, s: config.scale, o: 0 };
    }

    const frames: Keyframe[] = [
      { transform: transformOf(from, base) },
      { transform: transformOf(REST, base) },
    ];
    if (kind === 'drawer') {
      const transformOrigin = retarget
        ? (this.anchors.get(element) ?? this.triggerOrigin(element, origin))
        : this.triggerOrigin(element, origin);
      this.anchors.set(element, transformOrigin);
      for (const frame of frames) frame.transformOrigin = transformOrigin;
    }
    const timing = springTiming(config.spring, v0);
    const motion = this.animate(element, element, frames, { ...timing, fill: 'both' }, 'transform');
    if (motion) this.flights.set(element, { from, spring: config.spring, v0, animation: motion });

    if (from.o < targetOpacity - 0.001)
      this.animate(
        element,
        element,
        [{ opacity: from.o }, { opacity: targetOpacity }],
        { ...springTiming(SPRINGS.fade), fill: 'both' },
        'transform, opacity',
      );

    if (kind === 'page' && !retarget) this.stagger(element, origin.direction);
  }

  /**
   * Leaves quickly with an ease-out and holds the last frame until the next
   * entrance (or a short safety timeout) releases it, so the outgoing view
   * never flashes back before the new one renders. Reduced motion is instant.
   */
  exit(element: HTMLElement, origin = this.origin(), kind: MotionKind = 'page'): Promise<void> {
    element.dataset.motionKind = kind;
    const moving = this.isMoving(element);
    // Snapshot the presented pose before cancelling an entrance, so a quick
    // second interaction departs from the visible position.
    const shown = getComputedStyle(element);
    const start = { transform: shown.transform, opacity: shown.opacity };
    this.cancel(element);
    if (this.disposed || this.preferences.reduced()) return Promise.resolve();

    const rest = getComputedStyle(element);
    const base = rest.transform;
    const pose = moving
      ? presentedPose(start.transform, start.opacity, base)
      : { ...REST, o: opacityOf(rest) };
    const config = EXIT[kind];
    const direction = kind === 'drawer' ? this.dockedEdge(element) : origin.direction;
    const [dx, dy] = vector(direction, config.travel);
    const frames: Keyframe[] = [
      { transform: transformOf(pose, base), opacity: pose.o },
      {
        transform: transformOf(
          { x: pose.x + dx, y: pose.y + dy, s: pose.s * config.scale, o: 0 },
          base,
        ),
        opacity: 0,
      },
    ];
    if (kind === 'drawer') {
      const transformOrigin = this.anchors.get(element) ?? this.triggerOrigin(element, origin);
      this.anchors.delete(element);
      for (const frame of frames) frame.transformOrigin = transformOrigin;
    }
    return new Promise<void>((resolve) => {
      const motion = this.animate(
        element,
        element,
        frames,
        { duration: config.duration, easing: EASE_OUT, fill: 'forwards' },
        'transform, opacity',
        resolve,
      );
      if (!motion) resolve();
    });
  }

  feedback(button: HTMLElement): void {
    // Glass controls get the field's cursor-placed press glow instead.
    if (button.matches(':disabled,[aria-disabled="true"]') || button.closest('[data-glass]'))
      return;
    this.cancel(button);
    if (this.disposed || this.preferences.reduced()) return;

    const style = getComputedStyle(button);
    const frames: Keyframe[] = [
      { backgroundColor: style.backgroundColor, offset: 0 },
      {
        backgroundColor: `color-mix(in srgb, ${style.backgroundColor} 88%, ${style.color} 12%)`,
        offset: 0.35,
      },
      { backgroundColor: style.backgroundColor, offset: 1 },
    ];
    // The press scale belongs to CSS (:active), so this pulse stays
    // colour-only and never doubles it or scales positioned drawings.
    this.animate(
      button,
      button,
      frames,
      { duration: FEEDBACK.duration, easing: EASE_OUT, fill: 'both' },
      'background-color',
    );
  }

  cancel(element?: HTMLElement): void {
    for (const motion of Array.from(this.active)) {
      if (
        element &&
        motion.scope !== element &&
        motion.target !== element &&
        !element.contains(motion.target)
      )
        continue;
      motion.settle();
    }
  }

  dispose(): void {
    this.disposed = true;
    this.cancel();
    this.lastOrigin = undefined;
  }

  private defaultOrigin(): MotionOrigin {
    return { x: window.innerWidth / 2, y: window.innerHeight / 2, direction: 'bottom' };
  }

  private isMoving(element: HTMLElement): boolean {
    for (const motion of this.active) if (motion.target === element) return true;
    return false;
  }

  /** Analytic velocity of a running entrance, in px/s (x, y) and scale units/s. */
  private velocity(flight: Flight): Pose {
    const { v } = springValue(flight.spring, seconds(flight.animation), flight.v0);
    return {
      x: (REST.x - flight.from.x) * v,
      y: (REST.y - flight.from.y) * v,
      s: (REST.s - flight.from.s) * v,
      o: 0,
    };
  }

  /** Projects a velocity onto the remaining path to rest, as the spring's v0. */
  private normalisedVelocity(from: Pose, velocity: Pose): number {
    const dx = REST.x - from.x;
    const dy = REST.y - from.y;
    const distance = dx * dx + dy * dy;
    let v0 = 0;
    if (distance > 0.25) v0 = (velocity.x * dx + velocity.y * dy) / distance;
    else if (Math.abs(REST.s - from.s) > 1e-4) v0 = velocity.s / (REST.s - from.s);
    return Math.max(-20, Math.min(40, v0));
  }

  /** The window edge a drawer is docked to: the right side, or the bottom sheet. */
  private dockedEdge(element: HTMLElement): Direction {
    const bounds = element.getBoundingClientRect();
    const width = window.innerWidth || 1;
    return bounds.left + bounds.width / 2 > width * 0.6 ? 'right' : 'bottom';
  }

  /** The trigger point in the element's own box, clamped to its bounds. */
  private triggerOrigin(element: HTMLElement, origin: MotionOrigin): string {
    const bounds = element.getBoundingClientRect();
    const x = Math.max(0, Math.min(bounds.width, origin.x - bounds.left));
    const y = Math.max(0, Math.min(bounds.height, origin.y - bounds.top));
    return `${Math.round(x)}px ${Math.round(y)}px`;
  }

  private stagger(element: HTMLElement, direction: Direction): void {
    const [x, y] = vector(direction, STAGGER.travel);
    const move = springTiming(STAGGER.spring);
    const fade = springTiming(SPRINGS.fade);
    this.staggerTargets(element).forEach((target, index) => {
      const base = getComputedStyle(target).transform;
      const delay = index * STAGGER.step;
      this.animate(
        target,
        element,
        [
          { transform: transformOf({ x, y, s: 1, o: 0 }, base) },
          { transform: transformOf(REST, base) },
        ],
        { ...move, delay, fill: 'both' },
        'transform, opacity',
      );
      this.animate(
        target,
        element,
        [{ opacity: 0 }, { opacity: 1 }],
        { ...fade, delay, fill: 'both' },
        'transform, opacity',
      );
    });
  }

  private staggerTargets(element: HTMLElement): HTMLElement[] {
    const selected: HTMLElement[] = [];
    for (const target of element.querySelectorAll<HTMLElement>(STAGGER_TARGETS)) {
      if (
        target.closest('[hidden]') ||
        !target.getClientRects().length ||
        target.matches(POSITIONED)
      )
        continue;
      if (selected.some((parent) => parent.contains(target))) continue;
      selected.push(target);
      if (selected.length === STAGGER.max) break;
    }
    return selected;
  }

  /** will-change lives only while an element animates, shared by its animations. */
  private hint(target: HTMLElement, value: string): void {
    const saved = this.hints.get(target);
    if (saved) saved.count++;
    else
      this.hints.set(target, {
        count: 1,
        value: target.style.getPropertyValue('will-change'),
        priority: target.style.getPropertyPriority('will-change'),
      });
    target.style.setProperty('will-change', value);
  }

  private unhint(target: HTMLElement): void {
    const saved = this.hints.get(target);
    if (!saved || --saved.count > 0) return;
    this.hints.delete(target);
    if (saved.value) target.style.setProperty('will-change', saved.value, saved.priority);
    else target.style.removeProperty('will-change');
  }

  /**
   * Starts one WAAPI animation and tracks it until it finishes or is
   * cancelled. With `held`, the finished frame stays (fill: forwards) and
   * `held` is called at once; the hold is released by the next cancel() of
   * the element, or after EXIT_HOLD_MS.
   */
  private animate(
    target: HTMLElement,
    scope: HTMLElement,
    keyframes: Keyframe[],
    options: KeyframeAnimationOptions,
    willChange: string,
    held?: () => void,
  ): Animation | null {
    if (typeof target.animate !== 'function') return null;
    let animation: Animation;
    try {
      animation = target.animate(keyframes, options);
    } catch {
      return null;
    }
    this.hint(target, willChange);

    let settled = false;
    let timer = 0;
    const motion: ActiveMotion = {
      target,
      scope,
      animation,
      settle: () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.active.delete(motion);
        if (this.flights.get(target)?.animation === animation) this.flights.delete(target);
        animation.removeEventListener('finish', finished);
        animation.removeEventListener('cancel', motion.settle);
        animation.cancel();
        this.unhint(target);
        held?.();
      },
    };
    const finished = () => {
      if (!held) {
        motion.settle();
        return;
      }
      held();
      if (!settled) timer = window.setTimeout(motion.settle, EXIT_HOLD_MS);
    };
    this.active.add(motion);
    animation.addEventListener('finish', finished, { once: true });
    animation.addEventListener('cancel', motion.settle, { once: true });
    // Cancellation rejects Animation.finished; both outcomes settle the motion,
    // including external cancellation or detached nodes.
    animation.finished.catch(motion.settle);
    return animation;
  }
}
