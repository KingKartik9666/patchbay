import { useEffect, useState } from 'react';
import type { Preferences } from '../domain/contracts';
import type { FrameStats } from '../rendering/frame-clock';
import type { FrameClock } from '../rendering/frame-clock';

import { Icon } from './Icon';
type BooleanPreference = 'motionBlur' | 'reducedMotion' | 'highContrast' | 'mooreInitial';
export function SettingsPanel({
  preferences,
  onChange,
  onTheme,
  onScreenshot,
  clock,
  errors,
}: {
  preferences: Preferences;
  onChange: (value: Partial<Preferences>) => void;
  onTheme: () => void;
  onScreenshot: () => void;
  clock: FrameClock;
  errors: number;
}) {
  const [stats, setStats] = useState<FrameStats>({ p50: 0, p95: 0, longFrames: 0, subscribers: 0 });
  useEffect(() => clock.onStats(setStats), [clock]);
  const toggle = (id: string, key: BooleanPreference, label: string, hint: string) => (
    <label className="setting-row">
      <span>
        <strong>{label}</strong>
        <small>{hint}</small>
      </span>
      <input
        id={id}
        type="checkbox"
        checked={preferences[key]}
        role="switch"
        onChange={(event) => onChange({ [key]: event.target.checked })}
      />
    </label>
  );
  return (
    <section id="panel-settings" className="drawer-panel">
      <h3>Display</h3>
      <button
        id="theme-setting"
        className="secondary-button wide-button"
        aria-pressed={preferences.theme === 'dark'}
        aria-label={`Switch to ${preferences.theme === 'dark' ? 'light' : 'dark'} theme`}
        onClick={onTheme}
      >
        <Icon name="theme" />
        <span id="theme-label">{preferences.theme === 'dark' ? 'Light' : 'Dark'} theme</span>
      </button>
      {toggle(
        'motion-blur',
        'motionBlur',
        'Motion blur',
        'Soft edges during movement, crisp text at rest.',
      )}

      {toggle(
        'reduced-motion',
        'reducedMotion',
        'Reduced motion',
        'Keep the signal, skip the travel.',
      )}
      {toggle(
        'high-contrast',
        'highContrast',
        'High contrast',
        'Solid surfaces and clearer borders.',
      )}
      <label className="setting-row">
        <span>
          <strong>Diagram quality</strong>
          <small>Choose the resolution of the diagram canvas.</small>
        </span>
        <select
          id="quality"
          value={preferences.quality}
          onChange={(event) => onChange({ quality: event.target.value as Preferences['quality'] })}
        >
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
      </label>
      <h3>Simulation</h3>
      {toggle(
        'moore-initial',
        'mooreInitial',
        'Initial Moore output',
        'Print before reading the first input.',
      )}
      <button id="screenshot" className="secondary-button wide-button" onClick={onScreenshot}>
        <Icon name="camera" />
        Save screenshot
      </button>
      <h3>Local diagnostics</h3>
      <dl id="diagnostics">
        <dt>Display refresh</dt>
        <dd id="metric-hz">{stats.p50 ? `${Math.round(1000 / stats.p50)} Hz` : 'Detecting'}</dd>
        <dt>Frame p50 / p95</dt>
        <dd id="metric-frame">
          {stats.p50.toFixed(1)} / {stats.p95.toFixed(1)} ms
        </dd>
        <dt>Long animation frames</dt>
        <dd id="metric-long">{stats.longFrames}</dd>
        <dt>Renderer errors</dt>
        <dd id="metric-errors">{errors}</dd>
      </dl>
      <p className="drawer-hint">
        Diagnostics stay on this device. Frame readings describe this session, not a hardware
        guarantee.
      </p>
    </section>
  );
}
