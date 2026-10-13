export type Theme = 'light' | 'dark';

type Point = { x: number; y: number };
type ThemeWaveOptions = {
  theme: () => Theme;
  reduced: () => boolean;
  /** Commit the palette and redraw theme-dependent canvas ink synchronously. */
  onCommit: (theme: Theme) => void;
};
type Layer = {
  canvas: HTMLCanvasElement;
  context: CanvasRenderingContext2D;
  x: number;
  y: number;
  width: number;
  height: number;
};

const DURATION = 1.2;
const EDGE_WIDTH = 24;
const EDGE_BANDS = 16;
const SEGMENTS = 224;
const TAU = Math.PI * 2;
const opposite = (theme: Theme): Theme => theme === 'light' ? 'dark' : 'light';
const smooth = (value: number) => value * value * (3 - 2 * value);

/**
 * A temporary difference mask: white inverts the pixels already on screen;
 * its graded, rippling edge turns them grey before their opposite color.
 * The application's shared ticker is the only animation clock.
 */
export class ThemeWave {
  private target: Theme | null = null;
  private elapsed = 0;
  private origin: Point = { x: 0, y: 0 };
  private width = 0;
  private height = 0;
  private dpr = 1;
  private reach = 0;
  private viewport: Layer | null = null;
  private dialogs = new Map<HTMLDialogElement, Layer>();
  private disposed = false;
  private directions = Array.from({ length: SEGMENTS }, (_, index) => {
    const angle = index / SEGMENTS * TAU;
    return { angle, x: Math.cos(angle), y: Math.sin(angle) };
  });

  constructor(private options: ThemeWaveOptions) {
    document.body.dataset.themeTransition = 'idle';
    window.addEventListener('resize', this.resize);
    document.addEventListener('visibilitychange', this.visibility);
  }

  get active(): boolean { return this.target !== null; }

  toggle(origin?: Point): void {
    if (this.disposed) return;
    // Finish the previous intent first, so rapid clicks cannot commit an old
    // target after the latest click. A second click then travels back.
    const next = opposite(this.target ?? this.options.theme());
    if (this.active) this.finish();
    if (this.options.reduced() || document.hidden) {
      this.options.onCommit(next);
      return;
    }

    this.width = window.innerWidth;
    this.height = window.innerHeight;
    this.dpr = Math.min(1.5, window.devicePixelRatio || 1);
    this.origin = {
      x: Math.max(0, Math.min(this.width, origin?.x ?? this.width * .82)),
      y: Math.max(0, Math.min(this.height, origin?.y ?? 90)),
    };
    this.reach = Math.hypot(
      Math.max(this.origin.x, this.width - this.origin.x),
      Math.max(this.origin.y, this.height - this.origin.y),
    ) + EDGE_WIDTH / 2 + 3;
    this.elapsed = 0;
    this.viewport = this.createLayer(document.body, 'viewport');
    if (!this.viewport) {
      this.options.onCommit(next);
      return;
    }
    this.target = next;
    this.sizeLayer(this.viewport, 0, 0, this.width, this.height);
    document.body.dataset.themeTransition = 'running';
    this.syncDialogs();
  }

  /** dt is in seconds, matching the shared ticker. Idle calls do no work. */
  update(dt: number): void {
    if (!this.active || this.disposed) return;
    if (this.options.reduced() || document.hidden ||
        window.innerWidth !== this.width || window.innerHeight !== this.height ||
        Math.min(1.5, window.devicePixelRatio || 1) !== this.dpr) {
      this.finish();
      return;
    }
    this.elapsed += Math.max(0, Number.isFinite(dt) ? dt : 0);
    if (this.elapsed >= DURATION) {
      this.finish();
      return;
    }
    this.syncDialogs();
    this.draw();
  }

