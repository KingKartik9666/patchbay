import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { flightKeyframes, flightPlan, isLaunchActive, launchMode } from '../src/launch/launch';

const root = resolve(import.meta.dirname, '..');
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');
const html = read('index.html');
const css = /<style id="launch-css">([\s\S]*?)<\/style>/.exec(html)?.[1] ?? '';

/** Top-level `@keyframes` bodies by name. */
function keyframes(): Map<string, string> {
  const found = new Map<string, string>();
  for (const match of css.matchAll(/@keyframes\s+([\w-]+)\s*\{/g)) {
    let depth = 1,
      index = match.index + match[0].length;
    for (; depth && index < css.length; index++)
      depth += css[index] === '{' ? 1 : css[index] === '}' ? -1 : 0;
    found.set(match[1], css.slice(match.index + match[0].length, index - 1));
  }
  return found;
}
/** The body of a variant's nested block, `html[data-launch=<mode>]{ … }`. */
function variant(mode: string): string {
  return (
    new RegExp(`^html\\[data-launch=${mode}\\]\\{\\n([\\s\\S]*?)\\n\\}`, 'm').exec(css)?.[1] ?? ''
  );
}
/** The `animation` shorthand of one rule inside a block, as written. */
function animation(block: string, selector: string): string {
  const escaped = selector.replace(/[[\]().:]/g, '\\$&');
  return new RegExp(`^${escaped}\\{(?:--[^;]+;)*animation:([^}]+)\\}`, 'm').exec(block)?.[1] ?? '';
}
/** One token per theme from src/reference.css (the Night and Pearl blocks). */
function token(theme: 'dark' | 'light', name: string): string {
  const reference = read('src/reference.css'),
    start = reference.indexOf(`html[data-theme='${theme}'] {`);
  const block = reference.slice(start, reference.indexOf('\n}', start));
  return new RegExp(`${name}:\\s*(#[0-9a-f]{6})`, 'i').exec(block)?.[1].toLowerCase() ?? '';
}
/** A `--l-*` launch colour for a theme (Night is the default block). */
function stageColour(theme: 'dark' | 'light', name: string): string {
  const selector =
    theme === 'light'
      ? /html\[data-theme=light\] \.launch\{([^}]+)\}/
      : /html:is\(\[data-launch=full\],\[data-launch=short\],\[data-launch=still\]\) \.launch\{([^}]+)\}/;
  return (
    new RegExp(`--l-${name}:(#[0-9A-Fa-f]{6})`).exec(selector.exec(css)?.[1] ?? '')?.[1] ?? ''
  ).toLowerCase();
}

describe('launch flight', () => {
  const jack = { left: 680, top: 360, width: 80, height: 80 },
    viewport = { width: 1440, height: 900 };
  it('flies centre to centre and lands at the target size', () => {
    expect(flightPlan(jack, { left: 300, top: 500, width: 52, height: 52 }, viewport)).toEqual({
      dx: 326 - 720,
      dy: 526 - 400,
      scale: 0.65,
    });
  });
  it('fades in place when the target is missing, collapsed or off-screen', () => {
    expect(flightPlan(jack, null, viewport)).toBeNull();
    expect(flightPlan(jack, { left: 10, top: 10, width: 0, height: 0 }, viewport)).toBeNull();
    expect(flightPlan(jack, { left: 10, top: 1200, width: 52, height: 52 }, viewport)).toBeNull();
    const fade = flightKeyframes(null);
    expect(fade.at(-1)).toEqual({ transform: 'scale(0.6)', opacity: 0 });
  });
  it('animates only transform and opacity, and lands before dissolving', () => {
    const frames = flightKeyframes({ dx: -394, dy: 126, scale: 0.65 });
    for (const frame of frames)
      expect(Object.keys(frame).filter((key) => !['offset', 'easing'].includes(key))).toEqual([
        'transform',
        'opacity',
      ]);
    expect(frames[1]).toMatchObject({
      transform: 'translate(-394.00px, 126.00px) scale(0.6500)',
      opacity: 1,
      offset: 0.85,
    });
  });
  it('is off and settled outside the desktop shell', () => {
    expect(launchMode()).toBe('off');
    expect(isLaunchActive()).toBe(false);
  });
});

