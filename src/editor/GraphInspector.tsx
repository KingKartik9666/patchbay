import { useState, type FormEvent } from 'react';
import type {
  GraphDraft,
  GraphEdit,
  GraphState,
  GraphTransition,
  MachineKind,
} from '../domain/contracts';

export interface TransitionEditor {
  id?: string;
  from: string;
  to: string;
  input: string;
  output: string;
}
export type SubmitEdit = (edit: GraphEdit, message: string) => Promise<boolean>;

interface StateInspectorProps {
  state: GraphState;
  kind: MachineKind;
  start: string;
  busy: boolean;
  autoFocus?: boolean;
  submitEdit: SubmitEdit;
  onDelete(): void;
}

export function StateInspector({
  state,
  kind,
  start,
  busy,
  autoFocus = false,
  submitEdit,
  onDelete,
}: StateInspectorProps) {
  const [name, setName] = useState(state.name);
  const [output, setOutput] = useState(state.output);
  const save = async (event: FormEvent) => {
    event.preventDefault();
    await submitEdit(
      { type: 'updateState', id: state.id, name, output, start: start === state.id },
      'State saved.',
    );
  };
  return (
    <section id="graph-state-panel" className="graph-inspector-section">
      <span className="graph-eyebrow">State</span>
      <h2 id="graph-state-title">{state.name}</h2>
      <form
        id="graph-state-form"
        className="graph-form"
        onSubmit={(event) => {
          void save(event);
        }}
      >
        <label htmlFor="graph-state-name">
          Name
          <input
            id="graph-state-name"
            name="stateName"
            autoComplete="off"
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
            disabled={busy}
            autoFocus={autoFocus}
          />
        </label>
        <label id="graph-state-output-row" htmlFor="graph-state-output" hidden={kind !== 'moore'}>
          Moore output
          <input
            id="graph-state-output"
            name="stateOutput"
            autoComplete="off"
            aria-describedby="graph-symbol-help"
            value={output}
            onChange={(event) => setOutput(event.target.value)}
            disabled={busy}
          />
        </label>
        <button id="graph-save-state" type="submit" className="graph-button" disabled={busy}>
          Save state
        </button>
      </form>
      <div className="graph-inspector-actions">
        <button
          id="graph-set-start"
          type="button"
          className="graph-button"
          disabled={busy || start === state.id}
          onClick={() => {
            void submitEdit({ type: 'setStart', id: state.id }, 'Start state updated.');
          }}
        >
          {start === state.id ? 'Start state' : 'Set as start'}
        </button>
        <button
          id="graph-delete-state"
          type="button"
          className="graph-button graph-danger"
          disabled={busy}
          onClick={onDelete}
        >
          Delete state
        </button>
      </div>
      <p className="graph-small-note">
        Deleting a state also removes its arrows. Undo restores them.
      </p>
    </section>
  );
}

interface TransitionInspectorProps {
  draft: GraphDraft;
  editor: TransitionEditor;
  busy: boolean;
  onSave(value: TransitionEditor): Promise<void>;
  onDelete(): void;
}

