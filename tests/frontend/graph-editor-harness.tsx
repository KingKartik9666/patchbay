import { StrictMode, useLayoutEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { GraphEditor } from '../../src/editor/GraphEditor';
import type { GraphDraft, GraphEdit, GraphResult } from '../../src/domain/contracts';
import { FrameClock } from '../../src/rendering/frame-clock';
import '../../src/style.css';

// Synthetic parent fixture: these controls test UI ownership and lifetimes.
// Rust graph validation and actual IPC are verified by the application suite.
const initial: GraphDraft = {
  kind: 'mealy',
  states: [
    { id: 's0', name: 'EdgePosition', output: 'inactive', x: 0, y: 35 },
    { id: 's1', name: 'Target', output: '0', x: 250, y: 180 },
  ],
  transitions: [],
  alphabet: ['a', 'λ'],
  start: 's0',
  nextId: 2,
};
const clock = new FrameClock({
  pointer: { x: 0, y: 0 },
  energy: 0,
  phase: 'idle',
  quality: 'high',
  glass: 'solid',
  refreshHz: 60,
  reducedMotion: true,
  focusMode: false,
  boardRate: 0,
  glowPasses: 2,
});
clock.start();
interface HarnessControl {
  load(draft: GraphDraft, errors?: string[]): void;
  show(value: boolean): void;
  hide(value: boolean): void;
  rejectNext(): void;
  holdNext(): void;
  release(): void;
  snapshot(): {
    result: GraphResult;
    edits: GraphEdit[];
    calls: Record<string, number>;
    subscribers: number;
  };
}
declare global {
  interface Window {
    graphHarness: HarnessControl;
  }
}
const edits: GraphEdit[] = [],
  calls: Record<string, number> = {};
function record(key: string) {
  calls[key] = (calls[key] || 0) + 1;
}
function Harness() {
  const [result, setResult] = useState<GraphResult>({ draft: initial, source: '', errors: [] });
  const [shown, show] = useState(true),
    [hidden, hide] = useState(false);
  const resultRef = useRef(result),
    rejected = useRef(false),
    held = useRef(false),
    releaseRef = useRef<(() => void) | null>(null);
  useLayoutEffect(() => {
    resultRef.current = result;
    window.graphHarness = {
      load: (draft, errors = []) => setResult({ draft, source: '', errors }),
      show,
      hide,
      rejectNext: () => {
        rejected.current = true;
      },
      holdNext: () => {
        held.current = true;
      },
      release: () => releaseRef.current?.(),
      snapshot: () => ({
        result: resultRef.current,
        edits,
        calls,
        subscribers: clock.subscriberCount,
      }),
    };
  }, [result]);
  const edit = async (value: GraphEdit) => {
    edits.push(value);
    if (held.current) {
      held.current = false;
      await new Promise<void>((resolve) => {
        releaseRef.current = resolve;
      });
      releaseRef.current = null;
    }
    if (rejected.current) {
      rejected.current = false;
      throw { message: 'Rust rejected this edit.', details: ['Original draft retained.'] };
    }
    // Apply the synthetic responses needed by these tests. This deliberately
    // does not implement the Rust validator.
    if (value.type === 'moveState')
      setResult((current) => ({
        ...current,
        draft: {
          ...current.draft,
          states: current.draft.states.map((state) =>
            state.id === value.id ? { ...state, x: value.x, y: value.y } : state,
          ),
        },
      }));
    if (value.type === 'updateState')
      setResult((current) => ({
        ...current,
        draft: {
          ...current.draft,
          states: current.draft.states.map((state) =>
            state.id === value.id ? { ...state, name: value.name, output: value.output } : state,
          ),
        },
      }));
    if (value.type === 'upsertTransition')
      setResult((current) => {
        const id = value.id || `t${current.draft.nextId}`;
        const edge = {
          id,
          from: value.from,
          to: value.to,
          input: value.input,
          output: value.output,
        };
        return {
          ...current,
          draft: {
            ...current.draft,
            nextId: current.draft.nextId + (value.id ? 0 : 1),
            alphabet: current.draft.alphabet.includes(value.input)
              ? current.draft.alphabet
              : [...current.draft.alphabet, value.input],
            transitions: [...current.draft.transitions.filter((item) => item.id !== id), edge],
          },
        };
      });
  };
  return (
    <div hidden={hidden} style={{ maxWidth: 1200, margin: '20px auto' }}>
      {shown && (
        <GraphEditor
          result={result}
          clock={clock}
          busy={false}
          canUndo
          canRedo
          onEdit={edit}
          onNew={async () => {
            record('new');
          }}
          onUndo={() => record('undo')}
          onRedo={() => record('redo')}
          onRun={() => record('run')}
          onText={() => record('text')}
          onOpen={() => record('open')}
          onSave={() => record('save')}
          onMessage={() => record('message')}
        />
      )}
    </div>
  );
}
createRoot(document.getElementById('harness')!).render(
  <StrictMode>
    <Harness />
  </StrictMode>,
);
