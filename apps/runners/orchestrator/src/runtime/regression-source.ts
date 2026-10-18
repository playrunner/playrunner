import {
  normalizeRegressionRepository,
  parseRegressionRequest,
  parseRegressionPolicy,
} from '../../../shared/regression';

// Only the repository named by an immutable source comparison is pinned. A
// release's separate test-repository pin must agree rather than being replaced.
export function resolveRegressionSourceRevision(
  config: Record<string, unknown>,
  request: unknown,
  existingRevision?: string,
): string | undefined {
  if (request === undefined) return existingRevision;
  const parsed = parseRegressionRequest(request);
  if (!(config.action === 'clone' || (!config.action && config.repository))) {
    return existingRevision;
  }
  const repository = normalizeRegressionRepository(
    typeof config.repository === 'string'
      ? config.repository.trim().replace(/\.git$/, '')
      : config.repository,
  );
  const source = parsed.sources.find((item) => item.repository === repository);
  const pinned =
    source?.headSha ||
    (config.regression === undefined
      ? undefined
      : parseRegressionPolicy(config.regression).repositories.find(
          (item) => item.repository === repository,
        )?.revision);
  if (!pinned) return existingRevision;
  if (existingRevision && existingRevision.toLowerCase() !== pinned) {
    throw new Error(
      'Regression source head conflicts with the pinned test repository revision.',
    );
  }
  return pinned;
}
