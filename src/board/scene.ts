/** The circuit model and its painter can also run inside an OffscreenCanvas worker. */
export type BoardContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export interface BoardTrace {
  points: Float32Array;
  lengths: Float32Array;
  length: number;
}

export interface BoardComponent { x: number; y: number; w: number; h: number }
export interface BoardPad { x: number; y: number; r: number; phase: number; frequency: number }
export interface BoardScene {
  width: number;
  height: number;
  traces: BoardTrace[];
  weights: Float32Array;
  totalLength: number;
  components: BoardComponent[];
  pads: BoardPad[];
  vias: BoardPad[];
}

export function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let n = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    n = (n + Math.imul(n ^ (n >>> 7), 61 | n)) ^ n;
    return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
  };
}

function chamfer(raw: number[], radius: number): BoardTrace {
  const points: number[] = [raw[0]!, raw[1]!];
  for (let i = 2; i < raw.length - 2; i += 2) {
    const x = raw[i]!, y = raw[i + 1]!;
    const ax = raw[i - 2]! - x, ay = raw[i - 1]! - y;
    const bx = raw[i + 2]! - x, by = raw[i + 3]! - y;
    const incoming = Math.hypot(ax, ay), outgoing = Math.hypot(bx, by);
    const amount = Math.min(radius, incoming / 2, outgoing / 2);
    if (incoming > 0 && outgoing > 0) {
      points.push(x + ax / incoming * amount, y + ay / incoming * amount);
      points.push(x + bx / outgoing * amount, y + by / outgoing * amount);
    }
  }
  points.push(raw[raw.length - 2]!, raw[raw.length - 1]!);
  const lengths = new Float32Array(points.length / 2);
  let length = 0;
  for (let i = 1; i < lengths.length; i++) {
    length += Math.hypot(points[i * 2]! - points[i * 2 - 2]!, points[i * 2 + 1]! - points[i * 2 - 1]!);
    lengths[i] = length;
  }
  return { points: new Float32Array(points), lengths, length };
}

/** Generation runs only when the viewport changes, with a fixed seed. */
export function generateBoardScene(width: number, height: number, seed = 0x50746368): BoardScene {
  const random = mulberry32(seed);
  const grid = 24;
  const snap = (n: number) => Math.round(n / grid) * grid;
  const components: BoardComponent[] = [];
  const traces: BoardTrace[] = [];
  const pads: BoardPad[] = [];
  const vias: BoardPad[] = [];
  const edgePoint = (index: number): [number, number] => {
    const edge = index % 4;
    if (edge === 0) return [snap(18 + random() * width * .22), snap(random() * height)];
    if (edge === 1) return [snap(width * (.77 + random() * .22)), snap(random() * height)];
    if (edge === 2) return [snap(random() * width), snap(12 + random() * height * .18)];
    return [snap(random() * width), snap(height * (.81 + random() * .18))];
  };

  for (let i = 0; i < 14; i++) {
    const [x, y] = edgePoint(i);
    const w = (3 + Math.floor(random() * 4)) * grid;
    const h = (2 + Math.floor(random() * 3)) * grid;
    components.push({ x: Math.min(width - w - 12, Math.max(12, x - w / 2)), y: Math.min(height - h - 12, Math.max(12, y - h / 2)), w, h });
  }

  for (let bus = 0; bus < 24; bus++) {
    const [sx, sy] = edgePoint(bus);
    const [ex, ey] = edgePoint(bus + (random() > .55 ? 1 : 4));
    const horizontalFirst = random() > .5;
    const bend = horizontalFirst ? snap((sx + ex) / 2 + (random() - .5) * 120) : snap((sy + ey) / 2 + (random() - .5) * 120);
    const count = 2 + Math.floor(random() * 4);
    for (let lane = 0; lane < count; lane++) {
      const offset = (lane - (count - 1) / 2) * 7;
      const raw = horizontalFirst
        ? [sx, sy + offset, bend + offset, sy + offset, bend + offset, ey + offset, ex, ey + offset]
        : [sx + offset, sy, sx + offset, bend + offset, ex + offset, bend + offset, ex + offset, ey];
      const trace = chamfer(raw, 14);
      if (trace.length > 40) traces.push(trace);
    }
  }

  const addPads = (target: BoardPad[], count: number, isVia: boolean) => {
    for (let i = 0; i < count; i++) {
      const trace = traces[Math.floor(random() * traces.length)];
      const atEnd = random() > .5;
      const x = trace ? trace.points[atEnd ? trace.points.length - 2 : 0]! : random() * width;
      const y = trace ? trace.points[atEnd ? trace.points.length - 1 : 1]! : random() * height;
      target.push({ x, y, r: isVia ? 3 : 3 + random() * 2, phase: random() * Math.PI * 2, frequency: .25 + random() * .45 });
    }
  };
  addPads(pads, 26, false);
  addPads(vias, 16, true);
  const weights = new Float32Array(traces.length);
  let totalLength = 0;
  for (let i = 0; i < traces.length; i++) weights[i] = totalLength += traces[i]!.length;
  return { width, height, traces, weights, totalLength, components, pads, vias };
}

