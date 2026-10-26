import { useState } from 'react';
import type { Workbench } from '../app/use-workbench';
import type { FrameClock } from '../rendering/frame-clock';
import { StateDiagram } from '../rendering/StateDiagram';
import type { Playback } from '../playback/playback';
import type { PlaybackState } from '../playback/playback';
import { Icon } from './Icon';

export function outputTokens(player: Playback, cursor: number): string[] {
  return [
    ...(player.trace.initialOut === undefined ? [] : [player.trace.initialOut]),
    ...player.trace.steps.slice(0, cursor).map((step) => step.out),
  ];
}
function Tape({
  symbols,
  cursor,
  output = false,
}: {
  symbols: string[];
  cursor: number;
  output?: boolean;
}) {
  const start = Math.max(0, Math.min(Math.max(0, symbols.length - 18), cursor - 6));
  return (
    <div className="tape-window">
      <div className={`tape ${output ? 'output-tape' : ''}`}>
        {start > 0 && (
          <span className="tape-ellipsis" aria-hidden="true">
            …
          </span>
        )}
        {symbols.slice(start, start + 18).map((symbol, index) => (
          <span
            key={start + index}
            className={`tape-cell ${start + index === cursor ? 'current' : ''} ${start + index < cursor ? 'read' : ''}`}
            data-index={start + index}
          >
            {symbol}
          </span>
        ))}
        {output && cursor === symbols.length && (
          <span className="tape-cell current empty" aria-hidden="true" />
        )}
        {start + 18 < symbols.length && (
          <span className="tape-ellipsis" aria-hidden="true">
            …
          </span>
        )}
      </div>
    </div>
  );
}
export function Transport({
  player,
  playback,
  invalid = false,
  reduced = false,
  trace = false,
}: {
  player: Playback;
  playback: PlaybackState;
  invalid?: boolean;
  reduced?: boolean;
  trace?: boolean;
}) {
  const prefix = trace ? 'trace-' : '';
  return (
    <div className={trace ? 'trace-controls' : 'transport-buttons'}>
      <button
        id={`${prefix}reset`}
        className="icon-button"
        aria-label={trace ? 'Reset trace playback' : 'Reset playback'}
        disabled={invalid}
        onClick={() => player.seek(0)}
      >
        <Icon name="reset" />
      </button>
      <button
        id={`${prefix}back`}
        className="icon-button"
        aria-label={trace ? 'Previous trace step' : 'Step back'}
        disabled={invalid}
        onClick={() => player.seek(playback.cursor - 1)}
      >
        <Icon name="back" />
      </button>
      <button
        id={`${prefix}play`}
        className="play-button"
        disabled={invalid || !player.trace.steps.length}
        onClick={() => player.toggle()}
      >
        <Icon name={playback.playing ? 'pause' : 'play'} />
        <span>{playback.playing ? 'Pause' : 'Play'}</span>
        {!trace && <kbd>Space</kbd>}
      </button>
      <button
        id={`${prefix}step`}
        className="icon-button"
        aria-label={trace ? 'Next trace step' : 'Step forward'}
        disabled={invalid || playback.cursor >= player.trace.steps.length}
        onClick={() => player.step(reduced)}
      >
        <Icon name="step" />
      </button>
    </div>
  );
}
function InputForm({ input, onLoad }: { input: string; onLoad: (value: string) => void }) {
  const [draft, setDraft] = useState(input);
  return (
    <form
      id="input-form"
      onSubmit={(event) => {
        event.preventDefault();
        onLoad(draft);
      }}
    >
      <label htmlFor="input">Input string</label>
      <input
        id="input"
        aria-describedby="input-error input-format"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        placeholder="e.g. 1101"
        maxLength={4096}
        autoComplete="off"
        spellCheck={false}
      />
      <button type="submit" className="load-button">
        Load input
      </button>
    </form>
  );
}
export function Bench({
  workbench,
  clock,
  player,
  playback,
  replayKey,
  onReplay,
  onNavigate,
  reduced,
}: {
  workbench: Workbench;
  clock: FrameClock;
  player: Playback;
  playback: PlaybackState;
  replayKey: number;
  onReplay: () => void;
  onNavigate: (page: 'bench' | 'editor', panel?: 'text' | 'trace') => void;
  reduced: boolean;
}) {
  const { state } = workbench,
    evaluation = state.evaluation!,
    machine = evaluation.machine!;
  const preset = state.presets.find((item) => item.id === state.presetId),
    kind = machine.outputs.kind,
    invalid = evaluation.inputIssues.length > 0;
  const active = playback.cursor ? player.trace.steps[playback.cursor - 1].to : machine.start;
  const output = outputTokens(player, playback.cursor),
    [building, setBuilding] = useState(false);
  return (
    <section id="view-bench" className="view" aria-label="Bench">
      <section id="sheet" className="sheet">
        <header className="sheet-header">
          <div className="machine-heading">
            <span className="machine-emblem">
              <Icon name="machines" />
            </span>
            <div>
              <h1 id="machine-title">{preset?.name ?? 'Custom machine'}</h1>
              <p id="machine-description">
                {preset?.description ?? 'Your states. Your inputs. Your logic.'}
              </p>
            </div>
          </div>
          <div className="sheet-actions">
            <div className="kind-switch" aria-label="Machine type">
              <button
                id="mode-mealy"
                aria-pressed={kind === 'mealy'}
                disabled={state.busy}
                onClick={() => {
                  void workbench.convert('mealy');
                }}
              >
                Mealy
              </button>
              <button
                id="mode-moore"
                aria-pressed={kind === 'moore'}
                disabled={state.busy}
                onClick={() => {
                  void workbench.convert('moore');
                }}
              >
                Moore
              </button>
            </div>
            <button id="replay-build" className="quiet-button" onClick={onReplay}>
              <Icon name="reset" />
              <span>Replay build</span>
              <kbd>B</kbd>
            </button>
          </div>
        </header>
        <div className="diagram-toolbar">
          <span id="notation">
            {kind === 'mealy' ? (
              <>
                Transition label:{' '}
                <b>
                  input <span>/</span> output
                </b>
              </>
            ) : (
              <>
                State label:{' '}
                <b>
                  state <span>/</span> output
                </b>
              </>
            )}
          </span>
          <div className="diagram-edit-actions">
            <button
              id="text-shortcut"
              className="text-button"
              onClick={() => onNavigate('bench', 'text')}
            >
              Text
            </button>
            <button id="edit-shortcut" className="text-button" onClick={() => onNavigate('editor')}>
              <Icon name="editor" />
              Edit drawing
            </button>
          </div>
        </div>
        <StateDiagram
          machine={machine}
          clock={clock}
          cursor={playback.cursor}
          activeState={active}
          travelRef={player.travel}
          replayKey={replayKey}
          theme={state.preferences.theme}
          onBuildingChange={setBuilding}
          onInspect={(id) =>
            workbench.message(
              `State ${id}. ${machine.alphabet.map((symbol) => `On ${symbol}, go to ${machine.delta[id][symbol]}.`).join(' ')}`,
            )
          }
        />
        <footer className="diagram-footer">
          <div className="diagram-counts">
            <span>
              <b id="state-count">{machine.states.length}</b> states
            </span>
            <span>
              <b id="transition-count">{machine.states.length * machine.alphabet.length}</b>{' '}
              transitions
            </span>
            <span id="build-status" className="build-status">
              {building ? 'Building diagram' : 'Diagram ready'}
            </span>
          </div>
          <span className="active-chip">
            <i />
            Current state <b id="active-state">{active}</b>
          </span>
        </footer>
      </section>
      <section id="dock" className="dock glass" aria-label="Input, output and playback">
        <div className="dock-top">
          <InputForm
            key={state.input}
            input={state.input}
            onLoad={(value) => {
              void workbench.loadInput(value);
            }}
          />
          <span id="tape-note">
            {kind === 'mealy'
              ? 'One output for every input.'
              : 'State outputs, including the initial state.'}
          </span>
          <button
            id="trace-shortcut"
            className="text-button"
            onClick={() => onNavigate('bench', 'trace')}
          >
            <Icon name="trace" />
            View trace
          </button>
        </div>
        <p id="input-format" className="drawer-hint">
          {evaluation.tokenInput
            ? 'Separate input tokens with spaces. Each token is one transition.'
            : 'Enter symbols consecutively. Each symbol is one transition.'}
        </p>
        <div id="input-error" className="error-message" role="alert" hidden={!invalid}>
          {evaluation.inputIssues
            .slice(0, 8)
            .map((issue) => `"${issue.sym}" at ${issue.index + 1} is not in the alphabet.`)
            .join(' ')}
        </div>
        <div className="tapes">
          <div className="tape-row">
            <div className="tape-label">
              <span>Input</span>
              <small id="input-count">{evaluation.inputSymbols.length} symbols</small>
            </div>
            <Tape symbols={evaluation.inputSymbols} cursor={playback.cursor} />
          </div>
          <div className="tape-row">
            <div className="tape-label">
              <span>Output</span>
              <small id="output-count">{output.length} written</small>
            </div>
            <Tape symbols={output} cursor={output.length} output />
          </div>
        </div>
        <div className="transport">
          <Transport player={player} playback={playback} invalid={invalid} reduced={reduced} />
          <div className="scrubber">
            <label htmlFor="progress">
              <span id="playback-status">
                {invalid
                  ? 'Check the input'
                  : playback.playing
                    ? 'Following the signal'
                    : playback.cursor === player.trace.steps.length
                      ? 'Run complete'
                      : 'Ready when you are'}
              </span>
              <span id="progress-label">
                {playback.cursor} / {player.trace.steps.length}
              </span>
            </label>
            <input
              id="progress"
              type="range"
              min={0}
              max={player.trace.steps.length}
              value={playback.cursor}
              step={1}
              disabled={invalid}
              aria-label="Playback position"
              onChange={(event) => player.seek(Number(event.target.value))}
            />
          </div>
          <div className="speed-control">
            <label htmlFor="speed">Speed</label>
            <select
              id="speed"
              value={playback.speed}
              onChange={(event) => player.speed(Number(event.target.value))}
            >
              {[0.25, 0.5, 1, 2, 4].map((speed) => (
                <option key={speed} value={speed}>
                  {speed}×
                </option>
              ))}
            </select>
          </div>
        </div>
      </section>
      <footer className="bench-footer">
        <span id="output-explanation">
          {kind === 'mealy'
            ? 'Mealy outputs belong to transitions.'
            : 'Moore outputs belong to states.'}
        </span>
        <button
          id="convert"
          className="text-button"
          disabled={state.busy}
          onClick={() => {
            void workbench.convert();
          }}
        >
          <Icon name="convert" />
          <span>Convert to {kind === 'mealy' ? 'Moore' : 'Mealy'}</span>
        </button>
      </footer>
    </section>
  );
}
