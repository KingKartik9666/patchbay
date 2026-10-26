import { useEffect, useState, useSyncExternalStore } from 'react';
import type { Trace } from '../domain/contracts';
import type { FrameClock } from '../rendering/frame-clock';
import { Playback } from './playback';
export function usePlayback(trace: Trace, clock: FrameClock) {
  const [session, setSession] = useState(() => ({ trace, controller: new Playback(trace) }));
  let controller = session.controller;
  if (session.trace !== trace) {
    controller = new Playback(trace, session.controller.getSnapshot().speed);
    setSession({ trace, controller });
  }
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  useEffect(() => clock.subscribe((dt) => controller.update(dt)), [clock, controller]);
  return { controller, ...state };
}
