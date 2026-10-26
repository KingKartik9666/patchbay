import type { Preset } from '../domain/contracts';
import { Icon } from './Icon';
export function Library({
  presets,
  onPreset,
  onEdit,
}: {
  presets: Preset[];
  onPreset: (id: string) => void;
  onEdit: () => void;
}) {
  return (
    <section id="view-machines" className="view sheet library" aria-label="Machines">
      <header className="view-heading">
        <div>
          <h1>A machine for every idea.</h1>
          <p>Binary, multiple variables, decimal digits and named events.</p>
        </div>
        <span className="library-count">{String(presets.length).padStart(2, '0')}</span>
      </header>
      <div className="machine-list">
        {presets.map((preset, index) => (
          <button
            key={preset.id}
            className="preset-row"
            data-preset={preset.id}
            onClick={() => onPreset(preset.id)}
          >
            <span className="preset-number">{String(index + 1).padStart(2, '0')}</span>
            <span className="preset-info">
              <strong>{preset.name}</strong>
              <span>{preset.description}</span>
            </span>
            <span className="preset-example">
              <small>
                {preset.category} · Try {preset.input}
              </small>
              <span>{preset.expected}</span>
            </span>
            <span className="kind-badge">{preset.kind === 'mealy' ? 'Mealy' : 'Moore'}</span>
            <Icon name="play" />
          </button>
        ))}
      </div>
      <div className="library-footer">
        <p>Have a machine of your own?</p>
        <button id="library-edit" className="secondary-button" onClick={onEdit}>
          <Icon name="editor" />
          Draw a machine
        </button>
      </div>
    </section>
  );
}
