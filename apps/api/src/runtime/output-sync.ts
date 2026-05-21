import type { OutputSyncBackend, OutputSyncRequest } from './contracts';

export class NoopOutputSyncBackend implements OutputSyncBackend {
  async sync(_request: OutputSyncRequest): Promise<void> {
    return;
  }
}
