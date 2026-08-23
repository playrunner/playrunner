import fs from 'node:fs';
import path from 'node:path';
import { runProcess, type ProcessResult } from './process';

const DEFAULT_SKILLS_PATH = '.agents/skills';
const DEFAULT_GIT_REF = 'main';
const GIT_TIMEOUT_MS = 10 * 60_000;
const MAX_SKILL_SOURCES = 10;
const MAX_SKILLS = 100;
const MAX_SKILL_FILES = 2_000;
const MAX_SKILL_BYTES = 32 * 1024 * 1024;
const MAX_SKILL_FILE_BYTES = 8 * 1024 * 1024;
const MAX_SKILL_PATH_BYTES = 1_024;
const GIT_OBJECT_ID_PATTERN = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;

export type ProjectAgentSkillSource = {
  id: string;
  path: string;
  type: 'project';
};

export type GitHubAgentSkillSource = {
  id: string;
  path: string;
  ref: string;
  repository: string;
  type: 'github';
};

export type AgentSkillSource = ProjectAgentSkillSource | GitHubAgentSkillSource;

export type InstalledAgentSkill = {
  directory: string;
  name: string;
  scope: 'repository' | 'user';
  source: {
    id: string;
    path: string;
    ref?: string;
    repository?: string;
    revision: string;
    type: 'github' | 'project' | 'repository';
  };
};

export type AgentSkillsInventory = {
  schemaVersion: '1.0';
  skills: InstalledAgentSkill[];
};

type AgentIdentity = {
  gid: number;
  home: string;
  uid: number;
};

type RunCommand = (
  command: string,
  args: string[],
  options: Parameters<typeof runProcess>[2],
) => Promise<ProcessResult>;

export type PrepareAgentSkillsOptions = {
  destinationRoot?: string;
  environment?: NodeJS.ProcessEnv;
  githubToken?: string;
  identity: AgentIdentity;
  inventoryPath?: string;
  primaryRevision: string;
  repositoryRoot: string;
  runCommand?: RunCommand;
  sources: readonly AgentSkillSource[];
  stagingRoot?: string;
  workingDirectory: string;
};

export type PreparedAgentSkills = {
  inventory: AgentSkillsInventory;
  inventoryPath: string;
  installedCount: number;
};

type DiscoveredSkill = {
  directory: string;
  name: string;
};

type CopyBudget = {
  bytes: number;
  files: number;
  skills: number;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function assertOnlyKeys(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  field: string,
): void {
  const unexpected = Object.keys(value).find((key) => !allowed.has(key));
  if (unexpected) {
    throw new Error(`AI Container ${field}.${unexpected} is not supported.`);
  }
}

function requiredSourceId(value: unknown, field: string): string {
  const id = typeof value === 'string' ? value.trim() : '';
  if (!/^[a-z][a-z0-9-]{0,62}$/.test(id)) {
    throw new Error(
      `AI Container ${field} must start with a lowercase letter and contain at most 63 lowercase letters, numbers, or hyphens.`,
    );
  }
  return id;
}

function requiredSkillsPath(value: unknown, field: string): string {
  const skillPath = typeof value === 'string' ? value.trim() : '';
  const hasControlCharacter = Array.from(skillPath).some((character) => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127;
  });
  if (
    !skillPath ||
    Buffer.byteLength(skillPath, 'utf8') > MAX_SKILL_PATH_BYTES ||
    skillPath.startsWith('/') ||
    skillPath.includes('\\') ||
    skillPath.includes('\u0000') ||
    hasControlCharacter ||
    path.posix.normalize(skillPath) !== skillPath ||
    skillPath
      .split('/')
      .some(
        (segment) =>
          !segment ||
          segment === '..' ||
          (segment === '.' && skillPath !== '.') ||
          segment === '.git',
      )
  ) {
    throw new Error(
      `AI Container ${field} must be a normalized path inside its repository.`,
    );
  }
  return skillPath;
}

