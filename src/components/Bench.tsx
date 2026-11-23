import { useLayoutEffect, useRef, useState } from 'react';
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
const TAPE_WINDOW = 18,
  TAPE_OVERFLOW = 2;
function Tape({
  symbols,
  cursor,
  output = false,
  complete = false,
}: {
  symbols: string[];
  cursor: number;
  output?: boolean;
  /** The output tape of a finished run; CSS plays one finite light sweep. */
  complete?: boolean;
}) {
  const start = Math.max(0, Math.min(Math.max(0, symbols.length - TAPE_WINDOW), cursor - 6)),
    end = start + TAPE_WINDOW;
  // Up to two symbols past each end of the readable window sit under frosted
  // stubs, so the strip visibly continues while only the window is legible.
  const leading = symbols.slice(Math.max(0, start - TAPE_OVERFLOW), start),
    trailing = symbols.slice(end, end + TAPE_OVERFLOW);
  const windowRef = useRef<HTMLDivElement>(null);
  // Narrow windows show fewer than 18 cells, so keep the current cell and one
  // cell of lookahead inside the clipped window instead of past its edge.
  useLayoutEffect(() => {
    const view = windowRef.current;
    if (!view) return;
    const follow = () => {
      const current = view.querySelector<HTMLElement>('.tape-cell.current');
      if (!current) {
        view.scrollLeft = 0;
        return;
      }
      const box = view.getBoundingClientRect(),
        cell = current.getBoundingClientRect();
      const left = cell.left - box.left + view.scrollLeft,
        width = cell.width;
      if (left + 2 * width > view.scrollLeft + view.clientWidth)
        view.scrollLeft = left + 2 * width - view.clientWidth;
      else if (left - width < view.scrollLeft) view.scrollLeft = Math.max(0, left - width);
    };
    follow();
    if (typeof ResizeObserver !== 'function') return;
    const observer = new ResizeObserver(follow);
    observer.observe(view);
    return () => observer.disconnect();
  }, [symbols, cursor, output]);
  return (
    <div ref={windowRef} className="tape-window">
      <div
        className={`tape ${output ? 'output-tape' : ''}`}
        data-complete={output && complete ? '' : undefined}
      >
        {leading.length > 0 && (
          <span className="tape-overflow leading" aria-hidden="true">
            {leading.map((symbol, index) => (
              <span key={start - leading.length + index} className="tape-cell">
                {symbol}
              </span>
            ))}
          </span>
        )}
        {symbols.slice(start, end).map((symbol, index) => (
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
        {trailing.length > 0 && (
          <span className="tape-overflow trailing" aria-hidden="true">
            {trailing.map((symbol, index) => (
              <span key={end + index} className="tape-cell">
                {symbol}
              </span>
            ))}
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
        data-playing={playback.playing ? '' : undefined}
        disabled={invalid || !player.trace.steps.length}
        onClick={() => player.toggle()}
      >
        <Icon name={playback.playing ? 'pause' : 'play'} />
        <span>{playback.playing ? 'Pause' : 'Play'}</span>
        {!trace && <kbd className="kbd-chip">Space</kbd>}
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
  const total = player.trace.steps.length,
    complete = total > 0 && playback.cursor === total && !playback.playing;
  return (
    <section id="view-bench" className="view" aria-label="Bench">
      <section id="sheet" className="sheet">
        <header className="sheet-header">
          <div className="machine-heading">
            <h1 id="machine-title">{preset?.name ?? 'Custom machine'}</h1>
            <p id="machine-description">
              {preset?.description ?? 'Your states. Your inputs. Your logic.'}
            </p>
          </div>
          <div className="sheet-actions">
            <div className="kind-switch" data-kind={kind} role="group" aria-label="Machine type">
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
              <kbd className="kbd-chip">B</kbd>
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
        <div className="patch-panel">
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
        </div>
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
            Current state <b id="active-state">{active}</b>
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
      <section id="dock" className="dock" aria-label="Input, output and playback">
        <div className="dock-top">
          <InputForm
            key={state.input}
            input={state.input}
            onLoad={(value) => {
              void workbench.loadInput(value);
            }}
          />
          <span id="output-explanation">
            {kind === 'mealy'
              ? 'Mealy outputs belong to transitions.'
              : 'Moore outputs belong to states.'}{' '}
            <span id="tape-note">
              {player.trace.initialOut === undefined
                ? 'One output per input.'
                : 'One output per input, plus the initial output.'}
            </span>
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
              <small id="input-count">
                {evaluation.inputSymbols.length}{' '}
                {evaluation.inputSymbols.length === 1 ? 'symbol' : 'symbols'}
              </small>
            </div>
            <Tape symbols={evaluation.inputSymbols} cursor={playback.cursor} />
          </div>
          <div className="tape-row">
            <div className="tape-label">
              <span>Output</span>
              <small id="output-count">{output.length} written</small>
            </div>
            <Tape symbols={output} cursor={output.length} output complete={complete} />
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
                    : complete
                      ? 'Run complete'
                      : total
                        ? 'Ready when you are'
                        : 'Load an input to run'}
              </span>
              <span id="progress-label">
                {playback.cursor} / {total}
              </span>
            </label>
            <input
              id="progress"
              type="range"
              min={0}
              max={total}
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
    </section>
  );
}
