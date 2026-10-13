import type { MachineDef, Step } from '../engine/types';
import type { Signals } from '../signals';
import { buildDiagram, pointAt, EDGE_SAMPLES, type DEdge, type DNode, type DPoint, type DiagramData } from './layout';

interface NodeView { data: DNode; element: HTMLButtonElement; start: number; formed: boolean }
interface EdgeView {
  data: DEdge; element: HTMLSpanElement; start: number; duration: number;
  progress: number; labelShown: boolean; previous?: Float32Array; morph?: Float32Array;
}
interface RemovedEdge { data: DEdge; elapsed: number }

const clamp = (n: number, a = 0, b = 1) => Math.max(a, Math.min(b, n));
const ease = (u: number) => u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2;
const easeCubic = (u: number) => u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;

/** Canvas ink and DOM nodes. The application's one ticker owns all frame time. */
export class Diagram {
  private readonly host: HTMLElement;
  private readonly surface: HTMLDivElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D | null;
  private readonly nodeLayer: HTMLDivElement;
  private readonly labelLayer: HTMLDivElement;
  private readonly startLabel: HTMLSpanElement;
  private readonly observer: ResizeObserver;
  private ink = '#161616';
  private readonly head: DPoint = { x: 0, y: 0 };
  private readonly tail: DPoint = { x: 0, y: 0 };
  private readonly nodes = new Map<string, NodeView>();
  private readonly edges = new Map<string, EdgeView>();
  private readonly transitionEdges = new Map<string, Map<string, EdgeView>>();
  private readonly removed: RemovedEdge[] = [];
  private readonly animations = new Set<Animation>();
  private data: DiagramData = { nodes: [], edges: [], width: 1000, height: 440 };
  private machine?: MachineDef;
  private width = 1000;
  private height = 440;
  private clock = 0;
  private total = 0;
  private morphClock = 1;
  private buildingNow = false;
  private dirty = true;
  private active = '';
  private activeEdge?: EdgeView;
  private travelU = -1;
  private travelStep?: Step;
  private travelProgress = 0;
  private arrived = false;
  private handedOff = false;
  private draws = 0;
  private largeGraph = false;
  private scroll = () => { this.dirty = true; };
  private reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  private quality: Signals['quality'] = 'high';
  private fontsReady = document.fonts.status === 'loaded';
  private disposed = false;
  private pointerX = 0;
  private pointerY = 0;

  constructor(host: HTMLElement) {
    this.host = host;
    host.classList.add('diagram');
    this.surface = document.createElement('div');
    this.surface.className = 'diagram-surface';
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'diagram-ink';
    this.canvas.setAttribute('aria-hidden', 'true');
    this.context = this.canvas.getContext('2d', { alpha: true });
    this.nodeLayer = document.createElement('div');
    this.nodeLayer.className = 'diagram-nodes';
    this.nodeLayer.setAttribute('role', 'group');
    this.nodeLayer.setAttribute('aria-label', 'Machine states, in discovery order');
    this.labelLayer = document.createElement('div');
    this.labelLayer.className = 'diagram-labels';
    this.labelLayer.setAttribute('aria-hidden', 'true');
    this.startLabel = document.createElement('span');
    this.startLabel.className = 'diagram-start-label';
    this.startLabel.textContent = 'start';
    this.startLabel.setAttribute('aria-hidden', 'true');
    this.surface.append(this.canvas, this.labelLayer, this.nodeLayer, this.startLabel);
    host.append(this.surface);
    host.addEventListener('scroll', this.scroll, { passive: true });
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(host);
    void document.fonts.ready.then(() => { if (!this.disposed) { this.fontsReady = true; this.dirty = true; } });
    this.resize();
  }

  refreshTheme(): void {
    this.ink = getComputedStyle(this.host).getPropertyValue('--copper').trim() || '#161616';
    this.dirty = true;
  }

  get building(): boolean { return this.buildingNow; }
  get drawCount(): number { return this.draws; }

  setMachine(machine: MachineDef): void {
    const incremental = !!this.machine;
    this.machine = machine;
    this.largeGraph = machine.states.length > 32;
    this.clearTravel();
    this.active = machine.start;
    this.host.dataset.kind = machine.outputs.kind;
    this.regenerate(incremental);
    this.host.scrollLeft = this.host.scrollTop = 0;
  }

