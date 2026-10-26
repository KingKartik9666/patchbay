import type { SavedSession } from '../domain/contracts';
/** Coalesces durable snapshots and serializes writes so older IPC completions
 * cannot replace newer edits. Flush is awaited before closing the window. */
export class SessionWriter {
  private pending: SavedSession | null = null;
  private running: Promise<void> | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  constructor(
    private readonly write: (session: SavedSession) => Promise<void>,
    private readonly onError: (error: unknown) => void,
  ) {}
  schedule(session: SavedSession): void {
    this.pending = session;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      void this.flush().catch(this.onError);
    }, 200);
  }
  async flush(): Promise<void> {
    clearTimeout(this.timer);
    if (this.running) {
      await this.running;
      if (this.pending) await this.flush();
      return;
    }
    const work = async () => {
      while (this.pending) {
        const next = this.pending;
        this.pending = null;
        try {
          await this.write(next);
        } catch (error) {
          if (!this.pending) this.pending = next;
          throw error;
        }
      }
    };
    this.running = work();
    try {
      await this.running;
    } finally {
      this.running = null;
    }
  }
  dispose(): void {
    clearTimeout(this.timer);
  }
}