function requiredGitHubRepository(value: unknown, field: string): string {
  const repository =
    typeof value === 'string' ? value.trim().replace(/\.git$/i, '') : '';
  const segments = repository.split('/');
  if (
    Buffer.byteLength(repository, 'utf8') > 200 ||
    !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository) ||
    segments.some(
      (segment) =>
        segment.length > 100 ||
        !/^[A-Za-z0-9]/.test(segment) ||
        segment.endsWith('-'),
    )
  ) {
    throw new Error(
      `AI Container ${field} must be a GitHub repository in owner/repository form.`,
    );
  }
  return repository;
}

function requiredGitRef(value: unknown, field: string): string {
  const ref = typeof value === 'string' ? value.trim() : '';
  if (/^(?:[A-Fa-f0-9]{40}|[A-Fa-f0-9]{64})$/.test(ref)) {
    return ref.toLowerCase();
  }
  const components = ref.split('/');
  const hasForbiddenCharacter = Array.from(ref).some((character) => {
    const code = character.charCodeAt(0);
    return (
      code <= 32 ||
      code === 127 ||
      ['~', '^', ':', '?', '*', '[', '\\'].includes(character)
    );
  });
  if (
    !ref ||
    ref.length > 255 ||
    ref.startsWith('-') ||
    ref === '@' ||
    ref === 'HEAD' ||
    ref.startsWith('/') ||
    ref.startsWith('refs/') ||
    ref.endsWith('/') ||
    ref.endsWith('.') ||
    ref.endsWith('.lock') ||
    ref.includes('..') ||
    ref.includes('//') ||
    ref.includes('@{') ||
    components.some(
      (component) =>
        !component ||
        component.startsWith('.') ||
        component.endsWith('.') ||
        component.endsWith('.lock'),
    ) ||
    hasForbiddenCharacter
  ) {
    throw new Error(
      `AI Container ${field} must be a safe Git branch, tag, or complete commit SHA.`,
    );
  }
  return ref;
}

export function normalizeAgentSkillSources(value: unknown): AgentSkillSource[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_SKILL_SOURCES) {
    throw new Error(
      `AI Container config.skillSources must contain at most ${MAX_SKILL_SOURCES} entries.`,
    );
  }
  const sources = value.map((candidate, index): AgentSkillSource => {
    const source = record(candidate);
    const field = `config.skillSources[${index}]`;
    if (source.type === 'project') {
      assertOnlyKeys(source, new Set(['id', 'path', 'type']), field);
      return {
        id: requiredSourceId(source.id, `${field}.id`),
        path: requiredSkillsPath(source.path, `${field}.path`),
        type: 'project',
      };
    }
    if (source.type === 'github') {
      assertOnlyKeys(
        source,
        new Set(['id', 'path', 'ref', 'repository', 'type']),
        field,
      );
      return {
        id: requiredSourceId(source.id, `${field}.id`),
        path: requiredSkillsPath(
          source.path === undefined ? DEFAULT_SKILLS_PATH : source.path,
          `${field}.path`,
        ),
        ref: requiredGitRef(
          source.ref === undefined ? DEFAULT_GIT_REF : source.ref,
          `${field}.ref`,
        ),
        repository: requiredGitHubRepository(
          source.repository,
          `${field}.repository`,
        ),
        type: 'github',
      };
    }
    throw new Error(`AI Container ${field}.type must be project or github.`);
  });
  const ids = sources.map((source) => source.id.toLowerCase());
  if (new Set(ids).size !== ids.length) {
    throw new Error('AI Container Agent Skill source IDs must be unique.');
  }
  return sources;
}

