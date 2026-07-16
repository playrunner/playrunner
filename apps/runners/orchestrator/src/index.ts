import { spawn } from 'child_process';
import crypto from 'crypto';
import express from 'express';
import { orchestratorRuntime } from './runtime';
import type {
  PlaywrightExecutionRequest,
  PreparedPlaywrightRunner,
} from './runtime/contracts';
import { packageExecutorRuntime } from './runtime/package-executors';

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3012;
const EDITOR_API_URL = process.env.EDITOR_API_URL?.trim() || '';

function requiredEditorApiUrl(): never {
  throw new Error(
    'EDITOR_API_URL is required for local runner callbacks. Set EDITOR_API_URL in the orchestrator environment from apps/api/.env EDITOR_API_URL_DOCKER.',
  );
}

type WorkflowEventLevel = 'info' | 'error' | 'warn' | 'build' | 'debug';
type WorkflowNodeState =
  'idle' | 'pending' | 'running' | 'success' | 'error' | 'warning';

type WorkflowEventPublisher = {
  executionId: string;
  publishEvent: (payload: Record<string, unknown>) => Promise<void>;
  publishLog: (
    message: string,
    level?: WorkflowEventLevel,
    extra?: Record<string, unknown>,
  ) => Promise<void>;
  publishNodeState: (nodeId: string, state: WorkflowNodeState) => Promise<void>;
};

type GcpPubSubEventTransport = {
  projectId?: string;
  topicName?: string;
  type?: 'gcp_pubsub';
};

type WorkflowTemplateContext = {
  definition: {
    id: string;
    name: string;
  };
  run: {
    durationMs: number | '';
    failedNode: {
      id: string;
      name: string;
    };
    finishedAt: string;
    id: string;
    runner: string;
    startedAt: string;
    status: 'running' | 'completed' | 'failed' | 'cancelled';
    trigger: string;
    url: string;
  };
};

const PUBSUB_API_BASE_URL = 'https://pubsub.googleapis.com/v1';
const REDACTED_VALUE = '[redacted]';
const SENSITIVE_PAYLOAD_KEY_PATTERN = /authorization|secret|token/i;

function getPubSubApiBaseUrl(): string {
  const emulatorHost = process.env.PUBSUB_EMULATOR_HOST?.trim();
  if (!emulatorHost) {
    return PUBSUB_API_BASE_URL;
  }

  const normalizedHost = emulatorHost.replace(/\/+$/, '');
  return `${normalizedHost.startsWith('http') ? normalizedHost : `http://${normalizedHost}`}/v1`;
}

function isUsingPubSubEmulator(): boolean {
  return !!process.env.PUBSUB_EMULATOR_HOST?.trim();
}

function resolvePlaywrightRuntime(
  config: Record<string, any>,
): 'typescript' | 'python' {
  const configured = config.testLanguage || config.runtime;
  if (configured === 'python') {
    return 'python';
  }
  return 'typescript';
}

type ActiveProcess = {
  executionId: string;
  nodeId: string;
  process: ReturnType<typeof spawn>;
  publisher: WorkflowEventPublisher;
};

const activeProcesses = new Map<string, ActiveProcess>();

function activeExecutionKey(executionId: string, nodeId: string): string {
  return JSON.stringify([executionId, nodeId]);
}

function getString(value: unknown): string {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function getRecord(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, any>)
    : {};
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error && error.message.trim()
    ? error.message
    : 'Unknown error';
}

function getPathValue(source: Record<string, any>, path: string): unknown {
  return path.split('.').reduce<unknown>((current, segment) => {
    if (!current || typeof current !== 'object') {
      return undefined;
    }

    return (current as Record<string, unknown>)[segment];
  }, source);
}

function formatTemplateValue(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }

  if (typeof value === 'string') {
    return value;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  return JSON.stringify(value);
}

function getDurationMs(startedAt: string, finishedAt: Date): number {
  const startedAtMs = new Date(startedAt).getTime();
  if (Number.isNaN(startedAtMs)) {
    return 0;
  }

  return Math.max(0, finishedAt.getTime() - startedAtMs);
}

