import type { Signals } from '../signals';
import { drawStaticBoard, generateBoardScene, mulberry32, pointAtDistance, type BoardContext, type BoardScene } from './scene';

type Surface = HTMLCanvasElement | OffscreenCanvas;
const MAX_PULSES = 48;
const TAU = Math.PI * 2;

function surface(width: number, height: number): Surface {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function context(canvas: Surface): BoardContext {
  const ctx = canvas.getContext('2d', { alpha: false }) as BoardContext | null;
  if (!ctx) throw new Error('The circuit board needs a 2D canvas context.');
  return ctx;
}

/** Canvas-only board and frost twin. The app's single ticker owns all scheduling. */
export class Board {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly frostCtx: CanvasRenderingContext2D;
  private readonly staticBoard = surface(1, 1);
  private readonly staticFrost = surface(1, 1);
  private readonly staticCtx: BoardContext;
  private readonly staticFrostCtx: BoardContext;
  private readonly glow = surface(32, 32);
  private readonly active = new Uint8Array(MAX_PULSES);
  private readonly traceIndex = new Int16Array(MAX_PULSES);
  private readonly distance = new Float32Array(MAX_PULSES);
  private readonly speed = new Float32Array(MAX_PULSES);
  private readonly tail = new Float32Array(MAX_PULSES);
  private readonly point = new Float32Array(2);
  private readonly random = mulberry32(0x6f776572);
  private readonly costs = new Float32Array(60);
  private scene: BoardScene | null = null;
  private width = 1;
  private height = 1;
  private dpr = 1;
  private ratio = 1;
  private quality: Signals['quality'] = 'high';
  private glass: Signals['glass'] = 'baked';
  private frozen = false;
  private focused = false;
  private dirty = true;
  private disposed = false;
  private elapsed = 0;
  private pending = 0;
  private spawnBalance = 0;
  private previousEnergy = 0;
  private ringAge = 2;
  private draws = 0;
  private cost = 0;
  private costIndex = 0;
  private costCount = 0;
  private overBudget = 0;
  private adaptiveRate = 120;

  constructor(private readonly boardCanvas: HTMLCanvasElement, private readonly frostCanvas: HTMLCanvasElement) {
    this.ctx = context(boardCanvas) as CanvasRenderingContext2D;
    this.frostCtx = context(frostCanvas) as CanvasRenderingContext2D;
    this.staticCtx = context(this.staticBoard);
    this.staticFrostCtx = context(this.staticFrost);
    const glowContext = this.glow.getContext('2d') as BoardContext;
    const gradient = glowContext.createRadialGradient(16, 16, 0, 16, 16, 16);
    gradient.addColorStop(0, 'rgba(255,220,237,.95)');
    gradient.addColorStop(.12, 'rgba(255,91,173,.7)');
    gradient.addColorStop(.42, 'rgba(255,91,173,.24)');
    gradient.addColorStop(1, 'rgba(255,91,173,0)');
    glowContext.fillStyle = gradient;
    glowContext.fillRect(0, 0, 32, 32);
  }

  get drawCount(): number { return this.draws; }
  get lastCostMs(): number { return this.cost; }

  resize(width: number, height: number, dpr: number): void {
    if (this.disposed) return;
    this.width = Math.max(1, Math.round(width));
    this.height = Math.max(1, Math.round(height));
    this.dpr = Math.max(1, Math.min(1.5, dpr || 1));
    this.scene = generateBoardScene(this.width, this.height);
    this.active.fill(0);
    this.spawnBalance = 0;
    this.rebuildCache();
  }

  private rebuildCache(): void {
    if (!this.scene) return;
    this.ratio = this.quality === 'high' ? this.dpr : 1;
    this.boardCanvas.width = this.staticBoard.width = Math.max(1, Math.round(this.width * this.ratio));
    this.boardCanvas.height = this.staticBoard.height = Math.max(1, Math.round(this.height * this.ratio));
    this.frostCanvas.width = this.staticFrost.width = Math.max(1, Math.ceil(this.width / 8));
    this.frostCanvas.height = this.staticFrost.height = Math.max(1, Math.ceil(this.height / 8));
    drawStaticBoard(this.staticCtx, this.scene, this.ratio);
    drawStaticBoard(this.staticFrostCtx, this.scene, 1 / 8);
    this.dirty = true;
  }

  update(dt: number, signals: Readonly<Signals>): void {
    if (this.disposed || !this.scene) return;
    const frozen = signals.quality === 'low' || signals.reducedMotion || signals.focusMode;
    if (signals.quality !== this.quality) {
      this.quality = signals.quality;
      this.rebuildCache();
      if (this.quality !== 'high') this.active.fill(0, 24);
    }
    if (frozen !== this.frozen || signals.focusMode !== this.focused || signals.glass !== this.glass) {
      this.frozen = frozen;
      this.focused = signals.focusMode;
      this.glass = signals.glass;
      this.dirty = true;
      if (frozen) this.active.fill(0);
    }
    if (!frozen && signals.phase === 'playing' && signals.energy > this.previousEnergy + .15) this.ringAge = 0;
    this.previousEnergy = signals.energy;
    if (frozen && !this.dirty) return;
    const delta = Math.max(0, Math.min(.05, dt));
    this.pending += delta;
    const rate = Math.max(1, Math.min(signals.refreshHz || 60, signals.boardRate || 120, this.adaptiveRate, this.quality === 'medium' ? 60 : 120));
    if (!this.dirty && this.pending + .0001 < 1 / rate) return;
    const frameDt = this.pending;
    this.pending = 0;
    if (!frozen) {
      this.elapsed += frameDt;
      this.ringAge += frameDt;
      this.movePulses(frameDt, signals.energy);
    }
    const before = performance.now();
    this.drawBoard(this.ctx, this.staticBoard, this.ratio, !frozen, signals.glowPasses);
    if (this.glass === 'baked' && this.quality !== 'low') {
      this.drawBoard(this.frostCtx, this.staticFrost, 1 / 8, !frozen, signals.glowPasses);
    }
    this.cost = performance.now() - before;
    this.draws++;
    this.dirty = false;
    if (!frozen) this.trackCost(this.cost);
  }

  private movePulses(dt: number, energy: number): void {
    const scene = this.scene!;
    const count = this.quality === 'high' ? MAX_PULSES : 24;
    for (let i = 0; i < count; i++) {
      if (!this.active[i]) continue;
      this.distance[i]! += this.speed[i]! * dt;
      if (this.distance[i]! > scene.traces[this.traceIndex[i]!]!.length + this.tail[i]!) this.active[i] = 0;
    }
    this.spawnBalance += dt * (5 + 14 * Math.max(0, Math.min(1, energy)));
    while (this.spawnBalance >= 1) {
      this.spawnBalance--;
      let slot = 0;
      while (slot < count && this.active[slot]) slot++;
      if (slot === count || !scene.traces.length) continue;
      const weight = this.random() * scene.totalLength;
      let trace = 0;
      while (trace < scene.weights.length - 1 && scene.weights[trace]! < weight) trace++;
      this.active[slot] = 1;
      this.traceIndex[slot] = trace;
      this.distance[slot] = 0;
      this.speed[slot] = 90 + this.random() * 130;
      this.tail[slot] = 70 + this.random() * 90;
    }
  }

  /** Both canvases share the scene and pulse pool; only their scale differs. */
  private drawBoard(ctx: BoardContext, cached: Surface, scale: number, animate: boolean, glowPasses: number): void {
    const scene = this.scene!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.drawImage(cached, 0, 0);
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    if (this.focused) {
      ctx.fillStyle = 'rgba(20,20,20,.8)';
      ctx.fillRect(0, 0, this.width, this.height);
    }
    if (!animate) return;
    ctx.globalCompositeOperation = 'lighter';
    const count = this.quality === 'high' ? MAX_PULSES : 24;
    const stamps = glowPasses === 2 ? 5 : 8;
    for (let i = 0; i < count; i++) {
      if (!this.active[i]) continue;
      const trace = scene.traces[this.traceIndex[i]!]!;
      for (let stamp = stamps - 1; stamp >= 0; stamp--) {
        const distance = this.distance[i]! - this.tail[i]! * stamp / stamps;
        if (distance < 0 || distance > trace.length) continue;
        pointAtDistance(trace, distance, this.point);
        const x = this.point[0]!, y = this.point[1]!;
        const away = Math.min(1, Math.hypot((x - this.width * .54) / this.width, (y - this.height * .46) / this.height) * 2);
        const fade = 1 - stamp / stamps;
        ctx.globalAlpha = fade * fade * (.13 + away * .37);
        const size = stamp === 0 ? 20 : 12;
        ctx.drawImage(this.glow, x - size / 2, y - size / 2, size, size);
      }
    }
    ctx.fillStyle = '#ff5bad';
    for (let i = 0; i < Math.min(14, scene.pads.length); i++) {
      const pad = scene.pads[i]!;
      const heartbeat = .5 + .5 * Math.sin(this.elapsed * TAU * pad.frequency + pad.phase);
      ctx.globalAlpha = .05 + heartbeat * .13;
      ctx.beginPath();
      ctx.arc(pad.x, pad.y, 2.5 + heartbeat * 2.5, 0, TAU);
      ctx.fill();
    }
    if (this.ringAge < 1.2 && scene.pads.length) {
      const pad = scene.pads[0]!;
      ctx.globalAlpha = .2 * (1 - this.ringAge / 1.2);
      ctx.strokeStyle = '#ff5bad';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(pad.x, pad.y, this.ringAge * 50, 0, TAU);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  private trackCost(cost: number): void {
    if (this.costCount === this.costs.length && this.costs[this.costIndex]! > 1.2) this.overBudget--;
    this.costs[this.costIndex] = cost;
    if (cost > 1.2) this.overBudget++;
    this.costIndex = (this.costIndex + 1) % this.costs.length;
    this.costCount = Math.min(this.costs.length, this.costCount + 1);
    if (this.costCount === this.costs.length && this.overBudget > 3) {
      this.adaptiveRate = this.adaptiveRate > 60 ? 60 : 30;
      this.costCount = 0;
      this.costIndex = 0;
      this.overBudget = 0;
      this.costs.fill(0);
    }
  }

  dispose(): void {
    this.disposed = true;
    this.active.fill(0);
    this.scene = null;
    this.staticBoard.width = this.staticBoard.height = 1;
    this.staticFrost.width = this.staticFrost.height = 1;
    this.glow.width = this.glow.height = 1;
  }
}
