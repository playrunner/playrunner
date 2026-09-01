import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createAuthenticationEnvelopeKeyPair,
  openAuthenticationEnvelope,
  sealAuthenticationEnvelope,
} from './authentication-envelope';

test('seals auth state to one execution, node, and ephemeral recipient', () => {
  const recipient = createAuthenticationEnvelopeKeyPair();
  const plaintext = Buffer.from('{"cookies":["secret-cookie"]}', 'utf8');
  const envelope = sealAuthenticationEnvelope({
    executionId: 'execution-1',
    nodeId: 'node-1',
    plaintext,
    recipientPublicKey: recipient.publicKey,
  });
  assert.equal(JSON.stringify(envelope).includes('secret-cookie'), false);
  assert.deepEqual(
    openAuthenticationEnvelope({
      envelope,
      executionId: 'execution-1',
      nodeId: 'node-1',
      recipientPrivateKey: recipient.privateKey,
    }),
    plaintext,
  );
  assert.throws(() =>
    openAuthenticationEnvelope({
      envelope,
      executionId: 'execution-1',
      nodeId: 'node-2',
      recipientPrivateKey: recipient.privateKey,
    }),
  );
});
