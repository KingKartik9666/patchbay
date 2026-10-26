import type { MachineDef, Step } from '../domain/contracts';
import {
  EDGE_SAMPLES,
  pointAt,
  type DEdge,
  type DiagramData,
  type DPoint,
} from '../diagram/layout';
import type { Signals } from '../signals';

export type NodeStage = 'waiting' | 'forming' | 'formed';
export interface DiagramPresentation {
  building: boolean;
  nodeStages: ReadonlyMap<string, NodeStage>;
  visibleEdges: ReadonlySet<string>;
  startVisible: boolean;
  reducedMotion: boolean;
  reading?: string;
  arriving?: string;
  traversed?: string;
  fault?: string;
}
export interface Travel {
  step?: Step;
  progress: number;
}
interface EdgeInk {
  edge: DEdge;
  start: number;
  duration: number;
  progress: number;
  previous?: Float32Array;
  morph?: Float32Array;
}
interface GlyphFlight {
  glyph: string;
  from: DPoint;
  to: DPoint;
  elapsed: number;
}

const clamp = (value: number, low = 0, high = 1) => Math.max(low, Math.min(high, value));
const ease = (u: number) => (u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2);
const easeCubic = (u: number) => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2);

/** Canvas resources and sampled geometry only. React owns every state/label. */
export class DiagramInk {
  private readonly context: CanvasRenderingContext2D | null;
  private readonly glyphContext: CanvasRenderingContext2D | null;
  private machine?: MachineDef;
  private data?: DiagramData;
  private replayKey = -1;
  private width = 1;
  private height = 1;
  private dpr = 1;
  private quality: Signals['quality'];
  private reducedMotion: boolean;
  private fontsReady = document.fonts?.status === 'loaded' || !document.fonts;
  private disposed = false;
  private dirty = true;
  private ink = '#161616';
  private time = 0;
  private total = 0;
  private morphTime = 0.4;
  private building = false;
  private startVisible = false;
  private nodes = new Map<string, { start: number; stage: NodeStage }>();
  private edges = new Map<string, EdgeInk>();
  private transitions = new Map<string, Map<string, EdgeInk>>();
  private visibleEdges = new Set<string>();
  private removed: { edge: DEdge; elapsed: number }[] = [];
  private travelStep?: Step;
  private travelEdge?: EdgeInk;
  private travelProgress = 0;
  private handedOff = false;
  private reading?: string;
  private arriving?: string;
  private fault?: string;
  private flight?: GlyphFlight;
  private glyphDirty = false;
  private head: DPoint = { x: 0, y: 0 };
  private tail: DPoint = { x: 0, y: 0 };
  private drawCount = 0;
  private scroll = () => {
    this.dirty = true;
  };

  constructor(
    private readonly host: HTMLElement,
    private readonly canvas: HTMLCanvasElement,
    private readonly glyphCanvas: HTMLCanvasElement,
    private readonly onPresentation: (value: DiagramPresentation) => void,
    signals: Readonly<Signals>,
    private readonly glyphSource: (step: Step, edge: DEdge) => Element | null,
  ) {
    this.context = canvas.getContext('2d', { alpha: true });
    this.glyphContext = glyphCanvas.getContext('2d', { alpha: true });
    this.quality = signals.quality;
    this.reducedMotion = signals.reducedMotion;
    host.addEventListener('scroll', this.scroll, { passive: true });
    void document.fonts?.ready.then(() => {
      if (!this.disposed) {
        this.fontsReady = true;
        this.dirty = true;
      }
    });
  }

