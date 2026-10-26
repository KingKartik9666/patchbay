import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from 'react';
import type { Preferences } from '../domain/contracts';
import { FrameClock } from '../rendering/frame-clock';
import { UIMotion } from '../motion/ui-motion';

function useMedia(query: string): boolean {
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

export function useVisualSystem(
  preferences: Preferences,
  onChange: (value: Partial<Preferences>) => void,
) {
  const osReduced = useMedia('(prefers-reduced-motion: reduce)');
  const osContrast = useMedia('(prefers-contrast: more)');
  // Older sessions may contain a glass preference. Current surfaces are solid.
  const effective = {
    ...preferences,
    glass: 'solid' as const,
    reducedMotion: preferences.reducedMotion || osReduced,
    highContrast: preferences.highContrast || osContrast,
  };
  const latest = useRef({ preferences: effective, onChange });
  const motion = useRef<UIMotion | null>(null);
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
    root.dataset.glass = 'solid';
    root.classList.toggle('reduced-motion', effective.reducedMotion);
    root.classList.toggle('high-contrast', effective.highContrast);
    root.classList.toggle('focus-mode', effective.focusMode);
    Object.assign(clock.signals, {
      quality: effective.quality,
      glass: 'solid',
      reducedMotion: effective.reducedMotion,
      focusMode: effective.focusMode,
    });
  });
  useLayoutEffect(() => {
    const animator = new UIMotion({
      reduced: () => latest.current.preferences.reducedMotion,
      blur: () => latest.current.preferences.motionBlur,
    });
    motion.current = animator;
    return () => {
      animator.dispose();
      motion.current = null;
    };
  }, []);
  useEffect(() => {
    clock.start();
    return () => clock.stop();
  }, [clock]);
  const toggleTheme = useCallback(() => {
    latest.current.onChange({
      theme: latest.current.preferences.theme === 'light' ? 'dark' : 'light',
    });
  }, []);
  return { clock, effective, motion, toggleTheme };
}
