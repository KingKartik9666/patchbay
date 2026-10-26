export type Direction = 'left' | 'right' | 'top' | 'bottom';

export interface MotionOrigin {
  x: number;
  y: number;
  direction: Direction;
}

type MotionKind = 'page' | 'drawer' | 'content';

interface MotionPreferences {
  reduced: () => boolean;
  blur: () => boolean;
}

interface ActiveMotion {
  target: HTMLElement;
  scope: HTMLElement;
  animation: Animation;
  settle: () => void;
}

const EASING = 'cubic-bezier(.16,1,.3,1)';
const DURATION: Record<MotionKind, number> = { page: 800, drawer: 720, content: 600 };
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

function translated(transform: string, direction: Direction, distance: number): string {
  const [x, y] = vector(direction, distance);
  return `translate3d(${x}px,${y}px,0)${transform === 'none' ? '' : ` ${transform}`}`;
}

/**
 * Finite, native motion for the surrounding UI. React Bits' BlurText and
 * SplitText were consulted for the blur-to-clear and staggered reveal ideas;
 * this implementation is original TypeScript and does not use their code.
 * https://github.com/DavidHDev/react-bits/tree/main/src/ts-default/TextAnimations
 */
export class UIMotion {
  private readonly active = new Set<ActiveMotion>();
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

  enter(element: HTMLElement, origin = this.origin(), kind: MotionKind = 'page'): void {
    this.cancel(element);
    if (this.disposed || this.preferences.reduced()) return;

    const style = getComputedStyle(element);
    const blur = this.preferences.blur();
    const frames: Keyframe[] = [
      { transform: translated(style.transform, origin.direction, 40), opacity: 0, offset: 0 },
      {
        transform: translated(style.transform, origin.direction, 8),
        opacity: style.opacity,
        offset: 0.38,
      },
      { transform: style.transform, opacity: style.opacity, offset: 1 },
    ];
    if (blur) {
      frames[0].filter = this.blurred(style.filter, 6);
      frames[1].filter = this.blurred(style.filter, 1);
      frames[2].filter = style.filter;
    }
    void this.animate(
      element,
      element,
      frames,
      {
        duration: DURATION[kind],
        easing: EASING,
        fill: 'both',
      },
      blur ? 'transform, opacity, filter' : 'transform, opacity',
    );

    this.staggerTargets(element).forEach((target, index) => {
      const childStyle = getComputedStyle(target);
      // The container supplies blur; avoiding another filter on every row
      // keeps the transient blur within 6px and limits compositor layers.
      void this.animate(
        target,
        element,
        [
          { transform: translated(childStyle.transform, origin.direction, 16), opacity: 0 },
          { transform: childStyle.transform, opacity: childStyle.opacity },
        ],
        {
          duration: 400,
          delay: index * 35,
          easing: EASING,
          fill: 'both',
        },
        'transform, opacity',
      );
    });
  }

  exit(element: HTMLElement, origin = this.origin(), kind: MotionKind = 'page'): Promise<void> {
    element.dataset.motionKind = kind;
    // Snapshot the currently displayed pose before cancelling an entrance,
    // so a quick second interaction can depart from the visible position.
    const current = getComputedStyle(element);
    const start = {
      transform: current.transform,
      opacity: current.opacity,
      filter: current.filter,
    };
    this.cancel(element);
    if (this.disposed || this.preferences.reduced()) return Promise.resolve();

    const style = getComputedStyle(element);
    const blur = this.preferences.blur();
    const frames: Keyframe[] = [
      { transform: start.transform, opacity: start.opacity },
      { transform: translated(style.transform, origin.direction, 20), opacity: 0 },
    ];
    if (blur) {
      frames[0].filter = start.filter;
      frames[1].filter = this.blurred(style.filter, 4);
    }
    return this.animate(
      element,
      element,
      frames,
      {
        duration: 260,
        easing: 'cubic-bezier(.4,0,1,1)',
        fill: 'both',
      },
      blur ? 'transform, opacity, filter' : 'transform, opacity',
    );
  }

  feedback(button: HTMLElement): void {
    if (button.matches(':disabled,[aria-disabled="true"]')) return;
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
    const positioned = button.matches(POSITIONED);
    if (!positioned) {
      const scale = style.scale === 'none' ? '1' : style.scale;
      frames[0].scale = scale;
      frames[1].scale = '.98';
      frames[2].scale = scale;
    }
    // Graph node/label transforms position the drawing. Their feedback uses
    // only colour; no transform or individual scale effect is attached.
    void this.animate(
      button,
      button,
      frames,
      {
        duration: 190,
        easing: EASING,
        fill: 'both',
      },
      positioned ? 'background-color' : 'background-color, scale',
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

  private blurred(filter: string, pixels: number): string {
    return `blur(${pixels}px)${filter === 'none' ? '' : ` ${filter}`}`;
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
      if (selected.length === 8) break;
    }
    return selected;
  }

  private animate(
    target: HTMLElement,
    scope: HTMLElement,
    keyframes: Keyframe[],
    options: KeyframeAnimationOptions,
    willChange: string,
  ): Promise<void> {
    if (typeof target.animate !== 'function') return Promise.resolve();
    const previous = target.style.getPropertyValue('will-change');
    const priority = target.style.getPropertyPriority('will-change');
    let animation: Animation;
    try {
      animation = target.animate(keyframes, options);
    } catch {
      return Promise.resolve();
    }
    target.style.setProperty('will-change', willChange);

    return new Promise<void>((resolve) => {
      let settled = false;
      const motion: ActiveMotion = {
        target,
        scope,
        animation,
        settle: () => {
          if (settled) return;
          settled = true;
          this.active.delete(motion);
          animation.removeEventListener('finish', motion.settle);
          animation.removeEventListener('cancel', motion.settle);
          animation.cancel();
          if (target.style.getPropertyValue('will-change') === willChange) {
            if (previous) target.style.setProperty('will-change', previous, priority);
            else target.style.removeProperty('will-change');
          }
          resolve();
        },
      };
      this.active.add(motion);
      animation.addEventListener('finish', motion.settle, { once: true });
      animation.addEventListener('cancel', motion.settle, { once: true });
      // Cancellation rejects Animation.finished. Both outcomes settle the
      // public promise, including external cancellation or detached nodes.
      void animation.finished.then(motion.settle, motion.settle);
    });
  }
}