  configure(
    machine: MachineDef,
    data: DiagramData,
    width: number,
    height: number,
    replayKey: number,
  ): void {
    if (this.disposed) return;
    const first = !this.machine;
    const changedMachine = this.machine !== machine;
    const replay = this.replayKey !== replayKey;
    const resizing = !first && !changedMachine && !replay;
    const morphing = !first && changedMachine && !this.reducedMotion && data.nodes.length <= 32;
    const oldEdges = this.edges;
    const oldNodes = this.nodes;
    this.machine = machine;
    this.data = data;
    this.replayKey = replayKey;
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.clearTravel();
    this.nodes = new Map(
      data.nodes.map((node) => [
        node.id,
        { start: 0, stage: oldNodes.get(node.id)?.stage ?? 'waiting' },
      ]),
    );
    this.edges = new Map(
      data.edges.map((edge) => {
        const previous = oldEdges.get(edge.id);
        return [
          edge.id,
          {
            edge,
            start: 0,
            duration: 0.35,
            progress: previous?.progress ?? 0,
            ...(morphing && previous
              ? { previous: previous.morph ?? previous.edge.pts, morph: new Float32Array(edge.pts) }
              : {}),
          },
        ];
      }),
    );
    this.removed = morphing
      ? [...oldEdges.values()]
          .filter((view) => !this.edges.has(view.edge.id))
          .map((view) => ({ edge: view.edge, elapsed: 0 }))
      : [];
    this.transitions.clear();
    for (const view of this.edges.values()) {
      let row = this.transitions.get(view.edge.from);
      if (!row) {
        row = new Map();
        this.transitions.set(view.edge.from, row);
      }
      for (const symbol of view.edge.symbols) row.set(symbol, view);
    }
    this.morphTime = morphing ? 0 : 0.4;
    this.resizeCanvas();
    if (resizing || this.reducedMotion || data.nodes.length > 32) {
      this.time = this.total = 0;
      this.visibleEdges.clear();
      this.finishBuild(false);
    } else this.schedule(!first && changedMachine && !replay);
    if (changedMachine || replay) this.host.scrollLeft = this.host.scrollTop = 0;
    this.refreshTheme();
    this.publish();
    this.draw();
  }

  refreshTheme(): void {
    if (this.disposed) return;
    this.ink = getComputedStyle(this.host).getPropertyValue('--copper').trim() || '#161616';
    this.dirty = true;
    this.glyphDirty = !!this.flight;
  }

  update(dt: number, signals: Readonly<Signals>, travel: Travel, activeState: string): void {
    if (this.disposed || !this.data) return;
    dt = clamp(Number.isFinite(dt) ? dt : 0, 0, 0.05);
    let changed = false;
    if (this.quality !== signals.quality) {
      this.quality = signals.quality;
      this.resizeCanvas();
      this.dirty = true;
    }
    if (this.reducedMotion !== signals.reducedMotion) {
      this.reducedMotion = signals.reducedMotion;
      changed = true;
      if (this.reducedMotion) {
        this.finishBuild(false);
        this.clearFlight();
        this.finishMorph();
      }
      this.dirty = true;
    }
    const nextFault = signals.phase === 'fault' ? activeState : undefined;
    if (nextFault !== this.fault) {
      this.fault = nextFault;
      changed = true;
    }
    if (travel.step) changed = this.setTravel(travel.step, travel.progress, signals) || changed;
    else if (this.travelStep) {
      this.clearTravel();
      changed = true;
    }
    if (this.building && this.fontsReady) {
      this.time += dt;
      for (const node of this.nodes.values()) {
        const stage =
          this.time < node.start ? 'waiting' : this.time < node.start + 0.32 ? 'forming' : 'formed';
        if (stage !== node.stage) {
          node.stage = stage;
          changed = true;
        }
      }
      for (const view of this.edges.values()) {
        view.progress = view.start < 0 ? 1 : ease(clamp((this.time - view.start) / view.duration));
        if (view.progress >= 0.6 && !this.visibleEdges.has(view.edge.id)) {
          this.visibleEdges.add(view.edge.id);
          changed = true;
        }
      }
      if (!this.startVisible && this.time >= 0.22) {
        this.startVisible = true;
        changed = true;
      }
      if (this.time + 1e-7 >= this.total) {
        this.finishBuild(false);
        changed = true;
      }
      this.dirty = true;
    }
    if (this.morphTime < 0.4) {
      this.morphTime = Math.min(0.4, this.morphTime + dt);
      const amount = ease(this.morphTime / 0.4);
      for (const view of this.edges.values())
        if (view.previous && view.morph) {
          for (let i = 0; i < view.morph.length; i++)
            view.morph[i] = view.previous[i] + (view.edge.pts[i] - view.previous[i]) * amount;
        }
      if (this.morphTime >= 0.4) this.finishMorph();
      this.dirty = true;
    }
    for (let i = this.removed.length - 1; i >= 0; i--) {
      this.removed[i].elapsed += dt;
      if (this.removed[i].elapsed >= 0.18) this.removed.splice(i, 1);
      this.dirty = true;
    }
    if (signals.reducedMotion || signals.focusMode || signals.quality === 'low') this.clearFlight();
    if (this.flight) {
      this.flight.elapsed += dt;
      if (this.flight.elapsed >= 0.3) this.clearFlight();
      this.glyphDirty = true;
    }
    if (changed) this.publish();
    if (this.dirty) this.draw();
    if (this.glyphDirty) this.drawGlyph();
  }

