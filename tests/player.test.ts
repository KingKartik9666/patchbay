import { describe, expect, it } from 'vitest';
import { Player } from '../src/player';
import { parse } from '../src/engine/parse';
import { simulate } from '../src/engine/simulate';
import { presets } from '../src/presets';

function create() { const p = new Player(); p.load(simulate(parse(presets[0].source).machine!, '1101')); return p; }
describe('playback cursor and cancellation', () => {
  it('steps once and stays paused', () => { const p=create(); p.step();p.update(.45);expect(p.cursor).toBe(0);p.update(.45);expect(p.cursor).toBe(1);expect(p.playing).toBe(false);p.update(10);expect(p.cursor).toBe(1); });
  it('seeking cancels a partial journey', () => {const p=create();p.toggle();p.update(.5);p.seek(3);p.update(5);expect(p.cursor).toBe(3);expect(p.progress).toBe(0);expect(p.playing).toBe(false);});
  it('finishes at the last input and replays from the start', () => {const p=create();p.toggle();for(let i=0;i<4;i++)p.update(.9);expect(p.cursor).toBe(4);expect(p.playing).toBe(false);p.toggle();expect(p.cursor).toBe(0);expect(p.playing).toBe(true);});
  it('speed scales elapsed time, independent of frame cadence', () => {const a=create(),b=create();a.speed=b.speed=2;a.toggle();b.toggle();for(let i=0;i<30;i++)a.update(.45/30);for(let i=0;i<60;i++)b.update(.45/60);expect(a.cursor).toBe(b.cursor);expect(a.cursor).toBe(1);});
  it('empty input does not play', () => {const p=new Player();p.toggle();p.step();p.update(1);expect(p.cursor).toBe(0);expect(p.playing).toBe(false);});
});