function createWorkflowTemplateContext(
  reqBody: Record<string, any>,
  testId: string,
  startedAt: Date,
): WorkflowTemplateContext {
  const workflow = getRecord(reqBody.workflow);
  const definition = getRecord(workflow.definition);
  const run = getRecord(workflow.run);
  const failedNode = getRecord(run.failedNode);
  const workflowId = getString(definition.id) || getString(reqBody.workflowId);

  return {
    definition: {
      id: workflowId,
      name:
        getString(definition.name) ||
        getString(reqBody.workflowName) ||
        getString(reqBody.title) ||
        'Untitled Workflow',
    },
    run: {
      durationMs: '',
      failedNode: {
        id: getString(failedNode.id),
        name: getString(failedNode.name),
      },
      finishedAt: '',
      id: testId,
      runner:
        getString(run.runner) ||
        getString(reqBody.cloudProvider) ||
        'LOCAL_RUNNER',
      startedAt: startedAt.toISOString(),
      status: 'running',
      trigger:
        getString(run.trigger) || (reqBody.scheduler ? 'schedule' : 'manual'),
      url: getString(run.url),
    },
  };
}

function finishWorkflowRun(
  workflow: WorkflowTemplateContext,
  status: WorkflowTemplateContext['run']['status'],
) {
  const finishedAt = new Date();
  workflow.run.status = status;
  workflow.run.finishedAt = finishedAt.toISOString();
  workflow.run.durationMs = getDurationMs(workflow.run.startedAt, finishedAt);
}

function markWorkflowRunFailed(
  workflow: WorkflowTemplateContext,
  node?: { id?: string; label?: string },
) {
  if (!workflow.run.failedNode.id && node?.id) {
    workflow.run.failedNode.id = node.id;
    workflow.run.failedNode.name = getString(node.label) || node.id;
  }

  finishWorkflowRun(workflow, 'failed');
}

function prepareWorkflowRunStatusForNode({
  activeNodeCount,
  outgoingCount,
  workflow,
}: {
  activeNodeCount: number;
  outgoingCount: number;
  workflow: WorkflowTemplateContext;
}) {
  if (workflow.run.status === 'failed') {
    return;
  }

  if (activeNodeCount === 1 && outgoingCount === 0) {
    finishWorkflowRun(workflow, 'completed');
    return;
  }

  workflow.run.status = 'running';
  workflow.run.finishedAt = '';
  workflow.run.durationMs = '';
}

function renderNodeTemplate(
  text: string,
  context: {
    env: Record<string, string>;
    workflow: WorkflowTemplateContext;
  },
) {
  if (!text) {
    return text;
  }

  return text.replace(/{{\s*([^{}]+?)\s*}}/g, (match, expression) => {
    const path = expression.trim();
    if (!path.startsWith('env.') && !path.startsWith('workflow.')) {
      return match;
    }

    return formatTemplateValue(getPathValue(context, path));
  });
}

function isSensitivePayloadKey(key: string): boolean {
  return (
    key.toLowerCase() === 'code' || SENSITIVE_PAYLOAD_KEY_PATTERN.test(key)
  );
}

function redactSensitivePayload(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => redactSensitivePayload(entry));
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
      key,
      isSensitivePayloadKey(key)
        ? REDACTED_VALUE
        : redactSensitivePayload(entry),
    ]),
  );
}

function writeWorkflowLogToConsole(
  executionId: string,
  message: string,
  level: WorkflowEventLevel,
) {
  const renderedMessage = `[Workflow ${executionId || 'unknown'}] ${message}`;

  if (level === 'error') {
    console.error(renderedMessage);
    return;
  }

  if (level === 'warn') {
    console.warn(renderedMessage);
    return;
  }

  console.log(renderedMessage);
}

