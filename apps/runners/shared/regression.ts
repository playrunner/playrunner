import { createHash } from 'node:crypto';
import path from 'node:path';

export const REGRESSION_LIMITS = {
  repositories: 16,
  files: 10_000,
  fileBytes: 512 * 1024,
  snapshotBytes: 16 * 1024 * 1024,
  dependencies: 30_000,
  journeys: 500,
  tests: 2_000,
  changes: 2_000,
  policyBytes: 2 * 1024 * 1024,
  planBytes: 512 * 1024,
} as const;

export class RegressionValidationError extends Error {}

export type RegressionFile = { repository: string; path: string };
export type RegressionSource = {
  repository: string;
  baseSha: string;
  headSha: string;
};
export type RegressionRequest = {
  version: 1;
  mode: 'affected' | 'full';
  sources: RegressionSource[];
};
export type RegressionTest = { file: string; project?: string };
export type RegressionJourney = {
  id: string;
  title: string;
  sources: RegressionFile[];
  tests: RegressionTest[];
};
export type RegressionPolicy = {
  version: 1;
  repositories: Array<{
    repository: string;
    revision?: string;
    aliases?: Record<string, string>;
  }>;
  dependencies: Array<{
    source: RegressionFile;
    consumer: RegressionFile;
    specifier?: string;
  }>;
  journeys: RegressionJourney[];
};
export type RegressionChange = RegressionFile & {
  status:
    | 'added'
    | 'modified'
    | 'deleted'
    | 'renamed'
    | 'copied'
    | 'type_changed';
  previousPath?: string;
};
/** Files includes every tree path; null means an asset whose content was not read. */
export type RegressionSnapshot = {
  repository: string;
  revision: string;
  files: Record<string, string | null>;
};
export type RegressionSelection = RegressionJourney & {
  reasons: Array<{ changed: RegressionFile; path: RegressionFile[] }>;
};
export type RegressionPlan = {
  version: 1;
  requestedMode: 'affected' | 'full';
  mode: 'affected' | 'full';
  hash: string;
  policyHash: string;
  snapshotRevisions: Array<{ repository: string; revision: string }>;
  sources: RegressionSource[];
  changedFiles: RegressionChange[];
  tests: RegressionTest[];
  journeys: RegressionSelection[];
  fallbackReasons: string[];
  truncation?: {
    changedFilesOmitted: number;
    journeysOmitted: number;
    reasonsOmitted: number;
    testsOmitted: number;
  };
};

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new RegressionValidationError(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function keys(
  value: Record<string, unknown>,
  allowed: string[],
  label: string,
) {
  if (Object.keys(value).some((key) => !allowed.includes(key))) {
    throw new RegressionValidationError(
      `${label} contains unsupported fields.`,
    );
  }
}

export function normalizeRegressionRepository(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length > 200 ||
    !/^[A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(value) ||
    value.endsWith('.git') ||
    value.split('/').some((part) => part.includes('..'))
  ) {
    throw new RegressionValidationError(
      'Regression repositories must use safe owner/repository identifiers.',
    );
  }
  return value.toLowerCase();
}

export function normalizeRegressionRevision(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-fA-F0-9]{40}$/.test(value)) {
    throw new RegressionValidationError(
      'Regression revisions must be immutable full 40-character Git SHAs.',
    );
  }
  return value.toLowerCase();
}

function controlCharacters(value: string, includeSpace = false): boolean {
  return [...value].some(
    (character) =>
      character.charCodeAt(0) <= (includeSpace ? 32 : 31) ||
      character.charCodeAt(0) === 127,
  );
}

export function normalizeRegressionPath(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !value ||
    value.length > 1024 ||
    /[\\:*?]/.test(value) ||
    controlCharacters(value) ||
    value.startsWith('/') ||
    value
      .split('/')
      .some(
        (part) =>
          !part || part === '.' || part === '..' || part.startsWith('-'),
      )
  ) {
    throw new RegressionValidationError(
      'Regression paths must be literal repository-relative paths without traversal or globs.',
    );
  }
  return value;
}