function lstatIfExists(target: string): fs.Stats | undefined {
  try {
    return fs.lstatSync(target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

function isInside(parent: string, candidate: string): boolean {
  return candidate === parent || candidate.startsWith(`${parent}${path.sep}`);
}

function safeDirectoryInside(
  baseDirectory: string,
  relativePath: string,
  label: string,
  allowMissing = false,
): string | undefined {
  const base = fs.realpathSync(baseDirectory);
  const candidate = path.resolve(base, ...relativePath.split('/'));
  if (!isInside(base, candidate)) {
    throw new Error(`${label} escaped its repository.`);
  }
  const stat = lstatIfExists(candidate);
  if (!stat) {
    if (allowMissing) return undefined;
    throw new Error(`${label} does not exist.`);
  }
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error(`${label} must be a regular directory, not a symlink.`);
  }
  const realCandidate = fs.realpathSync(candidate);
  if (realCandidate !== candidate || !isInside(base, realCandidate)) {
    throw new Error(
      `${label} resolves through a symlink or outside its repository.`,
    );
  }
  return realCandidate;
}

function skillName(skillFile: string, fallback: string): string {
  const stat = fs.lstatSync(skillFile);
  if (
    stat.isSymbolicLink() ||
    !stat.isFile() ||
    stat.size > MAX_SKILL_FILE_BYTES
  ) {
    throw new Error(
      `Agent Skill SKILL.md must be a regular file no larger than ${MAX_SKILL_FILE_BYTES} bytes.`,
    );
  }
  const source = fs.readFileSync(skillFile, 'utf8');
  if (!source.trim() || !/^---\r?\n/.test(source)) {
    throw new Error(`Agent Skill ${skillFile} requires YAML frontmatter.`);
  }
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(
    source,
  )?.[1];
  if (!frontmatter || !/^description\s*:\s*\S+/m.test(frontmatter)) {
    throw new Error(
      `Agent Skill ${skillFile} requires name and description metadata.`,
    );
  }
  const rawName = /^name\s*:\s*(.+?)\s*$/m.exec(frontmatter)?.[1];
  const name = rawName
    ?.replace(/^(['"])(.*)\1$/, '$2')
    .trim()
    .slice(0, 256);
  if (
    !name ||
    Array.from(name).some((character) => {
      const code = character.charCodeAt(0);
      return code < 32 || code === 127;
    })
  ) {
    throw new Error(
      `Agent Skill ${skillFile} requires name and description metadata.`,
    );
  }
  return name || fallback;
}

function discoverSkills(
  sourceRoot: string,
  label: string,
  allowEmpty: boolean,
): DiscoveredSkill[] {
  const directSkill = path.join(sourceRoot, 'SKILL.md');
  const directStat = lstatIfExists(directSkill);
  let candidates: string[];
  if (directStat) {
    if (directStat.isSymbolicLink() || !directStat.isFile()) {
      throw new Error(`${label}/SKILL.md must be a regular file.`);
    }
    candidates = [sourceRoot];
  } else {
    candidates = [];
    const entries = fs.readdirSync(sourceRoot, { withFileTypes: true });
    if (entries.length > MAX_SKILL_FILES) {
      throw new Error(
        `Agent Skill source exceeds the ${MAX_SKILL_FILES} entry discovery limit.`,
      );
    }
    for (const entry of entries) {
      const candidate = path.join(sourceRoot, entry.name);
      if (entry.isSymbolicLink()) {
        throw new Error(`${label} contains a symbolic link: ${entry.name}`);
      }
      if (!entry.isDirectory()) continue;
      const manifest = lstatIfExists(path.join(candidate, 'SKILL.md'));
      if (!manifest) continue;
      if (manifest.isSymbolicLink() || !manifest.isFile()) {
        throw new Error(
          `${label}/${entry.name}/SKILL.md must be a regular file.`,
        );
      }
      candidates.push(candidate);
    }
  }
  candidates.sort();
  if (!candidates.length && !allowEmpty) {
    throw new Error(
      `${label} does not contain a SKILL.md or immediate skill directories.`,
    );
  }
  return candidates.map((directory) => ({
    directory,
    name: skillName(path.join(directory, 'SKILL.md'), path.basename(directory)),
  }));
}

function assertSafeSkillTree(
  directory: string,
  sourceRoot: string,
  budget: CopyBudget,
): void {
  const root = fs.realpathSync(sourceRoot);
  const skillRoot = fs.realpathSync(directory);
  const visit = (target: string): void => {
    if (
      target !== skillRoot &&
      path.relative(skillRoot, target).split(path.sep).includes('.git')
    ) {
      return;
    }
    const stat = fs.lstatSync(target);
    if (stat.isSymbolicLink()) {
      throw new Error(`Agent Skill contains a symbolic link: ${target}`);
    }
    const realTarget = fs.realpathSync(target);
    const relativePath = path.relative(skillRoot, realTarget);
    if (
      !isInside(root, realTarget) ||
      !isInside(skillRoot, realTarget) ||
      Buffer.byteLength(relativePath, 'utf8') > MAX_SKILL_PATH_BYTES ||
      Array.from(relativePath).some((character) => {
        const code = character.charCodeAt(0);
        return code < 32 || code === 127;
      })
    ) {
      throw new Error('Agent Skill content escaped its configured source.');
    }
    if (stat.isDirectory()) {
      for (const entry of fs.readdirSync(target)) {
        visit(path.join(target, entry));
      }
      return;
    }
    if (!stat.isFile()) {
      throw new Error(`Agent Skill contains a non-regular file: ${target}`);
    }
    budget.files += 1;
    budget.bytes += stat.size;
    if (stat.size > MAX_SKILL_FILE_BYTES) {
      throw new Error(
        `Agent Skill file exceeds the ${MAX_SKILL_FILE_BYTES} byte limit.`,
      );
    }
    if (budget.files > MAX_SKILL_FILES || budget.bytes > MAX_SKILL_BYTES) {
      throw new Error(
        `Agent Skills exceed the ${MAX_SKILL_FILES} file or ${MAX_SKILL_BYTES} byte limit.`,
      );
    }
  };
  visit(directory);
}

function copyReadOnlyTree(source: string, destination: string): void {
  const stat = fs.lstatSync(source);
  if (stat.isDirectory()) {
    fs.mkdirSync(destination, { mode: 0o755 });
    for (const entry of fs.readdirSync(source)) {
      if (entry === '.git') continue;
      copyReadOnlyTree(path.join(source, entry), path.join(destination, entry));
    }
    fs.chmodSync(destination, 0o555);
    return;
  }
  // The hardened Agent container deliberately omits CAP_FOWNER. Linux's
  // copy_file_range path (used by fs.copyFileSync) returns EPERM when the
  // cloned source is owned by the unprivileged agent identity, even though
  // the runner can safely read it. Skill files are already bounded above, so
  // copy them with an exclusive create instead of weakening the container.
  const contents = fs.readFileSync(source);
  fs.writeFileSync(destination, contents, { flag: 'wx', mode: 0o600 });
  fs.chmodSync(destination, stat.mode & 0o111 ? 0o555 : 0o444);
}

function sealReadOnlyTree(target: string): void {
  const stat = fs.lstatSync(target);
  if (stat.isSymbolicLink()) {
    throw new Error(`Agent Skill contains a symbolic link: ${target}`);
  }
  if (stat.isDirectory()) {
    for (const entry of fs.readdirSync(target)) {
      sealReadOnlyTree(path.join(target, entry));
    }
    if ((process.getuid?.() ?? -1) === 0) fs.chownSync(target, 0, 0);
    fs.chmodSync(target, 0o555);
    return;
  }
  if (!stat.isFile()) {
    throw new Error(`Agent Skill contains a non-regular file: ${target}`);
  }
  if ((process.getuid?.() ?? -1) === 0) fs.chownSync(target, 0, 0);
  fs.chmodSync(target, stat.mode & 0o111 ? 0o555 : 0o444);
}

function sealRepositorySkillsRoot(sourceRoot: string): void {
  if ((process.getuid?.() ?? -1) === 0) {
    fs.chownSync(sourceRoot, 0, 0);
    fs.chownSync(path.dirname(sourceRoot), 0, 0);
  }
  fs.chmodSync(sourceRoot, 0o555);
  fs.chmodSync(path.dirname(sourceRoot), 0o555);
}

function ensureOwnedDirectory(target: string, identity: AgentIdentity): void {
  const parent = path.dirname(target);
  if (parent !== target && !fs.existsSync(parent)) {
    ensureOwnedDirectory(parent, identity);
  }
  const existing = lstatIfExists(target);
  if (existing) {
    if (existing.isSymbolicLink() || !existing.isDirectory()) {
      throw new Error(
        `Agent Skills destination is not a regular directory: ${target}`,
      );
    }
    return;
  }
  fs.mkdirSync(target, { mode: 0o755 });
  fs.chownSync(target, identity.uid, identity.gid);
}

function prepareInstallDirectory(target: string): void {
  const parent = path.dirname(target);
  if (parent !== target && !fs.existsSync(parent)) {
    prepareInstallDirectory(parent);
  }
  const existing = lstatIfExists(target);
  if (existing) {
    if (existing.isSymbolicLink() || !existing.isDirectory()) {
      throw new Error(
        `Agent Skills destination is not a regular directory: ${target}`,
      );
    }
    fs.chmodSync(target, 0o755);
    return;
  }
  fs.mkdirSync(target, { mode: 0o755 });
}

function sealInstallDirectory(destinationRoot: string): void {
  const agentsRoot = path.dirname(destinationRoot);
  for (const target of [destinationRoot, agentsRoot]) {
    const stat = lstatIfExists(target);
    if (!stat) continue;
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new Error(
        `Agent Skills destination is not a regular directory: ${target}`,
      );
    }
    if ((process.getuid?.() ?? -1) === 0) {
      fs.chownSync(target, 0, 0);
    }
    fs.chmodSync(target, 0o555);
  }
}

function removeInstalledTree(target: string): void {
  const stat = lstatIfExists(target);
  if (!stat) return;
  if (stat.isSymbolicLink()) {
    fs.unlinkSync(target);
    return;
  }
  if (stat.isDirectory()) {
    fs.chmodSync(target, 0o755);
    for (const entry of fs.readdirSync(target)) {
      removeInstalledTree(path.join(target, entry));
    }
    fs.rmdirSync(target);
    return;
  }
  fs.chmodSync(target, 0o644);
  fs.unlinkSync(target);
}

function credentialFreeGitEnvironment(
  token: string | undefined,
  identity: AgentIdentity,
  environment: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const sanitized = { ...environment };
  for (const key of Object.keys(sanitized)) {
    if (
      key === 'GIT_CONFIG_COUNT' ||
      key === 'GIT_CONFIG_PARAMETERS' ||
      /^GIT_CONFIG_(?:KEY|VALUE)_\d+$/.test(key)
    ) {
      delete sanitized[key];
    }
  }
  const result: NodeJS.ProcessEnv = {
    ...sanitized,
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_SYSTEM: '/dev/null',
    GIT_TERMINAL_PROMPT: '0',
    HOME: identity.home,
  };
  if (!token) return result;
  return {
    ...result,
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'http.https://github.com/.extraheader',
    GIT_CONFIG_VALUE_0: `Authorization: Basic ${Buffer.from(
      `x-access-token:${token}`,
      'utf8',
    ).toString('base64')}`,
  };
}

async function cloneGitHubSkillSource(
  source: GitHubAgentSkillSource,
  target: string,
  options: PrepareAgentSkillsOptions,
): Promise<string> {
  const run = options.runCommand || runProcess;
  ensureOwnedDirectory(path.dirname(target), options.identity);
  ensureOwnedDirectory(target, options.identity);
  const credentialEnvironment = credentialFreeGitEnvironment(
    options.githubToken,
    options.identity,
    options.environment || process.env,
  );
  const inspectionEnvironment = credentialFreeGitEnvironment(
    undefined,
    options.identity,
    options.environment || process.env,
  );
  const runStep = async (
    args: string[],
    label: string,
    environment = inspectionEnvironment,
    maxOutputBytes = 1_000_000,
  ) => {
    const result = await run('git', args, {
      cwd: target,
      env: environment,
      gid: options.identity.gid,
      maxOutputBytes,
      timeoutMs: GIT_TIMEOUT_MS,
      uid: options.identity.uid,
    });
    if (result.code !== 0 || result.timedOut) {
      throw new Error(
        result.timedOut
          ? `Agent Skill repository ${label} timed out for ${source.repository}.`
          : `Agent Skill repository ${label} failed for ${source.repository} with code ${result.code}.`,
      );
    }
    if (result.stdoutTruncated || result.stderrTruncated) {
      throw new Error(
        `Agent Skill repository ${label} produced truncated output for ${source.repository}.`,
      );
    }
    return result;
  };
  await runStep(['init', '--quiet', '.'], 'initialization');
  await runStep(
    ['remote', 'add', 'origin', `https://github.com/${source.repository}.git`],
    'remote configuration',
  );
  await runStep(
    ['fetch', '--no-tags', '--depth', '1', 'origin', source.ref],
    'fetch',
    credentialEnvironment,
  );
  await runStep(['checkout', '--detach', '--force', 'FETCH_HEAD'], 'checkout');
  const revisionResult = await runStep(
    ['rev-parse', '--verify', 'HEAD^{commit}'],
    'revision verification',
    inspectionEnvironment,
    4_096,
  );
  const revision = revisionResult.stdout.trim().toLowerCase();
  if (!GIT_OBJECT_ID_PATTERN.test(revision)) {
    throw new Error(
      `Agent Skill repository revision could not be verified for ${source.repository}.`,
    );
  }
  if (GIT_OBJECT_ID_PATTERN.test(source.ref) && revision !== source.ref) {
    throw new Error(
      `Agent Skill repository checkout did not match the configured commit for ${source.repository}.`,
    );
  }
  return revision;
}

function canonicalSkillRoots(
  workingDirectory: string,
  repositoryRoot: string,
): string[] {
  const root = fs.realpathSync(repositoryRoot);
  const cwd = fs.realpathSync(workingDirectory);
  if (!isInside(root, cwd)) {
    throw new Error(
      'Agent Skills working directory is outside the repository.',
    );
  }
  const roots: string[] = [];
  let current = cwd;
  while (true) {
    const candidate = safeDirectoryInside(
      current,
      DEFAULT_SKILLS_PATH,
      `Repository Agent Skills at ${path.join(current, DEFAULT_SKILLS_PATH)}`,
      true,
    );
    if (candidate) roots.push(candidate);
    if (current === root) break;
    current = path.dirname(current);
  }
  return roots;
}

function writeInventory(
  inventory: AgentSkillsInventory,
  target: string,
): string {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(inventory, null, 2)}\n`, {
    mode: 0o444,
  });
  return target;
}

export async function prepareAgentSkills(
  options: PrepareAgentSkillsOptions,
): Promise<PreparedAgentSkills> {
  const sources = normalizeAgentSkillSources(options.sources);
  const destinationRoot =
    options.destinationRoot ||
    path.join(options.identity.home, '.agents', 'skills');
  const stagingRoot =
    options.stagingRoot || '/workspace/playrunner-skill-sources';
  const inventoryPath =
    options.inventoryPath || '/workspace/inputs/agent-skills.json';
  const budget: CopyBudget = { bytes: 0, files: 0, skills: 0 };
  const inventory: AgentSkillsInventory = {
    schemaVersion: '1.0',
    skills: [],
  };
  const seenDirectories = new Set<string>();
  const installedDirectories: string[] = [];

  const addSkills = (
    discovered: readonly DiscoveredSkill[],
    sourceRoot: string,
    source: InstalledAgentSkill['source'],
    scope: InstalledAgentSkill['scope'],
    install: boolean,
  ) => {
    for (const skill of discovered) {
      const realDirectory = fs.realpathSync(skill.directory);
      if (seenDirectories.has(realDirectory)) continue;
      assertSafeSkillTree(skill.directory, sourceRoot, budget);
      budget.skills += 1;
      if (budget.skills > MAX_SKILLS) {
        throw new Error(
          `Agent Skills exceed the ${MAX_SKILLS} discovered skill limit.`,
        );
      }
      seenDirectories.add(realDirectory);
      let directory = skill.directory;
      if (install) {
        prepareInstallDirectory(destinationRoot);
        const suffix = discovered.length === 1 ? '' : `-${budget.skills}`;
        directory = path.join(destinationRoot, `${source.id}${suffix}`);
        if (lstatIfExists(directory)) {
          throw new Error(
            `Agent Skill destination already exists for source ${source.id}.`,
          );
        }
        copyReadOnlyTree(skill.directory, directory);
        installedDirectories.push(directory);
      }
      inventory.skills.push({
        directory,
        name: skill.name,
        scope,
        source,
      });
    }
  };

  try {
    for (const [index, root] of canonicalSkillRoots(
      options.workingDirectory,
      options.repositoryRoot,
    ).entries()) {
      const discovered = discoverSkills(
        root,
        `Repository Agent Skills at ${root}`,
        true,
      );
      addSkills(
        discovered,
        root,
        {
          id: `repository-${index + 1}`,
          path:
            path.relative(fs.realpathSync(options.repositoryRoot), root) || '.',
          revision: options.primaryRevision,
          type: 'repository',
        },
        'repository',
        false,
      );
      for (const skill of discovered) sealReadOnlyTree(skill.directory);
      sealRepositorySkillsRoot(root);
    }

    if (sources.some((source) => source.type === 'github')) {
      fs.rmSync(stagingRoot, { force: true, recursive: true });
      ensureOwnedDirectory(stagingRoot, options.identity);
    }
    for (const [index, source] of sources.entries()) {
      let repositoryRoot = options.repositoryRoot;
      let revision = options.primaryRevision;
      let removeAfter = false;
      if (source.type === 'github') {
        repositoryRoot = path.join(stagingRoot, `source-${index + 1}`);
        revision = await cloneGitHubSkillSource(
          source,
          repositoryRoot,
          options,
        );
        removeAfter = true;
      }
      try {
        const root = safeDirectoryInside(
          repositoryRoot,
          source.path,
          `Agent Skill source ${source.id}`,
        )!;
        addSkills(
          discoverSkills(root, `Agent Skill source ${source.id}`, false),
          root,
          {
            id: source.id,
            path: source.path,
            ...(source.type === 'github'
              ? {
                  ref: source.ref,
                  repository: source.repository,
                }
              : {}),
            revision,
            type: source.type,
          },
          'user',
          true,
        );
      } finally {
        if (removeAfter) {
          fs.rmSync(repositoryRoot, { force: true, recursive: true });
        }
      }
    }
    inventory.skills.sort((left, right) =>
      left.name < right.name
        ? -1
        : left.name > right.name
          ? 1
          : left.directory < right.directory
            ? -1
            : 1,
    );
    return {
      installedCount: installedDirectories.length,
      inventory,
      inventoryPath: writeInventory(inventory, inventoryPath),
    };
  } catch (error) {
    for (const directory of installedDirectories.reverse()) {
      removeInstalledTree(directory);
    }
    throw error;
  } finally {
    if (lstatIfExists(destinationRoot)) {
      sealInstallDirectory(destinationRoot);
    }
    if (sources.some((source) => source.type === 'github')) {
      fs.rmSync(stagingRoot, { force: true, recursive: true });
    }
  }
}
