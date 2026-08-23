import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  normalizeAgentSkillSources,
  prepareAgentSkills,
  type AgentSkillSource,
} from './agent-skills';

const REVISION = 'a'.repeat(40);

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'playrunner-skills-'));
  const repositoryRoot = path.join(root, 'repo');
  const workingDirectory = path.join(repositoryRoot, 'apps', 'web');
  const home = path.join(root, 'home');
  fs.mkdirSync(workingDirectory, { recursive: true });
  fs.mkdirSync(home, { recursive: true });
  return { home, repositoryRoot, root, workingDirectory };
}

function identity(home: string) {
  return {
    gid: process.getgid?.() ?? 1001,
    home,
    uid: process.getuid?.() ?? 1001,
  };
}

function cleanup(root: string): void {
  const makeWritable = (target: string): void => {
    const stat = fs.lstatSync(target);
    if (stat.isSymbolicLink()) return;
    if (stat.isDirectory()) {
      fs.chmodSync(target, 0o755);
      for (const entry of fs.readdirSync(target)) {
        makeWritable(path.join(target, entry));
      }
    } else {
      fs.chmodSync(target, 0o644);
    }
  };
  if (fs.existsSync(root)) makeWritable(root);
  fs.rmSync(root, { force: true, recursive: true });
}