function array(value: unknown, maximum: number, label: string): unknown[] {
  if (!Array.isArray(value) || value.length > maximum) {
    throw new RegressionValidationError(
      `${label} must have at most ${maximum} entries.`,
    );
  }
  return value;
}

function file(value: unknown): RegressionFile {
  const item = object(value, 'Regression file');
  keys(item, ['repository', 'path'], 'Regression file');
  return {
    repository: normalizeRegressionRepository(item.repository),
    path: normalizeRegressionPath(item.path),
  };
}

export function parseRegressionRequest(value: unknown): RegressionRequest {
  const request = object(value, 'Regression request');
  keys(request, ['version', 'mode', 'sources'], 'Regression request');
  if (
    request.version !== 1 ||
    !['affected', 'full'].includes(String(request.mode))
  ) {
    throw new RegressionValidationError(
      'Regression request requires version 1 and mode affected or full.',
    );
  }
  const seen = new Set<string>();
  const sources = array(
    request.sources,
    REGRESSION_LIMITS.repositories,
    'Regression sources',
  ).map((entry) => {
    const source = object(entry, 'Regression source');
    keys(source, ['repository', 'baseSha', 'headSha'], 'Regression source');
    const result = {
      repository: normalizeRegressionRepository(source.repository),
      baseSha: normalizeRegressionRevision(source.baseSha),
      headSha: normalizeRegressionRevision(source.headSha),
    };
    if (result.baseSha === result.headSha || seen.has(result.repository)) {
      throw new RegressionValidationError(
        'Regression sources require distinct base/head commits and unique repositories.',
      );
    }
    seen.add(result.repository);
    return result;
  });
  if (!sources.length)
    throw new RegressionValidationError(
      'At least one regression source is required.',
    );
  return {
    version: 1,
    mode: request.mode as RegressionRequest['mode'],
    sources: sources.sort((a, b) => a.repository.localeCompare(b.repository)),
  };
}