  invalidate(): void {
    this.dirty = true;
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.host.removeEventListener('scroll', this.scroll);
    this.nodes.clear();
    this.edges.clear();
    this.transitions.clear();
    this.removed.length = 0;
    this.clearTravel();
    this.canvas.width = this.canvas.height = this.glyphCanvas.width = this.glyphCanvas.height = 1;
  }

  private schedule(incremental: boolean): void {
    this.time = 0;
    this.total = 0;
    this.building = true;
    this.startVisible = false;
    this.visibleEdges.clear();
    const nodeTimes = new Map<string, number>();
    for (const [id, node] of this.nodes) {
      const ready = incremental && node.stage !== 'waiting';
      nodeTimes.set(id, ready ? -1 : Infinity);
      node.stage = ready ? 'formed' : 'waiting';
    }
    if (this.machine && nodeTimes.get(this.machine.start) !== -1)
      nodeTimes.set(this.machine.start, 0.12);
    for (const node of this.data!.nodes) {
      let sourceStart = nodeTimes.get(node.id)!;
      if (!Number.isFinite(sourceStart)) {
        sourceStart = this.total + 0.1;
        nodeTimes.set(node.id, sourceStart);
      }
      let sibling = 0;
      for (const view of new Set(this.transitions.get(node.id)?.values() ?? [])) {
        const exists = incremental && view.progress === 1;
        view.start = exists ? -1 : Math.max(0, sourceStart) + 0.2 + sibling++ * 0.09;
        view.duration = clamp(0.16 + view.edge.length / 1400, 0.22, 0.5);
        view.progress = exists ? 1 : 0;
        if (exists) this.visibleEdges.add(view.edge.id);
        const arrival = view.start + view.duration;
        if (!exists && view.edge.to !== node.id)
          nodeTimes.set(view.edge.to, Math.min(nodeTimes.get(view.edge.to) ?? Infinity, arrival));
        this.total = Math.max(this.total, exists ? 0 : arrival + 0.4);
      }
      this.total = Math.max(this.total, Math.max(0, sourceStart) + 0.32);
    }
    this.total = Math.max(this.total + 0.25, 0.5);
    const scale = this.total > 3 ? 3 / this.total : 1;
    this.total *= scale;
    for (const [id, node] of this.nodes) node.start = (nodeTimes.get(id) ?? 0) * scale;
    for (const view of this.edges.values()) {
      if (view.start >= 0) view.start *= scale;
      view.duration *= scale;
    }
    this.dirty = true;
  }

