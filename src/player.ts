import type { Trace } from './engine/types';

/** Playback owns the cursor, never the simulation. Seeking always cancels travel. */
export class Player {
  cursor = 0;
  playing = false;
  speed = 1;
  progress = 0;
  private stepping = false;
  trace: Trace = { steps: [], output: '' };
  onChange: () => void = () => {};
  onTravel: (index: number, progress: number) => void = () => {};
  load(trace: Trace) { this.trace = trace; this.seek(0); }
  seek(cursor: number) {
    this.playing = false; this.stepping = false; this.progress = 0;
    this.cursor = Math.max(0, Math.min(this.trace.steps.length, Math.trunc(cursor)));
    this.onChange();
  }
  toggle() {
    if (this.playing) { this.seek(this.cursor); return; }
    if (!this.trace.steps.length) return;
    if (this.cursor === this.trace.steps.length) this.cursor = 0;
    this.playing = true; this.stepping = false; this.progress = 0; this.onChange();
  }
  step() {
    if (this.cursor >= this.trace.steps.length) return;
    this.playing = false; this.stepping = true; this.progress = 0; this.onChange();
  }
  update(dt: number) {
    if (!this.playing && !this.stepping) return;
    const duration = this.cursor >= 64 ? 1 / 30 : 0.9 / this.speed;
    this.progress = Math.min(1, this.progress + dt / duration);
    if (this.progress > 1 - 1e-9) this.progress = 1;
    this.onTravel(this.cursor, this.progress);
    if (this.progress < 1) return;
    this.cursor++; this.progress = 0;
    if (this.stepping || this.cursor >= this.trace.steps.length) this.playing = false;
    this.stepping = false; this.onChange();
  }
}
