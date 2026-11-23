import type { MachineDef } from '../domain/contracts';

export const EDGE_SAMPLES = 96;
export interface DPoint {
  x: number;
  y: number;
}
export interface DNode {
  id: string;
  x: number;
  y: number;
  r: number;
  order: number;
  depth: number;
  reachable: boolean;
  out?: string;
}
export interface DEdge {
  id: string;
  from: string;
  to: string;
  kind: 'forward' | 'back' | 'loop';
  labels: string[];
  symbols: string[];
  pts: Float32Array;
  len: Float32Array;
  length: number;
  order: number;
  labelX: number;
  labelY: number;
  reachable: boolean;
  bounds: { left: number; top: number; right: number; bottom: number };
}
export interface DiagramData {
  nodes: DNode[];
  edges: DEdge[];
  width: number;
  height: number;
}

const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));
const pairId = (from: string, to: string) => JSON.stringify([from, to]);
const finiteSize = (value: number, fallback: number) =>
  Number.isFinite(value) && value > 0 ? value : fallback;

/** Samples a cubic once. Animation reads its table and never evaluates a layout. */
export function sampleCubic(
  p0: DPoint,
  p1: DPoint,
  p2: DPoint,
  p3: DPoint,
): { pts: Float32Array; len: Float32Array; length: number } {
  const pts = new Float32Array(EDGE_SAMPLES * 2);
  const len = new Float32Array(EDGE_SAMPLES);
  for (let i = 0; i < EDGE_SAMPLES; i++) {
    const t = i / (EDGE_SAMPLES - 1),
      a = 1 - t;
    pts[i * 2] = a * a * a * p0.x + 3 * a * a * t * p1.x + 3 * a * t * t * p2.x + t * t * t * p3.x;
    pts[i * 2 + 1] =
      a * a * a * p0.y + 3 * a * a * t * p1.y + 3 * a * t * t * p2.y + t * t * t * p3.y;
    if (i)
      len[i] =
        len[i - 1] +
        Math.hypot(pts[i * 2] - pts[(i - 1) * 2], pts[i * 2 + 1] - pts[(i - 1) * 2 + 1]);
  }
  return { pts, len, length: len[EDGE_SAMPLES - 1] };
}

/** Arc-length lookup, with an optional output object for allocation-free frames. */
export function pointAt(
  edge: Pick<DEdge, 'pts' | 'len'>,
  u: number,
  out: DPoint = { x: 0, y: 0 },
): DPoint {
  const n = edge.len.length;
  if (!n) {
    out.x = 0;
    out.y = 0;
    return out;
  }
  const target = clamp(Number.isFinite(u) ? u : 0, 0, 1) * edge.len[n - 1];
  let low = 0,
    high = n - 1;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (edge.len[mid] < target) low = mid + 1;
    else high = mid;
  }
  const before = Math.max(0, low - 1);
  const segment = edge.len[low] - edge.len[before];
  const t = segment > 0 ? (target - edge.len[before]) / segment : 0;
  out.x = edge.pts[before * 2] + (edge.pts[low * 2] - edge.pts[before * 2]) * t;
  out.y = edge.pts[before * 2 + 1] + (edge.pts[low * 2 + 1] - edge.pts[before * 2 + 1]) * t;
  return out;
}

