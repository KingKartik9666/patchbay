import { useEffect, useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { isTauri } from '@tauri-apps/api/core';
import type { Page, Panel, Preferences } from '../domain/contracts';
import { Icon } from './Icon';
import { NavIcon, type NavIconName } from './NavIcon';

const destinations: { name: NavIconName; label: string }[] = [
  { name: 'bench', label: 'Bench' },
  { name: 'machines', label: 'Machines' },
  { name: 'trace', label: 'Trace' },
  { name: 'editor', label: 'Editor' },
  { name: 'learn', label: 'Learn' },
  { name: 'settings', label: 'Settings' },
];

interface ChromeProps {
  page: Page;
  panel: Panel;
  preferences: Preferences;
  onNavigate: (name: NavIconName) => void;
  onTheme: (trigger: HTMLElement) => void;
  onFocus: () => void;
  onClose: () => void;
}

export function Chrome({
  page,
  panel,
  preferences,
  onNavigate,
  onTheme,
  onFocus,
  onClose,
}: ChromeProps) {
  const [maximized, setMaximized] = useState(false);
  const active = panel === 'text' ? 'editor' : (panel ?? page);

  useEffect(() => {
    if (!isTauri()) return;
    const window = getCurrentWindow();
    let alive = true;
    let unlisten: (() => void) | undefined;
    void window.isMaximized().then((value) => {
      if (alive) setMaximized(value);
    });
    void window
      .onResized(() => {
        void window.isMaximized().then((value) => {
          if (alive) setMaximized(value);
        });
      })
      .then((stop) => {
        if (alive) unlisten = stop;
        else stop();
      });
    return () => {
      alive = false;
      unlisten?.();
    };
  }, []);

  return (
    <>
      <div
        className="titlebar"
        onPointerDown={(event) => {
          if (isTauri() && event.button === 0 && !(event.target as HTMLElement).closest('button'))
            void getCurrentWindow().startDragging();
        }}
      >
        <span className="titlebar-logo">
          <NavIcon name="bench" />
          Patchbay
        </span>
        <span className="titlebar-caption">Mealy & Moore machine studio</span>
        <div className="window-controls">
          <button
            id="window-minimize"
            type="button"
            aria-label="Minimize window"
            onClick={() => {
              if (isTauri()) void getCurrentWindow().minimize();
            }}
          >
            <Icon name="minimize" />
          </button>
          <button
            id="window-maximize"
            type="button"
            aria-label={maximized ? 'Restore window' : 'Maximize window'}
            onClick={() => {
              if (isTauri()) void getCurrentWindow().toggleMaximize();
            }}
          >
            <Icon name={maximized ? 'restore' : 'maximize'} />
          </button>
          <button id="window-close" type="button" aria-label="Close window" onClick={onClose}>
            <Icon name="close" />
          </button>
        </div>
      </div>
      <nav
        id="rail"
        className="rail"
        aria-label="Main navigation"
        onKeyDown={(event) => {
          const buttons = Array.from(
            event.currentTarget.querySelectorAll<HTMLButtonElement>('.nav-item'),
          );
          const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
          const next =
            event.key === 'Home'
              ? 0
              : event.key === 'End'
                ? buttons.length - 1
                : ['ArrowDown', 'ArrowRight'].includes(event.key)
                  ? (index + 1) % buttons.length
                  : ['ArrowUp', 'ArrowLeft'].includes(event.key)
                    ? (index - 1 + buttons.length) % buttons.length
                    : -1;
          if (next >= 0) {
            event.preventDefault();
            buttons[next].focus();
          }
        }}
      >
        {destinations.map(({ name, label }) => (
          <button
            key={name}
            type="button"
            className={`nav-item${active === name ? ' active' : ''}`}
            data-route={name}
            tabIndex={active === name ? 0 : -1}
            aria-current={active === name ? 'page' : undefined}
            aria-label={label}
            onClick={() => onNavigate(name)}
          >
            <NavIcon name={name} />
            <span className="nav-label">{label}</span>
            <span className="nav-tooltip" aria-hidden="true">
              {label}
            </span>
          </button>
        ))}
        <span className="rail-status">
          <i aria-hidden="true" />
          Offline ready
        </span>
      </nav>
      <header className="workspace-header">
        <div>
          <button type="button" className="wordmark" onClick={() => onNavigate('bench')}>
            <NavIcon name="bench" />
            Patchbay<span>.</span>
          </button>
          <p>Small machines. Visible logic.</p>
        </div>
        <div className="header-end">
          <span className="local-chip">
            <i aria-hidden="true" />
            Runs on your device
          </span>
          <button
            id="theme-toggle"
            type="button"
            className="icon-button"
            aria-label={`Switch to ${preferences.theme === 'dark' ? 'light' : 'dark'} theme`}
            aria-pressed={preferences.theme === 'dark'}
            title="Switch theme"
            onClick={(event) => onTheme(event.currentTarget)}
          >
            <Icon name="theme" />
          </button>
          <button
            id="focus"
            type="button"
            className="icon-button"
            aria-label="Focus mode"
            aria-pressed={preferences.focusMode}
            title="Focus mode (F)"
            onClick={onFocus}
          >
            <Icon name="focus" />
          </button>
        </div>
      </header>
    </>
  );
}
