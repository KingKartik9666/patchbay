export type GlassKind = 'bar' | 'sidebar' | 'sheet';
export const GLASS_KIND: Record<GlassKind, number> = { bar: 0, sidebar: 1, sheet: 2 };

export interface GlassEntry {
  el: HTMLElement;
  kind: GlassKind;
  /** Shader frost only for active entries; rims and press glow for all. */
  active: boolean;
  x: number;
  y: number;
  w: number;
  h: number;
  radius: number;
  la: number;
  lx: number;
}

const entries: GlassEntry[] = [];
const listeners = new Set<(sync: boolean) => void>();
let observer: ResizeObserver | null = null;
let pressed: HTMLElement | null = null;
let light: { x: number; y: number } | null = null;

function readRect(entry: GlassEntry): void {
  const rect = entry.el.getBoundingClientRect();
  entry.x = rect.left;
  entry.y = rect.top;
  entry.w = rect.width;
  entry.h = rect.height;
}
function readAll(): void {
  for (const entry of entries) {
    readRect(entry);
    entry.radius = parseFloat(getComputedStyle(entry.el).borderTopLeftRadius) || 0;
  }
}
/** sync: the geometry changed now and the field should redraw inside this callback. */
function notify(sync: boolean): void {
  for (const listener of listeners) listener(sync);
}
const resized = () => {
  readAll();
  notify(true);
};
const transition = () => notify(false);

const down = (event: PointerEvent) => {
  const button = event.target instanceof Element ? event.target.closest('button') : null;
  if (!button || !entries.some((entry) => entry.el.contains(button))) return;
  const rect = button.getBoundingClientRect();
  button.style.setProperty('--px', `${Math.round(event.clientX - rect.left)}px`);
  button.style.setProperty('--py', `${Math.round(event.clientY - rect.top)}px`);
  button.setAttribute('data-pressed', '');
  pressed = button;
};
const up = () => {
  pressed?.removeAttribute('data-pressed');
  pressed = null;
};

function install(): void {
  observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(resized);
  addEventListener('resize', resized);
  addEventListener('pointerdown', down, { passive: true, capture: true });
  addEventListener('pointerup', up, { passive: true, capture: true });
  addEventListener('pointercancel', up, { passive: true, capture: true });
}
function uninstall(): void {
  observer?.disconnect();
  observer = null;
  removeEventListener('resize', resized);
  removeEventListener('pointerdown', down, { capture: true });
  removeEventListener('pointerup', up, { capture: true });
  removeEventListener('pointercancel', up, { capture: true });
  up();
}

/** Registers a glass surface; returns its unregister function. */
export function registerGlass(el: HTMLElement, kind: GlassKind, active: boolean): () => void {
  if (!entries.length) install();
  const entry: GlassEntry = {
    el,
    kind,
    active,
    x: 0,
    y: 0,
    w: 0,
    h: 0,
    radius: 0,
    la: NaN,
    lx: NaN,
  };
  entries.push(entry);
  observer?.observe(el);
  el.addEventListener('transitionrun', transition);
  readAll();
  if (light) writeEntry(entry, light.x, light.y, true);
  notify(true);
  return () => {
    const index = entries.indexOf(entry);
    if (index < 0) return;
    entries.splice(index, 1);
    observer?.unobserve(el);
    el.removeEventListener('transitionrun', transition);
    el.style.removeProperty('--la');
    el.style.removeProperty('--lx');
    if (!entries.length) uninstall();
    notify(true);
  };
}

export const glassRegistry = {
  onChange(listener: (sync: boolean) => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  /** Re-reads the rect of every animating surface; true while any animates. */
  refreshAnimating(): boolean {
    let animating = false;
    for (const entry of entries)
      if (entry.el.getAnimations().length > 0) {
        readRect(entry);
        animating = true;
      }
    return animating;
  },
  /** Visible active surfaces, in CSS pixels, at most `limit`. */
  rects(limit = 8): GlassEntry[] {
    return entries.filter((entry) => entry.active && entry.w >= 1 && entry.h >= 1).slice(0, limit);
  },
  remeasure: readAll,
};

function writeEntry(entry: GlassEntry, x: number, y: number, force: boolean): void {
  if (entry.w < 1) return;
  const angle =
    ((Math.atan2(x - (entry.x + entry.w / 2), entry.y + entry.h / 2 - y) * 180) / Math.PI + 360) %
    360;
  const turn = Math.abs(((((angle - entry.la) % 360) + 540) % 360) - 180);
  if (force || !(turn <= 2)) {
    entry.la = angle;
    entry.el.style.setProperty('--la', `${angle.toFixed(1)}deg`);
  }
  const lx = x - entry.x;
  if (force || !(Math.abs(lx - entry.lx) <= 4)) {
    entry.lx = lx;
    entry.el.style.setProperty('--lx', `${Math.round(lx)}px`);
  }
}

/** Points every rim toward the light (CSS px). The field calls this once per
 * drawn frame, so rims follow at the display's refresh rate; a style is
 * written only when the angle moves more than 2° or the bar highlight more
 * than 4 px, so a resting light costs no style recalculation. */
export function writeRims(x: number, y: number, force = false): void {
  light = { x, y };
  for (const entry of entries) writeEntry(entry, x, y, force);
}

/** Static and off modes: rims fall back to the stylesheet's fixed angle. */
export function clearRims(): void {
  light = null;
  for (const entry of entries) {
    entry.la = entry.lx = NaN;
    entry.el.style.removeProperty('--la');
    entry.el.style.removeProperty('--lx');
  }
}