  rest(state: string): void {
    this.clearTravel();
    this.active = state;
    for (const [id, view] of this.nodes) {
      const active = id === state;
      view.element.classList.toggle('is-active', active);
      view.element.classList.remove('is-arriving', 'is-reading', 'is-fault');
      if (active) view.element.setAttribute('aria-current', 'true');
      else view.element.removeAttribute('aria-current');
    }
    this.dirty = true;
  }

  travel(step: Step, progress: number): void {
    if (this.buildingNow) this.finishBuild();
    const view = this.transitionEdges.get(step.from)?.get(step.sym);
    if (!view) return;
    if (this.travelStep?.i !== step.i || this.travelStep?.from !== step.from || this.travelStep?.sym !== step.sym || progress < this.travelProgress) {
      this.rest(step.from);
      this.travelStep = step;
      this.activeEdge = view;
      view.element.classList.add('is-traversed');
      this.nodes.get(step.from)?.element.classList.add('is-reading');
      this.arrived = false;
    }
    this.travelProgress = progress;
    this.travelU = easeCubic(clamp((progress - 0.26 / 0.9) / (0.38 / 0.9)));
    if (!this.handedOff && !this.reducedMotion && this.quality !== 'low' && progress >= (this.machine?.outputs.kind === 'moore' ? 0.84 : 0.5)) {
      this.handedOff = true;
      const source = this.machine?.outputs.kind === 'moore'
        ? this.nodes.get(step.to)?.element.querySelector('.diagram-node-output')
        : view.element.children[view.data.symbols.indexOf(step.sym)]?.querySelector('.edge-output');
      if (source) {
        const rect = source.getBoundingClientRect();
        this.host.dispatchEvent(new CustomEvent('glyph-handoff', {
          bubbles: true, detail: { glyph: step.out, x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 },
        }));
      }
    }
    if (progress >= 0.64 / 0.9 && !this.arrived) {
      this.arrived = true;
      for (const [id, node] of this.nodes) node.element.classList.toggle('is-active', id === step.to);
      this.nodes.get(step.to)?.element.classList.add('is-arriving');
      this.active = step.to;
    }
    this.dirty = true;
  }

  replay(): void {
    if (!this.machine) return;
    for (const animation of this.animations) animation.cancel();
    this.animations.clear();
    this.clearTravel();
    this.active = this.machine.start;
    this.schedule(false);
    this.rest(this.active);
  }

  update(dt: number, signals: Readonly<Signals>): void {
    if (this.disposed) return;
    const elapsed = Math.min(Math.max(dt, 0), 0.05);
    if (this.quality !== signals.quality) { this.quality = signals.quality; this.resizeCanvas(); this.dirty = true; }
    if (this.reducedMotion !== signals.reducedMotion) {
      this.reducedMotion = signals.reducedMotion;
      this.host.classList.toggle('diagram-reduced', this.reducedMotion);
      if (this.reducedMotion) this.finishBuild();
      this.dirty = true;
    }
    const parallax = !signals.reducedMotion && !signals.focusMode && signals.quality === 'high' && this.host.dataset.overflow !== 'true';
    const px = parallax ? -signals.pointer.x * 4 : 0, py = parallax ? -signals.pointer.y * 4 : 0;
    if (Math.abs(px - this.pointerX) + Math.abs(py - this.pointerY) > 0.02) {
      this.pointerX = px; this.pointerY = py;
      this.surface.style.transform = `translate3d(${px.toFixed(2)}px,${py.toFixed(2)}px,0)`;
    }
    if (signals.phase === 'fault') this.nodes.get(this.active)?.element.classList.add('is-fault');
    if (this.buildingNow && this.fontsReady) {
      this.clock += elapsed;
      for (const view of this.nodes.values()) {
        if (!view.formed && this.clock >= view.start) this.formNode(view);
      }
      for (const view of this.edges.values()) {
        view.progress = ease(clamp((this.clock - view.start) / view.duration));
        if (!view.labelShown && view.progress >= 0.6) {
          view.labelShown = true;
          view.element.classList.add('is-visible');
        }
      }
      if (this.clock + 0.0000001 >= this.total) this.finishBuild();
      this.dirty = true;
    }
    if (this.morphClock < 0.4) {
      this.morphClock = Math.min(0.4, this.morphClock + elapsed);
      const amount = ease(this.morphClock / 0.4);
      for (const view of this.edges.values()) {
        if (!view.previous || !view.morph) continue;
        for (let i = 0; i < view.morph.length; i++) view.morph[i] = view.previous[i] + (view.data.pts[i] - view.previous[i]) * amount;
        if (this.morphClock === 0.4) { view.previous = undefined; view.morph = undefined; }
      }
      this.dirty = true;
    }
    for (let i = this.removed.length - 1; i >= 0; i--) {
      this.removed[i].elapsed += elapsed;
      if (this.removed[i].elapsed >= 0.18) this.removed.splice(i, 1);
      this.dirty = true;
    }
    if (this.dirty) this.draw();
  }