  /** Complete immediately for resize, hidden documents or reduced motion. */
  finish(): void {
    const target = this.target;
    if (target === null) return;
    // Cover every last edge pixel before swapping the exact inverse palette.
    // Both commit and removal happen synchronously, before the next paint.
    const layers = this.layers();
    for (const layer of layers) {
      const context = layer.context;
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.globalAlpha = 1;
      context.fillStyle = '#fff';
      context.fillRect(0, 0, layer.canvas.width, layer.canvas.height);
    }
    this.target = null;
    this.viewport = null;
    this.dialogs.clear();
    this.elapsed = 0;
    try {
      this.options.onCommit(target);
    } finally {
      for (const layer of layers) this.releaseLayer(layer);
      if (!this.active) document.body.dataset.themeTransition = 'idle';
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.finish();
    this.disposed = true;
    window.removeEventListener('resize', this.resize);
    document.removeEventListener('visibilitychange', this.visibility);
  }

  private resize = (): void => { this.finish(); };
  private visibility = (): void => { if (document.hidden) this.finish(); };

  private createLayer(parent: HTMLElement, kind: 'viewport' | 'dialog'): Layer | null {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    if (kind === 'viewport') canvas.id = 'theme-wave';
    canvas.dataset.themeWaveLayer = kind;
    canvas.setAttribute('aria-hidden', 'true');
    canvas.style.cssText = `position:${kind === 'viewport' ? 'fixed' : 'absolute'};left:0;top:0;display:block;pointer-events:none;z-index:2147483647;mix-blend-mode:difference;`;
    const context = canvas.getContext('2d', { alpha: true });
    if (!context) return null;
    parent.appendChild(canvas);
    return { canvas, context, x: 0, y: 0, width: 0, height: 0 };
  }

  private sizeLayer(layer: Layer, x: number, y: number, width: number, height: number): void {
    layer.x = x;
    layer.y = y;
    if (layer.width === width && layer.height === height) return;
    layer.width = width;
    layer.height = height;
    layer.canvas.style.width = `${width}px`;
    layer.canvas.style.height = `${height}px`;
    layer.canvas.width = Math.max(1, Math.ceil(width * this.dpr));
    layer.canvas.height = Math.max(1, Math.ceil(height * this.dpr));
  }

  private syncDialogs(): void {
    // A body overlay is below a modal dialog in the browser's top layer.
    // Give each modal its own mask, sampled in the same viewport coordinates.
    const visible = new Set(document.querySelectorAll<HTMLDialogElement>('dialog:modal'));
    for (const [dialog, layer] of this.dialogs) {
      if (!visible.has(dialog)) {
        this.releaseLayer(layer);
        this.dialogs.delete(dialog);
      }
    }
    for (const dialog of visible) {
      const rect = dialog.getBoundingClientRect();
      const left = rect.left + dialog.clientLeft;
      const top = rect.top + dialog.clientTop;
      const x = Math.max(0, left);
      const y = Math.max(0, top);
      const width = Math.max(0, Math.min(this.width, left + dialog.clientWidth) - x);
      const height = Math.max(0, Math.min(this.height, top + dialog.clientHeight) - y);
      let layer = this.dialogs.get(dialog);
      if (!width || !height) {
        if (layer) {
          this.releaseLayer(layer);
          this.dialogs.delete(dialog);
        }
        continue;
      }
      if (!layer) {
        const created = this.createLayer(dialog, 'dialog');
        if (!created) continue;
        layer = created;
        this.dialogs.set(dialog, layer);
      }
      this.sizeLayer(layer, x, y, width, height);
      layer.canvas.style.left = `${dialog.scrollLeft + x - left}px`;
      layer.canvas.style.top = `${dialog.scrollTop + y - top}px`;
    }
  }

  private layers(): Layer[] {
    return this.viewport ? [this.viewport, ...this.dialogs.values()] : [];
  }

  private draw(): void {
    const progress = this.elapsed / DURATION;
    const radius = this.reach * smooth(progress);
    const swell = Math.sin(Math.PI * progress) * Math.min(82, radius * .145);
    const phase = progress * TAU;
    const contour = this.directions.map(direction => radius + swell * (
      .52 * Math.sin(direction.angle * 3 + phase * .9) +
      .30 * Math.sin(direction.angle * 7 - phase * 1.1) +
      .18 * Math.sin(direction.angle * 11 + phase * .65)
    ));
    const core = this.path(contour, -EDGE_WIDTH / 2);
    const bands: { path: Path2D; alpha: number }[] = [];
    let previousCoverage = 0;
    for (let index = EDGE_BANDS - 1; index >= 0; index--) {
      const coverage = 1 - smooth((index + .5) / EDGE_BANDS);
      const offset = -EDGE_WIDTH / 2 + (index + 1) * EDGE_WIDTH / EDGE_BANDS;
      // Nested fills avoid antialias seams between adjacent rings. Choose the
      // source alpha so their accumulated coverage follows the smooth ramp.
      bands.push({
        path: this.path(contour, offset),
        alpha: (coverage - previousCoverage) / (1 - previousCoverage),
      });
      previousCoverage = coverage;
    }
    for (const layer of this.layers()) {
      const context = layer.context;
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.clearRect(0, 0, layer.canvas.width, layer.canvas.height);
      context.setTransform(this.dpr, 0, 0, this.dpr, -layer.x * this.dpr, -layer.y * this.dpr);
      context.fillStyle = '#fff';
      for (const band of bands) {
        context.globalAlpha = band.alpha;
        context.fill(band.path);
      }
      context.globalAlpha = 1;
      context.fill(core);
    }
  }

  private path(contour: number[], offset: number): Path2D {
    const path = new Path2D();
    this.directions.forEach((direction, index) => {
      const radius = Math.max(0, contour[index] + offset);
      const x = this.origin.x + direction.x * radius;
      const y = this.origin.y + direction.y * radius;
      if (index === 0) path.moveTo(x, y);
      else path.lineTo(x, y);
    });
    path.closePath();
    return path;
  }

  private releaseLayer(layer: Layer): void {
    layer.canvas.remove();
    // Release the viewport-sized backing store as soon as motion ends.
    layer.canvas.width = layer.canvas.height = 1;
  }
}
