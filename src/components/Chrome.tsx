import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { isTauri } from '@tauri-apps/api/core';
import type { Page, Panel, Preferences } from '../domain/contracts';
import { field, useGlassSurface } from '../rendering/field';
import { SPRINGS, springTiming, springValue, type SpringToken } from '../motion/spring';
import type { NavigationSource } from '../motion/ui-motion';
import { Icon } from './Icon';
import { NavIcon, type NavIconName } from './NavIcon';
import { ThemeGlyph } from './ThemeGlyph';

type PanelName = Exclude<Panel, null>;

const pages: { name: Page; label: string }[] = [
  { name: 'bench', label: 'Bench' },
  { name: 'machines', label: 'Machines' },
  { name: 'editor', label: 'Editor' },
  { name: 'learn', label: 'Learn' },
];
const panels: { name: PanelName; label: string }[] = [
  { name: 'trace', label: 'Trace' },
  { name: 'text', label: 'Text definition' },
  { name: 'settings', label: 'Settings' },
];

/** A tooltip appears after this hover delay (the CSS transition-delay). */
const TOOLTIP_DELAY_MS = 300;
/** Within this long of one tooltip closing, the next opens without delay. */
const TOOLTIP_WARM_MS = 400;
/** The gel stretch of the indicator: 1 + min(GEL_MAX, speed / GEL_SPEED). */
const GEL_MAX = 0.08;
const GEL_SPEED = 4000;
const EASE_OUT = 'cubic-bezier(.23,1,.32,1)';

interface ChromeProps {
  page: Page;
  panel: Panel;
  preferences: Preferences;
  /** The titlebar caption, '{Route} · {machine name}'. */
  caption: string;
  /** How the latest navigation was started; keyboard snaps the indicator. */
  source: RefObject<NavigationSource>;
  onNavigate: (name: NavIconName, source: NavigationSource) => void;
  /** Starts the theme wave from `origin` (the toggle when omitted). */
  onTheme: (origin?: HTMLElement) => void;
  /**
   * The theme the user last asked for; it flips on press, before the wave
   * lands. Defaults to the committed theme.
   */
  themeIntent?: Preferences['theme'];
  onFocus: () => void;
  onClose: () => void;
}

interface Point {
  x: number;
  y: number;
}

interface IndicatorFlight {
  from: Point;
  to: Point;
  spring: SpringToken;
  v0: number;
  animation: Animation;
}

/** Two jacks joined by a patch cable: the product's mark. */
function BrandMark() {
  return (
    <svg className="brand-mark" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <circle cx="5.5" cy="8" r="3.5" />
      <circle cx="18.5" cy="8" r="3.5" />
      <circle className="brand-mark-pin" cx="5.5" cy="8" r="1.2" />
      <circle className="brand-mark-pin" cx="18.5" cy="8" r="1.2" />
      <path d="M5.5 11.5c0 9 13 9 13 0" />
    </svg>
  );
}

/** Layout offset of `element` inside `ancestor`, ignoring transforms such as :active scale. */
function offsetWithin(element: HTMLElement, ancestor: HTMLElement): Point {
  let x = 0;
  let y = 0;
  let node: Element | null = element;
  while (node instanceof HTMLElement && node !== ancestor) {
    x += node.offsetLeft;
    y += node.offsetTop;
    node = node.offsetParent;
  }
  if (node === ancestor) return { x, y };
  // The rail is not the offset parent (an unpositioned rail): fall back to boxes.
  const inner = element.getBoundingClientRect();
  const outer = ancestor.getBoundingClientRect();
  return {
    x: inner.left - outer.left - ancestor.clientLeft,
    y: inner.top - outer.top - ancestor.clientTop,
  };
}

function cancelFlight(flight: RefObject<IndicatorFlight | null>, gel: RefObject<Animation | null>) {
  flight.current?.animation.cancel();
  flight.current = null;
  gel.current?.cancel();
  gel.current = null;
}

/**
 * Moves the shared selection indicator onto the active page row. Size changes
 * are instant; the move is a 'glass' spring on `translate` that starts from the
 * presented position with the running velocity, plus a short gel stretch on
 * `scale` along the travel axis that relaxes on 'snappy'.
 */