  resize(): void {
    const width = this.host.clientWidth;
    const height = this.host.clientHeight;
    // Hidden views have no layout. Keep the last visible geometry until the
    // Bench returns, rather than regenerating an off-screen 1px diagram.
    if (width <= 0 || height <= 0) return;
    if (width === this.width && height === this.height && this.canvas.width) return;
    this.width = width; this.height = height;
    if (this.machine) this.regenerate(true, true);
    else { this.data.width = width; this.data.height = height; this.resizeCanvas(); }
    this.dirty = true;
    this.draw();
  }

  dispose(): void {
    this.disposed = true;
    this.observer.disconnect();
    this.host.removeEventListener('scroll', this.scroll);
    for (const animation of this.animations) animation.cancel();
    this.animations.clear();
    this.nodes.clear(); this.edges.clear(); this.transitionEdges.clear(); this.removed.length = 0;
    this.surface.remove();
  }

  private regenerate(incremental: boolean, resizing = false): void {
    if (!this.machine) return;
    const morphing = incremental && !this.reducedMotion && !resizing && !this.largeGraph;
    if (resizing) this.removed.length = 0;
    const next = buildDiagram(this.machine, { w: this.width, h: this.height });
    const nextNodes = new Set(next.nodes.map(node => node.id));
    const nextEdges = new Set(next.edges.map(edge => edge.id));
    for (const [id, view] of this.nodes) {
      if (nextNodes.has(id)) continue;
      view.element.classList.remove('is-active', 'is-reading', 'is-arriving');
      view.element.removeAttribute('aria-current');
      view.element.setAttribute('aria-hidden', 'true');
      view.element.tabIndex = -1;
      view.element.disabled = true;
      if (this.reducedMotion || resizing) view.element.remove();
      else this.animate(view.element, [{ opacity: 1, scale: '1' }, { opacity: 0, scale: '0.8' }], 160, () => view.element.remove());
      this.nodes.delete(id);
    }
    for (const [id, view] of this.edges) {
      if (nextEdges.has(id)) continue;
      if (!this.reducedMotion && !resizing) this.removed.push({ data: view.data, elapsed: 0 });
      view.element.remove();
      this.edges.delete(id);
    }
    for (const node of next.nodes) {
      let view = this.nodes.get(node.id);
      if (view) {
        view.data = node;
        view.formed = true;
      } else {
        const element = document.createElement('button');
        element.type = 'button';
        element.className = 'diagram-node';
        element.addEventListener('click', () => {
          this.host.dispatchEvent(new CustomEvent('state-inspect', { bubbles: true, detail: { state: node.id } }));
        });
        view = { data: node, element, start: 0, formed: false };
        this.nodes.set(node.id, view);
      }
      const element = view.element;
      element.style.setProperty('--node-size', `${node.r * 2}px`);
      element.style.transform = `translate3d(${node.x - node.r}px,${node.y - node.r}px,0)`;
      element.classList.toggle('is-unreachable', !node.reachable);
      element.classList.toggle('is-moore', this.machine.outputs.kind === 'moore');
      element.classList.toggle('is-active', node.id === this.active);
      element.replaceChildren();
      const name = document.createElement('span');
      name.className = 'diagram-node-name'; name.textContent = node.id;
      element.append(name);
      if (node.out !== undefined) {
        const output = document.createElement('span');
        output.className = 'diagram-node-output'; output.textContent = node.out;
        element.append(output);
      }
      let description = `State ${node.id}${node.out !== undefined ? `, output ${node.out}` : ''}.`;
      for (const sym of this.machine.alphabet) description += ` On ${sym} goes to ${this.machine.delta[node.id]?.[sym] ?? 'no state'}.`;
      if (!node.reachable) description += ' Unreachable from the start state.';
      element.setAttribute('aria-label', description);
      element.title = description;
      this.nodeLayer.append(element);
    }
    this.transitionEdges.clear();
    for (const edge of next.edges) {
      let view = this.edges.get(edge.id);
      if (view) {
        if (morphing) { view.previous = view.morph ?? view.data.pts; view.morph = new Float32Array(edge.pts.length); view.morph.set(view.previous); }
        else { view.previous = undefined; view.morph = undefined; }
        view.data = edge;
      } else {
        const element = document.createElement('span'); element.className = 'diagram-edge-label';
        view = { data: edge, element, start: 0, duration: 0.35, progress: 0, labelShown: false };
        this.edges.set(edge.id, view);
      }
      view.element.style.transform = `translate3d(${edge.labelX}px,${edge.labelY}px,0) translate(-50%,-50%)`;
      view.element.classList.toggle('is-unreachable', !edge.reachable);
      view.element.replaceChildren();
      edge.symbols.forEach((sym, index) => {
        if (index < 3 || edge.symbols.length <= 4) {
          const row = document.createElement('span'); row.className = 'diagram-edge-symbol';
          const input = document.createElement('span'); input.className = 'edge-input'; input.textContent = sym; row.append(input);
          if (this.machine!.outputs.kind === 'mealy') {
            const slash = document.createElement('span'); slash.className = 'edge-slash'; slash.textContent = '/';
            const output = document.createElement('span'); output.className = 'edge-output'; output.textContent = edge.labels[index].slice(sym.length + 1);
            row.append(slash, output);
          }
          view!.element.append(row);
        }
        let transitions = this.transitionEdges.get(edge.from);
        if (!transitions) { transitions = new Map(); this.transitionEdges.set(edge.from, transitions); }
        transitions.set(sym, view!);
      });
      if (edge.symbols.length > 4) {
        const more = document.createElement('span'); more.className = 'diagram-edge-more';
        more.textContent = `+${edge.symbols.length - 3} symbols`; view.element.append(more);
      }
      view.element.title = edge.labels.join(', ');
      this.labelLayer.append(view.element);
    }
    this.data = next;
    this.surface.style.width = `${next.width}px`;
    this.surface.style.height = `${next.height}px`;
    this.host.dataset.overflow = String(next.width > this.width || next.height > this.height);
    this.resizeCanvas();
    this.morphClock = morphing ? 0 : 1;
    const startNode = this.nodes.get(this.machine.start)?.data;
    if (startNode) this.startLabel.style.transform = `translate3d(${Math.max(4, startNode.x - startNode.r - 60)}px,${startNode.y + 12}px,0)`;
    this.schedule(incremental);
    if (resizing || this.largeGraph) this.finishBuild();
  }