async function publishGcpPubSubEvent(args: {
  accessToken?: string;
  executionId: string;
  executionToken: string;
  payload: Record<string, unknown>;
  projectId: string;
  topicName: string;
}) {
  if (!args.accessToken && !isUsingPubSubEmulator()) {
    throw new Error('Pub/Sub access token is required.');
  }

  const eventId = getString(args.payload.eventId) || crypto.randomUUID();
  const payload: Record<string, unknown> = {
    executionAuthToken: args.executionToken,
    executionId: args.executionId,
    testId: args.executionId,
    ...args.payload,
    eventId,
  };
  const eventType = getString(payload.type) || 'event';
  const response = await fetch(
    `${getPubSubApiBaseUrl()}/projects/${args.projectId}/topics/${args.topicName}:publish`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(args.accessToken
          ? { Authorization: `Bearer ${args.accessToken}` }
          : {}),
      },
      body: JSON.stringify({
        messages: [
          {
            attributes: {
              cloudProvider: getString(payload.cloudProvider) || 'GCP',
              eventId,
              eventType,
              executionId: args.executionId,
              messageKind: 'workflow_event',
            },
            data: Buffer.from(JSON.stringify(payload), 'utf8').toString(
              'base64',
            ),
            orderingKey: args.executionId,
          },
        ],
      }),
    },
  );

  if (!response.ok) {
    const details = await response.text().catch(() => '');
    throw new Error(
      `Pub/Sub publish failed (${response.status}): ${details.slice(0, 500)}`,
    );
  }
}

function createWorkflowEventPublisher(
  reqBody: Record<string, any>,
): WorkflowEventPublisher {
  const executionId = typeof reqBody.testId === 'string' ? reqBody.testId : '';
  const executionToken =
    typeof reqBody.executionAuthToken === 'string'
      ? reqBody.executionAuthToken
      : '';
  const eventTransport = reqBody.eventTransport as
    GcpPubSubEventTransport | undefined;
  const gcpAccessToken = getString(reqBody.settings?.gcp?.accessToken);
  const basePayload = {
    cloudProvider: reqBody.cloudProvider || 'LOCAL_RUNNER',
    workflowId: reqBody.workflowId || null,
  };

  const publishEvent = async (payload: Record<string, unknown>) => {
    if (!executionId || !executionToken) {
      console.warn(
        'Skipping workflow event publish because execution context is missing.',
      );
      return;
    }

    const mergedPayload = {
      ...basePayload,
      ...payload,
      eventId: getString(payload.eventId) || crypto.randomUUID(),
    };

    try {
      if (
        eventTransport?.type !== 'gcp_pubsub' ||
        !eventTransport.projectId ||
        !eventTransport.topicName
      ) {
        throw new Error('Pub/Sub event transport is required.');
      }

      await publishGcpPubSubEvent({
        accessToken: gcpAccessToken,
        executionId,
        executionToken,
        payload: mergedPayload,
        projectId: eventTransport.projectId,
        topicName: eventTransport.topicName,
      });
    } catch (error) {
      console.error(
        `Failed to publish workflow event for ${executionId}:`,
        error,
      );
    }
  };

  return {
    executionId,
    publishEvent,
    publishLog: async (message, level = 'info', extra = {}) => {
      writeWorkflowLogToConsole(executionId, message, level);
      await publishEvent({
        ...extra,
        level,
        message,
        timestamp: new Date().toISOString(),
        type: 'log',
      });
    },
    publishNodeState: async (nodeId, state) => {
      await publishEvent({
        nodeId,
        state,
        timestamp: new Date().toISOString(),
        type: 'node_state',
      });
    },
  };
}

