import type { Workbench } from '../app/use-workbench';
import { Icon } from './Icon';
export function TextPanel({ workbench }: { workbench: Workbench }) {
  const { state } = workbench;
  return (
    <section id="panel-editor" className="drawer-panel">
      <div className="editor-toolbar">
        <button
          id="open-file"
          className="secondary-button"
          onClick={() => {
            void workbench.openProject();
          }}
        >
          <Icon name="open" />
          Open
        </button>
        <button
          id="save-file"
          className="secondary-button"
          onClick={() => {
            void workbench.saveText();
          }}
        >
          <Icon name="save" />
          Save
        </button>
        <span id="editor-file">{state.fileName}</span>
      </div>
      <label htmlFor="source" className="editor-label">
        Machine definition <span>Live preview</span>
      </label>
      <textarea
        id="source"
        spellCheck={false}
        autoCapitalize="off"
        maxLength={1000000}
        value={state.manualDraft ?? state.evaluation?.source ?? ''}
        onChange={(event) => workbench.editText(event.target.value)}
      />
      <p className="drawer-hint">
        Declare inputs with <code>alphabet 00 01 10 11</code> or <code>alphabet coin push</code>.
        Use space-separated input tokens in the Bench. Every state needs one transition per input.
      </p>
      <div className="syntax-help">
        <strong>Mealy</strong>
        <code>from input to output</code>
        <strong>Moore</strong>
        <code>
          out state output
          <br />
          from input to
        </code>
      </div>
      <div id="editor-errors" role="alert" tabIndex={-1}>
        {state.manualErrors.slice(0, 30).map((error, index) => (
          <p key={index}>
            <strong>Line {error.line}:</strong> {error.msg}
          </p>
        ))}
      </div>
      <p id="editor-valid" className="validation-note">
        {state.manualDirty
          ? 'Checking definition…'
          : state.manualErrors.length
            ? 'The diagram keeps your last valid machine.'
            : 'Valid machine. Preview updated.'}
      </p>
      <button
        id="apply"
        className="primary-button wide-button"
        onClick={() => {
          void workbench.validateText(true);
        }}
      >
        Apply machine
      </button>
    </section>
  );
}
