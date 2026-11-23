import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from 'react';
import { flushSync } from 'react-dom';
import { isTauri } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import type { Backdrop, Preferences } from '../domain/contracts';
import { FrameClock } from '../rendering/frame-clock';
import { connectDisplay } from '../rendering/display';
import { UIMotion } from '../motion/ui-motion';
import { createThemeWave, type Theme, type ThemeWave } from '../motion/theme-wave';

/** A media query as React state; re-renders only when its match flips. */
export function useMedia(query: string): boolean {
  const media = useMemo(() => matchMedia(query), [query]);
  const subscribe = useCallback(
    (callback: () => void) => {
      media.addEventListener('change', callback);
      return () => media.removeEventListener('change', callback);
    },
    [media],
  );
  return useSyncExternalStore(subscribe, () => media.matches);
}

/** A theme wave or reduced-motion fade owns the native theme until it lands. */
function themeInFlight(): boolean {
  const root = document.documentElement;
  return root.hasAttribute('data-theme-wave') || root.hasAttribute('data-theme-fade');
}

/** 'mica' only when Rust applied Mica and nothing asks for an opaque frame. */
export type WindowMaterial = 'mica' | 'solid';

export function useVisualSystem(
  preferences: Preferences,
  backdrop: Backdrop,
  onChange: (value: Partial<Preferences>) => void,
) {
  const osReduced = useMedia('(prefers-reduced-motion: reduce)');
  const osContrast = useMedia('(prefers-contrast: more)');
  // WebView2 support for this query is unconfirmed, so it is one signal among
  // several; the app's Window material switch is the dependable opt-out.
  const osReducedTransparency = useMedia('(prefers-reduced-transparency: reduce)');
  const effective = {
    ...preferences,
    reducedMotion: preferences.reducedMotion || osReduced,
    highContrast: preferences.highContrast || osContrast,
  };
  const reducedTransparency = osReducedTransparency || effective.glass === 'solid';
  const material: WindowMaterial =
    backdrop.kind === 'mica' && !reducedTransparency && !effective.highContrast ? 'mica' : 'solid';
  const latest = useRef({ preferences: effective, onChange });
  const motion = useRef<UIMotion | null>(null);
  const wave = useRef<ThemeWave | null>(null);
  const clock = useMemo(
    () =>
      new FrameClock({
        pointer: { x: 0, y: 0 },
        energy: 0,
        phase: 'idle',
        quality: 'medium',
        glass: 'solid',
        refreshHz: 60,
        reducedMotion: false,
        focusMode: false,
        boardRate: 60,
        glowPasses: 2,
      }),
    [],
  );
  useLayoutEffect(() => {
    latest.current = { preferences: effective, onChange };
    const root = document.documentElement;
    root.dataset.theme = effective.theme;
    root.dataset.quality = effective.quality;
    root.dataset.backdrop = material;
    root.classList.toggle('reduced-transparency', reducedTransparency);
    root.classList.toggle('reduced-motion', effective.reducedMotion);
    root.classList.toggle('high-contrast', effective.highContrast);
    root.classList.toggle('focus-mode', effective.focusMode);
    Object.assign(clock.signals, {
      quality: effective.quality,
      glass: material === 'mica' ? 'baked' : 'solid',
      reducedMotion: effective.reducedMotion,
      focusMode: effective.focusMode,
    });
    clock.setFrameRate(effective.frameRate);
    // A theme committed outside the toggle (boot, a loaded session) turns the glyph too.
    wave.current?.sync();
  });
  const theme = effective.theme;
  useEffect(() => {
    // The DWM Mica tint and WebView2's prefers-color-scheme follow the app
    // theme. The pre-boot default may briefly win over Rust's startup pin, but
    // the frame is opaque until the backdrop arrives together with the saved
    // theme, which re-runs this effect. A refusal (tao declines dark mode under
    // high contrast) only leaves the legible system tint, so it is not an error.
    // A theme wave pins the native theme itself once it lands, so the DWM tint
    // never changes under a half-revealed window.
    if (!isTauri() || themeInFlight()) return;
    getCurrentWindow()
      .setTheme(theme)
      .catch(() => undefined);
  }, [theme]);
  useLayoutEffect(() => {
    // Blur is never animated (glass and the field own all blur), so the
    // motion-blur preference no longer reaches UIMotion.
    const animator = new UIMotion({
      reduced: () => latest.current.preferences.reducedMotion,
    });
    motion.current = animator;
    return () => {
      animator.dispose();
      motion.current = null;
    };
  }, []);

  // One theme wave for the app's lifetime. Its intent (the theme the user last
  // asked for) is mirrored into React for the toggles' aria-pressed and labels.
  const intentListeners = useMemo(() => new Set<() => void>(), []);
  useLayoutEffect(() => {
    const instance = createThemeWave(
      {
        apply: (next: Theme) => {
          // html[data-theme] moves in the layout effect above; the field snaps
          // to the new palette itself while data-theme-wave/-fade is set.
          flushSync(() => latest.current.onChange({ theme: next }));
        },
        syncNative: async (next: Theme) => {
          if (isTauri()) await getCurrentWindow().setTheme(next);
        },
        reduced: () => latest.current.preferences.reducedMotion,
        foam: () =>
          latest.current.preferences.quality !== 'low' && !latest.current.preferences.highContrast,
        clock,
      },
      () => latest.current.preferences.theme,
    );
    wave.current = instance;
    const release = instance.subscribe(() => {
      for (const listener of intentListeners) listener();
    });
    for (const listener of intentListeners) listener();
    return () => {
      release();
      instance.dispose();
      wave.current = null;
    };
  }, [clock, intentListeners]);
  const subscribeIntent = useCallback(
    (listener: () => void) => {
      intentListeners.add(listener);
      return () => {
        intentListeners.delete(listener);
      };
    },
    [intentListeners],
  );
  const themeIntent = useSyncExternalStore(
    subscribeIntent,
    () => wave.current?.intent() ?? latest.current.preferences.theme,
  );

  useEffect(() => {
    clock.start();
    const disconnect = connectDisplay(clock);
    return () => {
      disconnect();
      clock.stop();
    };
  }, [clock]);
  /**
   * Switches theme with the wave rolling out of `origin` (the title-bar toggle
   * by default). Keyboard activation plays it too: a rare, deliberate action,
   * recorded as an exception to the instant-keyboard rule in DESIGN.md.
   */
  const toggleTheme = useCallback((origin?: HTMLElement) => {
    // Guarded: a handler wired straight to onClick hands over its event instead.
    const from =
      (origin instanceof HTMLElement ? origin : null) ??
      document.getElementById('theme-toggle') ??
      document.documentElement;
    if (wave.current) wave.current.toggle(from);
    else
      latest.current.onChange({
        theme: latest.current.preferences.theme === 'light' ? 'dark' : 'light',
      });
  }, []);
  return { clock, effective, material, reducedTransparency, motion, toggleTheme, themeIntent };
}