function writeSkill(
  directory: string,
  name: string,
  files: Record<string, string> = {},
) {
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(
    path.join(directory, 'SKILL.md'),
    `---\nname: ${name}\ndescription: Use this skill for ${name}.\n---\n\nFollow the workflow.\n`,
  );
  for (const [relativePath, content] of Object.entries(files)) {
    const target = path.join(directory, relativePath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
}

function options(
  value: ReturnType<typeof fixture>,
  sources: readonly AgentSkillSource[],
) {
  return {
    destinationRoot: path.join(value.home, '.agents', 'skills'),
    environment: { PATH: process.env.PATH },
    identity: identity(value.home),
    inventoryPath: path.join(value.root, 'inputs', 'agent-skills.json'),
    primaryRevision: REVISION,
    repositoryRoot: value.repositoryRoot,
    sources,
    stagingRoot: path.join(value.root, 'skill-sources'),
    workingDirectory: value.workingDirectory,
  };
}

test('normalizes bounded project and GitHub Agent Skill sources', () => {
  assert.deepEqual(
    normalizeAgentSkillSources([
      { id: 'project-rules', path: '.playrunner/skills', type: 'project' },
      {
        id: 'shared-rules',
        repository: 'playrunner/agent-skills',
        type: 'github',
      },
    ]),
    [
      { id: 'project-rules', path: '.playrunner/skills', type: 'project' },
      {
        id: 'shared-rules',
        path: '.agents/skills',
        ref: 'main',
        repository: 'playrunner/agent-skills',
        type: 'github',
      },
    ],
  );
  assert.throws(
    () =>
      normalizeAgentSkillSources([
        { id: 'unsafe', path: '../skills', type: 'project' },
      ]),
    /normalized path inside its repository/,
  );
  assert.throws(
    () =>
      normalizeAgentSkillSources([
        {
          id: 'remote',
          repository: 'https://token@github.com/org/skills',
          type: 'github',
        },
      ]),
    /owner\/repository form/,
  );
  assert.throws(
    () =>
      normalizeAgentSkillSources([
        {
          id: 'remote',
          ref: '--upload-pack=bad',
          repository: 'org/skills',
          type: 'github',
        },
      ]),
    /safe Git branch, tag, or complete commit SHA/,
  );
  assert.throws(
    () =>
      normalizeAgentSkillSources([
        { id: 'same', path: 'one', type: 'project' },
        { id: 'same', path: 'two', type: 'project' },
      ]),
    /source IDs must be unique/,
  );
});

test('inventories canonical repository skills from the working directory to the repository root', async () => {
  const value = fixture();
  writeSkill(
    path.join(value.repositoryRoot, '.agents', 'skills', 'root-skill'),
    'root-skill',
  );
  writeSkill(
    path.join(value.repositoryRoot, 'apps', '.agents', 'skills', 'app-skill'),
    'app-skill',
  );
  try {
    const prepared = await prepareAgentSkills(options(value, []));
    assert.equal(prepared.installedCount, 0);
    assert.deepEqual(
      prepared.inventory.skills.map((skill) => [
        skill.name,
        skill.scope,
        skill.source.type,
        skill.source.revision,
      ]),
      [
        ['app-skill', 'repository', 'repository', REVISION],
        ['root-skill', 'repository', 'repository', REVISION],
      ],
    );
    assert.deepEqual(
      JSON.parse(fs.readFileSync(prepared.inventoryPath, 'utf8')),
      prepared.inventory,
    );
    assert.equal(
      fs.existsSync(path.join(value.home, '.agents', 'skills')),
      false,
    );
  } finally {
    cleanup(value.root);
  }
});

test('copies an explicitly configured project skill into the Codex user scope as read-only content', async () => {
  const value = fixture();
  const skillRoot = path.join(
    value.repositoryRoot,
    'custom',
    'skills',
    'test-authoring',
  );
  writeSkill(skillRoot, 'test-authoring', {
    'references/checklist.md': '# Checklist\n',
    'scripts/check.sh': '#!/bin/sh\nexit 0\n',
  });
  fs.chmodSync(path.join(skillRoot, 'scripts', 'check.sh'), 0o755);
  try {
    const prepared = await prepareAgentSkills(
      options(value, [
        { id: 'project-tests', path: 'custom/skills', type: 'project' },
      ]),
    );
    const installed = path.join(
      value.home,
      '.agents',
      'skills',
      'project-tests',
    );
    assert.equal(prepared.installedCount, 1);
    assert.equal(prepared.inventory.skills[0].directory, installed);
    assert.equal(
      fs.readFileSync(path.join(installed, 'SKILL.md'), 'utf8'),
      fs.readFileSync(path.join(skillRoot, 'SKILL.md'), 'utf8'),
    );
    assert.equal(fs.statSync(path.join(installed, 'SKILL.md')).mode & 0o222, 0);
    assert.equal(
      fs.statSync(path.join(installed, 'scripts', 'check.sh')).mode & 0o111,
      0o111,
    );
    assert.equal(fs.statSync(path.join(value.home, '.agents')).mode & 0o222, 0);
    assert.equal(
      fs.statSync(path.join(value.home, '.agents', 'skills')).mode & 0o222,
      0,
    );
  } finally {
    cleanup(value.root);
  }
});

test('installs skills without Linux copy_file_range privileges', async () => {
  const value = fixture();
  writeSkill(
    path.join(value.repositoryRoot, 'restricted-copy', 'skill'),
    'restricted-copy',
  );
  const originalCopyFileSync = fs.copyFileSync;
  fs.copyFileSync = () => {
    throw Object.assign(new Error('operation not permitted'), {
      code: 'EPERM',
    });
  };
  try {
    const prepared = await prepareAgentSkills(
      options(value, [
        {
          id: 'restricted-copy',
          path: 'restricted-copy',
          type: 'project',
        },
      ]),
    );
    assert.equal(prepared.installedCount, 1);
    assert.equal(
      fs.existsSync(
        path.join(
          value.home,
          '.agents',
          'skills',
          'restricted-copy',
          'SKILL.md',
        ),
      ),
      true,
    );
  } finally {
    fs.copyFileSync = originalCopyFileSync;
    cleanup(value.root);
  }
});

test('clones GitHub skill sources without placing credentials in argv or persisted inventory', async () => {
  const value = fixture();
  const token = 'github-secret-token';
  const invocations: Array<{
    args: string[];
    command: string;
    environment: NodeJS.ProcessEnv;
  }> = [];
  try {
    const prepared = await prepareAgentSkills({
      ...options(value, [
        {
          id: 'shared',
          path: '.agents/skills',
          ref: 'B'.repeat(40),
          repository: 'playrunner/shared-skills',
          type: 'github',
        },
      ]),
      githubToken: token,
      runCommand: async (command, args, processOptions) => {
        invocations.push({
          args,
          command,
          environment: processOptions?.env || {},
        });
        if (args[0] === 'fetch') {
          const cloneRoot = processOptions?.cwd;
          assert.ok(cloneRoot);
          writeSkill(
            path.join(cloneRoot, '.agents', 'skills', 'shared-skill'),
            'shared-skill',
          );
          return {
            code: 0,
            durationMs: 1,
            signal: null,
            stderr: '',
            stdout: '',
            timedOut: false,
          };
        }
        return {
          code: 0,
          durationMs: 1,
          signal: null,
          stderr: '',
          stdout: `${'b'.repeat(40)}\n`,
          timedOut: false,
        };
      },
    });
    assert.equal(prepared.installedCount, 1);
    assert.equal(prepared.inventory.skills[0].source.revision, 'b'.repeat(40));
    assert.equal(prepared.inventory.skills[0].source.ref, 'b'.repeat(40));
    const remoteInvocation = invocations.find(
      (invocation) => invocation.args[0] === 'remote',
    )!;
    const fetchInvocation = invocations.find(
      (invocation) => invocation.args[0] === 'fetch',
    )!;
    assert.equal(fetchInvocation.args.at(-1), 'b'.repeat(40));
    assert.equal(
      remoteInvocation.args.includes(
        'https://github.com/playrunner/shared-skills.git',
      ),
      true,
    );
    assert.doesNotMatch(JSON.stringify(invocations), /github-secret-token/);
    assert.match(
      String(fetchInvocation.environment.GIT_CONFIG_VALUE_0),
      /^Authorization: Basic /,
    );
    assert.doesNotMatch(JSON.stringify(prepared.inventory), /github-secret/);
    assert.equal(fs.existsSync(path.join(value.root, 'skill-sources')), false);
  } finally {
    cleanup(value.root);
  }
});

test('rejects symbolic links and removes skills installed earlier in a failed preparation', async () => {
  const value = fixture();
  writeSkill(path.join(value.repositoryRoot, 'valid', 'one'), 'valid-skill');
  const unsafe = path.join(value.repositoryRoot, 'unsafe');
  writeSkill(path.join(unsafe, 'linked-skill'), 'linked-skill');
  fs.symlinkSync(
    path.join(value.repositoryRoot, 'valid'),
    path.join(unsafe, 'outside'),
  );
  try {
    await assert.rejects(
      () =>
        prepareAgentSkills(
          options(value, [
            { id: 'valid', path: 'valid', type: 'project' },
            { id: 'unsafe', path: 'unsafe', type: 'project' },
          ]),
        ),
      /symbolic link/,
    );
    assert.equal(
      fs.existsSync(path.join(value.home, '.agents', 'skills', 'valid')),
      false,
    );
  } finally {
    cleanup(value.root);
  }
});

test('does not duplicate an explicitly configured canonical repository skill', async () => {
  const value = fixture();
  writeSkill(
    path.join(value.repositoryRoot, '.agents', 'skills', 'canonical'),
    'canonical',
  );
  try {
    const prepared = await prepareAgentSkills(
      options(value, [
        { id: 'configured', path: '.agents/skills', type: 'project' },
      ]),
    );
    assert.equal(prepared.inventory.skills.length, 1);
    assert.equal(prepared.inventory.skills[0].scope, 'repository');
    assert.equal(prepared.installedCount, 0);
  } finally {
    cleanup(value.root);
  }
});

test('supports a repository root that is itself one configured skill', async () => {
  const value = fixture();
  writeSkill(value.repositoryRoot, 'single-repository-skill');
  try {
    const prepared = await prepareAgentSkills(
      options(value, [{ id: 'single-skill', path: '.', type: 'project' }]),
    );
    assert.equal(prepared.installedCount, 1);
    assert.equal(
      fs.existsSync(
        path.join(value.home, '.agents', 'skills', 'single-skill', 'SKILL.md'),
      ),
      true,
    );
  } finally {
    cleanup(value.root);
  }
});

test('rejects an oversized SKILL.md before reading or installing it', async () => {
  const value = fixture();
  const skillDirectory = path.join(value.repositoryRoot, 'oversized');
  writeSkill(skillDirectory, 'oversized');
  fs.truncateSync(path.join(skillDirectory, 'SKILL.md'), 8 * 1024 * 1024 + 1);
  try {
    await assert.rejects(
      () =>
        prepareAgentSkills(
          options(value, [
            { id: 'oversized', path: 'oversized', type: 'project' },
          ]),
        ),
      /SKILL\.md.*no larger than/,
    );
    assert.equal(
      fs.existsSync(path.join(value.home, '.agents', 'skills', 'oversized')),
      false,
    );
  } finally {
    cleanup(value.root);
  }
});