export function parseRegressionPolicy(value: unknown): RegressionPolicy {
  const policy = object(value, 'Regression policy');
  keys(
    policy,
    ['version', 'repositories', 'dependencies', 'journeys'],
    'Regression policy',
  );
  if (
    policy.version !== 1 ||
    Buffer.byteLength(JSON.stringify(policy)) > REGRESSION_LIMITS.policyBytes
  ) {
    throw new RegressionValidationError(
      'Regression policy requires version 1 and must be at most 2 MiB.',
    );
  }
  const repositories = array(
    policy.repositories,
    REGRESSION_LIMITS.repositories,
    'Regression repositories',
  ).map((entry) => {
    const item = object(entry, 'Regression repository');
    keys(item, ['repository', 'revision', 'aliases'], 'Regression repository');
    const aliases: Record<string, string> = {};
    if (item.aliases !== undefined) {
      const configured = object(item.aliases, 'Regression aliases');
      if (Object.keys(configured).length > 100)
        throw new RegressionValidationError(
          'At most 100 aliases are supported per repository.',
        );
      for (const [name, target] of Object.entries(configured)) {
        if (
          !/^[@A-Za-z][A-Za-z0-9@_./-]*(?:\/\*)?$/.test(name) ||
          name.includes('..') ||
          ['__proto__', 'constructor', 'prototype'].includes(name)
        ) {
          throw new RegressionValidationError(
            'Regression aliases require a literal module name or a single trailing /*.',
          );
        }
        if (
          typeof target !== 'string' ||
          name.endsWith('/*') !== target.endsWith('/*')
        )
          throw new RegressionValidationError(
            'Regression alias wildcard and target must match.',
          );
        aliases[name] =
          normalizeRegressionPath(target.replace(/\/\*$/, '')) +
          (target.endsWith('/*') ? '/*' : '');
      }
    }
    return {
      repository: normalizeRegressionRepository(item.repository),
      ...(item.revision === undefined
        ? {}
        : { revision: normalizeRegressionRevision(item.revision) }),
      ...(Object.keys(aliases).length ? { aliases } : {}),
    };
  });
  const repositoryNames = new Set(repositories.map((item) => item.repository));
  if (!repositories.length || repositoryNames.size !== repositories.length)
    throw new RegressionValidationError(
      'Regression policy requires unique repositories.',
    );
  const checkedFile = (value: unknown) => {
    const result = file(value);
    if (!repositoryNames.has(result.repository))
      throw new RegressionValidationError(
        'Every mapped source must reference a configured regression repository.',
      );
    return result;
  };
  const dependencies = array(
    policy.dependencies ?? [],
    REGRESSION_LIMITS.dependencies,
    'Regression dependencies',
  ).map((entry) => {
    const item = object(entry, 'Regression dependency');
    keys(item, ['source', 'consumer', 'specifier'], 'Regression dependency');
    if (
      item.specifier !== undefined &&
      (typeof item.specifier !== 'string' ||
        !item.specifier ||
        item.specifier.length > 200 ||
        item.specifier.includes('\\') ||
        controlCharacters(item.specifier, true))
    )
      throw new RegressionValidationError(
        'Explicit dependency specifiers must be literal module names up to 200 characters.',
      );
    return {
      source: checkedFile(item.source),
      consumer: checkedFile(item.consumer),
      ...(item.specifier === undefined
        ? {}
        : { specifier: item.specifier as string }),
    };
  });
  let testCount = 0;
  const ids = new Set<string>();
  const journeys = array(
    policy.journeys,
    REGRESSION_LIMITS.journeys,
    'Regression journeys',
  ).map((entry) => {
    const item = object(entry, 'Regression journey');
    keys(item, ['id', 'title', 'sources', 'tests'], 'Regression journey');
    if (
      typeof item.id !== 'string' ||
      !/^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/.test(item.id) ||
      ids.has(item.id) ||
      typeof item.title !== 'string' ||
      !item.title.trim() ||
      item.title.length > 500
    ) {
      throw new RegressionValidationError(
        'Regression journeys require unique IDs and a readable title.',
      );
    }
    ids.add(item.id);
    const sources = array(item.sources, 1000, 'Journey sources').map(
      checkedFile,
    );
    const tests = array(
      item.tests,
      REGRESSION_LIMITS.tests,
      'Journey tests',
    ).map((entry) => {
      const mapped = object(entry, 'Regression test');
      keys(mapped, ['file', 'project'], 'Regression test');
      if (
        mapped.project !== undefined &&
        (typeof mapped.project !== 'string' ||
          mapped.project.length > 200 ||
          controlCharacters(mapped.project))
      )
        throw new RegressionValidationError(
          'Regression test projects must be strings up to 200 characters.',
        );
      return {
        file: normalizeRegressionPath(mapped.file),
        ...(mapped.project === undefined
          ? {}
          : { project: mapped.project as string }),
      };
    });
    testCount += tests.length;
    if (!sources.length || !tests.length || testCount > REGRESSION_LIMITS.tests)
      throw new RegressionValidationError(
        'Every regression journey needs source and test mappings; at most 2000 test mappings are supported.',
      );
    return { id: item.id, title: item.title.trim(), sources, tests };
  });
  return { version: 1, repositories, dependencies, journeys };
}

const SCRIPT = /\.(?:[cm]?[jt]sx?)$/i;
const UNSUPPORTED_SOURCE =
  /\.(?:vue|svelte|astro|mdx|html?|ejs|hbs|pug|erb|py|java|kt|kts|go|rs|cs|c|cc|cpp|h|hpp|rb|php|swift|dart)$/i;
const GLOBAL_CHANGE =
  /(?:^|\/)(?:package(?:-lock)?\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|(?:tsconfig|jsconfig)(?:\.[^/]+)?\.json|(?:playwright|vite|webpack|rollup|next|vitest|jest|babel|eslint)[^/]*\.(?:[cm]?[jt]s|json)|Dockerfile[^/]*|\.env(?:\.[^/]+)?|regression[^/]*\.json)$/i;