/** Runs src-tauri/src/launch-init.js the way launch::script does, in a fake document. */
function boot(payload: object, { withRoot = true } = {}) {
  const listeners = new Map<string, Set<() => void>>();
  const on = (target: string) => ({
    addEventListener(name: string, listener: () => void) {
      const key = `${target}:${name}`;
      if (!listeners.has(key)) listeners.set(key, new Set());
      listeners.get(key)!.add(listener);
    },
    removeEventListener(name: string, listener: () => void) {
      listeners.get(`${target}:${name}`)?.delete(listener);
    },
  });
  const rootElement = { dataset: {} as Record<string, string> };
  const observers: (() => void)[] = [];
  const document = {
    ...on('document'),
    hidden: false,
    documentElement: withRoot ? rootElement : null,
  } as { hidden: boolean; documentElement: typeof rootElement | null };
  const window = { ...on('window') } as Record<string, unknown>;
  class MutationObserver {
    constructor(private readonly callback: (records: unknown[], observer: unknown) => void) {}
    observe() {
      observers.push(() => this.callback([], this));
    }
    disconnect() {
      observers.length = 0;
    }
  }
  const script = read('src-tauri/src/launch-init.js').replace(
    '(__PATCHBAY_BOOT__)',
    `(${JSON.stringify(payload)})`,
  );
  runInNewContext(script, { window, document, MutationObserver });
  const fire = (key: string) => [...(listeners.get(key) ?? [])].forEach((listener) => listener());
  const count = () => [...listeners.values()].reduce((sum, set) => sum + set.size, 0);
  return { window, document, rootElement, observers, fire, count };
}

describe('launch initialization script', () => {
  const payload = { theme: 'light', launch: 'full', version: '2.0.0', contrast: true };
  it('marks the theme and the variant before the page parses', () => {
    const run = boot(payload);
    expect(run.rootElement.dataset).toEqual({
      theme: 'light',
      launch: 'full',
      launchContrast: '',
    });
    expect(Object.isFrozen(run.window.__patchbayBoot)).toBe(true);
    expect(run.window.__patchbayBoot).toEqual(payload);
  });
  it('skips on the first key, press, wheel or touch and then stops listening', () => {
    for (const event of ['keydown', 'pointerdown', 'wheel', 'touchstart']) {
      const run = boot(payload);
      expect(run.count()).toBe(5);
      run.fire('window:pointermove');
      expect(run.rootElement.dataset.launch).toBe('full');
      run.fire(`window:${event}`);
      expect(run.rootElement.dataset.launch).toBe('skip');
      expect(run.count()).toBe(0);
    }
  });
  it('skips when the window becomes hidden, but never revives a finished launch', () => {
    const run = boot(payload);
    run.fire('document:visibilitychange');
    expect(run.rootElement.dataset.launch).toBe('full');
    run.document.hidden = true;
    run.fire('document:visibilitychange');
    expect(run.rootElement.dataset.launch).toBe('skip');
    const done = boot(payload);
    done.rootElement.dataset.launch = 'done';
    done.fire('window:keydown');
    expect(done.rootElement.dataset.launch).toBe('done');
  });
  it('waits for <html> when the document is still empty, and sets only the theme when off', () => {
    const run = boot({ ...payload, launch: 'off', contrast: false }, { withRoot: false });
    expect(run.count()).toBe(0);
    run.document.documentElement = run.rootElement;
    run.observers.forEach((notify) => notify());
    expect(run.rootElement.dataset).toEqual({ theme: 'light' });
  });
});

