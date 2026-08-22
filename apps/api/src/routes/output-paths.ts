import fs from 'node:fs';
import path from 'path';

const MAX_PATH_SEGMENT_LENGTH = 255;
const SAFE_OUTPUT_PATH_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

const DEFAULT_MEDIA_WALK_LIMITS = Object.freeze({
  maxDepth: 16,
  maxEntries: 10_000,
});

type MediaWalkLimits = typeof DEFAULT_MEDIA_WALK_LIMITS;

function isContainedPath(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative === '' ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== '..' &&
      !path.isAbsolute(relative))
  );
}

export function isSafeOutputPathSegment(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= MAX_PATH_SEGMENT_LENGTH &&
    SAFE_OUTPUT_PATH_SEGMENT.test(value) &&
    value !== '.' &&
    value !== '..' &&
    !value.includes('/') &&
    !value.includes('\\') &&
    !value.includes('\0') &&
    !path.isAbsolute(value) &&
    path.basename(value) === value
  );
}

export function resolveOutputDirectory(
  outputRoot: string,
  testId: string,
  nodeId: string,
): string {
  if (!isSafeOutputPathSegment(testId) || !isSafeOutputPathSegment(nodeId)) {
    throw new Error('Invalid output path.');
  }

  const resolvedRoot = path.resolve(outputRoot);
  const resolvedDirectory = path.resolve(resolvedRoot, testId, nodeId);
  if (!resolvedDirectory.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error('Output path escapes the configured root.');
  }
  return resolvedDirectory;
}

export function encodeRelativeOutputPath(
  outputsDir: string,
  filePath: string,
): string {
  const relative = path.relative(outputsDir, filePath);
  if (
    !relative ||
    path.isAbsolute(relative) ||
    relative === '..' ||
    relative.startsWith(`..${path.sep}`)
  ) {
    throw new Error('Output file path escapes the output directory.');
  }
  return relative
    .split(path.sep)
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

export function findSafeOutputMedia(
  outputsDir: string,
  configuredLimits?: Partial<MediaWalkLimits>,
): string[] {
  const limits = { ...DEFAULT_MEDIA_WALK_LIMITS, ...configuredLimits };
  if (
    !Number.isSafeInteger(limits.maxDepth) ||
    limits.maxDepth < 0 ||
    !Number.isSafeInteger(limits.maxEntries) ||
    limits.maxEntries <= 0
  ) {
    throw new Error('Media traversal limits are invalid.');
  }

  const outputStat = fs.lstatSync(outputsDir);
  if (!outputStat.isDirectory() || outputStat.isSymbolicLink()) {
    throw new Error('Output path must be a real directory.');
  }
  const realOutputRoot = fs.realpathSync(outputsDir);
  const testResultsDir = path.join(outputsDir, 'test-results');
  if (!fs.existsSync(testResultsDir)) return [];

  const testResultsStat = fs.lstatSync(testResultsDir);
  if (!testResultsStat.isDirectory() || testResultsStat.isSymbolicLink()) {
    return [];
  }
  const realTestResults = fs.realpathSync(testResultsDir);
  if (!isContainedPath(realOutputRoot, realTestResults)) {
    throw new Error('Test results directory escapes the output root.');
  }

  const media: string[] = [];
  let traversalExhausted = false;
  let visitedEntries = 0;
  const visit = (directory: string, depth: number): void => {
    if (traversalExhausted) return;
    const directoryStat = fs.lstatSync(directory);
    if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) {
      return;
    }
    const realDirectory = fs.realpathSync(directory);
    if (!isContainedPath(realOutputRoot, realDirectory)) {
      throw new Error('Media directory escapes the output root.');
    }

    for (const name of fs.readdirSync(directory).sort()) {
      if (visitedEntries >= limits.maxEntries) {
        traversalExhausted = true;
        return;
      }
      visitedEntries += 1;
      const candidate = path.join(directory, name);
      const stat = fs.lstatSync(candidate);
      if (stat.isSymbolicLink()) continue;

      const realCandidate = fs.realpathSync(candidate);
      if (!isContainedPath(realOutputRoot, realCandidate)) {
        throw new Error('Media path escapes the output root.');
      }
      if (stat.isDirectory()) {
        if (depth >= limits.maxDepth) continue;
        visit(candidate, depth + 1);
      } else if (
        stat.isFile() &&
        (name.endsWith('.webm') || name.endsWith('.png'))
      ) {
        media.push(candidate);
      }
    }
  };

  visit(testResultsDir, 0);
  return media.sort((left, right) => left.localeCompare(right));
}
