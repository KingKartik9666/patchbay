import { describe, expect, it } from 'vitest';
import { Playback } from '../src/playback/playback';
import type { Trace } from '../src/domain/contracts';
const trace: Trace = {
  steps: [0, 1, 2].map((i) => ({ i, from: 'A', to: 'A', sym: '0', out: '1' })),
  output: '111',
  outputSeparator: '',
};
describe('Rust trace presentation', () => {
  it('steps, seeks and cancels travel without changing the trace', () => {
    const before = JSON.stringify(trace),
      player = new Playback(trace);
    player.step(false);
    player.update(0.45);
    expect(player.getSnapshot().cursor).toBe(0);
    expect(player.travel.current.progress).toBe(0.5);
    player.seek(2);
    expect(player.travel.current.step).toBeUndefined();
    expect(player.getSnapshot().playing).toBe(false);
    player.step(true);
    expect(player.getSnapshot().cursor).toBe(3);
    expect(JSON.stringify(trace)).toBe(before);
  });
  it('restarts at the end, respects speed and stops on completion', () => {
    const player = new Playback(trace);
    player.seek(3);
    player.toggle();
    player.speed(4);
    player.update(0.225);
    expect(player.getSnapshot().cursor).toBe(1);
    player.update(0.225);
    player.update(0.225);
    expect(player.getSnapshot()).toMatchObject({ cursor: 3, playing: false, speed: 4 });
  });
  it('empty traces never start and range clamping remains safe', () => {
    const player = new Playback({ steps: [], output: '', outputSeparator: '' });
    player.toggle();
    player.seek(100);
    player.step(false);
    expect(player.getSnapshot()).toMatchObject({ cursor: 0, playing: false });
  });
});
