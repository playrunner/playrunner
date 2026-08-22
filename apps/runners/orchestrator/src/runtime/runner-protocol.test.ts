import assert from 'node:assert/strict';
import test from 'node:test';
import { withRunnerProtocolSignature as signForRunner } from '../../../shared/runner-protocol';
import { withRunnerProtocolSignature as signForGcpApi } from '../../../../../packages/gcp/src/api-runtime/runner-protocol';

const TOKEN = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const GOLDEN_SIGNATURE = 'MECYMDEdQyaK0VlKRZIv_YGbJuNriXURulEZ9wvXViw';

test('runner and GCP API protocol canonicalization share a nested Unicode golden vector', () => {
  const payload = {
    nested: { protocolSignature: 'nested-value', Ω: 2, a: 1 },
    type: 'runner_status',
    z: [{ 中: true, b: false }],
    é: 'accent',
  };

  assert.equal(
    signForRunner(payload, TOKEN).protocolSignature,
    GOLDEN_SIGNATURE,
  );
  assert.equal(
    signForGcpApi(payload, TOKEN).protocolSignature,
    GOLDEN_SIGNATURE,
  );
});
