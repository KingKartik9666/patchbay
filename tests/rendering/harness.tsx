import { StrictMode, type RefObject } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import '../../src/style.css';
import '../../src/diagram/diagram.css';
import '../../src/reference.css';
import { StateDiagram } from '../../src/rendering/StateDiagram';
import { FrameClock } from '../../src/rendering/frame-clock';
import type { Signals } from '../../src/signals';
import type { MachineDef, Step } from '../../src/domain/contracts';

class ManualClock extends FrameClock {
  private subscribers = new Set<(dt: number, signals: Readonly<Signals>) => void>();
  override subscribe(callback: (dt: number, signals: Readonly<Signals>) => void): () => void {
    this.subscribers.add(callback);
    return () => {
      this.subscribers.delete(callback);
    };
  }
  override get subscriberCount() {
    return this.subscribers.size;
  }
  advance(dt: number) {
    for (const callback of this.subscribers) callback(dt, this.signals);
  }
}
const clock = new ManualClock({
  pointer: { x: 0, y: 0 },
  energy: 0,
  phase: 'idle',
  quality: 'medium',
  glass: 'baked',
  refreshHz: 120,
  reducedMotion: false,
  focusMode: false,
  boardRate: 30,
  glowPasses: 2,
});
const definition = (count: number, kind: 'mealy' | 'moore'): MachineDef => ({
  states: Array.from({ length: count }, (_, i) => `S${i}`),
  alphabet: ['0', 'λ'],
  start: 'S0',
  delta: Object.fromEntries(
    Array.from({ length: count }, (_, i) => [`S${i}`, { '0': `S${(i + 1) % count}`, λ: `S${i}` }]),
  ),
  outputs:
    kind === 'mealy'
      ? {
          kind,
          lambda: Object.fromEntries(
            Array.from({ length: count }, (_, i) => [`S${i}`, { '0': '1', λ: '0' }]),
          ),
        }
      : {
          kind,
          lambda: Object.fromEntries(
            Array.from({ length: count }, (_, i) => [`S${i}`, String(i % 2)]),
          ),
        },
});
let root: Root | undefined;
let machine = definition(2, 'moore'),
  cursor = 0,
  activeState = machine.start,
  replayKey = 0,
  theme: 'light' | 'dark' = 'light';
const travelRef: RefObject<{ step?: Step; progress: number }> = { current: { progress: 0 } };
let inspections: string[] = [];
const building: boolean[] = [];
let callbackVersion = 0;
const buildingCallbacks: { version: number; building: boolean }[] = [];
function render() {
  const version = callbackVersion;
  flushSync(() =>
    root?.render(
      <StrictMode>
        <main className="main-content" style={{ padding: 24 }}>
          <section className="sheet" style={{ padding: '20px 0' }}>
            <StateDiagram
              machine={machine}
              clock={clock}
              cursor={cursor}
              activeState={activeState}
              travelRef={travelRef}
              replayKey={replayKey}
              theme={theme}
              onInspect={(state) => {
                inspections.push(state);
              }}
              onBuildingChange={(value) => {
                building.push(value);
                buildingCallbacks.push({ version, building: value });
              }}
            />
          </section>
          <div className="output-tape" style={{ marginTop: 30 }}>
            <span className="tape-cell current">
              <span>1</span>
            </span>
          </div>
        </main>
      </StrictMode>,
    ),
  );
}
function mount() {
  if (!root) root = createRoot(document.getElementById('harness')!);
  render();
}
const fixture = {
  mount,
  unmount: () => {
    flushSync(() => root?.unmount());
    root = undefined;
  },
  tick: (frames = 1, dt = 1 / 120) => {
    flushSync(() => {
      for (let i = 0; i < frames; i++) clock.advance(dt);
    });
  },
  subscribers: () => clock.subscriberCount,
  building: () => building,
  buildingCallbacks: () => buildingCallbacks,
  inspections: () => inspections,
  resetInspections: () => {
    inspections = [];
  },
  setMachine: (count: number, kind: 'mealy' | 'moore' = 'moore') => {
    machine = definition(count, kind);
    cursor = 0;
    activeState = machine.start;
    travelRef.current = { progress: 0 };
    render();
  },
  setTravel: (progress: number) => {
    travelRef.current = { step: { i: 0, from: 'S0', sym: '0', to: 'S1', out: '1' }, progress };
    fixture.tick();
  },
  setCursor: (value: number) => {
    cursor = value;
    activeState = value ? 'S1' : 'S0';
    travelRef.current = { progress: 0 };
    render();
    fixture.tick();
  },
  replay: () => {
    replayKey++;
    render();
  },
  setCallbackVersion: (value: number) => {
    callbackVersion = value;
    render();
  },
  setQuality: (value: Signals['quality']) => {
    clock.signals.quality = value;
    fixture.tick();
  },
  setReduced: (value: boolean) => {
    clock.signals.reducedMotion = value;
    fixture.tick();
  },
  setTheme: (value: 'light' | 'dark') => {
    theme = value;
    document.documentElement.dataset.theme = theme;
    render();
    fixture.tick();
  },
};
declare global {
  interface Window {
    rendererFixture: typeof fixture;
  }
}
window.rendererFixture = fixture;
mount();