const BUILTINS = new Set([
  'assert',
  'async_hooks',
  'buffer',
  'child_process',
  'cluster',
  'console',
  'constants',
  'crypto',
  'dgram',
  'diagnostics_channel',
  'dns',
  'domain',
  'events',
  'fs',
  'http',
  'http2',
  'https',
  'module',
  'net',
  'os',
  'path',
  'perf_hooks',
  'process',
  'punycode',
  'querystring',
  'readline',
  'repl',
  'stream',
  'string_decoder',
  'sys',
  'timers',
  'tls',
  'trace_events',
  'tty',
  'url',
  'util',
  'v8',
  'vm',
  'wasi',
  'worker_threads',
  'zlib',
  'test',
]);
type Token = { kind: 'word' | 'string' | 'punctuation'; value: string };

function staticImports(text: string): { imports: string[]; issues: string[] } {
  const tokens: Token[] = [];
  const issues: string[] = [];
  let index = 0;
  while (index < text.length) {
    const char = text[index];
    if (/\s/.test(char)) {
      index++;
      continue;
    }
    if (text.startsWith('//', index)) {
      const end = text.indexOf('\n', index + 2);
      index = end < 0 ? text.length : end + 1;
      continue;
    }
    if (text.startsWith('/*', index)) {
      const end = text.indexOf('*/', index + 2);
      if (end < 0) {
        issues.push('Unterminated comment');
        break;
      }
      index = end + 2;
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      const quote = char;
      const start = ++index;
      let escaped = false;
      while (index < text.length && text[index] !== quote) {
        if (text[index] === '\\') {
          escaped = true;
          index += 2;
        } else index++;
      }
      if (index >= text.length) {
        issues.push('Unterminated string');
        break;
      }
      const value = text.slice(start, index++);
      if (quote === '`') {
        if (/\$\{[\s\S]*\b(?:import|require)\b/.test(value))
          issues.push(
            'Import inside a template expression requires an explicit dependency',
          );
        tokens.push({ kind: 'punctuation', value: '`' });
      } else tokens.push({ kind: 'string', value: escaped ? '\0' : value });
      continue;
    }
    if (/[A-Za-z_$]/.test(char)) {
      const start = index++;
      while (index < text.length && /[A-Za-z0-9_$]/.test(text[index])) index++;
      tokens.push({ kind: 'word', value: text.slice(start, index) });
    } else {
      tokens.push({ kind: 'punctuation', value: char });
      index++;
    }
  }
  const imports: string[] = [];
  const add = (token: Token | undefined) => {
    if (
      token?.kind !== 'string' ||
      token.value.includes('\0') ||
      !token.value ||
      token.value.length > 1024
    )
      issues.push(
        'Computed or escaped module specifier cannot be resolved safely',
      );
    else imports.push(token.value);
  };
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.kind !== 'word') continue;
    if (
      ['eval', 'Function'].includes(token.value) &&
      tokens[i + 1]?.value === '('
    ) {
      issues.push('Runtime-generated code requires full regression');
      continue;
    }
    if (token.value === 'require' && tokens[i + 1]?.value === '.') {
      if (
        tokens[i + 2]?.value === 'resolve' &&
        tokens[i + 3]?.value === '(' &&
        tokens[i + 5]?.value === ')'
      )
        add(tokens[i + 4]);
      else issues.push('Dynamic require helper requires full regression');
      continue;
    }
    if (token.value === 'require' && tokens[i + 1]?.value === '[') {
      issues.push('Computed require helper requires full regression');
      continue;
    }
    if (token.value === 'require' && tokens[i + 1]?.value === '(') {
      if (tokens[i + 3]?.value !== ')')
        issues.push('Computed require expression cannot be resolved safely');
      else add(tokens[i + 2]);
      continue;
    }
    if (token.value === 'require') {
      issues.push('Aliased or computed require requires full regression');
      continue;
    }
    if (token.value === 'import') {
      if (tokens[i + 1]?.value === '.') {
        if (
          tokens[i + 2]?.value === 'meta' &&
          tokens[i + 3]?.value === '.' &&
          tokens[i + 4]?.value.startsWith('glob')
        )
          issues.push('import.meta.glob requires full regression');
        continue;
      }
      if (tokens[i + 1]?.value === '(') {
        if (![')', ','].includes(tokens[i + 3]?.value))
          issues.push('Computed import expression cannot be resolved safely');
        else add(tokens[i + 2]);
        continue;
      }
      if (tokens[i + 1]?.kind === 'string') {
        add(tokens[i + 1]);
        continue;
      }
      let found = false;
      for (let j = i + 1; j < Math.min(tokens.length, i + 1000); j++) {
        if (tokens[j].value === ';') break;
        if (tokens[j].value === 'from') {
          add(tokens[j + 1]);
          found = true;
          break;
        }
        if (tokens[j].value === '=' && tokens[j + 1]?.value === 'require') {
          found = true;
          break;
        }
      }
      if (!found) issues.push('Unsupported import declaration');
    }
    if (
      token.value === 'export' &&
      ['*', '{', 'type'].includes(tokens[i + 1]?.value)
    ) {
      for (let j = i + 1; j < Math.min(tokens.length, i + 1000); j++) {
        if (tokens[j].value === ';') break;
        if (tokens[j].value === 'from') {
          add(tokens[j + 1]);
          break;
        }
        // A local export followed by the next declaration has no dependency.
        if (
          j > i + 1 &&
          ['export', 'import', 'const', 'function', 'class'].includes(
            tokens[j].value,
          )
        )
          break;
      }
    }
  }
  return { imports: [...new Set(imports)], issues: [...new Set(issues)] };
}

