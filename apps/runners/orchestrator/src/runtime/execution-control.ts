// Track the whole workflow, including preparation and cleanup, rather than
// inferring its lifetime from whichever child happens to be running.
export class ExecutionControl {
  private readonly stoppedBeforeStart = new Map<string, number>();
  private pruneStops() {
    for (const [id, at] of this.stoppedBeforeStart) {
      if (Date.now() - at > 24 * 60 * 60 * 1000)
        this.stoppedBeforeStart.delete(id);
    }
  }
  private readonly stopBarriers = new Map<
    string,
    { promise: Promise<void>; resolve: () => void }
  >();
  private readonly active = new Map<string, AbortController>();

  async run<T>(id: string, execute: (signal: AbortSignal) => Promise<T>) {
    this.pruneStops();
    if (this.stoppedBeforeStart.has(id))
      throw new Error('Execution was stopped before it started.');
    if (this.active.has(id)) throw new Error('Execution is already running.');
    const controller = new AbortController();
    this.active.set(id, controller);
    try {
      return await execute(controller.signal);
    } finally {
      this.active.delete(id);
      this.stopBarriers.delete(id);
    }
  }

  status(id: string): 'running' | 'stopping' | 'absent' {
    const controller = this.active.get(id);
    return controller
      ? controller.signal.aborted
        ? 'stopping'
        : 'running'
      : 'absent';
  }

  confirmStopped(id: string) {
    this.stopBarriers.get(id)?.resolve();
  }

  async waitForStop(id: string) {
    await this.stopBarriers.get(id)?.promise;
  }

  stop(id: string) {
    // A stop may beat the /execute request to this process. Keep the same
    // bounded 24-hour horizon as execution admission, and fail closed at capacity.
    this.pruneStops();
    if (!this.active.has(id) && !this.stoppedBeforeStart.has(id)) {
      if (this.stoppedBeforeStart.size >= 1000)
        throw new Error('Stop admission capacity is exhausted.');
      this.stoppedBeforeStart.set(id, Date.now());
    }
    if (this.active.has(id) && !this.stopBarriers.has(id)) {
      let resolve!: () => void;
      const promise = new Promise<void>((done) => {
        resolve = done;
      });
      this.stopBarriers.set(id, { promise, resolve });
    }
    this.active.get(id)?.abort(new Error('Workflow stopped by user.'));
    return this.status(id);
  }
}