export async function executeWorkflow(reqBody: any) {
  const eventPublisher = createWorkflowEventPublisher(reqBody);
  const { publishEvent, publishLog, publishNodeState } = eventPublisher;
  const workflowContext = createWorkflowTemplateContext(
    reqBody,
    getString(reqBody.testId),
    new Date(),
  );
  let terminalEventPublished = false;
  let workflowFailed = false;

  try {
    const { nodes, connections, settings, testId, bucketName } = reqBody;
    const nodeCount = Array.isArray(nodes) ? nodes.length : 0;

    console.log(
      'Runner received workflow execution request with nodes:',
      nodeCount,
    );

    await publishEvent({
      level: 'info',
      message: `Cloud orchestrator received workflow execution request with ${nodeCount} node${nodeCount === 1 ? '' : 's'}.`,
      timestamp: new Date().toISOString(),
      type: 'workflow_started',
      workflow: workflowContext,
    });

    if (nodes && Array.isArray(nodes)) {
      packageExecutorRuntime.preflight(nodes);

      const globalEnvVars: Record<string, string> = {};
      const envNodes = nodes.filter(
        (n) => packageExecutorRuntime.nodeType(n) === 'environment',
      );
      for (const envNode of envNodes) {
        if (envNode.config?.variables) {
          envNode.config.variables.forEach((v: any) => {
            if (v.enabled && v.key) {
              globalEnvVars[v.key] = v.currentValue || v.initialValue || '';
            }
          });
        }
      }

      const processedConnections = [...(connections || [])];

      for (const node of nodes) {
        const implicitParents = [
          ...(Array.isArray(node.parentNodes) ? node.parentNodes : []),
          ...(node.parentId ? [node.parentId] : []),
        ];

        for (const parentId of implicitParents) {
          const hasExplicit = processedConnections.some(
            (c) => c.sourceId === parentId && c.targetId === node.id,
          );
          if (!hasExplicit) {
            processedConnections.push({
              sourceId: parentId,
              targetId: node.id,
              type: 'sequential',
            });
          }
        }
      }

      if (processedConnections.length > 0) {
        await publishLog(
          `Analyzing ${processedConnections.length} workflow connections...`,
          'info',
        );
        for (const conn of processedConnections) {
          const type = conn.type || 'sequential';
          await publishLog(
            `Connection ${conn.sourceId} -> ${conn.targetId} is marked as [${type.toUpperCase()}]`,
            'debug',
          );
        }
      }

      const registerActiveProcessForNode = (
        activeNodeId: string,
        process: ReturnType<typeof spawn>,
      ) => {
        const key = activeExecutionKey(testId, activeNodeId);
        const activeProcess: ActiveProcess = {
          executionId: testId,
          nodeId: activeNodeId,
          process,
          publisher: eventPublisher,
        };
        activeProcesses.set(key, activeProcess);

        const removeActiveProcess = () => {
          if (activeProcesses.get(key) === activeProcess) {
            activeProcesses.delete(key);
          }
        };
        process.on('exit', removeActiveProcess);
        process.on('error', removeActiveProcess);
      };

      const createPlaywrightExecutionRequest = (
        node: any,
      ): {
        cpu: number;
        envKeys: string[];
        injectedEnv: string;
        memory: number;
        request: PlaywrightExecutionRequest;
        workers: number;
      } => {
        const config = node.config || {};
        const runtime = resolvePlaywrightRuntime(config);
        const cpu = config.cpu || 2;
        const memory = config.memory || 4;
        const workers = config.workers || 1;
        const envKeys = config.envVars || [];
        const cloudProvider = reqBody.cloudProvider || 'LOCAL_RUNNER';
        const payloadData = {
          data: {
            repository: config.repository,
            branch: config.branch,
            folder: config.folder,
            action: config.action,
            executionAuthToken: reqBody.executionAuthToken,
            testScript: config.testScript,
            nodeId: node.id,
            testId,
            testLanguage: runtime,
            playwrightVersion: config.playwrightVersion || 'latest',
            workers,
            editorApiUrl:
              reqBody.editorApiUrl || EDITOR_API_URL || requiredEditorApiUrl(),
            eventTransport: reqBody.eventTransport,
            bucketName: reqBody.bucketName || bucketName || null,
            cloudProvider,
          },
          github: settings?.github,
          settings: reqBody.settings,
        };

        return {
          cpu,
          envKeys,
          injectedEnv: envKeys.map((key: string) => `${key}=***`).join(', '),
          memory,
          request: {
            config,
            envKeys,
            globalEnvVars,
            nodeId: node.id,
            payloadData,
            publishLog,
            registerActiveProcess: (activeNodeId, process) => {
              registerActiveProcessForNode(
                activeNodeId,
                process as ReturnType<typeof spawn>,
              );
            },
            reqBody,
            runtime,
          },
          workers,
        };
      };

      const preparedPlaywrightRunners: Record<
        string,
        Promise<PreparedPlaywrightRunner>
      > = {};
      const playwrightNodes = nodes.filter(
        (node: any) => packageExecutorRuntime.nodeType(node) === 'playwright',
      );

      if (playwrightNodes.length > 0) {
        void publishLog(
          `Preparing ${playwrightNodes.length} Playwright runner${playwrightNodes.length === 1 ? '' : 's'} before workflow execution reaches them...`,
          'info',
        );

        for (const node of playwrightNodes) {
          const { request } = createPlaywrightExecutionRequest(node);
          void publishNodeState(node.id, 'pending');
          void publishLog(
            `Starting Playwright Runner preparation for ${node.label || node.id} (${node.id}).`,
            'info',
          );
          preparedPlaywrightRunners[node.id] =
            orchestratorRuntime.playwrightExecution
              .prepare(request)
              .catch(async (error) => {
                await publishLog(
                  `Failed to prepare Playwright Runner for ${node.id}: ${error.message}`,
                  'error',
                );
                throw error;
              });
        }
      }

      const nodeHasRun: Record<string, boolean> = {};
      const nodeIsRunning: Record<string, boolean> = {};
      let activeNodeCount = 0;

      // Start a node immediately if it hasn't already started. The DAG drives
      // parallelism: a node is triggered when its parent completes (or starts,
      // for `concurrent` edges), so sibling branches that share a parent all
      // fire at the same moment and run in parallel.
      const runNode = (nodeId: string) => {
        if (nodeHasRun[nodeId] || nodeIsRunning[nodeId]) {
          return;
        }
        void processNode(nodeId).catch(console.error);
      };

      const runConnectionTargets = (
        connectionsToTrigger: Array<{ targetId: string }>,
      ) => {
        const targetIds = Array.from(
          new Set(connectionsToTrigger.map((conn) => conn.targetId)),
        );
        for (const targetId of targetIds) {
          runNode(targetId);
        }
      };

      const processNode = async (nodeId: string) => {
        if (nodeHasRun[nodeId] || nodeIsRunning[nodeId]) {
          return;
        }

        const node = nodes.find((candidate: any) => candidate.id === nodeId);
        if (!node) return;

        nodeIsRunning[nodeId] = true;
        activeNodeCount++;
        const type = packageExecutorRuntime.nodeType(node);
        const outgoing = processedConnections.filter(
          (c) => c.sourceId === node.id,
        );
        let finalState: 'success' | 'error' | 'warning' = 'success';

        try {
          await publishNodeState(
            node.id,
            type === 'playwright' ? 'pending' : 'running',
          );
          prepareWorkflowRunStatusForNode({
            activeNodeCount,
            outgoingCount: outgoing.length,
            workflow: workflowContext,
          });
          const concurrentChildren = outgoing.filter(
            (c) => (c.type || 'sequential') === 'concurrent',
          );
          runConnectionTargets(concurrentChildren);

          if (type === 'environment' || type === 'schedule') {
            await publishLog(
              `Processing node: ${node.label} (${node.id})`,
              'info',
            );
          } else if (type === 'playwright') {
            const { cpu, injectedEnv, memory, request, workers } =
              createPlaywrightExecutionRequest(node);

            await publishLog(
              `Processing node: ${node.label} (${node.id})`,
              'info',
            );
            await publishLog(
              `Waiting for prepared Playwright Runner with resources: CPU ${cpu}, Memory ${memory}GB, Workers ${workers}`,
              'build',
            );
            if (injectedEnv) {
              await publishLog(
                `Injecting Environment Variables: ${injectedEnv}`,
                'info',
              );
            }

            console.log(
              `[Orchestrator] Sending payload to runner for ${node.id}:`,
              JSON.stringify(
                redactSensitivePayload(request.payloadData),
                null,
                2,
              ),
            );
            if (!settings?.github?.accessToken) {
              console.warn(
                '[Orchestrator WARNING] No GitHub accessToken found in settings. settings.github keys:',
                settings?.github ? Object.keys(settings.github) : 'null',
              );
            }

            try {
              const preparedRunner =
                (await preparedPlaywrightRunners[node.id]) ||
                (await orchestratorRuntime.playwrightExecution.prepare(
                  request,
                ));
              await preparedRunner.waitUntilReady();
              await publishLog(
                `Prepared Playwright Runner for ${node.id} is ready. Sending start signal.`,
                'info',
              );
              await preparedRunner.start();
              await publishLog(
                `Playwright Runner for ${node.id} acknowledged start signal.`,
                'info',
              );
              await preparedRunner.waitForCompletion();
            } catch (error) {
              throw new Error(
                `Playwright Runner failed: ${getErrorMessage(error)}`,
              );
            }
          } else if (type === 'github') {
            const hasGithubSettings = !!(settings && settings.github);
            await publishLog(
              `Processing node: ${node.label} (${node.id})`,
              'info',
            );
            if (hasGithubSettings) {
              await publishLog(
                'GitHub credentials loaded. Authenticating...',
                'info',
              );
            } else {
              await publishLog('No GitHub credentials provided.', 'warn');
              finalState = 'error';
            }
          } else {
            await publishLog(
              `Processing node: ${node.label} (${node.id})`,
              'info',
            );
            const result = await packageExecutorRuntime.execute({
              executionId: testId,
              workflowId: workflowContext.definition.id,
              node,
              settings,
              env: globalEnvVars,
              workflow: workflowContext as unknown as Record<string, unknown>,
              renderTemplate: (value) =>
                renderNodeTemplate(value, {
                  env: globalEnvVars,
                  workflow: workflowContext,
                }),
              log: publishLog,
            });
            finalState = result.outcome;

            if (result.output !== undefined) {
              await publishEvent({
                nodeId: node.id,
                output: result.output,
                timestamp: new Date().toISOString(),
                type: 'node_output',
              });
            }
          }
        } catch (error) {
          finalState = 'error';
          await publishLog(getErrorMessage(error), 'error');
        } finally {
          try {
            await publishNodeState(node.id, finalState);
            if (finalState === 'error') {
              workflowFailed = true;
              markWorkflowRunFailed(workflowContext, node);
            }
          } catch (finalizationError) {
            console.error(
              `Failed to finalize workflow node ${node.id}:`,
              finalizationError,
            );
          } finally {
            nodeIsRunning[nodeId] = false;
            nodeHasRun[nodeId] = true;
            activeNodeCount--;
          }
        }

        const hasConditionals = outgoing.some(
          (c) => c.type === 'success' || c.type === 'failure',
        );
        const isSuccess =
          (finalState as string) === 'success' ||
          (finalState as string) === 'warning';
        const postCompletionChildren: typeof outgoing = [];

        for (const conn of outgoing) {
          const connType = conn.type || 'sequential';
          let shouldTrigger = false;

          if (connType === 'concurrent') {
            continue;
          } else if (connType === 'sequential') {
            if (hasConditionals) {
              shouldTrigger = isSuccess;
            } else {
              shouldTrigger = true;
            }
          } else if (connType === 'success') {
            shouldTrigger = isSuccess;
          } else if (connType === 'failure') {
            shouldTrigger = !isSuccess;
          } else if (connType === 'independent') {
            shouldTrigger = true;
          }

          if (shouldTrigger) {
            postCompletionChildren.push(conn);
          }
        }

        runConnectionTargets(postCompletionChildren);
      };

      const incomingCount: Record<string, number> = {};
      for (const node of nodes) {
        incomingCount[node.id] = 0;
      }
      for (const conn of processedConnections) {
        if (incomingCount[conn.targetId] !== undefined) {
          incomingCount[conn.targetId]++;
        }
      }
      const startNodes = nodes
        .filter((n: any) => incomingCount[n.id] === 0)
        .map((n: any) => n.id);

      startNodes.forEach((startNodeId: string) => runNode(startNodeId));

      while (activeNodeCount > 0) {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }

      await Promise.allSettled(
        Object.values(preparedPlaywrightRunners).map(async (runnerPromise) => {
          const runner = await runnerPromise;
          await runner.cleanup?.();
        }),
      );
    }

    terminalEventPublished = true;
    finishWorkflowRun(workflowContext, workflowFailed ? 'failed' : 'completed');
    await publishEvent({
      level: workflowFailed ? 'error' : 'info',
      message: workflowFailed
        ? 'Workflow execution failed.'
        : 'Workflow execution completed.',
      timestamp: new Date().toISOString(),
      type: workflowFailed ? 'workflow_failed' : 'workflow_completed',
      workflow: workflowContext,
    });
  } catch (err: any) {
    if (!terminalEventPublished) {
      markWorkflowRunFailed(workflowContext);
      await publishEvent({
        level: 'error',
        message: `Workflow execution failed: ${err?.message || 'Unknown error'}`,
        timestamp: new Date().toISOString(),
        type: 'workflow_failed',
        workflow: workflowContext,
      });
    }
    throw err;
  }
}

