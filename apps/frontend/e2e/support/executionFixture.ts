import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const apiRequire = createRequire(
  new URL('../../../api/package.json', import.meta.url),
);
const { Pool } = apiRequire('pg');
const { parse } = apiRequire('dotenv');

// Seed event snapshots only in the same isolated schema as the real E2E API.
export async function executionFixture(userId: string) {
  const env = parse(
    readFileSync(new URL('../../../api/.env', import.meta.url)),
  );
  const url = new URL(
    process.env.PLAYRUNNER_E2E_DATABASE_URL ?? env.DATABASE_URL,
  );
  url.searchParams.delete('schema');
  const pool = new Pool({ connectionString: url.toString() });
  const id = randomUUID();
  const event = async (
    nodeId: string | null,
    type: string,
    payload: unknown,
  ) => {
    await pool.query(
      'INSERT INTO playrunner_e2e."WorkflowEvent" ("executionId", "userId", "nodeId", type, payload) VALUES ($1, $2, $3, $4, $5)',
      [id, userId, nodeId, type, JSON.stringify(payload)],
    );
  };
  const progress = async (nodeId: string, total: number, completed: number) =>
    event(nodeId, 'test_progress', {
      progress: {
        total,
        completed,
        passed: completed,
        failed: 0,
        skipped: 0,
        running: completed < total ? 1 : 0,
      },
    });
  const dispose = async () => {
    await pool.query(
      'DELETE FROM playrunner_e2e."WorkflowExecution" WHERE id = $1',
      [id],
    );
    await pool.end();
  };
  try {
    await pool.query(
      'INSERT INTO playrunner_e2e."WorkflowExecution" (id, "userId", "cloudProvider", "ingestTokenHash", "updatedAt") VALUES ($1, $2, $3, $4, NOW())',
      [id, userId, 'LOCAL_RUNNER', 'e2e-fixture-no-ingest-token'],
    );
    await event(null, 'execution_definition', {
      title: 'Expandable execution',
      nodes: [
        {
          id: 'fixtures',
          title: '462 database fixture cases',
          type: 'playwright',
        },
        { id: 'setup', title: 'Preparing environment', type: 'environment' },
      ],
    });
    await event('fixtures', 'node_state', { state: 'running' });
    await event('setup', 'node_state', { state: 'running' });
    for (const [nodeId, childKind, shardIndex] of [
      ['discovery', 'discovery', 0],
      ['shard-one', 'shard', 1],
      ['shard-two', 'shard', 2],
      ['aggregate', 'aggregate', 0],
    ] as const) {
      await event(nodeId, 'node_state', {
        parentNodeId: 'fixtures',
        childKind,
        shardIndex,
        state:
          childKind === 'discovery'
            ? 'success'
            : childKind === 'shard'
              ? 'running'
              : 'pending',
      });
    }
    await progress('shard-one', 236, 53);
    await progress('shard-two', 226, 47);
    return { id, progress, dispose };
  } catch (error) {
    await dispose();
    throw error;
  }
}