  private schedule(incremental: boolean): void {
    this.clock = 0;
    this.total = 0;
    const nodeTimes = new Map<string, number>();
    for (const [id, view] of this.nodes) {
      const ready = incremental && view.formed;
      nodeTimes.set(id, ready ? -1 : Infinity);
      if (!ready) {
        view.formed = false;
        view.element.classList.remove('is-formed');
        view.element.classList.add('is-forming');
      }
    }
    if (this.machine && nodeTimes.get(this.machine.start) !== -1) nodeTimes.set(this.machine.start, 0.12);
    for (const node of this.data.nodes) {
      let sourceStart = nodeTimes.get(node.id)!;
      if (!Number.isFinite(sourceStart)) { sourceStart = this.total + 0.1; nodeTimes.set(node.id, sourceStart); }
      let sibling = 0;
      for (const view of this.edges.values()) {
        if (view.data.from !== node.id) continue;
        const exists = incremental && view.progress === 1;
        view.start = exists ? -1 : Math.max(0, sourceStart) + 0.2 + sibling++ * 0.09;
        view.duration = clamp(0.16 + view.data.length / 1400, 0.22, 0.5);
        view.progress = exists ? 1 : 0;
        view.labelShown = exists;
        view.element.classList.toggle('is-visible', exists);
        const arrival = view.start + view.duration;
        if (!exists && view.data.to !== node.id) nodeTimes.set(view.data.to, Math.min(nodeTimes.get(view.data.to) ?? Infinity, arrival));
        this.total = Math.max(this.total, exists ? 0 : arrival + 0.4);
      }
    }
    this.total = Math.max(this.total + 0.25, 0.5);
    const scale = this.total > 3 ? 3 / this.total : 1;
    this.total *= scale;
    for (const [id, view] of this.nodes) {
      view.start = (nodeTimes.get(id) ?? 0) * scale;
      if (view.start < 0) { view.formed = true; view.element.classList.add('is-formed'); view.element.classList.remove('is-forming'); }
    }
    for (const view of this.edges.values()) { if (view.start >= 0) view.start *= scale; view.duration *= scale; }
    this.buildingNow = true;
    this.host.dataset.building = 'true';
    this.startLabel.classList.remove('is-visible');
    this.dirty = true;
    if (this.reducedMotion || this.largeGraph) this.finishBuild();
  }

