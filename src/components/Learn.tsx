/** Mirrors the global key handler in App.tsx. */
const shortcuts = [
  ['Space', 'Play or pause'],
  ['←', 'Step back'],
  ['→', 'Step forward'],
  ['R', 'Reset'],
  ['B', 'Replay build'],
  ['E', 'Editor'],
  ['F', 'Focus'],
  ['Q', 'Cycle quality'],
  ['?', 'Learn'],
  ['Esc', 'Close panel'],
] as const;

export function Learn({ onPreset }: { onPreset: (id: string) => void }) {
  return (
    <section id="view-learn" className="view sheet learn-view" aria-label="Learn">
      <header className="view-heading">
        <div>
          <h1>Same input. Different thinking.</h1>
          <p>Two ways to turn a sequence of inputs into a sequence of outputs.</p>
        </div>
      </header>
      <div className="learn-comparison">
        <article className="card">
          <h2>Mealy: the transition writes</h2>
          <svg
            className="learn-diagram"
            viewBox="0 0 400 140"
            role="img"
            aria-label="State A transitions to state B on input 1 and writes 0"
          >
            <circle cx="65" cy="75" r="33" />
            <circle cx="335" cy="75" r="33" />
            <path d="M100 75h200m-10-6 10 6-10 6" />
            <text x="65" y="82">
              A
            </text>
            <text x="335" y="82">
              B
            </text>
            <text className="signal-label" x="200" y="57">
              1 / 0
            </text>
          </svg>
          <p>
            The output depends on the current state <em>and</em> the input. It is written on the
            arrow.
          </p>
          <div className="formula">output = λ(state, input)</div>
          <p className="learn-detail">Read n symbols, write n symbols.</p>
          <button
            data-preset="mealy-11-detector"
            className="secondary-button"
            onClick={() => onPreset('mealy-11-detector')}
          >
            Try a Mealy machine
          </button>
        </article>
        <article className="card">
          <h2>Moore: the state writes</h2>
          <svg
            className="learn-diagram"
            viewBox="0 0 400 140"
            role="img"
            aria-label="State A with output 0 transitions to state B with output 1 on input 1"
          >
            <circle cx="65" cy="75" r="36" />
            <circle cx="335" cy="75" r="36" />
            <path d="M103 75h194m-10-6 10 6-10 6M31 75h68M301 75h68" />
            <text x="65" y="64">
              A
            </text>
            <text x="335" y="64">
              B
            </text>
            <text className="signal-label" x="65" y="99">
              0
            </text>
            <text className="signal-label" x="335" y="99">
              1
            </text>
            <text x="200" y="57">
              1
            </text>
          </svg>
          <p>The output depends only on the current state. It is written inside the circle.</p>
          <div className="formula">output = λ(state)</div>
          <p className="learn-detail">Read n symbols, write n + 1 with the initial output.</p>
          <button
            data-preset="moore-11-detector"
            className="secondary-button"
            onClick={() => onPreset('moore-11-detector')}
          >
            Try a Moore machine
          </button>
        </article>
      </div>
      <div className="learn-bottom card">
        <h3>A few useful details</h3>
        <p>
          The entry arrow marks the start state. These machines transform signals, so they have no
          accepting states. When the input ends, the run is complete. In Settings, you can omit the
          initial Moore output to match your course convention.
        </p>
        <div className="keyboard-help">
          {shortcuts.map(([key, label]) => (
            <span key={key}>
              <kbd className="kbd-chip">{key}</kbd> {label}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}
