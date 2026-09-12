import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { packagePlugin, pluginRoot } from '../scripts/package.mjs';

test('public skills upload excludes local MCP configuration and private submission records', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'playrunner-submission-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const { submissionZip } = await packagePlugin(dir);
  const listing = spawnSync('unzip', ['-Z1', submissionZip], {
    encoding: 'utf8',
  });
  assert.equal(listing.status, 0);
  assert.match(listing.stdout, /^plugin.json$/m);
  assert.match(listing.stdout, /^skills\/playrunner\/SKILL.md$/m);
  assert.match(listing.stdout, /^scripts\/playrunner.mjs$/m);
  assert.doesNotMatch(
    listing.stdout,
    /\.mcp\.json|\.codex-plugin|submission\/|node_modules|\.env|test/,
  );
  const local = JSON.parse(
    await readFile(join(pluginRoot, '.mcp.json'), 'utf8'),
  );
  assert.deepEqual(local.mcpServers.playrunner, {
    type: 'http',
    url: 'https://playrunner.cloud/mcp',
  });
});

test('review materials include required cases and do not claim completed publication', async () => {
  const listing = JSON.parse(
    await readFile(join(pluginRoot, 'submission/listing.json'), 'utf8'),
  );
  const cases = JSON.parse(
    await readFile(join(pluginRoot, 'submission/test-cases.json'), 'utf8'),
  );
  assert.equal(listing.organisation, 'Concept AI PTY LTD');
  assert.equal(listing.project, 'Playrunner');
  assert.equal(listing.submissionType, 'With MCP');
  assert.equal(listing.policyAttestations, null);
  assert.equal(cases.positive.length, 5);
  assert.equal(cases.negative.length, 3);
});

test('remote MCP skill works independently of its enclosing plugin', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'playrunner-skill-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const { skillZip } = await packagePlugin(join(dir, 'dist'));
  const extracted = spawnSync('unzip', [
    '-q',
    skillZip,
    '-d',
    join(dir, 'skill'),
  ]);
  assert.equal(extracted.status, 0);
  const runtime = JSON.parse(
    await readFile(join(dir, 'skill/runtime.json'), 'utf8'),
  );
  assert.equal(runtime.config.playrunnerVersion, '0.2.5');
  const skill = await readFile(join(dir, 'skill/SKILL.md'), 'utf8');
  assert.match(skill, /`scripts\/playrunner.mjs`/);
  const run = spawnSync(
    process.execPath,
    [join(dir, 'skill/scripts/playrunner.mjs'), '--help'],
    { env: { ...process.env, PATH: dir }, encoding: 'utf8' },
  );
  assert.equal(run.status, 2);
  assert.match(run.stderr, /Check Node.js and npm/);
  assert.doesNotMatch(run.stderr, /ENOENT.*runtime|package.json/);
});