function key(file: RegressionFile): string {
  return `${file.repository}:${file.path}`;
}
function decodeKey(value: string): RegressionFile {
  const split = value.indexOf(':');
  return { repository: value.slice(0, split), path: value.slice(split + 1) };
}
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([name, item]) => [name, stable(item)]),
    );
  return value;
}
function hash(value: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(stable(value)))
    .digest('hex');
}
function withHash(input: Omit<RegressionPlan, 'hash'>): RegressionPlan {
  const plan = structuredClone(input);
  const truncation = plan.truncation || {
    changedFilesOmitted: 0,
    journeysOmitted: 0,
    reasonsOmitted: 0,
    testsOmitted: 0,
  };
  // Leave headroom for surrounding report metadata and the final hash.
  const tooLarge = () =>
    Buffer.byteLength(JSON.stringify(plan)) >
    REGRESSION_LIMITS.planBytes - 1024;
  if (tooLarge()) {
    plan.mode = 'full';
    plan.fallbackReasons = [
      ...new Set([
        ...plan.fallbackReasons,
        'Impact evidence exceeded the report size limit; the full suite is required',
      ]),
    ].sort();
    plan.truncation = truncation;
    while (tooLarge() && plan.journeys.length) {
      const journey = plan.journeys.pop()!;
      truncation.journeysOmitted++;
      truncation.reasonsOmitted += journey.reasons.length;
    }
    while (tooLarge() && plan.tests.length) {
      plan.tests.pop();
      truncation.testsOmitted++;
    }
    while (tooLarge() && plan.changedFiles.length) {
      plan.changedFiles.pop();
      truncation.changedFilesOmitted++;
    }
    while (tooLarge() && plan.fallbackReasons.length > 1)
      plan.fallbackReasons.splice(0, 1);
  }
  return { ...plan, hash: hash(plan) };
}

export function widenRegressionPlan(
  plan: RegressionPlan,
  reason: string,
): RegressionPlan {
  const { hash: _hash, ...rest } = plan;
  return withHash({
    ...rest,
    mode: 'full',
    fallbackReasons: [
      ...new Set([...plan.fallbackReasons, reason.slice(0, 1500)]),
    ].sort(),
  });
}

function externalModules(
  snapshot: RegressionSnapshot,
  issues: string[],
): Set<string> {
  const modules = new Set<string>();
  for (const [name, content] of Object.entries(snapshot.files)) {
    if (path.posix.basename(name) !== 'package.json' || content === null)
      continue;
    try {
      const manifest = JSON.parse(content);
      for (const kind of [
        'dependencies',
        'devDependencies',
        'peerDependencies',
        'optionalDependencies',
      ]) {
        for (const [dependency, version] of Object.entries(
          manifest[kind] || {},
        )) {
          // Workspace/file dependencies need aliases or explicit dependency links.
          if (
            typeof version === 'string' &&
            !/^(?:workspace:|file:|link:)/.test(version)
          )
            modules.add(dependency);
        }
      }
    } catch {
      issues.push(`Invalid package manifest ${snapshot.repository}:${name}`);
    }
  }
  return modules;
}