  private finishBuild(publish = true): void {
    this.time = this.total;
    this.building = false;
    this.startVisible = true;
    for (const node of this.nodes.values()) node.stage = 'formed';
    for (const view of this.edges.values()) {
      view.progress = 1;
      this.visibleEdges.add(view.edge.id);
    }
    this.dirty = true;
    if (publish) this.publish();
  }
  private finishMorph(): void {
    this.morphTime = 0.4;
    this.removed.length = 0;
    for (const view of this.edges.values()) {
      view.previous = undefined;
      view.morph = undefined;
    }
  }
  private publish(): void {
    this.onPresentation({
      building: this.building,
      nodeStages: new Map([...this.nodes].map(([id, value]) => [id, value.stage])),
      visibleEdges: new Set(this.visibleEdges),
      startVisible: this.startVisible,
      reducedMotion: this.reducedMotion,
      reading: this.reading,
      arriving: this.arriving,
      traversed: this.travelEdge?.edge.id,
      fault: this.fault,
    });
  }
  private clearFlight(): void {
    if (this.flight) {
      this.flight = undefined;
      this.glyphDirty = true;
    }
  }
  private clearTravel(): void {
    this.travelStep = undefined;
    this.travelEdge = undefined;
    this.reading = this.arriving = undefined;
    this.travelProgress = 0;
    this.handedOff = false;
    this.clearFlight();
    this.dirty = true;
  }
  private setTravel(step: Step, progress: number, signals: Readonly<Signals>): boolean {
    const view = this.transitions.get(step.from)?.get(step.sym);
    if (!view) return false;
    let changed = false;
    if (this.building) {
      this.finishBuild(false);
      changed = true;
    }
    if (
      !this.travelStep ||
      this.travelStep.i !== step.i ||
      this.travelStep.from !== step.from ||
      this.travelStep.sym !== step.sym ||
      progress < this.travelProgress
    ) {
      this.clearTravel();
      this.travelStep = step;
      this.travelEdge = view;
      changed = true;
    }
    const nextProgress = clamp(Number.isFinite(progress) ? progress : 0);
    if (nextProgress !== this.travelProgress) this.dirty = true;
    this.travelProgress = nextProgress;
    const reading = nextProgress < 0.64 / 0.9 ? step.from : undefined;
    const arriving = nextProgress >= 0.64 / 0.9 ? step.to : undefined;
    if (this.reading !== reading || this.arriving !== arriving) {
      this.reading = reading;
      this.arriving = arriving;
      changed = true;
    }
    const handoff = this.machine?.outputs.kind === 'moore' ? 0.84 : 0.5;
    if (!this.handedOff && nextProgress >= handoff) {
      this.handedOff = true;
      if (
        !signals.reducedMotion &&
        !signals.focusMode &&
        signals.quality !== 'low' &&
        nextProgress < 0.98
      )
        this.startFlight(step, view.edge);
    }
    return changed;
  }
  private startFlight(step: Step, edge: DEdge): void {
    if (!this.glyphContext || !step.out) return;
    const source = this.glyphSource(step, edge),
      target = document.querySelector('.output-tape .current');
    if (!source || !target) return;
    const from = source.getBoundingClientRect(),
      to = target.getBoundingClientRect();
    if (!from.width || !to.width) return;
    const ratio = Math.min(
      window.devicePixelRatio || 1,
      1.5,
      Math.sqrt(1_600_000 / (window.innerWidth * window.innerHeight)),
    );
    this.glyphCanvas.width = Math.max(1, Math.floor(window.innerWidth * ratio));
    this.glyphCanvas.height = Math.max(1, Math.floor(window.innerHeight * ratio));
    this.glyphContext.setTransform(ratio, 0, 0, ratio, 0, 0);
    this.flight = {
      glyph: step.out,
      from: { x: from.x + from.width / 2, y: from.y + from.height / 2 },
      to: { x: to.x + to.width / 2, y: to.y + to.height / 2 },
      elapsed: 0,
    };
    this.glyphDirty = true;
  }
  private resizeCanvas(): void {
    this.dpr = Math.min(window.devicePixelRatio || 1, this.quality === 'high' ? 1.5 : 1);
    this.canvas.width = Math.round(this.width * this.dpr);
    this.canvas.height = Math.round(this.height * this.dpr);
    this.context?.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }
  private edgeVisible(edge: DEdge): boolean {
    const { scrollLeft: x, scrollTop: y } = this.host,
      b = edge.bounds;
    return (
      b.right >= x - 20 &&
      b.left <= x + this.width + 20 &&
      b.bottom >= y - 20 &&
      b.top <= y + this.height + 20
    );
  }
  private draw(): void {
    this.dirty = false;
    const c = this.context,
      data = this.data;
    if (!c || !data) return;
    c.clearRect(0, 0, this.width, this.height);
    c.save();
    c.translate(-this.host.scrollLeft, -this.host.scrollTop);
    c.lineCap = 'round';
    c.lineJoin = 'round';
    for (const view of this.edges.values()) {
      if (view.progress <= 0 || (!view.morph && !this.edgeVisible(view.edge))) continue;
      this.strokeEdge(view.edge, view.progress, view.morph);
    }
    for (const removed of this.removed) {
      if (!this.edgeVisible(removed.edge)) continue;
      c.globalAlpha = 1 - removed.elapsed / 0.18;
      this.strokeEdge(removed.edge, 1 - removed.elapsed / 0.18);
    }
    c.globalAlpha = 1;
    const start = data.nodes.find((node) => node.id === this.machine?.start);
    if (start) {
      const u = this.building ? ease(clamp((this.time - 0.22) / 0.2)) : 1;
      if (u > 0) {
        const right = start.x - start.r - 5,
          left = Math.max(4, right - 47),
          x = left + (right - left) * u;
        c.beginPath();
        c.moveTo(left, start.y);
        c.lineTo(x, start.y);
        c.strokeStyle = this.ink;
        c.lineWidth = 1.7;
        c.stroke();
        this.arrow(x, start.y, 0, 1);
      }
    }
    if (this.building)
      for (const node of data.nodes) {
        const timing = this.nodes.get(node.id)!;
        const u = clamp((this.time - timing.start) / 0.32);
        if (!u || u === 1) continue;
        c.beginPath();
        c.arc(
          node.x,
          node.y,
          node.r + 0.2,
          -Math.PI / 2,
          -Math.PI / 2 + Math.PI * 2 * (1 - (1 - u) ** 2),
        );
        c.globalAlpha = node.reachable ? 1 : 0.4;
        c.strokeStyle = this.ink;
        c.lineWidth = 1.7;
        c.stroke();
      }
    c.globalAlpha = 1;
    if (this.travelEdge && this.edgeVisible(this.travelEdge.edge))
      this.drawTravel(this.travelEdge.edge);
    c.restore();
    this.canvas.dataset.draws = String(++this.drawCount);
  }
  private strokeEdge(edge: DEdge, u: number, points = edge.pts): void {
    const c = this.context!;
    const inheritedAlpha = c.globalAlpha;
    c.globalAlpha *= edge.reachable ? 1 : 0.4;
    const limit = clamp(u) * edge.length;
    let index = 1;
    while (index < EDGE_SAMPLES - 1 && edge.len[index] < limit) index++;
    const before = index - 1,
      segment = edge.len[index] - edge.len[before];
    const amount = segment ? clamp((limit - edge.len[before]) / segment) : 0;
    const x = points[before * 2] + (points[index * 2] - points[before * 2]) * amount;
    const y = points[before * 2 + 1] + (points[index * 2 + 1] - points[before * 2 + 1]) * amount;
    c.beginPath();
    c.moveTo(points[0], points[1]);
    for (let i = 1; i < index; i++) c.lineTo(points[i * 2], points[i * 2 + 1]);
    c.lineTo(x, y);
    c.strokeStyle = this.ink;
    c.lineWidth = 1.65;
    c.stroke();
    this.arrow(
      x,
      y,
      Math.atan2(y - points[before * 2 + 1], x - points[before * 2]),
      u < 1 ? 0.66 : 1,
    );
    c.globalAlpha = inheritedAlpha;
  }
  private drawTravel(edge: DEdge): void {
    const c = this.context!;
    if (
      this.reducedMotion ||
      this.quality === 'low' ||
      this.travelProgress < 0.26 / 0.9 ||
      this.travelProgress > 0.76 / 0.9
    )
      return;
    const u = easeCubic(clamp((this.travelProgress - 0.26 / 0.9) / (0.38 / 0.9)));
    pointAt(edge, u, this.head);
    pointAt(edge, Math.max(0, u - 0.09), this.tail);
    c.beginPath();
    c.moveTo(this.tail.x, this.tail.y);
    c.lineTo(this.head.x, this.head.y);
    c.strokeStyle = this.ink;
    c.lineWidth = 2.5;
    c.stroke();
    c.beginPath();
    c.arc(this.head.x, this.head.y, 2.7, 0, Math.PI * 2);
    c.fillStyle = this.ink;
    c.fill();
  }
  private arrow(x: number, y: number, angle: number, scale: number): void {
    const c = this.context!,
      size = 8 * scale,
      cos = Math.cos(angle),
      sin = Math.sin(angle);
    c.beginPath();
    c.moveTo(x, y);
    c.lineTo(x - size * cos + size * 0.45 * sin, y - size * sin - size * 0.45 * cos);
    c.lineTo(x - size * cos - size * 0.45 * sin, y - size * sin + size * 0.45 * cos);
    c.closePath();
    c.fillStyle = this.ink;
    c.fill();
  }
  private drawGlyph(): void {
    this.glyphDirty = false;
    const c = this.glyphContext;
    if (!c) return;
    c.clearRect(0, 0, window.innerWidth, window.innerHeight);
    if (!this.flight) return;
    const { from, to, glyph, elapsed } = this.flight,
      u = easeCubic(clamp(elapsed / 0.3));
    c.save();
    c.translate(from.x + (to.x - from.x) * u, from.y + (to.y - from.y) * u);
    c.scale(0.8 + 0.2 * u, 0.8 + 0.2 * u);
    c.globalAlpha = 1 - u;
    c.fillStyle = this.ink;
    c.font = '850 25px "Nunito Variable", sans-serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(glyph, 0, 0);
    c.restore();
  }
}
