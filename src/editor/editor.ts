import type { MachineDef } from '../engine/types';
import { isSymbol as oneSymbol } from '../engine/symbols';
import type { Signals } from '../signals';
import {
  addState, cloneDraft, createDraft, draftFromMachine, draftToSource,
  fillMissing, parseDraft, removeState, removeTransition, renameState,
  serializeDraft, setAlphabet, upsertTransition, validateDraft,
  type GraphDraft, type GraphKind, type GraphTransition,
} from './model';
import { graphCurves, STATE_RADIUS, type Curve, type Point } from './geometry';
import './editor.css';

interface EditorOptions {
  onApply: (source: string) => void;
  onText: () => void;
  onMessage: (message: string) => void;
}
interface TransitionEditor { id?: string; from: string; to: string; input: string; output: string }
interface Gesture {
  pointerId: number;
  stateId: string;
  mode: 'move' | 'connect';
  client: Point;
  world: Point;
  initial: Point;
  before: GraphDraft;
  moved: boolean;
}

const RECOVERY_KEY = 'patchbay:graph:v1';
const HISTORY_LIMIT = 50;
const FILE_LIMIT_BYTES = 1024 * 1024;
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const errorMessage = (error: unknown) => error instanceof Error ? error.message : String(error);

/** Editable draft, accessible DOM targets and viewport ink driven by the app ticker. */
export class GraphicalEditor {
  private readonly host: HTMLElement;
  private readonly options: EditorOptions;
  private readonly stage: HTMLDivElement;
  private readonly scroll: HTMLDivElement;
  private readonly surface: HTMLDivElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D | null;
  private readonly nodeLayer: HTMLDivElement;
  private readonly labelLayer: HTMLDivElement;
  private readonly observer: ResizeObserver;
  private readonly listeners = new AbortController();
  private readonly nodes = new Map<string, HTMLButtonElement>();
  private readonly labels = new Map<string, HTMLButtonElement>();
  private readonly undoStack: GraphDraft[] = [];
  private readonly redoStack: GraphDraft[] = [];
  private draft: GraphDraft = createDraft();
  private curves: Curve[] = [];
  private selectedState = '';
  private transitionEditor: TransitionEditor | null = null;
  private connectFrom = '';
  private connectHover = '';
  private pointer: Point | null = null;
  private gesture: Gesture | null = null;
  private tool: 'select' | 'connect' = 'select';
  private zoom = 1;
  private origin: Point = { x: -130, y: -130 };
  private width = 1;
  private height = 1;
  private worldBounds = { left: -130, top: -130, right: 650, bottom: 450 };
  private dpr = 1;
  private quality: Signals['quality'] = 'high';
  private dirty = true;
  private geometryDirty = true;
  private recovered = false;
  private initialized = false;
  private storageAvailable = true;
  private disposed = false;
  private suppressClickUntil = 0;
  private pendingFit = false;
  private errors: string[] = [];

