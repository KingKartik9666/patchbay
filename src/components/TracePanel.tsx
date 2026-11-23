import { useEffect } from 'react';
import type { Playback, PlaybackState } from '../playback/playback';
import { field } from '../rendering/field';
import { Icon } from './Icon';
import { outputTokens, Transport } from './Bench';
export function traceText(player: Playback, input: string, kind: string): string {
  return [
    `Patchbay — ${kind} machine`,
    `Input: ${input}`,
    `Output: ${player.trace.output}`,
    player.trace.initialOut !== undefined ? `Initial output: ${player.trace.initialOut}` : '',
    'Step\tState\tInput\tNext\tOutput',
    ...player.trace.steps.map(
      (step) => `${step.i + 1}\t${step.from}\t${step.sym}\t${step.to}\t${step.out}`,
    ),
  ]
    .filter(Boolean)
    .join('\n');
}
export function TracePanel({
  player,
  playback,
  start,
  reduced,
  invalid,
  onCopy,
}: {
  player: Playback;
  playback: PlaybackState;
  start: string;
  reduced: boolean;
  invalid: boolean;
  onCopy: () => void;
}) {
  const total = player.trace.steps.length,
    begin = Math.max(0, Math.min(Math.max(0, total - 200), playback.cursor - 80));
  const active = playback.cursor ? player.trace.steps[playback.cursor - 1].to : start;
  const next = player.trace.steps[playback.cursor];
  const output = outputTokens(player, playback.cursor).join(player.trace.outputSeparator);
  // Closing the drawer under the pointer never sends pointerleave.
  useEffect(() => () => field.setHoverState(null), []);
  return (
    <section id="panel-trace" className="drawer-panel">
      <div className="trace-counter">
        <strong id="step-counter">{playback.cursor}</strong>
        <span>
          of <b id="total-counter">{total}</b> steps read
        </span>
        <button id="copy" className="icon-button" aria-label="Copy full trace" onClick={onCopy}>
          <Icon name="copy" />
        </button>
      </div>
      <div className="trace-summary">
        <div>
          <span>Current state</span>
          <strong id="current-state">{active}</strong>
        </div>
        <div>
          <span>Output so far</span>
          <strong id="summary-output">{output || '—'}</strong>
        </div>
      </div>
      <div className="trace-next" aria-live="polite" aria-atomic="true">
        <span>
          {invalid
            ? 'Check the input'
            : next
              ? 'Next transition'
              : total
                ? 'Run complete'
                : 'Ready to run'}
        </span>
        <strong>{next ? `${next.from} → ${next.to}` : active}</strong>
        <p>
          {next
            ? `Read ${next.sym} · write ${next.out}`
            : total
              ? 'All input symbols have been read.'
              : 'Load input on the Bench to begin.'}
        </p>
      </div>
      <label className="trace-progress" htmlFor="trace-progress">
        Explore steps
        <input
          id="trace-progress"
          type="range"
          min="0"
          max={total}
          value={playback.cursor}
          disabled={invalid || !total}
          onChange={(event) => player.seek(Number(event.target.value))}
        />
      </label>
      <Transport player={player} playback={playback} reduced={reduced} invalid={invalid} trace />
      <p className="drawer-hint">Click a step to return to that moment.</p>
      <div className="trace-table-wrap">
        <table>
          <thead>
            <tr>
              <th>Step</th>
              <th>State</th>
              <th>In</th>
              <th>Next</th>
              <th>Out</th>
            </tr>
          </thead>
          <tbody id="trace-body">
            {player.trace.steps.slice(begin, begin + 200).map((step) => (
              <tr
                key={step.i}
                className={step.i < playback.cursor ? 'read' : ''}
                aria-current={step.i === playback.cursor - 1 ? 'step' : undefined}
                onPointerEnter={() => field.setHoverState(step.to)}
                onPointerLeave={() => field.setHoverState(null)}
              >
                <td>
                  <button
                    className="trace-seek"
                    aria-label={`Seek to step ${step.i + 1}`}
                    disabled={invalid}
                    onClick={() => player.seek(step.i + 1)}
                  >
                    {step.i + 1}
                  </button>
                </td>
                <td>{step.from}</td>
                <td>{step.sym}</td>
                <td>{step.to}</td>
                <td>{step.out}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p id="trace-empty" hidden={total > 0}>
          Load an input string to begin.
        </p>
      </div>
      <p id="trace-window">
        {total > 200
          ? `Showing steps ${begin + 1}–${Math.min(total, begin + 200)} of ${total}. Scrub to explore the full trace.`
          : ''}
      </p>
    </section>
  );
}
