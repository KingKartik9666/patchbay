import { useEffect, useState } from 'react';
import type { Backdrop, Preferences } from '../domain/contracts';
import { field, type FieldStatus } from '../rendering/field';
import type { FrameClock, FrameStats } from '../rendering/frame-clock';
import { Icon } from './Icon';
import { ThemeGlyph } from './ThemeGlyph';

const backgroundLabel = (status: FieldStatus) =>
  `${status.mode} · ${Number(status.scale.toFixed(2))}× · ${status.fps} fps`;
type BooleanPreference = 'reducedMotion' | 'highContrast' | 'launchAnimation' | 'mooreInitial';
export function SettingsPanel({
  preferences,
  backdrop,
  onChange,
  onTheme,
  themeIntent = preferences.theme,
  onScreenshot,
  clock,
  errors,
}: {
  preferences: Preferences;
  backdrop: Backdrop;
  onChange: (value: Partial<Preferences>) => void;
  onTheme: (origin?: HTMLElement) => void;
  themeIntent?: Preferences['theme'];
  onScreenshot: () => void;
  clock: FrameClock;
  errors: number;
}) {
  const [stats, setStats] = useState<FrameStats>(() => clock.stats());
  useEffect(() => clock.onStats(setStats), [clock]);
  const [background, setBackground] = useState(() => field.status());
  useEffect(() => field.onStatus(setBackground), []);
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
  const materialAvailable = backdrop.kind === 'mica';
  // The OS's figure for this monitor; the measured vsync until it arrives.
  const nativeHz = stats.displayHz || stats.refreshHz;
  const notes = [
    background.reason && `Background: ${background.reason}.`,
    stats.note && `Refresh: ${stats.note}.`,
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <section id="panel-settings" className="drawer-panel">
      <h3>Appearance</h3>
      <button
        id="theme-setting"
        className="secondary-button wide-button"
        aria-label={`Switch to ${themeIntent === 'dark' ? 'light' : 'dark'} theme`}
        onClick={(event) => onTheme(event.currentTarget)}
      >
        <ThemeGlyph />
        <span id="theme-label">{themeIntent === 'dark' ? 'Light' : 'Dark'} theme</span>
      </button>
      <label className="setting-row">
        <span>
          <strong>Window material</strong>
          <small>
            {materialAvailable
              ? 'Let the desktop show softly through the window frame. Off keeps every surface solid.'
              : `Solid surfaces are in use on this device.${backdrop.reason ? ` ${backdrop.reason}` : ''}`}
          </small>
        </span>
        <input
          id="window-material"
          type="checkbox"
          role="switch"
          checked={materialAvailable && preferences.glass === 'baked'}
          disabled={!materialAvailable}
          onChange={(event) => onChange({ glass: event.target.checked ? 'baked' : 'solid' })}
        />
      </label>
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
      {toggle(
        'launch-animation',
        'launchAnimation',
        'Launch animation',
        'Play the colour intro when Patchbay opens.',
      )}
      <label className="setting-row">
        <span>
          <strong>Rendering quality</strong>
          <small>
            Sets diagram sharpness and the 3D background. Low keeps the background still.
          </small>
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
      <label className="setting-row">
        <span>
          <strong>Frame rate</strong>
          <small>Motion runs at your display’s refresh rate. A cap saves power.</small>
        </span>
        <select
          id="frame-rate"
          value={preferences.frameRate}
          onChange={(event) =>
            onChange({ frameRate: event.target.value as Preferences['frameRate'] })
          }
        >
          <option value="match">
            {nativeHz ? `Match display · ${nativeHz} Hz` : 'Match display'}
          </option>
          <option value="60">60 fps · power saver</option>
          <option value="30">30 fps · battery saver</option>
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
        <dd id="metric-hz">
          {stats.displayHz
            ? `${stats.displayHz} Hz`
            : stats.refreshHz
              ? `${stats.refreshHz} Hz measured`
              : 'Detecting'}
        </dd>
        <dt>Frame rate</dt>
        <dd id="metric-fps">{stats.fps ? `${stats.fps} fps` : 'Measuring'}</dd>
        <dt>Frame p50 / p95</dt>
        <dd id="metric-frame">
          {stats.p50.toFixed(1)} / {stats.p95.toFixed(1)} ms
        </dd>
        <dt>Long animation frames</dt>
        <dd id="metric-long">{stats.longFrames}</dd>
        <dt>Background</dt>
        <dd id="metric-background">{backgroundLabel(background)}</dd>
        <dt>Renderer errors</dt>
        <dd id="metric-errors">{errors}</dd>
      </dl>
      {notes && (
        <p id="metric-notes" className="drawer-hint">
          {notes}
        </p>
      )}
      <p className="drawer-hint">
        Diagnostics stay on this device. Frame readings describe this session, not a hardware
        guarantee.
      </p>
    </section>
  );
}