export function TransitionInspector({
  draft,
  editor,
  busy,
  onSave,
  onDelete,
}: TransitionInspectorProps) {
  const [value, setValue] = useState(editor);
  const change = (key: 'from' | 'to' | 'input' | 'output', text: string) =>
    setValue((current) => ({ ...current, [key]: text }));
  const save = async (event: FormEvent) => {
    event.preventDefault();
    await onSave({ ...value, ...(editor.id ? { id: editor.id } : {}) });
  };
  return (
    <section id="graph-transition-panel" className="graph-inspector-section">
      <span className="graph-eyebrow">Transition</span>
      <h2 id="graph-transition-title">{editor.id ? 'Edit transition' : 'Add transition'}</h2>
      <form
        id="graph-transition-form"
        className="graph-form"
        onSubmit={(event) => {
          void save(event);
        }}
      >
        <div className="graph-form-pair">
          <label htmlFor="graph-from">
            From
            <select
              id="graph-from"
              required
              value={value.from}
              onChange={(event) => change('from', event.target.value)}
              disabled={busy}
            >
              {draft.states.map((state) => (
                <option key={state.id} value={state.id}>
                  {state.name}
                </option>
              ))}
            </select>
          </label>
          <label htmlFor="graph-to">
            To
            <select
              id="graph-to"
              required
              value={value.to}
              onChange={(event) => change('to', event.target.value)}
              disabled={busy}
            >
              {draft.states.map((state) => (
                <option key={state.id} value={state.id}>
                  {state.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label htmlFor="graph-input">
          Input symbol
          <input
            id="graph-input"
            autoComplete="off"
            list="graph-symbol-options"
            placeholder="0, 00, coin"
            required
            aria-describedby="graph-symbol-help"
            value={value.input}
            onChange={(event) => change('input', event.target.value)}
            disabled={busy}
            autoFocus
          />
          <datalist id="graph-symbol-options">
            {draft.alphabet.map((symbol) => (
              <option key={symbol} value={symbol} />
            ))}
          </datalist>
        </label>
        <label id="graph-output-row" htmlFor="graph-output" hidden={draft.kind !== 'mealy'}>
          Output symbol
          <input
            id="graph-output"
            autoComplete="off"
            required={draft.kind === 'mealy'}
            aria-describedby="graph-symbol-help"
            value={value.output}
            onChange={(event) => change('output', event.target.value)}
            disabled={busy}
          />
        </label>
        <p className="graph-small-note">
          A new input symbol joins the alphabet. One arrow per state and input keeps the machine
          deterministic.
        </p>
        <div className="graph-inspector-actions">
          <button id="graph-save-transition" type="submit" className="graph-button" disabled={busy}>
            Save transition
          </button>
          <button
            id="graph-delete-transition"
            type="button"
            className="graph-button graph-danger"
            hidden={!editor.id}
            disabled={busy}
            onClick={onDelete}
          >
            Delete
          </button>
        </div>
      </form>
    </section>
  );
}

export function EmptyInspector() {
  return (
    <section id="graph-inspector-empty" className="graph-inspector-section graph-help">
      <span className="graph-eyebrow">Inspector</span>
      <h2>Make a connection</h2>
      <p>Select a state to rename it, choose the start state or change its output.</p>
      <p>
        Drag a state's + handle to another state to draw an arrow. You can also click +, then click
        a target. Choose the source again for a self-loop.
      </p>
      <p>
        Arrows use the drawing input and output above. Auto picks the next unused input for each
        source.
      </p>
      <p>Click an arrow label to edit its input and output.</p>
    </section>
  );
}

interface AlphabetInspectorProps {
  draft: GraphDraft;
  busy: boolean;
  submitEdit: SubmitEdit;
}
export function AlphabetInspector({ draft, busy, submitEdit }: AlphabetInspectorProps) {
  const [text, setText] = useState(draft.alphabet.join(' '));
  const [fillOutput, setFillOutput] = useState('0');
  const save = async (event: FormEvent) => {
    event.preventDefault();
    await submitEdit({ type: 'setAlphabetText', text }, 'Input alphabet updated.');
  };
  return (
    <section className="graph-inspector-section graph-alphabet-section">
      <span className="graph-eyebrow">Machine</span>
      <h2>Input alphabet</h2>
      <form
        id="graph-alphabet-form"
        className="graph-form"
        onSubmit={(event) => {
          void save(event);
        }}
      >
        <label htmlFor="graph-alphabet" className="sr-only">
          Input alphabet, symbols separated by spaces or a JSON array
        </label>
        <input
          id="graph-alphabet"
          autoComplete="off"
          placeholder="0 1 or 00 01 10 11"
          aria-describedby="graph-alphabet-help"
          value={text}
          onChange={(event) => setText(event.target.value)}
          disabled={busy}
        />
        <p id="graph-alphabet-help" className="graph-small-note">
          Separate symbols with spaces, or enter a JSON array. Use 00 01 10 11 for two binary
          variables, or words such as coin push for events. Removing a symbol also removes its
          arrows.
        </p>
        <button id="graph-apply-alphabet" type="submit" className="graph-button" disabled={busy}>
          Apply alphabet
        </button>
      </form>
      <div className="graph-fill">
        <label
          id="graph-fill-output-row"
          htmlFor="graph-fill-output"
          hidden={draft.kind !== 'mealy'}
        >
          Default output
          <input
            id="graph-fill-output"
            value={fillOutput}
            onChange={(event) => setFillOutput(event.target.value)}
            autoComplete="off"
            aria-describedby="graph-symbol-help"
            disabled={busy}
          />
        </label>
        <button
          id="graph-fill-missing"
          type="button"
          className="graph-button"
          disabled={busy || !draft.states.length || !draft.alphabet.length}
          onClick={() => {
            void submitEdit(
              { type: 'fillMissing', output: fillOutput },
              'Missing transitions filled with self-loops.',
            );
          }}
        >
          Fill missing self-loops
        </button>
      </div>
      <p id="graph-symbol-help" className="graph-small-note">
        Each input or output is one token: 0, 00, coin, emoji or any word without spaces or #. When
        inputs have multiple characters, separate input tokens with spaces.
      </p>
    </section>
  );
}

export function transitionEditor(edge: GraphTransition): TransitionEditor {
  return { id: edge.id, from: edge.from, to: edge.to, input: edge.input, output: edge.output };
}
