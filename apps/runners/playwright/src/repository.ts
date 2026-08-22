import path from 'node:path';
import fs from 'node:fs';

export function normalizeGitHubRepository(value: unknown): string {
  const repository = String(value || '')
    .trim()
    .replace(/\.git$/, '');
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
    throw new Error(
      'Playwright requires a GitHub repository in owner/repository form.',
    );
  }
  return repository;
}

export function createGitCredentialEnvironment(
  token: string | undefined,
  environment: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const result = { ...environment, GIT_TERMINAL_PROMPT: '0' };
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

export function resolveRepositoryWorkingDirectory(
  repositoryRoot: string,
  folder: unknown,
): string {
  const configuredFolder = String(folder || '.');
  const candidate = path.resolve(repositoryRoot, configuredFolder);
  let realRepositoryRoot = '';
  let realCandidate = '';
  try {
    realRepositoryRoot = fs.realpathSync(repositoryRoot);
    realCandidate = fs.realpathSync(candidate);
  } catch {
    throw new Error(
      `Working folder does not exist in the repository: ${configuredFolder}`,
    );
  }
  if (
    (realCandidate !== realRepositoryRoot &&
      !realCandidate.startsWith(`${realRepositoryRoot}${path.sep}`)) ||
    !fs.statSync(realCandidate).isDirectory()
  ) {
    throw new Error(
      `Working folder must resolve to a directory inside the repository: ${configuredFolder}`,
    );
  }
  return candidate;
}