function resolveImport(
  importer: string,
  specifier: string,
  snapshot: RegressionSnapshot,
  aliases: Record<string, string>,
  external: Set<string>,
): string | null | undefined {
  let target: string | undefined;
  if (specifier.startsWith('.'))
    target = path.posix.normalize(
      path.posix.join(path.posix.dirname(importer), specifier),
    );
  else {
    for (const [name, replacement] of Object.entries(aliases).sort(
      ([a], [b]) => b.length - a.length,
    )) {
      if (name.endsWith('/*') && specifier.startsWith(name.slice(0, -1))) {
        target = replacement.slice(0, -1) + specifier.slice(name.length - 1);
        break;
      }
      if (name === specifier) {
        target = replacement;
        break;
      }
    }
    if (target === undefined) {
      const packageName = specifier.startsWith('@')
        ? specifier.split('/').slice(0, 2).join('/')
        : specifier.split('/')[0];
      if (
        specifier.startsWith('node:') ||
        BUILTINS.has(packageName) ||
        external.has(packageName)
      )
        return null;
      return undefined;
    }
  }
  target = path.posix.normalize(target);
  if (target.startsWith('../') || target.startsWith('/') || target === '..')
    return undefined;
  const candidates = [target];
  if (/\.[cm]?jsx?$/.test(target))
    candidates.push(
      target.replace(/\.js$/, '.ts'),
      target.replace(/\.js$/, '.tsx'),
      target.replace(/\.mjs$/, '.mts'),
      target.replace(/\.cjs$/, '.cts'),
      target.replace(/\.jsx$/, '.tsx'),
    );
  if (!path.posix.extname(target))
    for (const extension of [
      '.ts',
      '.tsx',
      '.js',
      '.jsx',
      '.mts',
      '.cts',
      '.mjs',
      '.cjs',
      '.json',
    ])
      candidates.push(target + extension, `${target}/index${extension}`);
  const found = [...new Set(candidates)].filter((candidate) =>
    Object.hasOwn(snapshot.files, candidate),
  );
  // Ambiguous TS/JS shadowing cannot safely exclude either consumer.
  return found.length === 1 ? found[0] : undefined;
}

