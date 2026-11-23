import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { GraphEdit, GraphTransition, MachineKind } from '../domain/contracts';
import type { GraphEditorProps } from './contracts';
import { GraphCanvas, type GraphTool } from './GraphCanvas';
import {
  AlphabetInspector,
  EmptyInspector,
  StateInspector,
  TransitionInspector,
  transitionEditor,
  type TransitionEditor,
} from './GraphInspector';
import type { Point } from './geometry';
import { statePlacement } from './viewport';
import './editor.css';

type Selection =
  | { type: 'state'; id: string }
  | { type: 'addedState'; previousIds: ReadonlySet<string> }
  | {
      type: 'transition';
      editor: TransitionEditor;
      revision: number;
      previousIds?: ReadonlySet<string>;
    }
  | null;

function errorMessages(error: unknown): string[] {
  if (error && typeof error === 'object' && 'message' in error) {
    const message = String(error.message);
    const details =
      'details' in error && Array.isArray(error.details)
        ? error.details.filter((detail): detail is string => typeof detail === 'string')
        : [];
    return [message, ...details];
  }
  return [String(error)];
}

/** The validated draft and command history belong to App; this component owns presentation. */
export function GraphEditor(props: GraphEditorProps) {
  const {
    result,
    clock,
    busy,
    canUndo,
    canRedo,
    onEdit,
    onNew,
    onUndo,
    onRedo,
    onRun,
    onText,
    onOpen,
    onSave,
    onMessage,
  } = props;
  const draft = result.draft;
  const rootRef = useRef<HTMLDivElement>(null),
    errorRef = useRef<HTMLDivElement>(null);
  const viewCenterRef = useRef<Point>({ x: 200, y: 130 });
  const pendingRef = useRef(false),
    mountedRef = useRef(false),
    selectionRevision = useRef(0);
  const [selection, setSelection] = useState<Selection>(null);
  const [tool, setTool] = useState<GraphTool>('select');
  const [drawingInput, setDrawingInput] = useState('');
  const [drawingOutput, setDrawingOutput] = useState('0');
  const [resetToken, setResetToken] = useState(0);
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState('Draw your machine. Changes stay in your draft until Run.');
  const [showErrors, setShowErrors] = useState(false);
  const [commandErrors, setCommandErrors] = useState<string[]>([]);
  const disabled = busy || pending;
  const selectedState =
    selection?.type === 'state'
      ? draft.states.find((state) => state.id === selection.id)
      : selection?.type === 'addedState'
        ? draft.states.find((state) => !selection.previousIds.has(state.id))
        : undefined;
  const selectedEditor =
    selection?.type === 'transition'
      ? (() => {
          const added = selection.previousIds
            ? draft.transitions.find((edge) => !selection.previousIds?.has(edge.id))
            : undefined;
          const edge =
            added ||
            (selection.editor.id
              ? draft.transitions.find((item) => item.id === selection.editor.id)
              : undefined);
          if (edge) return transitionEditor(edge);
          if (
            selection.editor.id ||
            !draft.states.some((state) => state.id === selection.editor.from) ||
            !draft.states.some((state) => state.id === selection.editor.to)
          )
            return null;
          return selection.editor;
        })()
      : null;
  const errors = showErrors ? (commandErrors.length ? commandErrors : result.errors) : [];

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  useLayoutEffect(() => {
    if (showErrors && errors.length) errorRef.current?.focus();
  }, [showErrors, errors.length]);
  function announce(message: string) {
    setStatus(message);
    onMessage(message);
  }
  async function perform(command: () => Promise<void>, message: string): Promise<boolean> {
    if (busy || pendingRef.current) return false;
    pendingRef.current = true;
    setPending(true);
    setCommandErrors([]);
    setShowErrors(false);
    try {
      await command();
      if (mountedRef.current) announce(message);
      return true;
    } catch (error) {
      if (mountedRef.current) {
        setCommandErrors(errorMessages(error));
        setShowErrors(true);
        setStatus('This edit could not be applied. Review the error below.');
      }
      return false;
    } finally {
      pendingRef.current = false;
      if (mountedRef.current) setPending(false);
    }
  }
  async function submitEdit(edit: GraphEdit, message: string): Promise<boolean> {
    return perform(() => onEdit(edit), message);
  }
  function resetInteraction() {
    setResetToken((token) => token + 1);
  }
  function selectState(id: string) {
    setSelection({ type: 'state', id });
  }
  function nextDrawingInput(source: string) {
    const symbols = draft.alphabet.length ? draft.alphabet : ['0'];
    const used = new Set(
      draft.transitions.filter((edge) => edge.from === source).map((edge) => edge.input),
    );
    return symbols.find((symbol) => !used.has(symbol)) || '';
  }
  function openTransition(from?: string, to?: string, existing?: GraphTransition) {
    if (!draft.states.length) {
      announce(
        'Add a state before adding a transition. A self-loop uses the same state for From and To.',
      );
      return;
    }
    const source = from || selectedState?.id || draft.states[0].id;
    setSelection({
      type: 'transition',
      revision: ++selectionRevision.current,
      editor: existing
        ? transitionEditor(existing)
        : {
            from: source,
            to: to || source,
            input: nextDrawingInput(source),
            output: drawingOutput,
          },
    });
    resetInteraction();
  }
  async function drawTransition(from: string, to: string) {
    if (disabled || pendingRef.current) return;
    const input = draft.alphabet.includes(drawingInput) ? drawingInput : nextDrawingInput(from);
    if (!input) {
      openTransition(from, to);
      announce('This state has an arrow for every input. Enter a new input symbol to add another.');
      return;
    }
    const existing = draft.transitions.find((edge) => edge.from === from && edge.input === input);
    if (existing) {
      openTransition(existing.from, existing.to, existing);
      announce(
        `This state already has an arrow for ${input}. Edit that arrow or choose another input.`,
      );
      return;
    }
    setSelection(null);
    resetInteraction();
    await submitEdit(
      { type: 'upsertTransition', from, to, input, output: drawingOutput },
      `Arrow drawn: ${input}${draft.kind === 'mealy' ? ` / ${drawingOutput}` : ''}. Draw from a state handle to continue.`,
    );
  }
  async function addState(point: Point) {
    if (disabled) return;
    const placement = statePlacement(draft, point);
    setSelection({
      type: 'addedState',
      previousIds: new Set(draft.states.map((state) => state.id)),
    });
    setTool('select');
    resetInteraction();
    await submitEdit(
      { type: 'addState', ...placement },
      'State added. Rename it in the inspector.',
    );
  }
  async function saveTransition(value: TransitionEditor) {
    if (selection?.type !== 'transition' || disabled) return;
    const originalSelection = selection;
    setSelection({
      type: 'transition',
      editor: value,
      revision: originalSelection.revision,
      ...(value.id ? {} : { previousIds: new Set(draft.transitions.map((edge) => edge.id)) }),
    });
    if (
      (await submitEdit({ type: 'upsertTransition', ...value }, 'Transition saved.')) &&
      draft.kind === 'mealy'
    )
      setDrawingOutput(value.output);
  }
  async function deleteSelected() {
    if (disabled) return;
    const edit: GraphEdit | undefined = selectedState
      ? { type: 'removeState', id: selectedState.id }
      : selectedEditor?.id
        ? { type: 'removeTransition', id: selectedEditor.id }
        : undefined;
    if (!edit) return;
    resetInteraction();
    if (
      await submitEdit(
        edit,
        selectedState ? 'State and incident transitions deleted.' : 'Transition deleted.',
      )
    )
      setSelection(null);
  }
  function history(redo: boolean) {
    if (disabled || (redo ? !canRedo : !canUndo)) return;
    resetInteraction();
    setCommandErrors([]);
    setShowErrors(false);
    if (redo) onRedo();
    else onUndo();
    announce(redo ? 'Edit restored.' : 'Edit undone.');
  }
  function run() {
    if (disabled) return;
    resetInteraction();
    setCommandErrors([]);
    setShowErrors(true);
    onRun();
    if (result.errors.length) errorRef.current?.focus();
  }
  const keyboardRef = useRef<(event: KeyboardEvent) => void>(() => {});
  useLayoutEffect(() => {
    keyboardRef.current = (event) => {
      const root = rootRef.current;
      if (
        !root?.getClientRects().length ||
        root.closest('[hidden]') ||
        event.defaultPrevented ||
        document.querySelector('dialog[open]')
      )
        return;
      if (event.key === 'Escape') {
        resetInteraction();
        return;
      }
      if (
        event.target instanceof Element &&
        event.target.closest(
          'input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"]',
        )
      )
        return;
      const modifier = event.ctrlKey || event.metaKey;
      if (modifier && event.key.toLowerCase() === 'z') {
        if (!disabled) {
          event.preventDefault();
          history(event.shiftKey);
        }
      } else if (modifier && event.key.toLowerCase() === 'y') {
        if (!disabled) {
          event.preventDefault();
          history(true);
        }
      } else if (
        (event.key === 'Delete' || event.key === 'Backspace') &&
        (selectedState || selectedEditor?.id) &&
        !disabled
      ) {
        event.preventDefault();
        void deleteSelected();
      }
    };
  });
  useEffect(() => {
    const listener = (event: KeyboardEvent) => keyboardRef.current(event);
    document.addEventListener('keydown', listener);
    return () => document.removeEventListener('keydown', listener);
  }, []);
  const changeTool = (value: GraphTool) => {
    setTool(value);
    resetInteraction();
  };
  const transitionKey = selectedEditor
    ? JSON.stringify([
        selection?.type === 'transition' ? selection.revision : 0,
        selectedEditor.id,
        selectedEditor.from,
        selectedEditor.to,
        selectedEditor.input,
        selectedEditor.output,
        draft.kind,
      ])
    : '';
  return (
    <div
      id="graph-editor"
      ref={rootRef}
      className={`graph-editor${clock.signals.reducedMotion ? ' graph-reduced' : ''}`}
      aria-busy={disabled}
    >
      <div className="graph-toolbar" aria-label="Graph editing tools">
        <div
          className="graph-tool-group fill-capsule graph-file-tools"
          data-group="file"
          role="group"
          aria-label="File"
        >
          <button
            id="graph-new"
            type="button"
            className="graph-button"
            disabled={disabled}
            onClick={() => {
              setSelection(null);
              resetInteraction();
              void perform(
                () => onNew(draft.kind),
                'New drawing. Add a state to begin. Undo can restore the previous drawing.',
              );
            }}
          >
            New machine
          </button>
          <button
            id="graph-open"
            type="button"
            className="graph-button"
            disabled={disabled}
            onClick={() => {
              resetInteraction();
              onOpen();
            }}
          >
            Open
          </button>
          <button
            id="graph-save"
            type="button"
            className="graph-button"
            disabled={disabled}
            onClick={onSave}
          >
            Save draft
          </button>
          <button
            id="graph-text"
            type="button"
            className="graph-button"
            disabled={disabled}
            onClick={() => {
              resetInteraction();
              onText();
            }}
          >
            Text definition
          </button>
        </div>
        <div
          className="graph-tool-group fill-capsule graph-draw-tools"
          data-group="edit"
          role="group"
          aria-label="Drawing tools"
        >
          <div
            className="graph-mode-switch"
            data-tool={tool}
            role="group"
            aria-label="Drawing mode"
          >
            <button
              id="graph-select"
              type="button"
              aria-pressed={tool === 'select'}
              title="Select and move states"
              disabled={disabled}
              onClick={() => changeTool('select')}
            >
              Select
            </button>
            <button
              id="graph-connect"
              type="button"
              aria-pressed={tool === 'connect'}
              title="Draw arrows between states"
              disabled={disabled}
              onClick={() => changeTool('connect')}
            >
              Connect
            </button>
          </div>
          <button
            id="graph-add-state"
            type="button"
            className="graph-button"
            disabled={disabled}
            onClick={() => {
              void addState(viewCenterRef.current);
            }}
          >
            Add state
          </button>
          <button
            id="graph-add-transition"
            type="button"
            className="graph-button"
            disabled={disabled}
            onClick={() => openTransition()}
          >
            Add transition
          </button>
          <label className="graph-kind-label" htmlFor="graph-kind">
            Type
            <select
              id="graph-kind"
              value={draft.kind}
              disabled={disabled}
              onChange={(event) => {
                resetInteraction();
                void submitEdit(
                  { type: 'setKind', kind: event.target.value as MachineKind },
                  `Drawing type changed to ${event.target.value === 'mealy' ? 'Mealy' : 'Moore'}.`,
                );
              }}
            >
              <option value="mealy">Mealy</option>
              <option value="moore">Moore</option>
            </select>
          </label>
        </div>
        <div
          className="graph-tool-group fill-capsule graph-history"
          data-group="history"
          role="group"
          aria-label="Edit history"
        >
          <button
            id="graph-undo"
            type="button"
            className="graph-button"
            aria-label="Undo graph edit"
            title="Undo (Ctrl+Z)"
            disabled={disabled || !canUndo}
            onClick={() => history(false)}
          >
            Undo
          </button>
          <button
            id="graph-redo"
            type="button"
            className="graph-button"
            aria-label="Redo graph edit"
            title="Redo (Ctrl+Shift+Z)"
            disabled={disabled || !canRedo}
            onClick={() => history(true)}
          >
            Redo
          </button>
        </div>
        <div className="graph-tool-group" data-group="run" role="group" aria-label="Run">
          <button
            id="graph-run"
            type="button"
            className="primary-button"
            disabled={disabled}
            onClick={run}
          >
            Run machine
          </button>
        </div>
      </div>
      <div
        className="graph-drawing-defaults"
        role="group"
        aria-label="Defaults for drawing transitions"
      >
        <span className="graph-drawing-title">New arrows</span>
        <label htmlFor="graph-draw-input">
          Input
          <select
            id="graph-draw-input"
            value={draft.alphabet.includes(drawingInput) ? drawingInput : ''}
            disabled={disabled}
            onChange={(event) => setDrawingInput(event.target.value)}
          >
            <option value="">
              {draft.alphabet.length ? 'Auto · next unused' : 'Auto · start with 0'}
            </option>
            {draft.alphabet.map((symbol) => (
              <option key={symbol} value={symbol}>
                {symbol}
              </option>
            ))}
          </select>
        </label>
        <label htmlFor="graph-draw-output" hidden={draft.kind !== 'mealy'}>
          Output
          <input
            id="graph-draw-output"
            value={drawingOutput}
            list="graph-draw-output-options"
            autoComplete="off"
            aria-describedby="graph-symbol-help"
            disabled={disabled}
            onChange={(event) => setDrawingOutput(event.target.value)}
          />
          <datalist id="graph-draw-output-options">
            {[...new Set(['0', '1', ...draft.transitions.map((edge) => edge.output)])]
              .filter(Boolean)
              .map((output) => (
                <option key={output} value={output} />
              ))}
          </datalist>
        </label>
        <span className="graph-drawing-note">
          Drag a state's + to another state, or click + then a target.
        </span>
      </div>
      <div className="graph-workspace">
        <div className="graph-canvas-panel">
          <GraphCanvas
            draft={draft}
            clock={clock}
            tool={tool}
            busy={disabled}
            resetToken={resetToken}
            selectedState={selectedState?.id || ''}
            selectedTransition={selectedEditor?.id || ''}
            onSelectState={selectState}
            onSelectTransition={(edge) => openTransition(edge.from, edge.to, edge)}
            onClearSelection={() => setSelection(null)}
            onConnect={(from, to) => {
              void drawTransition(from, to);
            }}
            onAddState={(point) => {
              void addState(point);
            }}
            onMoveState={(id, point) =>
              submitEdit({ type: 'moveState', id, ...point }, 'State moved.')
            }
            onMessage={announce}
            viewCenterRef={viewCenterRef}
          />
          <div className="graph-canvas-footer">
            <span id="graph-counts">
              {draft.states.length} {draft.states.length === 1 ? 'state' : 'states'} ·{' '}
              {draft.transitions.length}{' '}
              {draft.transitions.length === 1 ? 'transition' : 'transitions'}
            </span>
            <span id="graph-status" role="status" aria-live="polite">
              {status}
            </span>
          </div>
        </div>
        <aside className="graph-inspector" aria-label="Graph inspector">
          {selectedState ? (
            <StateInspector
              key={JSON.stringify([
                selectedState.id,
                selectedState.name,
                selectedState.output,
                draft.kind,
              ])}
              state={selectedState}
              kind={draft.kind}
              start={draft.start}
              busy={disabled}
              autoFocus={selection?.type === 'addedState'}
              submitEdit={submitEdit}
              onDelete={() => {
                void deleteSelected();
              }}
            />
          ) : selectedEditor ? (
            <TransitionInspector
              key={transitionKey}
              draft={draft}
              editor={selectedEditor}
              busy={disabled}
              onSave={saveTransition}
              onDelete={() => {
                void deleteSelected();
              }}
            />
          ) : (
            <EmptyInspector />
          )}
          <AlphabetInspector
            key={JSON.stringify([draft.alphabet, draft.kind])}
            draft={draft}
            busy={disabled}
            submitEdit={submitEdit}
          />
        </aside>
      </div>
      <div
        id="graph-errors"
        ref={errorRef}
        className="graph-errors"
        role="alert"
        tabIndex={-1}
        hidden={!errors.length}
      >
        <strong>Review this drawing</strong>
        <ul>
          {errors.map((message, index) => (
            <li key={`${index}:${message}`}>{message}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export default GraphEditor;
