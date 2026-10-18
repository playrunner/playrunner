import {
  normalizeRegressionRepository,
  parseRegressionPolicy,
  parseRegressionRequest,
  RegressionValidationError,
  type RegressionPolicy,
  type RegressionRequest,
} from '../../../runners/shared/regression';

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function repositoryName(value: unknown) {
  return normalizeRegressionRepository(
    typeof value === 'string' ? value.trim().replace(/\.git$/, '') : value,
  );
}

/** The saved workflow, never a run caller, owns the impact mapping. */
export function validateRegressionExecution(
  body: Record<string, unknown>,
  savedNodes: unknown,
):
  | {
      request: RegressionRequest;
      policies: Record<string, RegressionPolicy>;
    }
  | undefined {
  if (body.regression === undefined) return undefined;
  if (body.release !== undefined || body.ci !== undefined) {
    throw new RegressionValidationError(
      'Regression runs cannot be combined with release verification or legacy CI context.',
    );
  }
  const request = parseRegressionRequest(body.regression);
  const nodes = Array.isArray(savedNodes) ? savedNodes.map(record) : [];
  if (
    nodes.some((node) =>
      ['agent-container', 'codex-cli', 'validator'].includes(
        String(node.nodeType),
      ),
    )
  ) {
    throw new RegressionValidationError(
      'Change-aware regression runs require ordinary Playwright checks. AI test-generation and validator workflows retain their full-suite rules.',
    );
  }
  const playwright = nodes.filter((node) => node.nodeType === 'playwright');
  if (!playwright.length) {
    throw new RegressionValidationError(
      'A regression workflow must contain at least one Playwright node.',
    );
  }
  const policies: Record<string, RegressionPolicy> = Object.create(null);
  const allowedRepositories = new Set<string>();
  for (const node of playwright) {
    const config = record(node.config);
    if (
      (config.action && config.action !== 'clone') ||
      !config.repository ||
      config.testLanguage === 'python'
    ) {
      throw new RegressionValidationError(
        'Change-aware regression requires GitHub-backed TypeScript Playwright nodes. Inline scripts, uploaded suites, local workspaces and Python tests are not supported.',
      );
    }
    const repository = repositoryName(config.repository);
    allowedRepositories.add(repository);
    if (config.regression !== undefined) {
      const policy = parseRegressionPolicy(config.regression);
      policies[String(node.id)] = policy;
      for (const source of policy.repositories) {
        allowedRepositories.add(source.repository.toLowerCase());
      }
    }
  }
  for (const source of request.sources) {
    if (!allowedRepositories.has(source.repository.toLowerCase())) {
      throw new RegressionValidationError(
        `Source repository ${source.repository} is not configured in this saved workflow.`,
      );
    }
  }
  return { request, policies };
}
