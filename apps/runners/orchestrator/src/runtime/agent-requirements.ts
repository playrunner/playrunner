export type ResolvedAgentRequirement = {
  body: string;
  id: string;
  source: 'github' | 'jira';
  title: string;
  url: string;
};

const MAX_REQUIREMENTS = 20;
const MAX_REQUIREMENT_TEXT = 64 * 1024;
const REQUEST_TIMEOUT_MS = 20_000;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function configuredSources(config: Record<string, unknown>) {
  const sources: Array<{ reference: string; source: 'github' | 'jira' }> = [];
  const add = (source: 'github' | 'jira', value: unknown) => {
    const reference = typeof value === 'string' ? value.trim() : '';
    if (reference) sources.push({ reference, source });
  };
  add('jira', config.jiraIssue);
  add('github', config.githubIssue);
  if (Array.isArray(config.requirementSources)) {
    for (const candidate of config.requirementSources) {
      const source = record(candidate);
      if (source.type === 'jira' || source.type === 'github') {
        add(source.type, source.reference);
      }
    }
  }
  const unique = sources.filter(
    (source, index, all) =>
      all.findIndex(
        (candidate) =>
          candidate.source === source.source &&
          candidate.reference.toLowerCase() === source.reference.toLowerCase(),
      ) === index,
  );
  if (unique.length > MAX_REQUIREMENTS) {
    throw new Error(
      `AI Container supports at most ${MAX_REQUIREMENTS} external requirement sources.`,
    );
  }
  return unique;
}

function boundedText(value: unknown): string {
  const text = typeof value === 'string' ? value.trim() : '';
  return text.slice(0, MAX_REQUIREMENT_TEXT);
}

function adfText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value))
    return value.map(adfText).filter(Boolean).join('\n');
  const node = record(value);
  const ownText = typeof node.text === 'string' ? node.text : '';
  const content = Array.isArray(node.content)
    ? node.content
        .map(adfText)
        .filter(Boolean)
        .join(node.type === 'paragraph' || node.type === 'heading' ? '' : '\n')
    : '';
  const text = `${ownText}${content}`;
  return node.type === 'paragraph' || node.type === 'heading'
    ? `${text}\n`
    : text;
}

async function getJson(
  url: string,
  accessToken: string,
  accept = 'application/json',
): Promise<unknown> {
  const response = await fetch(url, {
    headers: { Accept: accept, Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`request returned ${response.status}`);
  }
  return data;
}

function parseGitHubReference(reference: string) {
  const short = reference.match(
    /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)#([1-9][0-9]*)$/,
  );
  if (short) {
    return { number: Number(short[3]), repository: `${short[1]}/${short[2]}` };
  }
  let url: URL;
  try {
    url = new URL(reference);
  } catch {
    throw new Error(
      'GitHub requirement must be an issue/PR URL or owner/repository#number.',
    );
  }
  const match = url.pathname.match(
    /^\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/(?:issues|pull)\/([1-9][0-9]*)\/?$/,
  );
  if (url.origin !== 'https://github.com' || !match) {
    throw new Error(
      'GitHub requirement must be an issue/PR URL or owner/repository#number.',
    );
  }
  return { number: Number(match[3]), repository: `${match[1]}/${match[2]}` };
}

async function resolveGitHub(
  reference: string,
  settings: Record<string, unknown>,
): Promise<ResolvedAgentRequirement> {
  const accessToken = boundedText(settings.accessToken);
  if (!accessToken) {
    throw new Error('GitHub is not connected.');
  }
  const { number, repository } = parseGitHubReference(reference);
  const apiBaseUrl =
    boundedText(settings.apiBaseUrl) || 'https://api.github.com';
  const data = record(
    await getJson(
      `${apiBaseUrl.replace(/\/+$/, '')}/repos/${repository}/issues/${number}`,
      accessToken,
      'application/vnd.github+json',
    ),
  );
  const title = boundedText(data.title);
  if (!title) throw new Error('GitHub returned an issue without a title.');
  return {
    body: boundedText(data.body),
    id: `${repository}#${number}`,
    source: 'github',
    title,
    url: `https://github.com/${repository}/${Object.keys(record(data.pull_request)).length ? 'pull' : 'issues'}/${number}`,
  };
}

function parseJiraKey(reference: string): string {
  const direct = reference.toUpperCase();
  if (/^[A-Z][A-Z0-9_]{0,49}-[1-9][0-9]*$/.test(direct)) return direct;
  try {
    const url = new URL(reference);
    const match = url.pathname.match(
      /\/browse\/([A-Za-z][A-Za-z0-9_]{0,49}-[1-9][0-9]*)\/?$/,
    );
    if (match) return match[1].toUpperCase();
  } catch {
    // Fall through to the actionable validation error.
  }
  throw new Error('Jira requirement must be an issue key or browse URL.');
}

async function resolveJira(
  reference: string,
  settings: Record<string, unknown>,
): Promise<ResolvedAgentRequirement> {
  const accessToken = boundedText(settings.accessToken);
  if (!accessToken) throw new Error('Jira is not connected.');
  const issueKey = parseJiraKey(reference);
  const apiBaseUrl = (
    boundedText(settings.apiBaseUrl) || 'https://api.atlassian.com'
  ).replace(/\/+$/, '');
  const resources = await getJson(
    `${apiBaseUrl}/oauth/token/accessible-resources`,
    accessToken,
  );
  const resource = Array.isArray(resources) ? record(resources[0]) : {};
  const cloudId = boundedText(resource.id);
  if (!cloudId) throw new Error('Jira has no accessible Cloud site.');
  const issue = record(
    await getJson(
      `${apiBaseUrl}/ex/jira/${encodeURIComponent(cloudId)}/rest/api/3/issue/${encodeURIComponent(issueKey)}?fields=summary,description`,
      accessToken,
    ),
  );
  const fields = record(issue.fields);
  const title = boundedText(fields.summary);
  if (!title) throw new Error('Jira returned an issue without a summary.');
  const siteUrl = boundedText(resource.url).replace(/\/+$/, '');
  return {
    body: boundedText(adfText(fields.description)).trim(),
    id: issueKey,
    source: 'jira',
    title,
    url: siteUrl
      ? `${siteUrl}/browse/${issueKey}`
      : `${apiBaseUrl}/ex/jira/${encodeURIComponent(cloudId)}/rest/api/3/issue/${encodeURIComponent(issueKey)}`,
  };
}

export async function resolveAgentRequirements(
  config: Record<string, unknown>,
  settings: Record<string, unknown>,
): Promise<ResolvedAgentRequirement[]> {
  const sources = configuredSources(config);
  return Promise.all(
    sources.map(async ({ reference, source }) => {
      try {
        return source === 'github'
          ? await resolveGitHub(reference, record(settings.github))
          : await resolveJira(reference, record(settings.jira));
      } catch (error) {
        const detail =
          error instanceof Error ? error.message : 'request failed';
        throw new Error(
          `Could not load ${source === 'github' ? 'GitHub' : 'Jira'} requirement ${reference}: ${detail}`,
        );
      }
    }),
  );
}