export function buildRegressionPlan(input: {
  request: RegressionRequest;
  policy: RegressionPolicy;
  snapshots: RegressionSnapshot[];
  changes: RegressionChange[];
  issues?: string[];
  testRepository?: string;
  testFolder?: string;
}): RegressionPlan {
  const request = parseRegressionRequest(input.request);
  const policy = parseRegressionPolicy(input.policy);
  const issues = [...(input.issues || [])];
  const reverse = new Map<string, Set<string>>();
  const knownFiles = new Set<string>();
  let edgeCount = 0;
  const edge = (source: string, consumer: string) => {
    if (++edgeCount > REGRESSION_LIMITS.dependencies) {
      issues.push('Dependency graph exceeds the supported limit');
      return;
    }
    if (!reverse.has(source)) reverse.set(source, new Set());
    reverse.get(source)!.add(consumer);
  };
  const snapshotRevisions = input.snapshots
    .map(({ repository, revision }) => ({ repository, revision }))
    .sort(
      (a, b) =>
        a.repository.localeCompare(b.repository) ||
        a.revision.localeCompare(b.revision),
    );
  for (const source of request.sources) {
    for (const revision of [source.baseSha, source.headSha])
      if (
        !input.snapshots.some(
          (item) =>
            item.repository === source.repository && item.revision === revision,
        )
      )
        issues.push(
          `Missing immutable snapshot ${source.repository}@${revision}`,
        );
  }
  for (const repository of policy.repositories) {
    if (
      !input.snapshots.some(
        (snapshot) => snapshot.repository === repository.repository,
      )
    )
      issues.push(`Missing configured repository ${repository.repository}`);
  }
  const changedFiles = [...input.changes].sort(
    (a, b) => key(a).localeCompare(key(b)) || a.status.localeCompare(b.status),
  );
  if (changedFiles.length > REGRESSION_LIMITS.changes)
    issues.push('Changed-file count exceeds the supported limit');
  for (const snapshot of input.snapshots) {
    const repository = policy.repositories.find(
      (item) => item.repository === snapshot.repository,
    );
    const entries = Object.entries(snapshot.files);
    if (entries.length > REGRESSION_LIMITS.files) {
      issues.push(
        `Repository file count exceeds the supported limit: ${snapshot.repository}`,
      );
      continue;
    }
    let bytes = 0;
    for (const [name, content] of entries) {
      knownFiles.add(key({ repository: snapshot.repository, path: name }));
      if (UNSUPPORTED_SOURCE.test(name))
        issues.push(
          `Unsupported source language may contain untracked consumers: ${snapshot.repository}:${name}`,
        );
      bytes += content === null ? 0 : Buffer.byteLength(content);
    }
    if (bytes > REGRESSION_LIMITS.snapshotBytes) {
      issues.push(
        `Repository content exceeds the supported limit: ${snapshot.repository}`,
      );
      continue;
    }
    const external = externalModules(snapshot, issues);
    for (const [name, content] of entries) {
      if (!SCRIPT.test(name)) continue;
      if (
        content === null ||
        Buffer.byteLength(content) > REGRESSION_LIMITS.fileBytes
      ) {
        issues.push(`Unreadable source ${snapshot.repository}:${name}`);
        continue;
      }
      const scanned = staticImports(content);
      for (const issue of scanned.issues)
        issues.push(`${snapshot.repository}:${name}: ${issue}`);
      for (const specifier of scanned.imports) {
        const resolved = resolveImport(
          name,
          specifier,
          snapshot,
          repository?.aliases || {},
          external,
        );
        if (resolved === undefined) {
          const explicit = policy.dependencies.some(
            (dependency) =>
              dependency.consumer.repository === snapshot.repository &&
              dependency.consumer.path === name &&
              dependency.specifier === specifier,
          );
          if (!explicit)
            issues.push(
              `Unresolved dependency ${snapshot.repository}:${name} -> ${specifier}`,
            );
        } else if (resolved !== null)
          edge(
            key({ repository: snapshot.repository, path: resolved }),
            key({ repository: snapshot.repository, path: name }),
          );
      }
    }
  }
  for (const dependency of policy.dependencies) {
    if (
      !knownFiles.has(key(dependency.source)) ||
      !knownFiles.has(key(dependency.consumer))
    )
      issues.push(
        `Explicit dependency references missing source: ${key(dependency.source)} -> ${key(dependency.consumer)}`,
      );
    else edge(key(dependency.source), key(dependency.consumer));
  }
  for (const journey of policy.journeys)
    for (const source of journey.sources) {
      if (!knownFiles.has(key(source)))
        issues.push(
          `Journey ${journey.id} references missing source ${key(source)}`,
        );
    }
  const selected = new Map<string, RegressionSelection>();
  const mappedTestFiles = new Set<string>();
  if (input.testRepository) {
    const repository = normalizeRegressionRepository(input.testRepository);
    const folder = (input.testFolder || '').replace(/^\/+|\/+$/g, '');
    if (folder) normalizeRegressionPath(folder);
    for (const journey of policy.journeys)
      for (const mapped of journey.tests)
        mappedTestFiles.add(
          key({ repository, path: path.posix.join(folder, mapped.file) }),
        );
  }
  let reasonPathEntries = 0;
  let reasonsOmitted = 0;
  for (const changed of changedFiles.slice(0, REGRESSION_LIMITS.changes)) {
    if (
      GLOBAL_CHANGE.test(changed.path) ||
      (changed.previousPath && GLOBAL_CHANGE.test(changed.previousPath))
    )
      issues.push(`Global configuration changed: ${key(changed)}`);
    if (!SCRIPT.test(changed.path))
      issues.push(
        `Changed file needs broader regression coverage: ${key(changed)}`,
      );
    const starts = [
      key(changed),
      ...(changed.previousPath
        ? [key({ repository: changed.repository, path: changed.previousPath })]
        : []),
    ];
    const paths = new Map<string, string[]>(
      starts.map((start) => [start, [start]]),
    );
    const queue = [...starts];
    while (queue.length) {
      const current = queue.shift()!;
      if (paths.size > REGRESSION_LIMITS.files) {
        issues.push(
          'Affected dependency traversal exceeds the supported limit',
        );
        break;
      }
      for (const consumer of [...(reverse.get(current) || [])].sort()) {
        if (!paths.has(consumer)) {
          if (paths.get(current)!.length >= 100) {
            issues.push('Affected dependency path exceeds the supported depth');
            continue;
          }
          paths.set(consumer, [...paths.get(current)!, consumer]);
          queue.push(consumer);
        }
      }
    }
    // A mapped form does not excuse an unmapped sibling consumer of a shared control.
    const mappedSources = new Set(
      policy.journeys.flatMap((journey) => journey.sources.map(key)),
    );
    const coverageMemo = new Map<string, boolean>();
    let coverageVisits = 0;
    const covered = (
      current: string,
      visiting: Set<string>,
      root = false,
    ): boolean => {
      if (!root && coverageMemo.has(current)) return coverageMemo.get(current)!;
      if (++coverageVisits > REGRESSION_LIMITS.dependencies) return false;
      if (visiting.has(current) || visiting.size >= 100) return false;
      const consumers = [...(reverse.get(current) || [])];
      if (!consumers.length)
        return mappedSources.has(current) || mappedTestFiles.has(current);
      const next = new Set(visiting).add(current);
      const result = consumers.every((consumer) => covered(consumer, next));
      if (!root) coverageMemo.set(current, result);
      return result;
    };
    if (!starts.every((start) => covered(start, new Set(), true)))
      issues.push(
        `An affected consumer pathway has no journey mapping: ${key(changed)}`,
      );
    let mapped = false;
    for (const journey of policy.journeys) {
      const matching = journey.sources
        .map((source) => paths.get(key(source)))
        .find(Boolean);
      if (!matching) continue;
      mapped = true;
      const value = selected.get(journey.id) || { ...journey, reasons: [] };
      if (
        value.reasons.length < 5 &&
        reasonPathEntries + matching.length <= 1000
      ) {
        value.reasons.push({
          changed: { repository: changed.repository, path: changed.path },
          path: matching.map(decodeKey),
        });
        reasonPathEntries += matching.length;
      } else reasonsOmitted++;
      selected.set(journey.id, value);
    }
    if (!mapped) issues.push(`No journey covers changed file ${key(changed)}`);
  }
  const journeys = [...selected.values()].sort((a, b) =>
    a.id.localeCompare(b.id),
  );
  const tests = [
    ...new Map(
      journeys
        .flatMap((journey) => journey.tests)
        .map((test) => [`${test.file}\0${test.project ?? '*'}`, test]),
    ).values(),
  ].sort(
    (a, b) =>
      a.file.localeCompare(b.file) ||
      (a.project || '').localeCompare(b.project || ''),
  );
  if (!changedFiles.length)
    issues.push(
      'No changed files were detected; run the full suite instead of returning an empty success',
    );
  if (!tests.length) issues.push('No mapped regression tests were selected');
  if (reasonsOmitted)
    issues.push(
      'Impact explanation exceeded the supported limit; the full suite is required',
    );
  return withHash({
    version: 1,
    requestedMode: request.mode,
    mode: request.mode === 'full' || issues.length ? 'full' : 'affected',
    policyHash: hash(policy),
    snapshotRevisions,
    sources: request.sources,
    changedFiles,
    tests,
    journeys,
    fallbackReasons: [...new Set(issues.map((issue) => issue.slice(0, 1500)))]
      .sort()
      .slice(0, 200),
    ...(reasonsOmitted
      ? {
          truncation: {
            changedFilesOmitted: 0,
            journeysOmitted: 0,
            reasonsOmitted,
            testsOmitted: 0,
          },
        }
      : {}),
  });
}