describe('launch stage (index.html)', () => {
  it('is the first body child, decorative, and never takes input', () => {
    expect(html.indexOf('<div class="launch" aria-hidden="true">')).toBeGreaterThan(
      html.indexOf('<body>'),
    );
    expect(html.indexOf('<div class="launch"')).toBeLessThan(html.indexOf('<div id="app">'));
    expect(css).toMatch(/\.launch\{display:none\}/);
    expect(css).toMatch(/pointer-events:none/);
    for (const name of [
      'launch-ground',
      'launch-stage',
      'launch-fields',
      'launch-veil',
      'launch-field is-mealy',
      'launch-field is-moore',
      'launch-ring',
      'launch-arc',
      'launch-comet',
      'launch-jack',
      'launch-word',
      'launch-sub',
    ])
      expect(html).toContain(`class="${name}"`);
  });
  it('is hidden for screenshots, skip, done and forced colours', () => {
    expect(css).toContain(
      'html[data-launch=skip] .launch,html[data-launch=done] .launch,html[data-capture] .launch{display:none!important}',
    );
    expect(css).toMatch(/@media \(forced-colors:active\)\{\.launch\{display:none!important\}\}/);
  });
  it('animates only transform and opacity (the watchdog only hides)', () => {
    const frames = keyframes();
    expect(frames.size).toBeGreaterThanOrEqual(11);
    for (const [name, body] of frames) {
      const properties = new Set(
        [...body.matchAll(/([\w-]+):/g)]
          .map((match) => match[1])
          .filter((property) => property !== 'animation-timing-function'),
      );
      const allowed = name === 'launch-watchdog' ? ['visibility'] : ['transform', 'opacity'];
      for (const property of properties) expect(allowed, `${name} ${property}`).toContain(property);
    }
  });
  it('keeps the documented timeline for every variant', () => {
    // DESIGN.md › The launch: [selector, animation] per beat (delay = start, ms).
    const full: [string, string][] = [
      ['.launch', 'launch-condense 1640ms linear both,launch-watchdog 1ms 3040ms forwards'],
      ['.launch-ground', 'launch-out 600ms var(--l-o) 1640ms both'],
      [':is(.launch-fields,.launch-mark)', 'l-shrink 460ms var(--l-m) 1180ms forwards'],
      ['.launch-swirl', 'l-swirl 600ms var(--l-m) 900ms both'],
      ['.launch-field', 'l-in 540ms var(--l-o) 80ms both'],
      ['.launch-ring', 'l-in 540ms var(--l-o) 80ms both,l-pulse 120ms var(--l-o) 900ms'],
      ['.launch-arc', 'l-swing 700ms var(--l-o) 200ms both'],
      ['.launch-comet', 'l-ride 620ms var(--l-m) 280ms both,l-blink 680ms linear 280ms both'],
      ['.launch-jack i', 'l-in 220ms var(--l-o) 900ms both'],
      [
        '.launch-word',
        'l-rise 560ms var(--l-o) 620ms both,l-shrink 300ms var(--l-o) 1500ms forwards',
      ],
      ['.launch-sub', 'l-in 480ms var(--l-o) 760ms both,l-shrink 300ms var(--l-o) 1500ms forwards'],
    ];
    const short: [string, string][] = [
      ['.launch', 'launch-condense 600ms linear both,launch-watchdog 1ms 1700ms forwards'],
      ['.launch-ground', 'launch-out 300ms var(--l-o) 600ms both'],
      [':is(.launch-fields,.launch-mark)', 'l-shrink 220ms var(--l-m) 420ms forwards'],
      ['.launch-field', 'l-in 360ms var(--l-o) 60ms both'],
      [':is(.launch-ring,.launch-arc)', 'l-in 360ms var(--l-o) 60ms both'],
      [
        '.launch-jack i',
        'l-in 160ms var(--l-o) 360ms both,l-shrink 300ms var(--l-o) 600ms forwards',
      ],
    ];
    for (const [mode, rules] of [
      ['full', full],
      ['short', short],
    ] as const)
      for (const [selector, expected] of rules)
        expect(animation(variant(mode), selector), `${mode} ${selector}`).toBe(expected);
    const still = 'launch-out 180ms linear 300ms both,launch-watchdog 1ms 1280ms forwards';
    expect(animation(variant('still'), '.launch')).toBe(still);
    expect(variant('still')).toContain('.launch :is(div,i,p){animation:none}');
    // OS reduced motion turns full and short into the still frame.
    const reduced =
      /@media \(prefers-reduced-motion:reduce\)\{html\[data-launch\]\{\n([\s\S]*?)\n\}\}/.exec(
        css,
      )?.[1] ?? '';
    expect(animation(reduced, '.launch')).toBe(still);
    expect(reduced).toContain('.launch :is(div,i,p){animation:none}');
  });
  it('starts on the window colour and resolves into the theme tokens', () => {
    expect(html).toContain('<meta name="theme-color" content="#0C0D0D" />');
    for (const theme of ['dark', 'light'] as const) {
      expect(stageColour(theme, 'ground'), theme).toBe(token(theme, '--mask'));
      expect(stageColour(theme, 'deep'), theme).toBe(token(theme, '--deep'));
      expect(stageColour(theme, 'silk'), theme).toBe(token(theme, '--silk'));
      expect(stageColour(theme, 'muted'), theme).toBe(token(theme, '--muted'));
      expect(stageColour(theme, 'signal'), theme).toBe(token(theme, '--panel-signal'));
    }
    expect(stageColour('dark', 'ground')).toBe('#0c0d0d');
    expect(stageColour('light', 'ground')).toBe('#eceef2');
  });
});