/** Pure deterministic BFS layout; state and input names are data, never selectors. */
export function buildDiagram(machine: MachineDef, box: { w: number; h: number }): DiagramData {
  const viewportWidth = finiteSize(box.w, 800),
    viewportHeight = finiteSize(box.h, 440);
  const r = clamp(Math.min(viewportWidth, viewportHeight) * 0.05, 26, 40);
  const stateSet = new Set(machine.states);
  const depths = new Map<string, number>();
  const order: string[] = [];
  const start = stateSet.has(machine.start) ? machine.start : machine.states[0];
  if (start !== undefined) {
    depths.set(start, 0);
    order.push(start);
  }
  for (let index = 0; index < order.length; index++) {
    const source = order[index];
    for (const symbol of machine.alphabet) {
      const destination = machine.delta[source]?.[symbol];
      if (destination !== undefined && stateSet.has(destination) && !depths.has(destination)) {
        depths.set(destination, depths.get(source)! + 1);
        order.push(destination);
      }
    }
  }
  const reachable = new Set(order);
  const reachableMax = Math.max(0, ...depths.values());
  for (const state of machine.states)
    if (!depths.has(state)) {
      depths.set(state, reachableMax + 1);
      order.push(state);
    }
  const maxDepth = Math.max(0, ...depths.values());
  const rowCounts = new Map<number, number>();
  for (const depth of depths.values()) rowCounts.set(depth, (rowCounts.get(depth) ?? 0) + 1);
  const maxRows = Math.max(1, ...rowCounts.values());
  const minimumGap = r * 2 + 80;
  // The start arrow (47px, tail at x - r - 52) and its "start" label (x - r - 60) sit left of
  // the start state and must never be clipped by the plate's inset and radius: r + 72 keeps
  // the tail >= 20px and the label >= 12px inside at every width.
  const horizontalMargin = Math.max(r + 72, Math.min(100, viewportWidth * 0.13));
  const padY = Math.max(r * 3.5 + 20, Math.min(120, viewportHeight * 0.25));
  // Expand the drawable area instead of compressing states, labels and loops.
  // The renderer scrolls this area inside the unchanged stage viewport.
  const w = Math.max(viewportWidth, horizontalMargin * 2 + maxDepth * (r * 2 + 72));
  const h = Math.max(viewportHeight, padY * 2 + 32 + (maxRows - 1) * minimumGap);
  const availableWidth = Math.max(1, w - horizontalMargin * 2);
  const colGap = maxDepth ? Math.min(330, availableWidth / maxDepth) : 0;
  const padX = (w - maxDepth * colGap) / 2;
  const nodes: DNode[] = order.map((id, index) => ({
    id,
    x: padX + depths.get(id)! * colGap,
    y: h / 2 + 16,
    r,
    order: index,
    depth: depths.get(id)!,
    reachable: reachable.has(id),
    ...(machine.outputs.kind === 'moore' ? { out: machine.outputs.lambda[id] ?? '' } : {}),
  }));
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const columns: DNode[][] = Array.from({ length: maxDepth + 1 }, () => []);
  nodes.forEach((node) => columns[node.depth].push(node));
  const predecessors = new Map<string, DNode[]>();
  for (const node of nodes) {
    for (const symbol of machine.alphabet) {
      const target = machine.delta[node.id]?.[symbol];
      if (!byId.has(target) || target === node.id) continue;
      const entries = predecessors.get(target) ?? [];
      if (!entries.includes(node)) entries.push(node);
      predecessors.set(target, entries);
    }
  }
  const spread = (column: DNode[]) => {
    const rowGap = Math.max(
      minimumGap,
      Math.min(160, Math.max(1, h - padY * 2 - 32) / Math.max(1, column.length - 1)),
    );
    column.forEach((node, index) => {
      node.y = h / 2 + 16 + (index - (column.length - 1) / 2) * rowGap;
    });
  };
  columns.forEach(spread);
  const barycentre = (node: DNode) => {
    const parents = predecessors.get(node.id);
    return parents?.length
      ? parents.reduce((sum, parent) => sum + parent.y, 0) / parents.length
      : node.y;
  };
  for (let pass = 0; pass < 2; pass++) {
    for (const column of columns) {
      column.sort((a, b) => barycentre(a) - barycentre(b) || a.order - b.order);
      spread(column);
    }
  }

  const merged = new Map<
    string,
    { from: string; to: string; labels: string[]; symbols: string[] }
  >();
  for (const source of nodes) {
    for (const symbol of machine.alphabet) {
      const target = machine.delta[source.id]?.[symbol];
      if (!byId.has(target)) continue;
      const id = pairId(source.id, target);
      const edge = merged.get(id) ?? { from: source.id, to: target, labels: [], symbols: [] };
      edge.symbols.push(symbol);
      edge.labels.push(
        machine.outputs.kind === 'mealy'
          ? `${symbol}/${machine.outputs.lambda[source.id]?.[symbol] ?? ''}`
          : symbol,
      );
      merged.set(id, edge);
    }
  }

  const edges: DEdge[] = [];
  for (const [id, edge] of merged) {
    const a = byId.get(edge.from)!,
      b = byId.get(edge.to)!;
    const kind = a.id === b.id ? 'loop' : b.depth > a.depth ? 'forward' : 'back';
    const reciprocal = a.id !== b.id && merged.has(pairId(b.id, a.id));
    let p0: DPoint, p1: DPoint, p2: DPoint, p3: DPoint;
    if (kind === 'loop') {
      p0 = { x: a.x - r * 0.68, y: a.y - r * 0.7332 };
      p3 = { x: a.x + r * 0.68, y: a.y - r * 0.7332 };
      p1 = { x: a.x - r * 2.05, y: a.y - r * 3.18 };
      p2 = { x: a.x + r * 2.05, y: a.y - r * 3.18 };
    } else if (kind === 'back' || reciprocal) {
      const direction = a.x <= b.x ? 1 : -1;
      const lane = kind === 'forward' ? -1 : 1;
      const offset = Math.min(h * 0.38, 0.35 * Math.hypot(b.x - a.x, b.y - a.y) + 40);
      p0 = { x: a.x + direction * r * 0.78, y: a.y + lane * r * 0.6258 };
      p3 = { x: b.x - direction * r * 0.78, y: b.y + lane * r * 0.6258 };
      const handle = Math.max(35, Math.abs(p3.x - p0.x) * 0.36);
      p1 = { x: p0.x + direction * handle, y: p0.y + lane * offset };
      p2 = { x: p3.x - direction * handle, y: p3.y + lane * offset };
    } else {
      p0 = { x: a.x + r, y: a.y };
      p3 = { x: b.x - r, y: b.y };
      const handle = Math.max(20, Math.abs(p3.x - p0.x) * 0.45);
      p1 = { x: p0.x + handle, y: p0.y };
      p2 = { x: p3.x - handle, y: p3.y };
    }
    const samples = sampleCubic(p0, p1, p2, p3);
    const midpoint = pointAt(samples, 0.5);
    const bounds = { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity };
    for (let i = 0; i < EDGE_SAMPLES; i++) {
      const x = samples.pts[i * 2],
        y = samples.pts[i * 2 + 1];
      bounds.left = Math.min(bounds.left, x);
      bounds.right = Math.max(bounds.right, x);
      bounds.top = Math.min(bounds.top, y);
      bounds.bottom = Math.max(bounds.bottom, y);
    }
    edges.push({
      id,
      ...edge,
      kind,
      ...samples,
      order: edges.length,
      labelX: midpoint.x,
      labelY: midpoint.y + (kind === 'loop' ? -7 : 0),
      reachable: a.reachable,
      bounds,
    });
  }
  return { nodes, edges, width: w, height: h };
}
