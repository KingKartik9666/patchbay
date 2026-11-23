import { useEffect, useLayoutEffect, useRef, useState, type JSX } from 'react';
import type { MachineDef, Page, Panel } from '../domain/contracts';
import type { FrameClock } from '../rendering/frame-clock';
import type { Playback } from '../playback/playback';
import { FieldEngine } from '../rendering/field/renderer';

export interface FieldCanvasProps {
  clock: FrameClock;
  machine: MachineDef | undefined;
  /** Read each frame (snapshot, travel, trace); React never re-renders for it. */
  player: Playback;
  page: Page;
  panel: Panel;
  theme: 'light' | 'dark';
  quality: 'low' | 'medium' | 'high';
  reducedMotion: boolean;
  /** reducedTransparency || highContrast */
  off: boolean;
}

/** The field: atmosphere only, drawn at the display's refresh rate while it
 * moves. It never takes input or focus, and the 2D diagram, tapes and trace
 * stay the authoritative interface. */
export function FieldCanvas(props: FieldCanvasProps): JSX.Element {
  const ref = useRef<HTMLCanvasElement>(null);
  // A canvas that has held a WebGL context is replaced to show the static field.
  const [generation, setGeneration] = useState(0);
  const [engine] = useState(() => new FieldEngine(() => setGeneration((value) => value + 1)));
  useLayoutEffect(() => {
    engine.update(props);
  });
  useLayoutEffect(() => {
    engine.start();
    return () => engine.stop();
  }, [engine]);
  useLayoutEffect(() => {
    engine.attach(ref.current);
  }, [engine, generation]);
  const { player } = props;
  useEffect(() => player.subscribe(engine.wake), [engine, player]);
  return <canvas key={generation} ref={ref} id="field" aria-hidden="true" tabIndex={-1} />;
}