  constructor(host: HTMLElement, options: EditorOptions) {
    this.host = host;
    this.options = options;
    host.classList.add('graph-editor');
    host.innerHTML = `
      <div class="graph-toolbar" aria-label="Graph editing tools">
        <div class="graph-tool-group">
          <button id="graph-new" type="button" class="graph-button">New machine</button>
          <label class="graph-kind-label" for="graph-kind">Type
            <select id="graph-kind"><option value="mealy">Mealy</option><option value="moore">Moore</option></select>
          </label>
        </div>
        <div class="graph-tool-group graph-draw-tools" role="group" aria-label="Drawing mode">
          <button id="graph-select" type="button" class="graph-button" aria-pressed="true">Select / move</button>
          <button id="graph-connect" type="button" class="graph-button" aria-pressed="false">Connect</button>
          <button id="graph-add-state" type="button" class="graph-button">+ State</button>
          <button id="graph-add-transition" type="button" class="graph-button">+ Transition</button>
        </div>
        <div class="graph-tool-group graph-history" role="group" aria-label="Edit history">
          <button id="graph-undo" type="button" class="graph-button" aria-label="Undo graph edit" title="Undo (Ctrl+Z)" disabled>Undo</button>
          <button id="graph-redo" type="button" class="graph-button" aria-label="Redo graph edit" title="Redo (Ctrl+Shift+Z)" disabled>Redo</button>
        </div>
        <div class="graph-tool-group graph-file-tools">
          <button id="graph-open" type="button" class="graph-button">Open</button>
          <button id="graph-save" type="button" class="graph-button">Save draft</button>
          <button id="graph-text" type="button" class="graph-button">Text definition</button>
          <button id="graph-run" type="button" class="primary-button">Run machine <span aria-hidden="true">↗</span></button>
        </div>
      </div>
      <div class="graph-workspace">
        <div class="graph-canvas-panel">
          <div class="graph-canvas-heading"><span id="graph-tool-hint">Double-click empty space to add a state. Drag a state to move it.</span>
            <div class="graph-view-tools" role="group" aria-label="Graph view">
              <button id="graph-zoom-out" type="button" aria-label="Zoom out" title="Zoom out">−</button>
              <output id="graph-zoom" aria-label="Zoom level">100%</output>
              <button id="graph-zoom-in" type="button" aria-label="Zoom in" title="Zoom in">+</button>
              <button id="graph-fit" type="button" title="Fit graph in view">Fit</button>
            </div>
          </div>
          <div id="graph-stage" class="graph-stage" aria-label="Graphical machine canvas">
            <canvas id="graph-ink" class="graph-ink" aria-hidden="true"></canvas>
            <div id="graph-scroll" class="graph-scroll" tabindex="0" aria-label="Graph viewport; use arrow keys or scroll to explore">
              <div class="graph-surface">
                <div class="graph-labels" role="group" aria-label="Transition labels; activate to edit"></div>
                <div class="graph-nodes" role="group" aria-label="Machine states; activate to inspect"></div>
              </div>
            </div>
            <div id="graph-empty" class="graph-empty"><span class="graph-empty-mark" aria-hidden="true">○ → ○</span><strong>Draw your machine</strong><span>Add a state, then connect states with labelled arrows.</span><button id="graph-empty-add" type="button" class="graph-button">Add first state</button></div>
          </div>
          <div class="graph-canvas-footer"><span id="graph-counts"></span><span id="graph-status" role="status" aria-live="polite"></span></div>
        </div>
        <aside class="graph-inspector" aria-label="Graph inspector">
          <section id="graph-inspector-empty" class="graph-inspector-section graph-help"><span class="graph-eyebrow">Inspector</span><h2>Make a connection</h2><p>Select a state to rename it, choose the start state or change its output.</p><p>With Connect, click a source and then a target, or drag between them. Choose the same state twice for a self-loop.</p><p>Click an arrow label to edit its input and output.</p></section>
          <section id="graph-state-panel" class="graph-inspector-section" hidden>
            <span class="graph-eyebrow">State</span><h2 id="graph-state-title">State</h2>
            <form id="graph-state-form" class="graph-form">
              <label for="graph-state-name">Name<input id="graph-state-name" name="stateName" autocomplete="off" required></label>
              <label id="graph-state-output-row" for="graph-state-output" hidden>Moore output<input id="graph-state-output" name="stateOutput" autocomplete="off" aria-describedby="graph-symbol-help"></label>
              <button id="graph-save-state" type="submit" class="graph-button">Save state</button>
            </form>
            <div class="graph-inspector-actions"><button id="graph-set-start" type="button" class="graph-button">Set as start</button><button id="graph-delete-state" type="button" class="graph-button graph-danger">Delete state</button></div>
            <p class="graph-small-note">Deleting a state also removes its arrows. Undo restores them.</p>
          </section>
          <section id="graph-transition-panel" class="graph-inspector-section" hidden>
            <span class="graph-eyebrow">Transition</span><h2 id="graph-transition-title">Add transition</h2>
            <form id="graph-transition-form" class="graph-form">
              <div class="graph-form-pair"><label for="graph-from">From<select id="graph-from" required></select></label><label for="graph-to">To<select id="graph-to" required></select></label></div>
              <label for="graph-input">Input symbol<input id="graph-input" autocomplete="off" list="graph-symbol-options" placeholder="0, 00, coin" required aria-describedby="graph-symbol-help"><datalist id="graph-symbol-options"></datalist></label>
              <label id="graph-output-row" for="graph-output">Output symbol<input id="graph-output" autocomplete="off" required aria-describedby="graph-symbol-help"></label>
              <p class="graph-small-note">A new input symbol joins the alphabet. One arrow per state and input keeps the machine deterministic.</p>
              <div class="graph-inspector-actions"><button id="graph-save-transition" type="submit" class="graph-button">Save transition</button><button id="graph-delete-transition" type="button" class="graph-button graph-danger" hidden>Delete</button></div>
            </form>
          </section>
          <section class="graph-inspector-section graph-alphabet-section">
            <span class="graph-eyebrow">Machine</span><h2>Input alphabet</h2>
            <form id="graph-alphabet-form" class="graph-form"><label for="graph-alphabet" class="sr-only">Input alphabet, symbols separated by spaces</label><input id="graph-alphabet" autocomplete="off" placeholder="0 1 or 00 01 10 11" aria-describedby="graph-alphabet-help"><p id="graph-alphabet-help" class="graph-small-note">Separate symbols with spaces. Use 00 01 10 11 for two binary variables, or words such as coin push for events. Removing a symbol also removes its arrows.</p><button id="graph-apply-alphabet" type="submit" class="graph-button">Apply alphabet</button></form>
            <div class="graph-fill"><label id="graph-fill-output-row" for="graph-fill-output">Default output<input id="graph-fill-output" value="0" autocomplete="off" aria-describedby="graph-symbol-help"></label><button id="graph-fill-missing" type="button" class="graph-button">Fill missing self-loops</button></div>
            <p id="graph-symbol-help" class="graph-small-note">Each input or output is one token: 0, 00, coin, emoji or any word without spaces or #. When inputs have multiple characters, separate input tokens with spaces.</p>
          </section>
        </aside>
      </div>
      <div id="graph-errors" class="graph-errors" role="alert" tabindex="-1" hidden></div>
      <input id="graph-import" type="file" accept=".patchbay,.txt,.machine,.json,text/plain,application/json" hidden>
    `;
    this.stage = this.element<HTMLDivElement>('graph-stage');
    this.scroll = this.element<HTMLDivElement>('graph-scroll');
    this.canvas = this.element<HTMLCanvasElement>('graph-ink');
    this.context = this.canvas.getContext('2d', { alpha: true });
    this.surface = host.querySelector<HTMLDivElement>('.graph-surface')!;
    this.nodeLayer = host.querySelector<HTMLDivElement>('.graph-nodes')!;
    this.labelLayer = host.querySelector<HTMLDivElement>('.graph-labels')!;
    this.recover();
    this.bindControls();
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(this.stage);
    this.syncDom();
    this.resize();
    void document.fonts.ready.then(() => { if (!this.disposed) this.dirty = true; });
  }

  setMachine(machine: MachineDef, preserveSavedDraft = false): void {
    this.cancelGesture();
    if (preserveSavedDraft && this.recovered) {
      this.recovered = false;
      this.initialized = true;
      this.pendingFit = true;
      this.setStatus('Recovered your saved drawing. Run when it is ready.');
      this.dirty = true;
      return;
    }
    const positions: Record<string, Point> = Object.create(null) as Record<string, Point>;
    for (const state of this.draft.states) positions[state.name] = { x: state.x, y: state.y };
    const next = draftFromMachine(machine, positions);
    this.replaceDraft(next, this.initialized);
    this.initialized = true;
    this.recovered = false;
    this.setStatus('Machine loaded. Changes are saved as a local draft.');
  }

  getSource(): string { return draftToSource(this.draft); }

  openSource(source: string): void {
    if (new TextEncoder().encode(source).byteLength > FILE_LIMIT_BYTES) throw new Error('This file exceeds the 1 MiB graph-file limit. Open a smaller draft file.');
    const next = parseDraft(source);
    this.cancelGesture();
    this.replaceDraft(next, true);
    this.initialized = true;
    this.recovered = false;
    this.clearErrors();
    this.announce('Drawing opened. Its positions and incomplete transitions are preserved.');
  }

  resize(): void {
    if (this.disposed) return;
    const width = this.scroll.clientWidth, height = this.scroll.clientHeight;
    if (!width || !height) { this.dirty = true; return; }
    const center = this.viewCenter();
    this.width = width;
    this.height = height;
    this.resizeCanvas();
    this.refreshGeometry();
    this.layoutExtent(center);
    if (this.pendingFit) this.fit();
    this.dirty = true;
  }

