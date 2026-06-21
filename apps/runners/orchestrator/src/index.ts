import { spawn } from 'child_process';
import express from 'express';
import { orchestratorRuntime } from './runtime';

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3002;
const EDITOR_API_URL = process.env.EDITOR_API_URL || 'http://localhost:3001';
const EXECUTION_TOKEN_HEADER = 'x-execution-token';

type WorkflowEventLevel = 'info' | 'error' | 'warn' | 'build' | 'debug';
type WorkflowNodeState = 'idle' | 'running' | 'success' | 'error' | 'warning';

type WorkflowEventPublisher = {
  executionId: string;
  publishEvent: (payload: Record<string, unknown>) => Promise<void>;
  publishLog: (message: string, level?: WorkflowEventLevel, extra?: Record<string, unknown>) => Promise<void>;
  publishNodeState: (nodeId: string, state: WorkflowNodeState) => Promise<void>;
};

function resolvePlaywrightRuntime(config: Record<string, any>): 'typescript' | 'python' {
  const configured = config.testLanguage || config.runtime;
  if (configured === 'python') {
    return 'python';
  }
  return 'typescript';
}

const activeProcesses: Record<string, ReturnType<typeof spawn>> = {};
const activeNodePublishers: Record<string, WorkflowEventPublisher> = {};

let activeWorkflows = 0;
let editorIsAlive = true;

setInterval(async () => {
  try {
    const res = await fetch(`${EDITOR_API_URL}/api/heartbeat`);
    const responseText = await res.text().catch(() => '');
    editorIsAlive = res.ok;
    console.log(
      `[heartbeat] editor-check status=${res.status} ok=${res.ok} activeWorkflows=${activeWorkflows} editorIsAlive=${editorIsAlive} body=${responseText || '<empty>'}`,
    );
  } catch {
    editorIsAlive = false;
    console.log(
      `[heartbeat] editor-check failed activeWorkflows=${activeWorkflows} editorIsAlive=${editorIsAlive}`,
    );
  }

  if (!editorIsAlive && activeWorkflows === 0) {
    console.log('Lost heartbeat to editor and no workflows in progress. Shutting down gracefully.');
    process.exit(0);
  }
}, 5000);

async function postWorkflowEvent(args: {
  editorApiUrl: string;
  executionId: string;
  executionToken: string;
  payload: Record<string, unknown>;
}) {
  try {
    const response = await fetch(new URL(`/api/executions/${args.executionId}/events`, args.editorApiUrl), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        [EXECUTION_TOKEN_HEADER]: args.executionToken,
      },
      body: JSON.stringify({
        executionId: args.executionId,
        testId: args.executionId,
        ...args.payload,
      }),
    });

    if (!response.ok) {
      const details = await response.text().catch(() => '');
      console.error(`Failed to post workflow event for ${args.executionId}: ${response.status} ${details}`);
    }
  } catch (error) {
    console.error(`Failed to post workflow event for ${args.executionId}:`, error);
  }
}