function placeIndicator(
  rail: HTMLElement,
  indicator: HTMLElement,
  item: HTMLElement,
  animate: boolean,
  flight: RefObject<IndicatorFlight | null>,
  gel: RefObject<Animation | null>,
): void {
  const to = offsetWithin(item, rail);
  indicator.style.width = `${item.offsetWidth}px`;
  indicator.style.height = `${item.offsetHeight}px`;

  const running = flight.current;
  let from: Point | null = null;
  let v0 = 0;
  if (running) {
    const elapsed = Math.max(0, Number(running.animation.currentTime ?? 0) / 1000);
    const { x: progress, v } = springValue(running.spring, elapsed, running.v0);
    const dx = running.to.x - running.from.x;
    const dy = running.to.y - running.from.y;
    from = { x: running.from.x + dx * progress, y: running.from.y + dy * progress };
    const remainingX = to.x - from.x;
    const remainingY = to.y - from.y;
    const distance = remainingX * remainingX + remainingY * remainingY;
    if (distance > 0.25) v0 = (dx * v * remainingX + dy * v * remainingY) / distance;
  } else if (rail.hasAttribute('data-indicator')) {
    const [x = '0', y = '0'] = indicator.style.translate.split(' ');
    from = { x: Number.parseFloat(x) || 0, y: Number.parseFloat(y) || 0 };
  }
  cancelFlight(flight, gel);
  indicator.style.translate = `${to.x}px ${to.y}px`;
  rail.setAttribute('data-indicator', '');

  if (!animate || !from || typeof indicator.animate !== 'function') return;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const distance = Math.hypot(dx, dy);
  if (distance < 0.5) return;

  v0 = Math.max(-20, Math.min(40, v0));
  const spring = SPRINGS.glass;
  const timing = springTiming(spring, v0);
  const animation = indicator.animate(
    [{ translate: `${from.x}px ${from.y}px` }, { translate: `${to.x}px ${to.y}px` }],
    timing,
  );
  flight.current = { from, to, spring, v0, animation };
  animation.addEventListener('finish', () => {
    if (flight.current?.animation === animation) flight.current = null;
  });

  // Peak speed of this move decides how far the gel stretches along its axis.
  let peak = 0;
  let peakAt = 0;
  for (let time = 0; time <= timing.duration; time += 4) {
    const speed = Math.abs(springValue(spring, time / 1000, v0).v) * distance;
    if (speed > peak) {
      peak = speed;
      peakAt = time;
    }
  }
  const stretch = Math.min(GEL_MAX, peak / GEL_SPEED);
  if (stretch < 0.005) return;
  const along = 1 + stretch;
  const across = 1 - stretch / 2;
  const relax = springTiming(SPRINGS.snappy);
  const total = peakAt + relax.duration;
  gel.current = indicator.animate(
    [
      { scale: '1 1', offset: 0, easing: EASE_OUT },
      {
        scale: Math.abs(dx) >= Math.abs(dy) ? `${along} ${across}` : `${across} ${along}`,
        offset: peakAt / total,
        easing: relax.easing,
      },
      { scale: '1 1', offset: 1 },
    ],
    { duration: total },
  );
}

