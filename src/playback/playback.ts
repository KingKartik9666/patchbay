import type { Step, Trace } from '../domain/contracts';
export interface PlaybackState {
  cursor: number;
  playing: boolean;
  speed: number;
}
export interface Travel {
  step?: Step;
  progress: number;
}
/** Owns presentation time and cursor. The immutable trace comes from Rust. */
export class Playback {
  readonly travel: { current: Travel } = { current: { progress: 0 } };
  private state: PlaybackState = { cursor: 0, playing: false, speed: 1 };
  private stepping = false;
  private listeners = new Set<() => void>();
  constructor(
    readonly trace: Trace,
    speed = 1,
  ) {
    this.state.speed = speed;
  }
  getSnapshot = (): PlaybackState => this.state;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish(next: PlaybackState): void {
    this.state = next;
    for (const listener of this.listeners) listener();
  }
  seek(cursor: number): void {
    this.stepping = false;
    this.travel.current = { progress: 0 };
    this.publish({
      ...this.state,
      cursor: Math.max(0, Math.min(this.trace.steps.length, Math.trunc(cursor))),
      playing: false,
    });
  }
  toggle(): void {
    if (this.state.playing) {
      this.seek(this.state.cursor);
      return;
    }
    if (!this.trace.steps.length) return;
    this.stepping = false;
    this.travel.current = { progress: 0 };
    this.publish({
      ...this.state,
      cursor: this.state.cursor === this.trace.steps.length ? 0 : this.state.cursor,
      playing: true,
    });
  }
  step(reduced: boolean): void {
    if (this.state.cursor >= this.trace.steps.length) return;
    if (reduced) {
      this.seek(this.state.cursor + 1);
      return;
    }
    this.stepping = true;
    this.travel.current = { step: this.trace.steps[this.state.cursor], progress: 0 };
    this.publish({ ...this.state, playing: false });
  }
  speed(speed: number): void {
    if ([0.25, 0.5, 1, 2, 4].includes(speed)) this.publish({ ...this.state, speed });
  }
  update(dt: number): void {
    if (!this.state.playing && !this.stepping) return;
    const duration = this.state.cursor >= 64 ? 1 / 30 : 0.9 / this.state.speed;
    const progress = Math.min(1, this.travel.current.progress + dt / duration);
    this.travel.current = {
      step: this.trace.steps[this.state.cursor],
      progress: progress > 1 - 1e-9 ? 1 : progress,
    };
    if (this.travel.current.progress < 1) return;
    const cursor = this.state.cursor + 1,
      playing = this.state.playing && !this.stepping && cursor < this.trace.steps.length;
    this.stepping = false;
    this.travel.current = { progress: 0 };
    this.publish({ ...this.state, cursor, playing });
  }
}
