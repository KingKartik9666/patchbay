import { describe, expect, it, vi } from 'vitest';
import { SessionWriter } from '../src/app/session-writer';
import { initialState, WorkbenchStore } from '../src/app/state';
import type { SavedSession } from '../src/domain/contracts';

const sample = (input: string): SavedSession => ({
  ...initialState.preferences,
  source: 'type mealy\nstart A\nA 0 A 1',
  input,
  manualDraft: null,
  route: 'bench',
  graph: null,
});
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
describe('durable session writer', () => {
  it('coalesces edits and serializes newer snapshots behind an in-flight write', async () => {
    const gate = deferred(),
      saved: string[] = [];
    const writer = new SessionWriter(async (session) => {
      saved.push(session.input);
      if (saved.length === 1) await gate.promise;
    }, vi.fn());
    writer.schedule(sample('0'));
    const first = writer.flush();
    writer.schedule(sample('00'));
    writer.schedule(sample('000'));
    const close = writer.flush();
    expect(saved).toEqual(['0']);
    gate.resolve();
    await Promise.all([first, close]);
    expect(saved).toEqual(['0', '000']);
    writer.dispose();
  });
  it('keeps failed edits available for a close-time retry', async () => {
    const write = vi
      .fn()
      .mockRejectedValueOnce(new Error('disk full'))
      .mockResolvedValueOnce(undefined);
    const writer = new SessionWriter(write, vi.fn());
    writer.schedule(sample('0'));
    await expect(writer.flush()).rejects.toThrow('disk full');
    await writer.flush();
    expect(write).toHaveBeenCalledTimes(2);
    expect(write.mock.calls[1][0].input).toBe('0');
    writer.dispose();
  });
  it('exposes the latest committed draft synchronously before a React render', () => {
    const store = new WorkbenchStore(),
      listener = vi.fn(),
      stop = store.subscribe(listener);
    store.dispatch({ type: 'patch', value: { manualDraft: 'unfinished', manualDirty: true } });
    expect(store.getSnapshot().manualDraft).toBe('unfinished');
    expect(listener).toHaveBeenCalledTimes(1);
    stop();
    store.dispatch({ type: 'patch', value: { manualDraft: 'next' } });
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