function createWorkflowEventPublisher(reqBody: Record<string, any>): WorkflowEventPublisher {
  const executionId = typeof reqBody.testId === 'string' ? reqBody.testId : '';
  const executionToken = typeof reqBody.executionAuthToken === 'string' ? reqBody.executionAuthToken : '';
  const editorApiUrl = reqBody.editorApiUrl || EDITOR_API_URL;
  const basePayload = {
    cloudProvider: reqBody.cloudProvider || 'LOCAL-DEV',
    workflowId: reqBody.workflowId || null,
  };

  const publishEvent = async (payload: Record<string, unknown>) => {
    if (!executionId || !executionToken) {
      console.warn('Skipping workflow event publish because execution context is missing.');
      return;
    }

    await postWorkflowEvent({
      editorApiUrl,
      executionId,
      executionToken,
      payload: {
        ...basePayload,
        ...payload,
      },
    });
  };

  return {
    executionId,
    publishEvent,
    publishLog: async (message, level = 'info', extra = {}) => {
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

async function executeWorkflow(reqBody: any) {
  activeWorkflows++;
  const eventPublisher = createWorkflowEventPublisher(reqBody);
  const { publishEvent, publishLog, publishNodeState } = eventPublisher;
  let terminalEventPublished = false;
  let workflowFailed = false;

  try {
    const { nodes, connections, settings, testId, bucketName } = reqBody;

    console.log('Runner received workflow execution request with nodes:', nodes?.length);

    await publishEvent({
      level: 'info',
      message: 'Workflow execution started.',
      timestamp: new Date().toISOString(),
      type: 'workflow_started',
    });

    if (nodes && Array.isArray(nodes)) {
      const globalEnvVars: Record<string, string> = {};
      const envNodes = nodes.filter((n) => (n.nodeType || n.label).toLowerCase() === 'environment');
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
          const hasExplicit = processedConnections.some((c) => c.sourceId === parentId && c.targetId === node.id);
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
        await publishLog(`Analyzing ${processedConnections.length} workflow connections...`, 'info');
        for (const conn of processedConnections) {
          const type = conn.type || 'sequential';
          await publishLog(`Connection ${conn.sourceId} -> ${conn.targetId} is marked as [${type.toUpperCase()}]`, 'debug');
        }
      }

      const nodeHasRun: Record<string, boolean> = {};
      const nodeIsRunning: Record<string, boolean> = {};
      let activeNodeCount = 0;
      const maxConcurrency = reqBody.concurrency || 100;
      const nodeQueue: string[] = [];

      const enqueueNode = (
        nodeId: string,
        options: { priority?: 'normal' | 'high'; bypassConcurrency?: boolean } = {},
      ) => {
        const { priority = 'normal', bypassConcurrency = false } = options;
        if (nodeHasRun[nodeId] || nodeIsRunning[nodeId] || nodeQueue.includes(nodeId)) {
          return;
        }
        if (bypassConcurrency) {
          processNode(nodeId).catch(console.error).finally(() => {
            pumpQueue();
          });
          return;
        }
        if (priority === 'high') {
          nodeQueue.unshift(nodeId);
        } else {
          nodeQueue.push(nodeId);
        }
        pumpQueue();
      };

      let isPumping = false;
      const pumpQueue = () => {
        if (isPumping) return;
        isPumping = true;
        while (activeNodeCount < maxConcurrency && nodeQueue.length > 0) {
          const id = nodeQueue.shift()!;
          processNode(id).catch(console.error).finally(() => {
            pumpQueue();
          });
        }
        isPumping = false;
      };

      const processNode = async (nodeId: string) => {
        if (nodeHasRun[nodeId] || nodeIsRunning[nodeId]) {
          return;
        }
        nodeIsRunning[nodeId] = true;
        activeNodeCount++;

        const node = nodes.find((candidate: any) => candidate.id === nodeId);
        if (!node) return;
        const type = (node.nodeType || node.label).toLowerCase();

        await publishNodeState(node.id, 'running');

        const outgoing = processedConnections.filter((c) => c.sourceId === node.id);
        const concurrentChildren = outgoing.filter((c) => (c.type || 'sequential') === 'concurrent');
        concurrentChildren.forEach((c) => {
          enqueueNode(c.targetId, { priority: 'high', bypassConcurrency: true });
        });

        await new Promise((resolve) => setTimeout(resolve, 1500));

        let finalState: 'success' | 'error' | 'warning' = 'success';

        if (type === 'environment') {
          await publishLog(`Processing node: ${node.label} (${node.id})`, 'info');
        } else if (type === 'playwright') {
          const config = node.config || {};
          const runtime = resolvePlaywrightRuntime(config);
          const cpu = config.cpu || 2;
          const memory = config.memory || 4;
          const workers = config.workers || 1;
          const envKeys = config.envVars || [];

          const injectedEnv = envKeys.map((key: string) => `${key}=***`).join(', ');

          await publishLog(`Processing node: ${node.label} (${node.id})`, 'info');
          await publishLog(`Starting Playwright Runner with resources: CPU ${cpu}, Memory ${memory}GB, Workers ${workers}`, 'build');
          if (injectedEnv) {
            await publishLog(`Injecting Environment Variables: ${injectedEnv}`, 'info');
          }
          const cloudProvider = reqBody.cloudProvider || 'LOCAL-DEV';
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
              editorApiUrl: reqBody.editorApiUrl || EDITOR_API_URL || 'http://host.docker.internal:3001',
              bucketName: reqBody.bucketName || bucketName || null,
              cloudProvider,
            },
            github: settings?.github,
            settings: reqBody.settings,
          };

          console.log(`[Orchestrator] Sending payload to runner for ${node.id}:`, JSON.stringify(payloadData, null, 2));
          if (!settings?.github?.accessToken) {
            console.warn('[Orchestrator WARNING] No GitHub accessToken found in settings. settings.github keys:', settings?.github ? Object.keys(settings.github) : 'null');
          }

          try {
            await orchestratorRuntime.playwrightExecution.execute({
              config,
              envKeys,
              globalEnvVars,
              nodeId: node.id,
              payloadData,
              publishLog,
              registerActiveProcess: (activeNodeId, process) => {
                activeProcesses[activeNodeId] = process as ReturnType<typeof spawn>;
                activeNodePublishers[activeNodeId] = eventPublisher;
                process.on('exit', () => {
                  delete activeProcesses[activeNodeId];
                  delete activeNodePublishers[activeNodeId];
                });
                process.on('error', () => {
                  delete activeProcesses[activeNodeId];
                  delete activeNodePublishers[activeNodeId];
                });
              },
              reqBody,
              runtime,
            });
          } catch (err: any) {
            await publishLog(`Playwright Runner failed: ${err.message}`, 'error');
            finalState = 'error';
          }
        } else if (type === 'slack') {
          const hasSlackSettings = !!(settings && settings.slack);
          await publishLog(`Processing node: ${node.label} (${node.id})`, 'info');
          if (hasSlackSettings) {
            await publishLog('Slack credentials found. Simulating message send.', 'info');
          } else {
            await publishLog('Slack credentials missing. Send might fail.', 'warn');
            finalState = 'warning';
          }
        } else if (type === 'github') {
          const hasGithubSettings = !!(settings && settings.github);
          await publishLog(`Processing node: ${node.label} (${node.id})`, 'info');
          if (hasGithubSettings) {
            await publishLog('GitHub credentials loaded. Authenticating...', 'info');
          } else {
            await publishLog('No GitHub credentials provided.', 'warn');
            finalState = 'error';
          }
        } else if (type === 'jira') {
          const config = node.config || {};
          const jiraSettings = settings?.jira;
          await publishLog(`Processing node: ${node.label} (${node.id})`, 'info');

          if (!jiraSettings?.accessToken) {
            await publishLog('Jira credentials missing. Cannot execute Jira action.', 'error');
            finalState = 'error';
          } else {
            try {
              const action = config.action || 'create';
              const cloudId = config.cloudId;

              if (!cloudId) {
                throw new Error('Missing cloudId in Jira node config. Please reselect project.');
              }

              const replaceVars = (text: string) => {
                if (!text) return text;
                let result = text;
                for (const [k, v] of Object.entries(globalEnvVars)) {
                  result = result.replace(new RegExp(`{{\\s*env\\.${k}\\s*}}`, 'g'), v);
                }
                return result;
              };

              const summary = replaceVars(config.summary || '');
              const description = replaceVars(config.description || '');

              if (action === 'create') {
                await publishLog('Creating Jira issue...', 'info');

                const fields: any = {
                  project: { id: config.projectId },
                  summary: summary || 'Untitled Issue',
                  issuetype: { name: config.issueType },
                };

                if (description) {
                  fields.description = {
                    type: 'doc',
                    version: 1,
                    content: [
                      {
                        type: 'paragraph',
                        content: [
                          { type: 'text', text: description },
                        ],
                      },
                    ],
                  };
                }

                const body = { fields };

                const res = await fetch(`https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/issue`, {
                  method: 'POST',
                  headers: {
                    Authorization: `Bearer ${jiraSettings.accessToken}`,
                    Accept: 'application/json',
                    'Content-Type': 'application/json',
                  },
                  body: JSON.stringify(body),
                });

                if (!res.ok) {
                  const errData = await res.text();
                  throw new Error(`Jira API returned ${res.status}: ${errData}`);
                }

                const data = await res.json();
                await publishLog(`Successfully created Jira issue: ${data.key}`, 'info');
              } else if (action === 'update') {
                await publishLog('Updating Jira issue...', 'info');
                const issueKey = replaceVars(config.issueKey || '');
                if (!issueKey) throw new Error('Issue key is required for update action.');

                const fields: any = {};
                if (summary) fields.summary = summary;
                if (description) {
                  fields.description = {
                    type: 'doc',
                    version: 1,
                    content: [
                      {
                        type: 'paragraph',
                        content: [
                          { type: 'text', text: description },
                        ],
                      },
                    ],
                  };
                }

                const body = { fields };

                const res = await fetch(`https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/issue/${issueKey}`, {
                  method: 'PUT',
                  headers: {
                    Authorization: `Bearer ${jiraSettings.accessToken}`,
                    Accept: 'application/json',
                    'Content-Type': 'application/json',
                  },
                  body: JSON.stringify(body),
                });

                if (!res.ok) {
                  const errData = await res.text();
                  throw new Error(`Jira API returned ${res.status}: ${errData}`);
                }

                await publishLog(`Successfully updated Jira issue: ${issueKey}`, 'info');
              }
            } catch (err: any) {
              await publishLog(`Jira Action failed: ${err.message}`, 'error');
              finalState = 'error';
            }
          }
        } else {
          await publishLog(`Processing node: ${node.label} (${node.id})`, 'info');
        }

        await publishNodeState(node.id, finalState);
        if (finalState === 'error') {
          workflowFailed = true;
        }

        nodeIsRunning[nodeId] = false;
        nodeHasRun[nodeId] = true;
        activeNodeCount--;

        const hasConditionals = outgoing.some((c) => c.type === 'success' || c.type === 'failure');
        const isSuccess = finalState === 'success' || finalState === 'warning';

        for (const conn of outgoing) {
          const connType = conn.type || 'sequential';
          let shouldTrigger = false;

          if (connType === 'concurrent') {
            return;
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
            enqueueNode(conn.targetId);
          }
        }
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
      const startNodes = nodes.filter((n: any) => incomingCount[n.id] === 0).map((n: any) => n.id);

      startNodes.forEach((startNodeId: string) => enqueueNode(startNodeId));

      while (activeNodeCount > 0 || nodeQueue.length > 0) {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }

    terminalEventPublished = true;
    await publishEvent({
      level: workflowFailed ? 'error' : 'info',
      message: workflowFailed ? 'Workflow execution failed.' : 'Workflow execution completed.',
      timestamp: new Date().toISOString(),
      type: workflowFailed ? 'workflow_failed' : 'workflow_completed',
    });
  } catch (err: any) {
    if (!terminalEventPublished) {
      await publishEvent({
        level: 'error',
        message: `Workflow execution failed: ${err?.message || 'Unknown error'}`,
        timestamp: new Date().toISOString(),
        type: 'workflow_failed',
      });
    }
    throw err;
  } finally {
    activeWorkflows--;
    console.log(
      `[heartbeat] workflow-finished activeWorkflows=${activeWorkflows} editorIsAlive=${editorIsAlive}`,
    );
    if (!editorIsAlive && activeWorkflows === 0 && process.env.JOB_MODE !== 'true') {
      console.log('Lost heartbeat to editor and workflow completed. Shutting down gracefully.');
      process.exit(0);
    }
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

app.post('/stop', async (req, res) => {
  const { nodeId } = req.body;
  if (!nodeId) return res.status(400).json({ error: 'nodeId required' });

  if (activeProcesses[nodeId]) {
    await activeNodePublishers[nodeId]?.publishLog(`Stopping execution for node: ${nodeId}...`, 'warn');
    await activeNodePublishers[nodeId]?.publishNodeState(nodeId, 'idle');
    activeProcesses[nodeId].kill('SIGTERM');
    res.status(200).json({ status: 'stopped' });
  } else {
    res.status(404).json({ error: 'Node not running' });
  }
});

async function start() {
  await orchestratorRuntime.ready;
  console.log(`Standby Runner listening on port ${PORT}`);

  app.listen(PORT, () => {
    console.log('Runner started and is now in standby ready for workflows.');
  });
}

start().catch((error) => {
  console.error('Failed to start orchestrator runtime:', error);
  process.exit(1);
});