  private formNode(view: NodeView): void {
    view.formed = true;
    view.element.classList.add('is-formed');
    if (!this.reducedMotion) this.animate(view.element, [{ opacity: 0, scale: '0.82' }, { opacity: view.data.reachable ? 1 : 0.4, scale: '1' }], 260);
  }

  finishBuild(): void {
    for (const animation of this.animations) animation.cancel();
    this.animations.clear();
    this.clock = this.total;
    this.buildingNow = false;
    this.host.dataset.building = 'false';
    for (const view of this.nodes.values()) {
      view.formed = true;
      view.element.classList.add('is-formed');
      view.element.classList.remove('is-forming');
    }
    for (const view of this.edges.values()) { view.progress = 1; view.labelShown = true; view.element.classList.add('is-visible'); }
    this.startLabel.classList.add('is-visible');
    this.dirty = true;
  }

  private clearTravel(): void {
    this.activeEdge?.element.classList.remove('is-traversed');
    this.activeEdge = undefined; this.travelStep = undefined; this.travelU = -1; this.travelProgress = 0; this.handedOff = false;
  }

  private resizeCanvas(): void {
    const cap = this.quality === 'high' ? 1.5 : 1;
    const dpr = Math.min(window.devicePixelRatio || 1, cap);
    this.canvas.width = Math.round(this.width * dpr);
    this.canvas.height = Math.round(this.height * dpr);
    this.canvas.style.width = `${this.width}px`; this.canvas.style.height = `${this.height}px`;
    this.context?.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  private draw(): void {
    this.dirty = false;
    const c = this.context;
    if (!c) return;
    this.draws++;
    c.clearRect(0, 0, this.width, this.height);
    c.save();
    c.translate(-this.host.scrollLeft, -this.host.scrollTop);
    c.lineCap = 'round'; c.lineJoin = 'round';
    for (const view of this.edges.values()) {
      if (view.progress <= 0) continue;
      if (!view.morph && !this.edgeVisible(view.data)) continue;
      const hot = this.buildingNow ? clamp(1 - (this.clock - view.start - view.duration) / 0.45) : 0;
      this.strokeEdge(view.data, view.progress, hot, view.morph);
    }
    for (const edge of this.removed) {
      c.globalAlpha = 1 - edge.elapsed / 0.18;
      this.strokeEdge(edge.data, 1 - edge.elapsed / 0.18, 0);
    }
    c.globalAlpha = 1;
    const start = this.machine ? this.nodes.get(this.machine.start) : undefined;
    if (start) {
      const u = this.buildingNow ? ease(clamp((this.clock - 0.22) / 0.2)) : 1;
      if (u > 0) {
        const right = start.data.x - start.data.r - 5;
        const left = Math.max(4, right - 47), length = right - left;
        c.beginPath(); c.moveTo(left, start.data.y); c.lineTo(left + length * u, start.data.y);
        c.strokeStyle = this.ink; c.lineWidth = 1.7; c.stroke();
        this.arrow(left + length * u, start.data.y, 0, 1, this.ink);
        this.startLabel.classList.add('is-visible');
      }
    }
    if (this.buildingNow) {
      for (const view of this.nodes.values()) {
        const u = clamp((this.clock - view.start) / 0.32);
        if (!u) continue;
        if (u === 1) { view.element.classList.remove('is-forming'); continue; }
        c.beginPath(); c.arc(view.data.x, view.data.y, view.data.r - 0.85, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (1 - (1 - u) * (1 - u)));
        c.globalAlpha = view.data.reachable ? 1 : 0.4;
        c.strokeStyle = this.ink; c.lineWidth = 1.7; c.stroke();
      }
    }
    c.globalAlpha = 1;
    if (this.activeEdge && this.travelU >= 0 && this.edgeVisible(this.activeEdge.data)) this.drawTravel(this.activeEdge.data);
    c.restore();
  }

  private edgeVisible(edge: DEdge): boolean {
    const x = this.host.scrollLeft, y = this.host.scrollTop, b = edge.bounds;
    return b.right >= x - 20 && b.left <= x + this.width + 20 && b.bottom >= y - 20 && b.top <= y + this.height + 20;
  }

  private strokeEdge(edge: DEdge, u: number, hot: number, morph?: Float32Array): void {
    const c = this.context!;
    const points = morph ?? edge.pts;
    const inheritedAlpha = c.globalAlpha;
    c.globalAlpha = inheritedAlpha * (edge.reachable ? 1 : 0.4);
    const limit = clamp(u) * edge.length;
    let lastIndex = 1;
    while (lastIndex < EDGE_SAMPLES - 1 && edge.len[lastIndex] < limit) lastIndex++;
    const a = lastIndex - 1, segment = edge.len[lastIndex] - edge.len[a];
    const amount = segment ? clamp((limit - edge.len[a]) / segment) : 0;
    const x = points[a * 2] + (points[lastIndex * 2] - points[a * 2]) * amount;
    const y = points[a * 2 + 1] + (points[lastIndex * 2 + 1] - points[a * 2 + 1]) * amount;
    c.beginPath(); c.moveTo(points[0], points[1]);
    for (let i = 1; i < lastIndex; i++) c.lineTo(points[i * 2], points[i * 2 + 1]);
    c.lineTo(x, y);
    c.strokeStyle = this.ink; c.lineWidth = hot > 0 ? 1.9 : 1.65; c.stroke();
    const angle = Math.atan2(y - points[a * 2 + 1], x - points[a * 2]);
    this.arrow(x, y, angle, u < 1 ? 0.66 : 1, this.ink);
    c.globalAlpha = inheritedAlpha;
  }

  private drawTravel(edge: DEdge): void {
    const c = this.context!;
    c.beginPath(); c.moveTo(edge.pts[0], edge.pts[1]);
    for (let i = 1; i < EDGE_SAMPLES; i++) c.lineTo(edge.pts[i * 2], edge.pts[i * 2 + 1]);
    c.strokeStyle = this.ink; c.lineWidth = 1.8; c.stroke();
    if (this.reducedMotion || this.quality === 'low' || this.travelProgress < 0.26 / 0.9 || this.travelProgress > 0.76 / 0.9) return;
    pointAt(edge, this.travelU, this.head);
    pointAt(edge, Math.max(0, this.travelU - 0.09), this.tail);
    c.beginPath(); c.moveTo(this.tail.x, this.tail.y); c.lineTo(this.head.x, this.head.y);
    c.strokeStyle = this.ink; c.lineWidth = 2.5; c.stroke();
    c.beginPath(); c.arc(this.head.x, this.head.y, 2.7, 0, Math.PI * 2); c.fillStyle = this.ink; c.fill();
  }

  private arrow(x: number, y: number, angle: number, scale: number, color: string): void {
    const c = this.context!;
    const size = 8 * scale;
    const cos = Math.cos(angle), sin = Math.sin(angle);
    c.beginPath(); c.moveTo(x, y);
    c.lineTo(x - size * cos + size * 0.45 * sin, y - size * sin - size * 0.45 * cos);
    c.lineTo(x - size * cos - size * 0.45 * sin, y - size * sin + size * 0.45 * cos);
    c.closePath(); c.fillStyle = color; c.fill();
  }

  private animate(element: HTMLElement, frames: Keyframe[], duration: number, done?: () => void): void {
    const animation = element.animate(frames, { duration, easing: 'cubic-bezier(.22,.85,.27,1)', fill: 'none' });
    this.animations.add(animation);
    void animation.finished.then(() => { this.animations.delete(animation); done?.(); }, () => { this.animations.delete(animation); done?.(); });
  }

}