// Measured in the 1600x900 design space: the coloured fields are composited
// (premultiplied, source-over) on the ground, under the ground veil, before
// and after the swirl, and every sample of the wordmark and subline line boxes
// is checked against its text colour.
type Rgba = [number, number, number, number];
const hex = (value: string): Rgba => [
  parseInt(value.slice(1, 3), 16),
  parseInt(value.slice(3, 5), 16),
  parseInt(value.slice(5, 7), 16),
  1,
];
const linear = (channel: number) => {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const luminance = ([r, g, b]: Rgba) => 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
const contrast = (a: Rgba, b: Rgba) => {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};
interface Field {
  x: number;
  y: number;
  r: number;
  stops: [number, Rgba][];
}
const fields: Field[] = [
  {
    x: 520,
    y: 560,
    r: 550,
    stops: [
      [0, [255, 92, 122, 0.85]],
      [0.55, [255, 181, 71, 0.35]],
      [0.72, [0, 0, 0, 0]],
    ],
  },
  {
    x: 1020,
    y: 300,
    r: 500,
    stops: [
      [0, [91, 140, 255, 0.85]],
      [0.55, [160, 124, 255, 0.35]],
      [0.72, [0, 0, 0, 0]],
    ],
  },
];
function sample(field: Field, x: number, y: number): Rgba {
  const t = Math.hypot(x - field.x, y - field.y) / field.r;
  const index = field.stops.findIndex(([offset]) => offset > t);
  if (index === -1) return [0, 0, 0, 0];
  const [o0, c0] = field.stops[index - 1],
    [o1, c1] = field.stops[index];
  const k = (t - o0) / (o1 - o0),
    alpha = c0[3] + (c1[3] - c0[3]) * k;
  // CSS gradients interpolate premultiplied colour.
  const channel = (i: number) =>
    alpha ? (c0[i] * c0[3] + (c1[i] * c1[3] - c0[i] * c0[3]) * k) / alpha : 0;
  return [channel(0), channel(1), channel(2), alpha];
}
function swirl(field: Field, amount: number): Field {
  const angle = (24 * amount * Math.PI) / 180,
    scale = 1 + 0.08 * amount,
    dx = field.x - 800,
    dy = field.y - 380;
  return {
    ...field,
    x: 800 + scale * (dx * Math.cos(angle) - dy * Math.sin(angle)),
    y: 380 + scale * (dx * Math.sin(angle) + dy * Math.cos(angle)),
    r: field.r * scale,
  };
}
/** The veil's transparent and opaque stops as fractions of the stage height. */
function veil(): [number, number] {
  const rule =
    /\.launch-veil\{[^}]*bottom:-(\d+)%;background:linear-gradient\(transparent ([\d.]+)%,var\(--l-ground\) ([\d.]+)%\)\}/.exec(
      css,
    );
  if (!rule) throw new Error('launch veil rule not found');
  const height = 1 + Number(rule[1]) / 100;
  return [(Number(rule[2]) / 100) * height, (Number(rule[3]) / 100) * height];
}
function worst(theme: 'dark' | 'light', text: string, box: number[]): number {
  const [clear, opaque] = veil();
  const ground = hex(stageColour(theme, 'ground')),
    ink = hex(stageColour(theme, text)),
    opacity = theme === 'light' ? 0.8 : 1;
  let lowest = Infinity;
  for (const amount of [0, 0.5, 1])
    for (let y = box[1]; y <= box[3]; y += 4)
      for (let x = box[0]; x <= box[2]; x += 8) {
        const mask = Math.min(1, Math.max(0, (opaque - y / 900) / (opaque - clear)));
        let colour = ground;
        for (const field of fields) {
          const [r, g, b, a] = sample(swirl(field, amount), x, y),
            alpha = a * mask * opacity;
          colour = [0, 1, 2].map((i) => colour[i] * (1 - alpha) + [r, g, b][i] * alpha) as Rgba;
          colour[3] = 1;
        }
        lowest = Math.min(lowest, contrast(ink, colour));
      }
  return lowest;
}

describe('launch legibility', () => {
  it('keeps the wordmark and subline far above 4.5:1 over the colour fields', () => {
    expect(veil().map((stop) => +stop.toFixed(3))).toEqual([0.52, 0.74]);
    // Line boxes: the wordmark is 112 units tall at y 640, the subline 30 at y 716.
    for (const theme of ['dark', 'light'] as const) {
      expect(worst(theme, 'silk', [540, 584, 1060, 696]), theme).toBeGreaterThan(7);
      expect(worst(theme, 'muted', [600, 700, 1000, 732]), theme).toBeGreaterThan(4.5);
    }
  });
});