export function Chrome({
  page,
  panel,
  preferences,
  caption,
  source,
  onNavigate,
  onTheme,
  themeIntent = preferences.theme,
  onFocus,
  onClose,
}: ChromeProps) {
  const [maximized, setMaximized] = useState(false);
  const [roving, setRoving] = useState<{ page: Page; name: NavIconName } | null>(null);
  const titlebarRef = useRef<HTMLDivElement>(null);
  const railRef = useRef<HTMLElement>(null);
  const indicatorRef = useRef<HTMLSpanElement>(null);
  const flight = useRef<IndicatorFlight | null>(null);
  const gel = useRef<Animation | null>(null);
  const tooltip = useRef({ shown: false, timer: 0 });
  const reduced = preferences.reducedMotion;
  useGlassSurface(titlebarRef, 'bar');
  useGlassSurface(railRef, 'sidebar');

  // Roving focus belongs to the page it started on; a route change resets it.
  const focusable = roving?.page === page ? roving.name : page;
  const [route, ...rest] = caption.split(' · ');
  const machine = rest.join(' · ');

  useEffect(() => {
    if (!isTauri()) return;
    const window = getCurrentWindow();
    let alive = true;
    let unlisten: (() => void) | undefined;
    void window.isMaximized().then((value) => {
      if (alive) setMaximized(value);
    });
    void window
      .onResized(() => {
        void window.isMaximized().then((value) => {
          if (alive) setMaximized(value);
        });
      })
      .then((stop) => {
        if (alive) unlisten = stop;
        else stop();
      });
    return () => {
      alive = false;
      unlisten?.();
    };
  }, []);

  // A pointer route change glides the indicator; keyboard, reduced motion and
  // the first placement snap it in the same frame as the route.
  useLayoutEffect(() => {
    const rail = railRef.current;
    const indicator = indicatorRef.current;
    const item = rail?.querySelector<HTMLElement>(`.nav-item[data-route="${page}"]`);
    if (!rail || !indicator || !item) return;
    placeIndicator(rail, indicator, item, !reduced && source.current !== 'keyboard', flight, gel);
  }, [page, reduced, source]);

  // Layout changes (sidebar ↔ icon rail ↔ tab bar, window resizes) snap it.
  useEffect(() => {
    const rail = railRef.current;
    if (!rail || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      const indicator = indicatorRef.current;
      const item = rail.querySelector<HTMLElement>(
        '.rail-group[data-group=pages] .nav-item.active',
      );
      if (indicator && item) placeIndicator(rail, indicator, item, false, flight, gel);
    });
    observer.observe(rail);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const state = tooltip.current;
    return () => {
      clearTimeout(state.timer);
      cancelFlight(flight, gel);
    };
  }, []);

  const warm = (on: boolean) => railRef.current?.toggleAttribute('data-tooltip-warm', on);
  const hover = (name: NavIconName) => {
    field.setNavHint(name);
    const state = tooltip.current;
    clearTimeout(state.timer);
    if (!state.shown)
      state.timer = window.setTimeout(() => {
        state.shown = true;
        warm(true);
      }, TOOLTIP_DELAY_MS);
  };
  const leave = () => {
    field.setNavHint(null);
    const state = tooltip.current;
    clearTimeout(state.timer);
    if (state.shown)
      state.timer = window.setTimeout(() => {
        state.shown = false;
        warm(false);
      }, TOOLTIP_WARM_MS);
  };

  const item = (name: NavIconName, label: string, active: boolean, kind: 'page' | 'panel') => (
    <button
      key={name}
      type="button"
      className={`nav-item${active ? ' active' : ''}`}
      data-route={name}
      tabIndex={focusable === name ? 0 : -1}
      aria-current={kind === 'page' && active ? 'page' : undefined}
      aria-expanded={kind === 'panel' ? active : undefined}
      aria-controls={kind === 'panel' ? 'drawer' : undefined}
      aria-label={label}
      onFocus={() => setRoving({ page, name })}
      onPointerEnter={() => hover(name)}
      onPointerLeave={leave}
      onClick={(event) => onNavigate(name, event.detail === 0 ? 'keyboard' : 'pointer')}
    >
      <NavIcon name={name} />
      <span className="nav-label">{label}</span>
      <span className="nav-tooltip" aria-hidden="true">
        {label}
      </span>
    </button>
  );

  return (
    <>
      <div
        ref={titlebarRef}
        className="titlebar"
        data-glass="bar"
        onPointerDown={(event) => {
          if (isTauri() && event.button === 0 && !(event.target as HTMLElement).closest('button'))
            void getCurrentWindow().startDragging();
        }}
      >
        <span className="titlebar-logo">
          <BrandMark />
          Patchbay
        </span>
        <span className="titlebar-divider" aria-hidden="true" />
        <span className="titlebar-caption" aria-hidden="true">
          {route}
          {machine && <span> · {machine}</span>}
        </span>
        <div className="header-end titlebar-capsule">
          <button
            id="theme-toggle"
            type="button"
            className="icon-button"
            aria-label={`Switch to ${themeIntent === 'dark' ? 'light' : 'dark'} theme`}
            title="Switch theme"
            onClick={(event) => onTheme(event.currentTarget)}
          >
            <ThemeGlyph />
          </button>
          <button
            id="focus"
            type="button"
            className="icon-button"
            aria-label="Focus mode"
            aria-pressed={preferences.focusMode}
            title="Focus mode (F)"
            onClick={onFocus}
          >
            <Icon name="focus" />
          </button>
        </div>
        <div className="window-controls">
          <button
            id="window-minimize"
            type="button"
            aria-label="Minimize window"
            onClick={() => {
              if (isTauri()) void getCurrentWindow().minimize();
            }}
          >
            <Icon name="minimize" />
          </button>
          <button
            id="window-maximize"
            type="button"
            aria-label={maximized ? 'Restore window' : 'Maximize window'}
            onClick={() => {
              if (isTauri()) void getCurrentWindow().toggleMaximize();
            }}
          >
            <Icon name={maximized ? 'restore' : 'maximize'} />
          </button>
          <button id="window-close" type="button" aria-label="Close window" onClick={onClose}>
            <Icon name="close" />
          </button>
        </div>
      </div>
      <nav
        id="rail"
        ref={railRef}
        className="rail"
        data-glass="sidebar"
        aria-label="Main navigation"
        onKeyDown={(event) => {
          // Rows hidden by the layout (Trace and Text on the tab bar) are skipped.
          const buttons = Array.from(
            event.currentTarget.querySelectorAll<HTMLButtonElement>('.nav-item'),
          ).filter((button) => button.getClientRects().length > 0);
          const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
          const next =
            event.key === 'Home'
              ? 0
              : event.key === 'End'
                ? buttons.length - 1
                : ['ArrowDown', 'ArrowRight'].includes(event.key)
                  ? (index + 1) % buttons.length
                  : ['ArrowUp', 'ArrowLeft'].includes(event.key)
                    ? (index - 1 + buttons.length) % buttons.length
                    : -1;
          if (next >= 0 && buttons[next]) {
            event.preventDefault();
            buttons[next].focus();
          }
        }}
      >
        <span ref={indicatorRef} className="nav-indicator" aria-hidden="true" />
        <div className="rail-group" data-group="pages" role="group" aria-label="Pages">
          {pages.map(({ name, label }) => item(name, label, page === name, 'page'))}
        </div>
        <span className="rail-group-label" id="rail-panels-label">
          Panels
        </span>
        <div
          className="rail-group"
          data-group="panels"
          role="group"
          aria-labelledby="rail-panels-label"
        >
          {panels.map(({ name, label }) => item(name, label, panel === name, 'panel'))}
        </div>
        <span className="rail-status">
          <i aria-hidden="true" />
          Offline · on this device
        </span>
      </nav>
    </>
  );
}
