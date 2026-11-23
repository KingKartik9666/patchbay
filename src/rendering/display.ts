import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { DisplayInfo } from '../domain/contracts';
import type { FrameClock } from './frame-clock';

/** Feeds the clock the OS's refresh rate for the monitor the window is on:
 * once now, again whenever Rust sees the window change monitor or the mode
 * change ('display-refresh'), and whenever the clock's measured vsync keeps
 * disagreeing. Outside the desktop app the clock relies on what it measures. */
export function connectDisplay(clock: FrameClock): () => void {
  if (!isTauri()) return () => undefined;
  let live = true;
  const apply = (info: DisplayInfo) => {
    if (live) clock.setDisplay(info);
  };
  // A failed query leaves the measured rate in charge; it is not an error.
  const detect = () => {
    invoke<DisplayInfo>('display_refresh').then(apply, () => undefined);
  };
  detect();
  const unlisten = listen<DisplayInfo>('display-refresh', (event) => apply(event.payload)).catch(
    () => undefined,
  );
  const offRedetect = clock.onRedetect(detect);
  return () => {
    live = false;
    offRedetect();
    void unlisten.then((stop) => stop?.());
  };
}