/** Writes a constant-speed point into a caller-owned scratch buffer. */
export function pointAtDistance(trace: BoardTrace, distance: number, point: Float32Array): void {
  const lengths = trace.lengths;
  const position = Math.max(0, Math.min(trace.length, distance));
  let lo = 1, hi = lengths.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (lengths[mid]! < position) lo = mid + 1;
    else hi = mid;
  }
  const before = lengths[lo - 1]!;
  const span = lengths[lo]! - before;
  const u = span > 0 ? (position - before) / span : 0;
  const previous = (lo - 1) * 2, next = lo * 2;
  point[0] = trace.points[previous]! + (trace.points[next]! - trace.points[previous]!) * u;
  point[1] = trace.points[previous + 1]! + (trace.points[next + 1]! - trace.points[previous + 1]!) * u;
}

/** One cached static layer: only the vignette and calm mask use gradients. */
export function drawStaticBoard(ctx: BoardContext, scene: BoardScene, scale: number): void {
  const { width, height } = scene;
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = '#171717';
  ctx.fillRect(0, 0, width, height);
  ctx.lineWidth = 1.25;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.strokeStyle = 'rgba(245,185,10,.08)';
  ctx.beginPath();
  for (const trace of scene.traces) {
    ctx.moveTo(trace.points[0]!, trace.points[1]!);
    for (let i = 2; i < trace.points.length; i += 2) ctx.lineTo(trace.points[i]!, trace.points[i + 1]!);
  }
  ctx.stroke();

  ctx.strokeStyle = 'rgba(245,185,10,.12)';
  ctx.fillStyle = 'rgba(20,20,20,.22)';
  for (const part of scene.components) {
    ctx.beginPath();
    ctx.roundRect(part.x, part.y, part.w, part.h, 5);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    for (let y = part.y + 12; y < part.y + part.h - 4; y += 12) {
      ctx.moveTo(part.x - 7, y); ctx.lineTo(part.x, y);
      ctx.moveTo(part.x + part.w, y); ctx.lineTo(part.x + part.w + 7, y);
    }
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(part.x + 10, part.y + 10, 2, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.fillStyle = 'rgba(245,185,10,.15)';
  ctx.beginPath();
  for (const pad of scene.pads) { ctx.moveTo(pad.x + pad.r, pad.y); ctx.arc(pad.x, pad.y, pad.r, 0, Math.PI * 2); }
  ctx.fill();
  ctx.strokeStyle = 'rgba(245,185,10,.16)';
  ctx.beginPath();
  for (const via of scene.vias) { ctx.moveTo(via.x + via.r, via.y); ctx.arc(via.x, via.y, via.r, 0, Math.PI * 2); }
  ctx.stroke();

  const calm = ctx.createRadialGradient(width * .54, height * .46, 0, width * .54, height * .46, Math.max(width, height) * .58);
  calm.addColorStop(0, 'rgba(23,23,23,.60)');
  calm.addColorStop(.38, 'rgba(23,23,23,.55)');
  calm.addColorStop(1, 'rgba(23,23,23,0)');
  ctx.fillStyle = calm;
  ctx.fillRect(0, 0, width, height);
  const vignette = ctx.createRadialGradient(width * .52, height * .4, Math.min(width, height) * .1, width * .52, height * .4, Math.max(width, height) * .7);
  vignette.addColorStop(0, 'rgba(20,20,20,0)');
  vignette.addColorStop(1, 'rgba(20,20,20,.35)');
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, width, height);
}
