import { readFile as nodeReadFile } from 'node:fs/promises';

type JsonRecord = Record<string, unknown>;

export type WorkflowCreateDependencies = {
  env: NodeJS.ProcessEnv;
  fetch: typeof globalThis.fetch;
  readFile?: (path: string, encoding: 'utf8') => Promise<string>;
  stderr: (line: string) => void;
  stdout: (line: string) => void;
};

type CreateOptions = {
  apiKey: string;
  file: string;
  json: boolean;
  url: string;
};

function usage() {
  return `Usage: playrunner workflow create --file <path> [options]

Creates or updates a Playrunner project and workflow from a declarative JSON file.

Options:
  --file <path>  Workflow definition JSON file (required)
  --url <url>    Playrunner server URL (or PLAYRUNNER_URL)
  --json         Emit JSON
  --help         Show this help

Environment:
  PLAYRUNNER_API_KEY  Unrestricted API token with workflow:write
  PLAYRUNNER_URL      Playrunner server URL`;
}

function parseOptions(
  args: string[],
  env: NodeJS.ProcessEnv,
): CreateOptions | 'help' {
  if (args.includes('--help') || args.includes('-h')) return 'help';
  let file = '';
  let json = false;
  let url = env.PLAYRUNNER_URL?.trim() ?? '';

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--json') json = true;
    else if (arg === '--file' || arg === '--url') {
      const value = args[index + 1];
      if (!value) throw new Error(`${arg} requires a value.`);
      index += 1;
      if (arg === '--file') file = value;
      else url = value;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  const apiKey = env.PLAYRUNNER_API_KEY?.trim() ?? '';
  if (!file) throw new Error('--file is required.');
  if (!url) throw new Error('PLAYRUNNER_URL or --url is required.');
  if (!apiKey) throw new Error('PLAYRUNNER_API_KEY is required.');
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new Error('The Playrunner URL is invalid.');
  }
  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    throw new Error('The Playrunner URL must use HTTP or HTTPS.');
  }
  parsedUrl.username = '';
  parsedUrl.password = '';
  parsedUrl.search = '';
  parsedUrl.hash = '';
  return {
    apiKey,
    file,
    json,
    url: parsedUrl.toString().replace(/\/$/, ''),
  };
}

function record(value: unknown): JsonRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

function errorMessage(payload: JsonRecord, fallback: string) {
  return typeof payload.error === 'string' ? payload.error : fallback;
}

export async function runWorkflowCreateCli(
  args: string[],
  dependencies: WorkflowCreateDependencies,
) {
  let options: CreateOptions | 'help';
  try {
    options = parseOptions(args, dependencies.env);
  } catch (error) {
    dependencies.stderr((error as Error).message);
    dependencies.stderr('Run playrunner workflow create --help for usage.');
    return 2;
  }
  if (options === 'help') {
    dependencies.stdout(usage());
    return 0;
  }

  try {
    const source = await (dependencies.readFile ?? nodeReadFile)(
      options.file,
      'utf8',
    );
    if (Buffer.byteLength(source, 'utf8') > 2 * 1024 * 1024) {
      throw new Error('The workflow definition must be at most 2 MiB.');
    }
    const definition = JSON.parse(source) as unknown;
    const workflow = record(record(definition)?.workflow);
    const workflowKey =
      typeof workflow?.key === 'string' ? workflow.key.trim() : '';
    if (!workflowKey) {
      throw new Error('The workflow definition must contain workflow.key.');
    }
    const response = await dependencies.fetch(
      `${options.url}/api/v1/workflows/definitions/${encodeURIComponent(workflowKey)}`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${options.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(definition),
      },
    );
    const payload = ((await response.json().catch(() => ({}))) ??
      {}) as JsonRecord;
    if (!response.ok) {
      dependencies.stderr(
        errorMessage(payload, `Request failed with status ${response.status}.`)
          .split(options.apiKey)
          .join('[redacted]'),
      );
      return 2;
    }
    const workflowId =
      typeof payload.workflowId === 'string' ? payload.workflowId : '';
    const editorPath =
      typeof payload.editorPath === 'string' ? payload.editorPath : '';
    if (!workflowId || !editorPath) {
      dependencies.stderr('Playrunner returned an invalid create response.');
      return 2;
    }
    const editorUrl = new URL(editorPath, `${options.url}/`).toString();
    if (options.json) {
      dependencies.stdout(
        JSON.stringify({
          created: payload.created === true,
          editorUrl,
          projectId: payload.projectId,
          workflowId,
        }),
      );
    } else {
      dependencies.stdout(
        `${payload.created === true ? 'Created' : 'Updated'} workflow ${workflowId}`,
      );
      dependencies.stdout(`Open in Playrunner: ${editorUrl}`);
    }
    return 0;
  } catch (error) {
    const message = (error as Error).message
      .split(options.apiKey)
      .join('[redacted]');
    dependencies.stderr(`Could not create workflow: ${message}`);
    return 2;
  }
}
