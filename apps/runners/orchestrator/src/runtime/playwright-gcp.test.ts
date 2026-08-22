import assert from 'node:assert/strict';
import test from 'node:test';
import { createDurableCloudRunCancellation } from './playwright-gcp';

test('does not latch a failed Cloud Run cancellation and retries during cleanup', async () => {
  let cancellationCalls = 0;
  let cleanupCalls = 0;
  const cancellation = createDurableCloudRunCancellation({
    cleanupControl: async () => {
      cleanupCalls += 1;
    },
    isCompleted: () => false,
    publishCancel: async () => {},
    requestExecutionCancel: async () => {
      cancellationCalls += 1;
      if (cancellationCalls === 1) {
        throw new Error('Cloud Run cancellation failed');
      }
    },
  });

  await assert.rejects(cancellation.cancel(), /cancellation failed/);
  assert.equal(cancellation.isDurablyCancelled(), false);

  await cancellation.cleanup();
  assert.equal(cancellationCalls, 2);
  assert.equal(cancellation.isDurablyCancelled(), true);
  assert.equal(cleanupCalls, 1);
});

test('treats a confirmed Cloud Run cancel as durable when Pub/Sub signalling fails', async () => {
  let cancellationCalls = 0;
  let signalFailures = 0;
  const cancellation = createDurableCloudRunCancellation({
    cleanupControl: async () => {},
    isCompleted: () => false,
    onSignalFailure: async () => {
      signalFailures += 1;
    },
    publishCancel: async () => {
      throw new Error('Pub/Sub unavailable');
    },
    requestExecutionCancel: async () => {
      cancellationCalls += 1;
    },
  });

  await cancellation.cancel();
  await cancellation.cleanup();
  assert.equal(cancellationCalls, 1);
  assert.equal(signalFailures, 1);
  assert.equal(cancellation.isDurablyCancelled(), true);
});