  update(_dt: number, signals: Readonly<Signals>): void {
    if (this.disposed || !this.visible()) return;
    if (this.quality !== signals.quality) {
      this.quality = signals.quality;
      this.resizeCanvas();
      this.dirty = true;
    }
    this.host.classList.toggle('graph-reduced', signals.reducedMotion);
    if (this.width !== this.scroll.clientWidth || this.height !== this.scroll.clientHeight) this.resize();
    if (this.geometryDirty) {
      const center = this.viewCenter();
      this.refreshGeometry();
      this.layoutExtent(center);
    }
    if (this.pendingFit) this.fit();
    if (!this.dirty) return;
    this.positionElements();
    this.draw();
    this.dirty = false;
  }

  dispose(): void {
    if (this.disposed) return;
    this.cancelGesture();
    this.disposed = true;
    this.listeners.abort();
    this.observer.disconnect();
    this.nodes.clear();
    this.labels.clear();
    this.host.replaceChildren();
  }

  private element<T extends HTMLElement = HTMLElement>(id: string): T {
    return this.host.querySelector<T>(`#${id}`)!;
  }

  private bindControls(): void {
    const signal = this.listeners.signal;
    const click = (id: string, action: () => void) => this.element(id).addEventListener('click', action, { signal });
    click('graph-new', () => {
      this.cancelGesture();
      this.replaceDraft(createDraft(this.draft.kind), true);
      this.announce('New drawing. Add a state to begin. Undo can restore the previous drawing.');
    });
    click('graph-add-state', () => this.createState(this.viewCenter()));
    click('graph-empty-add', () => this.createState(this.viewCenter()));
    click('graph-add-transition', () => this.openTransition());
    click('graph-select', () => this.setTool('select'));
    click('graph-connect', () => this.setTool('connect'));
    click('graph-undo', () => this.undo());
    click('graph-redo', () => this.redo());
    click('graph-zoom-in', () => this.setZoom(this.zoom * 1.25));
    click('graph-zoom-out', () => this.setZoom(this.zoom / 1.25));
    click('graph-fit', () => this.fit());
    click('graph-text', () => this.options.onText());
    click('graph-run', () => this.run());
    click('graph-open', () => { void this.openFile(); });
    click('graph-save', () => { void this.saveFile(); });
    click('graph-set-start', () => {
      if (this.selectedState) this.command(() => { this.draft.start = this.selectedState; }, 'Start state updated.');
    });
    click('graph-delete-state', () => this.deleteSelected());
    click('graph-delete-transition', () => this.deleteSelected());
    click('graph-fill-missing', () => {
      const output = this.draft.kind === 'mealy' ? this.element<HTMLInputElement>('graph-fill-output').value : '0';
      if (this.draft.kind === 'mealy' && !oneSymbol(output)) { this.showErrors(['Choose one nonempty output token without whitespace or #.']); return; }
      this.command(() => fillMissing(this.draft, output), 'Missing transitions filled with self-loops.');
    });
    this.element<HTMLSelectElement>('graph-kind').addEventListener('change', event => {
      const kind = (event.target as HTMLSelectElement).value as GraphKind;
      this.command(() => {
        this.draft.kind = kind;
        if (kind === 'moore') {
          for (const state of this.draft.states) if (!oneSymbol(state.output)) state.output = '0';
        } else {
          for (const transition of this.draft.transitions) if (!oneSymbol(transition.output)) transition.output = '0';
        }
      }, `Drawing type changed to ${kind === 'mealy' ? 'Mealy' : 'Moore'}.`);
    }, { signal });
    this.element('graph-state-form').addEventListener('submit', event => {
      event.preventDefault();
      const id = this.selectedState;
      const name = this.element<HTMLInputElement>('graph-state-name').value.trim();
      const output = this.element<HTMLInputElement>('graph-state-output').value;
      if (this.draft.kind === 'moore' && output && !oneSymbol(output)) { this.showErrors(['A Moore state output must be one token without whitespace or #.']); return; }
      this.command(() => {
        renameState(this.draft, id, name);
        const state = this.draft.states.find(item => item.id === id);
        if (state && this.draft.kind === 'moore') state.output = output;
      }, 'State saved.');
    }, { signal });
    this.element('graph-transition-form').addEventListener('submit', event => { event.preventDefault(); this.saveTransition(); }, { signal });
    this.element('graph-alphabet-form').addEventListener('submit', event => {
      event.preventDefault();
      const text = this.element<HTMLInputElement>('graph-alphabet').value.trim();
      try {
        const symbols: unknown = text.startsWith('[') ? JSON.parse(text) : text ? text.split(/[\s\p{White_Space}]+/u).filter(Boolean) : [];
        if (!Array.isArray(symbols) || symbols.some(symbol => typeof symbol !== 'string')) throw new Error('Enter tokens separated by spaces, or a JSON array of tokens.');
        this.command(() => setAlphabet(this.draft, symbols as string[]), 'Input alphabet updated.');
      } catch (error) { this.showErrors([errorMessage(error)]); }
    }, { signal });
    this.element<HTMLInputElement>('graph-import').addEventListener('change', event => {
      const input = event.target as HTMLInputElement;
      const file = input.files?.[0];
      if (file && file.size > FILE_LIMIT_BYTES) this.showErrors(['This file exceeds the 1 MiB graph-file limit. Open a smaller draft file.']);
      else if (file) void file.text().then(source => this.openSource(source)).catch(error => this.showErrors([`Could not open this file: ${errorMessage(error)}`]));
      input.value = '';
    }, { signal });
    this.scroll.addEventListener('scroll', () => { this.dirty = true; }, { signal, passive: true });
    this.scroll.addEventListener('pointerdown', event => this.pointerDown(event), { signal });
    this.scroll.addEventListener('pointermove', event => this.pointerMove(event), { signal });
    this.scroll.addEventListener('pointerup', event => this.pointerUp(event), { signal });
    this.scroll.addEventListener('pointercancel', () => this.cancelGesture(), { signal });
    this.scroll.addEventListener('lostpointercapture', () => { if (this.gesture) this.cancelGesture(); }, { signal });
    this.scroll.addEventListener('click', event => this.stageClick(event), { signal });
    this.scroll.addEventListener('dblclick', event => {
      if (!(event.target instanceof Element) || event.target.closest('.graph-node,.graph-edge-label')) return;
      event.preventDefault();
      this.createState(this.clientToWorld(event.clientX, event.clientY));
    }, { signal });
    this.scroll.addEventListener('wheel', event => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      this.setZoom(this.zoom * Math.exp(-event.deltaY * 0.002), this.clientToWorld(event.clientX, event.clientY), { x: event.clientX - this.scroll.getBoundingClientRect().left, y: event.clientY - this.scroll.getBoundingClientRect().top });
    }, { signal, passive: false });
    document.addEventListener('keydown', event => this.keyDown(event), { signal });
  }

  private recover(): void {
    try {
      const source = localStorage.getItem(RECOVERY_KEY);
      if (source) { this.draft = parseDraft(source); this.recovered = true; this.pendingFit = true; }
    } catch { this.storageAvailable = false; this.options.onMessage('Saved drawing recovery could not be read. Open a saved draft file to restore it.'); }
  }

  private persist(): void {
    try { localStorage.setItem(RECOVERY_KEY, serializeDraft(this.draft)); this.storageAvailable = true; }
    catch { this.storageAvailable = false; this.setStatus('Local recovery is unavailable. Save draft to keep this drawing.'); }
  }

  private command(action: () => void, message: string): boolean {
    this.cancelGesture();
    const before = cloneDraft(this.draft);
    try { action(); }
    catch (error) { this.draft = before; this.showErrors([errorMessage(error)]); return false; }
    if (JSON.stringify(before) === JSON.stringify(this.draft)) { this.setStatus(message); return true; }
    this.pushUndo(before);
    this.redoStack.length = 0;
    this.clearErrors();
    this.geometryDirty = true;
    this.syncDom();
    this.persist();
    this.setStatus(message);
    this.dirty = true;
    return true;
  }

  private replaceDraft(next: GraphDraft, history: boolean): void {
    if (history && JSON.stringify(this.draft) !== JSON.stringify(next)) this.pushUndo(cloneDraft(this.draft));
    if (!history) this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.draft = next;
    this.selectedState = '';
    this.transitionEditor = null;
    this.connectFrom = this.connectHover = '';
    this.pointer = null;
    this.clearErrors();
    this.geometryDirty = true;
    this.pendingFit = true;
    this.syncDom();
    this.persist();
    this.dirty = true;
  }

  private pushUndo(draft: GraphDraft): void {
    this.undoStack.push(draft);
    if (this.undoStack.length > HISTORY_LIMIT) this.undoStack.shift();
  }

  private undo(): void {
    this.cancelGesture();
    const previous = this.undoStack.pop();
    if (!previous) return;
    this.redoStack.push(cloneDraft(this.draft));
    this.restoreHistory(previous, 'Edit undone.');
  }

  private redo(): void {
    this.cancelGesture();
    const next = this.redoStack.pop();
    if (!next) return;
    this.pushUndo(cloneDraft(this.draft));
    this.restoreHistory(next, 'Edit restored.');
  }

  private restoreHistory(draft: GraphDraft, message: string): void {
    this.draft = draft;
    this.connectFrom = this.connectHover = '';
    this.clearErrors();
    this.geometryDirty = true;
    this.syncDom();
    this.persist();
    this.setStatus(message);
    this.dirty = true;
  }

  private createState(point: Point): void {
    let id = '';
    let x = Math.max(80, point.x), y = Math.max(80, point.y);
    // Repeated toolbar additions stay near the viewport center without covering each other.
    for (let attempt = 1; this.draft.states.some(state => Math.hypot(state.x - x, state.y - y) < 90); attempt++) {
      const angle = attempt * 2.399963229728653;
      const distance = 100 * Math.sqrt(attempt);
      x = Math.max(80, point.x + Math.cos(angle) * distance);
      y = Math.max(80, point.y + Math.sin(angle) * distance);
    }
    if (!this.command(() => { id = addState(this.draft, x, y).id; }, 'State added. Rename it in the inspector.')) return;
    this.setTool('select');
    this.selectState(id);
    this.element<HTMLInputElement>('graph-state-name').focus();
    this.element<HTMLInputElement>('graph-state-name').select();
  }

  private selectState(id: string): void {
    this.selectedState = id;
    this.transitionEditor = null;
    this.renderInspector();
    this.renderSelection();
    this.dirty = true;
  }

  private openTransition(from?: string, to?: string, existing?: GraphTransition): void {
    if (!this.draft.states.length) { this.showErrors(['Add a state before adding a transition. A self-loop uses the same state for From and To.']); return; }
    const source = from || this.selectedState || this.draft.states[0].id;
    const used = new Set(this.draft.transitions.filter(edge => edge.from === source).map(edge => edge.input));
    this.transitionEditor = existing ? { ...existing } : {
      from: source, to: to || source,
      input: this.draft.alphabet.find(symbol => !used.has(symbol)) || '', output: '0',
    };
    this.selectedState = '';
    this.connectFrom = this.connectHover = '';
    this.pointer = null;
    this.renderInspector();
    this.renderSelection();
    this.dirty = true;
    this.element<HTMLInputElement>('graph-input').focus();
  }

  private saveTransition(): void {
    if (!this.transitionEditor) return;
    const input = this.element<HTMLInputElement>('graph-input').value;
    const output = this.element<HTMLInputElement>('graph-output').value;
    const from = this.element<HTMLSelectElement>('graph-from').value;
    const to = this.element<HTMLSelectElement>('graph-to').value;
    if (!oneSymbol(input)) { this.showErrors(['Enter one input token, such as 0, 00, coin or 🟢, without whitespace or #.']); return; }
    if (this.draft.kind === 'mealy' && !oneSymbol(output)) { this.showErrors(['Enter one nonempty output token without whitespace or # for this Mealy transition.']); return; }
    const id = this.transitionEditor.id;
    const conflict = this.draft.transitions.find(edge => edge.from === from && edge.input === input && edge.id !== id);
    if (conflict) {
      const state = this.draft.states.find(item => item.id === from);
      this.showErrors([`State “${state?.name || from}” already has a transition for “${input}”. Click that arrow label to edit it, or choose a different input.`]);
      return;
    }
    this.command(() => {
      const edge = upsertTransition(this.draft, { ...(id ? { id } : {}), from, to, input, output: this.draft.kind === 'mealy' ? output : this.transitionEditor?.output || '0' });
      this.transitionEditor = { ...edge };
    }, 'Transition saved.');
  }

  private deleteSelected(): void {
    const stateId = this.selectedState, edgeId = this.transitionEditor?.id;
    if (stateId) {
      this.command(() => { removeState(this.draft, stateId); this.selectedState = ''; }, 'State and incident transitions deleted.');
    } else if (edgeId) {
      this.command(() => { removeTransition(this.draft, edgeId); this.transitionEditor = null; }, 'Transition deleted.');
    }
  }

  private setTool(tool: 'select' | 'connect'): void {
    this.cancelGesture();
    this.tool = tool;
    this.connectFrom = this.connectHover = '';
    this.pointer = null;
    this.element('graph-select').setAttribute('aria-pressed', String(tool === 'select'));
    this.element('graph-connect').setAttribute('aria-pressed', String(tool === 'connect'));
    this.stage.dataset.tool = tool;
    this.element('graph-tool-hint').textContent = tool === 'connect'
      ? 'Click source → target, or drag between states. Use the same state for a self-loop.'
      : 'Double-click empty space to add a state. Drag a state to move it.';
    this.renderSelection();
    this.dirty = true;
  }

  private syncDom(): void {
    const stateIds = new Set(this.draft.states.map(state => state.id));
    for (const [id, button] of this.nodes) if (!stateIds.has(id)) { button.remove(); this.nodes.delete(id); }
    for (const state of this.draft.states) {
      let button = this.nodes.get(state.id);
      if (!button) {
        button = document.createElement('button');
        button.type = 'button';
        button.className = 'graph-node';
        button.dataset.stateId = state.id;
        const name = document.createElement('span'); name.className = 'graph-node-name';
        const output = document.createElement('span'); output.className = 'graph-node-output';
        const start = document.createElement('span'); start.className = 'graph-node-start'; start.textContent = 'start'; start.setAttribute('aria-hidden', 'true');
        button.append(name, output, start);
        this.nodeLayer.append(button);
        this.nodes.set(state.id, button);
      }
      button.querySelector('.graph-node-name')!.textContent = state.name;
      button.querySelector<HTMLElement>('.graph-node-output')!.textContent = state.output || '?';
      button.querySelector<HTMLElement>('.graph-node-output')!.hidden = this.draft.kind !== 'moore';
      button.classList.toggle('is-start', this.draft.start === state.id);
      button.setAttribute('aria-label', `${state.name}${this.draft.start === state.id ? ', start state' : ''}${this.draft.kind === 'moore' ? `, output ${state.output || 'missing'}` : ''}. ${this.tool === 'connect' ? 'Choose connection endpoint' : 'Select or drag to move'}.`);
      button.title = state.name;
    }
    const edgeIds = new Set(this.draft.transitions.map(edge => edge.id));
    for (const [id, button] of this.labels) if (!edgeIds.has(id)) { button.remove(); this.labels.delete(id); }
    const stateNames = new Map(this.draft.states.map(state => [state.id, state.name]));
    for (const edge of this.draft.transitions) {
      let button = this.labels.get(edge.id);
      if (!button) {
        button = document.createElement('button');
        button.type = 'button';
        button.className = 'graph-edge-label';
        button.dataset.transitionId = edge.id;
        this.labelLayer.append(button);
        this.labels.set(edge.id, button);
      }
      button.textContent = this.draft.kind === 'mealy' ? `${edge.input} / ${edge.output || '?'}` : edge.input;
      button.setAttribute('aria-label', `Edit transition from ${stateNames.get(edge.from) || edge.from} to ${stateNames.get(edge.to) || edge.to}, input ${edge.input}${this.draft.kind === 'mealy' ? `, output ${edge.output || 'missing'}` : ''}`);
    }
    if (this.selectedState && !stateIds.has(this.selectedState)) this.selectedState = '';
    if (this.transitionEditor?.id) {
      const edge = this.draft.transitions.find(item => item.id === this.transitionEditor?.id);
      this.transitionEditor = edge ? { ...edge } : null;
    }
    if (this.transitionEditor && (!stateIds.has(this.transitionEditor.from) || !stateIds.has(this.transitionEditor.to))) this.transitionEditor = null;
    if (this.connectFrom && !stateIds.has(this.connectFrom)) this.connectFrom = '';
    this.element<HTMLSelectElement>('graph-kind').value = this.draft.kind;
    this.element<HTMLInputElement>('graph-alphabet').value = this.draft.alphabet.join(' ');
    this.element('graph-fill-output-row').hidden = this.draft.kind !== 'mealy';
    this.element<HTMLButtonElement>('graph-fill-missing').disabled = !this.draft.states.length || !this.draft.alphabet.length;
    this.element<HTMLButtonElement>('graph-undo').disabled = !this.undoStack.length;
    this.element<HTMLButtonElement>('graph-redo').disabled = !this.redoStack.length;
    this.element('graph-empty').hidden = !!this.draft.states.length;
    this.element('graph-counts').textContent = `${this.draft.states.length} ${this.draft.states.length === 1 ? 'state' : 'states'} · ${this.draft.transitions.length} ${this.draft.transitions.length === 1 ? 'transition' : 'transitions'}`;
    const datalist = this.element<HTMLDataListElement>('graph-symbol-options');
    datalist.replaceChildren(...this.draft.alphabet.map(symbol => { const option = document.createElement('option'); option.value = symbol; return option; }));
    this.renderInspector();
    this.renderSelection();
    this.dirty = true;
  }

  private renderInspector(): void {
    const state = this.draft.states.find(item => item.id === this.selectedState);
    this.element('graph-state-panel').hidden = !state;
    this.element('graph-transition-panel').hidden = !this.transitionEditor;
    this.element('graph-inspector-empty').hidden = !!state || !!this.transitionEditor;
    if (state) {
      this.element('graph-state-title').textContent = state.name;
      this.element<HTMLInputElement>('graph-state-name').value = state.name;
      this.element<HTMLInputElement>('graph-state-output').value = state.output;
      this.element('graph-state-output-row').hidden = this.draft.kind !== 'moore';
      const start = this.element<HTMLButtonElement>('graph-set-start');
      start.textContent = this.draft.start === state.id ? 'Start state' : 'Set as start';
      start.disabled = this.draft.start === state.id;
    }
    if (this.transitionEditor) {
      const edge = this.transitionEditor;
      this.element('graph-transition-title').textContent = edge.id ? 'Edit transition' : 'Add transition';
      for (const key of ['from', 'to'] as const) {
        const select = this.element<HTMLSelectElement>(`graph-${key}`);
        select.replaceChildren(...this.draft.states.map(item => {
          const option = document.createElement('option'); option.value = item.id; option.textContent = item.name; return option;
        }));
        select.value = edge[key];
      }
      this.element<HTMLInputElement>('graph-input').value = edge.input;
      this.element<HTMLInputElement>('graph-output').value = edge.output;
      this.element('graph-output-row').hidden = this.draft.kind !== 'mealy';
      this.element<HTMLInputElement>('graph-output').required = this.draft.kind === 'mealy';
      this.element('graph-delete-transition').hidden = !edge.id;
    }
  }

  private renderSelection(): void {
    for (const [id, button] of this.nodes) {
      button.classList.toggle('is-selected', id === this.selectedState);
      button.classList.toggle('is-connect-source', id === this.connectFrom);
      button.classList.toggle('is-connect-target', id === this.connectHover);
      button.setAttribute('aria-pressed', String(id === this.selectedState || id === this.connectFrom));
    }
    for (const [id, button] of this.labels) button.classList.toggle('is-selected', id === this.transitionEditor?.id);
  }

  private refreshGeometry(): void {
    if (!this.geometryDirty) return;
    this.curves = graphCurves(this.draft);
    let left = 0, top = 0, right = 400, bottom = 260;
    for (const state of this.draft.states) {
      left = Math.min(left, state.x - STATE_RADIUS); top = Math.min(top, state.y - STATE_RADIUS);
      right = Math.max(right, state.x + STATE_RADIUS); bottom = Math.max(bottom, state.y + STATE_RADIUS);
    }
    for (const curve of this.curves) {
      left = Math.min(left, curve.bounds.left - 50); top = Math.min(top, curve.bounds.top - 30);
      right = Math.max(right, curve.bounds.right + 50); bottom = Math.max(bottom, curve.bounds.bottom + 30);
    }
    this.worldBounds = { left: left - 100, top: top - 100, right: right + 100, bottom: bottom + 100 };
    this.geometryDirty = false;
  }

  private layoutExtent(center?: Point): void {
    const previousOrigin = this.origin;
    const moving = this.gesture?.mode === 'move' && this.gesture.moved;
    // Keep the scroll coordinate system stable throughout a drag. Shrinking its
    // leading margin or trailing extent can otherwise clamp scroll and move the
    // world under the pointer, feeding an unintended offset into the next event.
    this.origin = {
      x: moving ? Math.min(previousOrigin.x, this.worldBounds.left) : this.worldBounds.left,
      y: moving ? Math.min(previousOrigin.y, this.worldBounds.top) : this.worldBounds.top,
    };
    let width = Math.max(this.width, (this.worldBounds.right - this.origin.x) * this.zoom);
    let height = Math.max(this.height, (this.worldBounds.bottom - this.origin.y) * this.zoom);
    if (moving) {
      width = Math.max(width, (parseFloat(this.surface.style.width) || this.width) + (previousOrigin.x - this.origin.x) * this.zoom);
      height = Math.max(height, (parseFloat(this.surface.style.height) || this.height) + (previousOrigin.y - this.origin.y) * this.zoom);
    }
    this.surface.style.width = `${width}px`;
    this.surface.style.height = `${height}px`;
    if (center) {
      this.scroll.scrollLeft = (center.x - this.origin.x) * this.zoom - this.width / 2;
      this.scroll.scrollTop = (center.y - this.origin.y) * this.zoom - this.height / 2;
    }
    this.element<HTMLOutputElement>('graph-zoom').value = `${Math.round(this.zoom * 100)}%`;
    this.positionElements();
    this.dirty = true;
  }

  private positionElements(): void {
    for (const state of this.draft.states) {
      const button = this.nodes.get(state.id);
      if (!button) continue;
      button.style.left = `${(state.x - this.origin.x) * this.zoom}px`;
      button.style.top = `${(state.y - this.origin.y) * this.zoom}px`;
      button.style.width = button.style.height = `${STATE_RADIUS * 2 * this.zoom}px`;
      button.style.fontSize = `${15 * this.zoom}px`;
      button.style.setProperty('--graph-node-scale', String(this.zoom));
    }
    const left = this.scroll.scrollLeft, top = this.scroll.scrollTop;
    for (const curve of this.curves) {
      const button = this.labels.get(curve.transition.id);
      if (!button) continue;
      const x = (curve.label.x - this.origin.x) * this.zoom, y = (curve.label.y - this.origin.y) * this.zoom;
      button.style.left = `${x}px`; button.style.top = `${y}px`;
      button.style.setProperty('--graph-label-scale', String(Math.max(0.65, Math.min(1.15, this.zoom))));
      const visible = x >= left - 90 && y >= top - 45 && x <= left + this.width + 90 && y <= top + this.height + 45;
      button.style.visibility = visible || document.activeElement === button ? 'visible' : 'hidden';
    }
  }

  private fit(): void {
    if (!this.scroll.clientWidth || !this.scroll.clientHeight) { this.pendingFit = true; return; }
    this.refreshGeometry();
    const bounds = this.worldBounds;
    const worldWidth = bounds.right - bounds.left, worldHeight = bounds.bottom - bounds.top;
    this.zoom = clamp(Math.min(this.width / worldWidth, this.height / worldHeight, 1.2), 0.05, 2.5);
    this.pendingFit = false;
    this.layoutExtent({ x: (bounds.left + bounds.right) / 2, y: (bounds.top + bounds.bottom) / 2 });
  }

  private setZoom(zoom: number, anchor = this.viewCenter(), at: Point = { x: this.width / 2, y: this.height / 2 }): void {
    this.zoom = clamp(zoom, 0.05, 2.5);
    this.refreshGeometry();
    this.layoutExtent();
    this.scroll.scrollLeft = (anchor.x - this.origin.x) * this.zoom - at.x;
    this.scroll.scrollTop = (anchor.y - this.origin.y) * this.zoom - at.y;
    this.dirty = true;
  }

  private viewCenter(): Point {
    return { x: this.origin.x + (this.scroll.scrollLeft + this.width / 2) / this.zoom, y: this.origin.y + (this.scroll.scrollTop + this.height / 2) / this.zoom };
  }

  private clientToWorld(x: number, y: number): Point {
    const rect = this.scroll.getBoundingClientRect();
    return { x: this.origin.x + (x - rect.left + this.scroll.scrollLeft) / this.zoom, y: this.origin.y + (y - rect.top + this.scroll.scrollTop) / this.zoom };
  }

  private nodeAt(x: number, y: number): string {
    const element = document.elementFromPoint(x, y)?.closest<HTMLElement>('.graph-node');
    return element && this.host.contains(element) ? element.dataset.stateId || '' : '';
  }

  private pointerDown(event: PointerEvent): void {
    if (event.button !== 0 || this.gesture || !(event.target instanceof Element)) return;
    this.suppressClickUntil = 0;
    const button = event.target.closest<HTMLButtonElement>('.graph-node');
    if (!button) return;
    const state = this.draft.states.find(item => item.id === button.dataset.stateId);
    if (!state) return;
    event.preventDefault();
    button.focus({ preventScroll: true });
    if (this.tool === 'select') this.selectState(state.id);
    this.gesture = {
      pointerId: event.pointerId, stateId: state.id, mode: this.tool === 'connect' ? 'connect' : 'move',
      client: { x: event.clientX, y: event.clientY }, world: this.clientToWorld(event.clientX, event.clientY),
      initial: { x: state.x, y: state.y }, before: cloneDraft(this.draft), moved: false,
    };
    if (this.tool === 'connect') { this.pointer = this.gesture.world; this.dirty = true; }
    this.scroll.setPointerCapture(event.pointerId);
  }

  private pointerMove(event: PointerEvent): void {
    const point = this.clientToWorld(event.clientX, event.clientY);
    if (!this.gesture) {
      if (this.connectFrom) { this.pointer = point; this.dirty = true; }
      return;
    }
    const gesture = this.gesture;
    if (event.pointerId !== gesture.pointerId) return;
    if (Math.hypot(event.clientX - gesture.client.x, event.clientY - gesture.client.y) >= 4) gesture.moved = true;
    if (gesture.mode === 'move' && gesture.moved) {
      const state = this.draft.states.find(item => item.id === gesture.stateId);
      if (state) {
        state.x = Math.max(0, gesture.initial.x + point.x - gesture.world.x);
        state.y = Math.max(0, gesture.initial.y + point.y - gesture.world.y);
        this.geometryDirty = true;
        this.dirty = true;
      }
    } else if (gesture.mode === 'connect') {
      if (gesture.moved) this.connectFrom = gesture.stateId;
      this.pointer = point;
      const target = this.nodeAt(event.clientX, event.clientY);
      if (target !== this.connectHover) { this.connectHover = target; this.renderSelection(); }
      this.dirty = true;
    }
  }

  private pointerUp(event: PointerEvent): void {
    const gesture = this.gesture;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    this.gesture = null;
    if (this.scroll.hasPointerCapture(event.pointerId)) this.scroll.releasePointerCapture(event.pointerId);
    this.suppressClickUntil = performance.now() + 400;
    if (gesture.mode === 'move') {
      if (gesture.moved) this.geometryDirty = true;
      if (gesture.moved && JSON.stringify(gesture.before) !== JSON.stringify(this.draft)) {
        this.pushUndo(gesture.before);
        this.redoStack.length = 0;
        this.clearErrors();
        this.syncDom();
        this.persist();
        this.setStatus('State moved.');
      }
    } else if (gesture.moved) {
      const target = this.nodeAt(event.clientX, event.clientY);
      if (target) this.openTransition(gesture.stateId, target);
      else { this.connectFrom = gesture.stateId; this.connectHover = ''; this.setStatus('Choose a target state to finish this connection.'); this.renderSelection(); }
    } else this.connectState(gesture.stateId);
    this.dirty = true;
  }

  private cancelGesture(): void {
    const gesture = this.gesture;
    if (!gesture) return;
    this.gesture = null;
    if (this.scroll.hasPointerCapture(gesture.pointerId)) this.scroll.releasePointerCapture(gesture.pointerId);
    if (gesture.mode === 'move' && gesture.moved) {
      this.draft = gesture.before;
      this.geometryDirty = true;
      this.syncDom();
    }
    if (gesture.mode === 'connect') this.connectFrom = '';
    this.connectHover = '';
    this.pointer = null;
    this.renderSelection();
    this.dirty = true;
  }

  private connectState(id: string): void {
    if (this.connectFrom) this.openTransition(this.connectFrom, id);
    else {
      this.connectFrom = id;
      this.selectedState = '';
      this.transitionEditor = null;
      this.setStatus('Source chosen. Choose a target state, including the source for a self-loop.');
      this.renderInspector();
      this.renderSelection();
      this.dirty = true;
    }
  }

  private stageClick(event: MouseEvent): void {
    if (event.detail > 0 && performance.now() < this.suppressClickUntil) return;
    if (!(event.target instanceof Element)) return;
    const node = event.target.closest<HTMLElement>('.graph-node');
    if (node) {
      const id = node.dataset.stateId!;
      if (this.tool === 'connect') this.connectState(id); else this.selectState(id);
      return;
    }
    const label = event.target.closest<HTMLElement>('.graph-edge-label');
    if (label) {
      const edge = this.draft.transitions.find(item => item.id === label.dataset.transitionId);
      if (edge) this.openTransition(edge.from, edge.to, edge);
      return;
    }
    if (this.tool === 'select') { this.selectedState = ''; this.transitionEditor = null; this.renderInspector(); this.renderSelection(); this.dirty = true; }
  }

  private keyDown(event: KeyboardEvent): void {
    if (!this.visible() || event.defaultPrevented) return;
    if (document.querySelector('dialog[open]')) return;
    if (event.target instanceof Element && event.target.closest('input,textarea,select,[contenteditable="true"],[role="textbox"]')) return;
    const modifier = event.ctrlKey || event.metaKey;
    if (modifier && event.key.toLowerCase() === 'z') { event.preventDefault(); if (event.shiftKey) this.redo(); else this.undo(); }
    else if (modifier && event.key.toLowerCase() === 'y') { event.preventDefault(); this.redo(); }
    else if (event.key === 'Delete' || event.key === 'Backspace') { if (this.selectedState || this.transitionEditor?.id) { event.preventDefault(); this.deleteSelected(); } }
    else if (event.key === 'Escape') { this.cancelGesture(); this.connectFrom = this.connectHover = ''; this.pointer = null; this.renderSelection(); this.dirty = true; }
  }

  private run(): void {
    const errors = validateDraft(this.draft);
    if (errors.length) { this.showErrors(errors); this.element('graph-errors').focus(); return; }
    try { this.options.onApply(draftToSource(this.draft)); this.clearErrors(); this.setStatus('Machine is valid and ready on the Bench.'); }
    catch (error) { this.showErrors([errorMessage(error)]); }
  }

  private async openFile(): Promise<void> {
    if (!window.patchbay) { this.element<HTMLInputElement>('graph-import').click(); return; }
    try { const result = await window.patchbay.openMachine(); if (result && !this.disposed) this.openSource(result.source); }
    catch (error) { this.showErrors([`Could not open this file: ${errorMessage(error)}`]); }
  }

  private async saveFile(): Promise<void> {
    try {
      const source = serializeDraft(this.draft);
      if (new TextEncoder().encode(source).byteLength > FILE_LIMIT_BYTES) {
        this.showErrors(['This draft exceeds the 1 MiB graph-file limit. Shorten state names or remove some states or transitions before saving.']);
        return;
      }
      if (window.patchbay) {
        const save = window.patchbay.saveMachine as (content: string, format?: 'graph') => Promise<boolean>;
        if (await save(source, 'graph')) this.announce('Draft file saved, including state positions.');
      } else {
        const url = URL.createObjectURL(new Blob([source], { type: 'application/json;charset=utf-8' }));
        const link = document.createElement('a');
        link.href = url; link.download = 'machine.patchbay'; link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        this.announce('Draft downloaded, including state positions.');
      }
    } catch (error) { this.showErrors([`Could not save this drawing: ${errorMessage(error)}`]); }
  }

  private showErrors(errors: string[]): void {
    this.errors = errors;
    const container = this.element('graph-errors');
    const title = document.createElement('strong');
    title.textContent = errors.length === 1 ? 'Complete this before running' : `${errors.length} items need attention`;
    const list = document.createElement('ul');
    for (const message of errors.slice(0, 100)) { const item = document.createElement('li'); item.textContent = message; list.append(item); }
    if (errors.length > 100) { const item = document.createElement('li'); item.textContent = `${errors.length - 100} more items remain. Resolve these and run again to check your progress.`; list.append(item); }
    container.replaceChildren(title, list);
    container.hidden = false;
    this.setStatus('Drawing kept as a draft. Resolve the messages below to run.');
  }

  private clearErrors(): void { this.errors = []; this.element('graph-errors').hidden = true; this.element('graph-errors').replaceChildren(); }
  private setStatus(message: string): void { this.element('graph-status').textContent = this.storageAvailable ? message : 'Local recovery unavailable. Save draft to keep this drawing.'; }
  private announce(message: string): void { this.setStatus(message); this.options.onMessage(message); }
  private visible(): boolean { return !this.host.hidden && this.host.getClientRects().length > 0; }

  private resizeCanvas(): void {
    this.dpr = Math.min(window.devicePixelRatio || 1, this.quality === 'high' ? 2 : this.quality === 'medium' ? 1.5 : 1);
    this.canvas.width = Math.max(1, Math.ceil(this.width * this.dpr));
    this.canvas.height = Math.max(1, Math.ceil(this.height * this.dpr));
    this.dirty = true;
  }

  /** This is called only by update(), never by input handlers or an independent timer. */
  private draw(): void {
    const context = this.context;
    if (!context) return;
    context.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    context.clearRect(0, 0, this.width, this.height);
    const style = getComputedStyle(this.host);
    const copper = style.getPropertyValue('--copper').trim() || '#e0a458';
    const mint = style.getPropertyValue('--mint').trim() || '#7ce3c3';
    const line = style.getPropertyValue('--line').trim() || 'rgba(234,242,236,.13)';
    const viewLeft = this.origin.x + this.scroll.scrollLeft / this.zoom, viewTop = this.origin.y + this.scroll.scrollTop / this.zoom;
    const viewRight = viewLeft + this.width / this.zoom, viewBottom = viewTop + this.height / this.zoom;
    const spacing = 40 * this.zoom;
    if (spacing >= 12) {
      context.fillStyle = line;
      const startX = ((-viewLeft * this.zoom) % spacing + spacing) % spacing;
      const startY = ((-viewTop * this.zoom) % spacing + spacing) % spacing;
      for (let y = startY; y < this.height; y += spacing) for (let x = startX; x < this.width; x += spacing) context.fillRect(x, y, 1, 1);
    }
    context.translate(-viewLeft * this.zoom, -viewTop * this.zoom);
    context.scale(this.zoom, this.zoom);
    context.lineCap = 'round';
    for (const curve of this.curves) {
      const bounds = curve.bounds;
      if (bounds.right < viewLeft - 20 || bounds.left > viewRight + 20 || bounds.bottom < viewTop - 20 || bounds.top > viewBottom + 20) continue;
      const selected = curve.transition.id === this.transitionEditor?.id;
      context.strokeStyle = context.fillStyle = selected ? mint : copper;
      context.lineWidth = (selected ? 2.4 : 1.6) / this.zoom;
      context.beginPath(); context.moveTo(curve.a.x, curve.a.y);
      context.bezierCurveTo(curve.b.x, curve.b.y, curve.c.x, curve.c.y, curve.d.x, curve.d.y);
      context.stroke();
      const angle = Math.atan2(curve.d.y - curve.c.y, curve.d.x - curve.c.x);
      const head = 8 / this.zoom;
      context.beginPath(); context.moveTo(curve.d.x, curve.d.y);
      context.lineTo(curve.d.x - Math.cos(angle - 0.45) * head, curve.d.y - Math.sin(angle - 0.45) * head);
      context.lineTo(curve.d.x - Math.cos(angle + 0.45) * head, curve.d.y - Math.sin(angle + 0.45) * head);
      context.closePath(); context.fill();
    }
    const start = this.draft.states.find(state => state.id === this.draft.start);
    if (start) {
      context.strokeStyle = context.fillStyle = mint; context.lineWidth = 1.5 / this.zoom;
      context.beginPath(); context.moveTo(start.x - STATE_RADIUS - 35, start.y); context.lineTo(start.x - STATE_RADIUS - 4, start.y); context.stroke();
      context.beginPath(); context.moveTo(start.x - STATE_RADIUS - 3, start.y); context.lineTo(start.x - STATE_RADIUS - 11, start.y - 4); context.lineTo(start.x - STATE_RADIUS - 11, start.y + 4); context.closePath(); context.fill();
    }
    const source = this.draft.states.find(state => state.id === (this.gesture?.mode === 'connect' && this.gesture.moved ? this.gesture.stateId : this.connectFrom));
    if (source && this.pointer) {
      context.strokeStyle = mint; context.lineWidth = 1.7 / this.zoom; context.setLineDash([6 / this.zoom, 5 / this.zoom]);
      context.beginPath(); context.moveTo(source.x, source.y); context.lineTo(this.pointer.x, this.pointer.y); context.stroke(); context.setLineDash([]);
    }
  }
}
