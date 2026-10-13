export interface Signals {
  pointer: { x: number; y: number };
  energy: number;
  phase: 'idle' | 'building' | 'playing' | 'fault' | 'done';
  quality: 'high' | 'medium' | 'low';
  glass: 'baked' | 'solid';
  refreshHz: number;
  reducedMotion: boolean;
  focusMode: boolean;
  boardRate: number;
  glowPasses: 2 | 3;
}