app.post('/execute', async (req, res) => {
  res.status(200).json({ status: 'started' });
  void executeWorkflow(req.body).catch((error) => {
    console.error('Workflow execution failed:', error);
  });
});

app.get('/health', (req, res) => {
  res.status(200).send('Runner is healthy and in standby.');
});

app.get('/runtime', (req, res) => {
  const executorDiagnostics = packageExecutorRuntime.diagnostics();

  res.status(200).json({
    activePackageExecutorCount: executorDiagnostics.activeExecutions.length,
    eventTransport: 'pubsub',
    orchestratorContributions: executorDiagnostics.contributions,
    orchestratorExecutorTimeoutMs: executorDiagnostics.timeoutMs,
    pubsubEmulatorHost: process.env.PUBSUB_EMULATOR_HOST || null,
    runnerControl: 'pubsub',
    service: 'playrunner-orchestrator',
    workflowEventsTopic:
      process.env.GCP_PUBSUB_WORKFLOW_EVENTS_TOPIC ||
      'playrunner-workflow-events',
  });
});

app.post('/stop', async (req, res) => {
  const nodeId = getString(req.body?.nodeId);
  const requestedExecutionId =
    getString(req.body?.executionId) || getString(req.body?.testId);
  if (!nodeId) return res.status(400).json({ error: 'nodeId required' });

  const packageMatches = packageExecutorRuntime
    .diagnostics()
    .activeExecutions.filter(
      (active) =>
        active.nodeId === nodeId &&
        (!requestedExecutionId || active.executionId === requestedExecutionId),
    );
  const processMatches = Array.from(activeProcesses.values()).filter(
    (active) =>
      active.nodeId === nodeId &&
      (!requestedExecutionId || active.executionId === requestedExecutionId),
  );
  const matchingExecutionIds = new Set([
    ...packageMatches.map((active) => active.executionId),
    ...processMatches.map((active) => active.executionId),
  ]);

  if (!requestedExecutionId && matchingExecutionIds.size > 1) {
    return res.status(409).json({
      error:
        'Multiple executions are running this node. executionId is required.',
    });
  }

  const executionId =
    requestedExecutionId || matchingExecutionIds.values().next().value;
  if (!executionId) {
    return res.status(404).json({ error: 'Node not running' });
  }

  const cancelledExecutors = packageExecutorRuntime.cancel({
    executionId,
    nodeId,
  });
  let stoppedProcesses = 0;
  for (const active of processMatches) {
    if (active.executionId !== executionId) {
      continue;
    }

    await active.publisher.publishLog(
      `Stopping execution for node: ${nodeId}...`,
      'warn',
    );
    active.process.kill('SIGTERM');
    stoppedProcesses++;
  }

  if (cancelledExecutors === 0 && stoppedProcesses === 0) {
    return res.status(404).json({ error: 'Node not running' });
  }

  return res.status(200).json({
    executionId,
    status: 'stopped',
  });
});

async function start() {
  await orchestratorRuntime.ready;
  console.log(`Standby Runner listening on port ${PORT}`);

  app.listen(PORT, () => {
    console.log('Runner started and is now in standby ready for workflows.');
  });
}

if (require.main === module) {
  start().catch((error) => {
    console.error('Failed to start orchestrator runtime:', error);
    process.exit(1);
  });
}
