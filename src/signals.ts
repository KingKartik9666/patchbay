export interface Signals {
  pointer: { x: number; y: number };
  energy: number;
  phase: 'idle' | 'building' | 'playing' | 'fault' | 'done';
  quality: 'high' | 'medium' | 'low';
  glass: 'baked' | 'solid';
  /** The vsync rate measured from requestAnimationFrame. */
  refreshHz: number;
  /** The OS's refresh rate for the window's monitor; 0 when unknown. */
  displayHz: number;
  /** The rate the clock dispatches at: the display's, or a power-saving cap. */
  targetFps: number;
  /** Frames dispatched over the last second. */
  measuredFps: number;
  /** Why the measured and reported refresh rates disagree, if they do. */
  refreshNote: string | null;
  reducedMotion: boolean;
  focusMode: boolean;
  boardRate: number;
  glowPasses: 2 | 3;
}
