import { spawn } from 'child_process';
import express from 'express';
import { PubSub } from '@google-cloud/pubsub';
import { Storage } from '@google-cloud/storage';
import { orchestratorRuntime } from './runtime';

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3002;

const pubsub = new PubSub();
const PUBSUB_TOPIC = process.env.PUBSUB_TOPIC || 'orchestrator-logs';

function resolvePlaywrightRuntime(config: Record<string, any>): 'typescript' | 'python' {
  const configured = config.testLanguage || config.runtime;
  if (configured === 'python') {
    return 'python';
  }
  return 'typescript';
}

const activeProcesses: Record<string, ReturnType<typeof spawn>> = {};

const EDITOR_API_URL = process.env.EDITOR_API_URL || 'http://localhost:3001';
let activeWorkflows = 0;
let editorIsAlive = true;

setInterval(async () => {
  try {
    const res = await fetch(`${EDITOR_API_URL}/api/heartbeat`);
    editorIsAlive = res.ok;
  } catch (err) {
    editorIsAlive = false;
  }

  if (!editorIsAlive && activeWorkflows === 0) {
    console.log('Lost heartbeat to editor and no workflows in progress. Shutting down gracefully.');
    process.exit(0);
  }
}, 5000);

async function publishLog(message: string, level: 'info' | 'error' | 'warn' | 'build' | 'debug' = 'info') {
  const payload = JSON.stringify({ message, level, timestamp: new Date() });
  try {
    const topic = pubsub.topic(PUBSUB_TOPIC);
    await topic.publishMessage({ data: Buffer.from(payload) });
    console.log('Published to Pub/Sub:', message);
  } catch (err) {
    console.error('Failed to publish to Pub/Sub (Check GCP credentials):', err);
    // Fallback log for local dev without credentials
    console.log(`[Local Fallback] ${message}`);
  }
}

async function publishNodeState(nodeId: string, state: 'idle' | 'running' | 'success' | 'error' | 'warning') {
  const payload = JSON.stringify({ type: 'node_state', nodeId, state, timestamp: new Date() });
  try {
    const topic = pubsub.topic(PUBSUB_TOPIC);
    await topic.publishMessage({ data: Buffer.from(payload) });
    console.log(`Published node state ${state} for ${nodeId}`);
  } catch (err) {
    console.error('Failed to publish node state:', err);
  }
}

async function executeWorkflow(reqBody: any) {
  activeWorkflows++;
  try {
    const { nodes, connections, settings, testId, bucketName } = reqBody;
    
    console.log('Runner received workflow execution request with nodes:', nodes?.length);
  
  // Simulate workflow execution asynchronously
  await publishLog('Workflow execution started.', 'info');
  
  if (nodes && Array.isArray(nodes)) {
    // 1. Extract global environment variables from Environment nodes
    const globalEnvVars: Record<string, string> = {};
    const envNodes = nodes.filter(n => (n.nodeType || n.label).toLowerCase() === 'environment');
    for (const envNode of envNodes) {
      if (envNode.config?.variables) {
        envNode.config.variables.forEach((v: any) => {
          if (v.enabled && v.key) {
            globalEnvVars[v.key] = v.currentValue || v.initialValue || '';
          }
        });
      }
    }

    // 2. Build and Execute DAG
    const processedConnections = [...(connections || [])];
    
    // Implicit connections: if a node declares parents and no explicit edge exists,
    // treat each parent as a sequential dependency.
    if (nodes && Array.isArray(nodes)) {
      for (const node of nodes) {
        const implicitParents = [
          ...(Array.isArray(node.parentNodes) ? node.parentNodes : []),
          ...(node.parentId ? [node.parentId] : [])
        ];

        for (const parentId of implicitParents) {
          const hasExplicit = processedConnections.some(c => c.sourceId === parentId && c.targetId === node.id);
          if (!hasExplicit) {
            processedConnections.push({
              sourceId: parentId,
              targetId: node.id,
              type: 'sequential'
            });
          }
        }
      }
    }

    // Process connections to log different connection line states first
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
      options: { priority?: 'normal' | 'high'; bypassConcurrency?: boolean } = {}
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

      const node = nodes.find((n: any) => n.id === nodeId);
      if (!node) return;
      const type = (node.nodeType || node.label).toLowerCase();

      await publishNodeState(node.id, 'running');
      
      // TRIGGER CONCURRENT CHILDREN IMMEDIATELY
      const outgoing = processedConnections.filter(c => c.sourceId === node.id);
      const concurrentChildren = outgoing.filter(c => (c.type || 'sequential') === 'concurrent');
      concurrentChildren.forEach(c => {
        enqueueNode(c.targetId, { priority: 'high', bypassConcurrency: true });
      });

      await new Promise(resolve => setTimeout(resolve, 1500)); // Simulate work
      
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
        
        // Build the env string to inject
        const injectedEnv = envKeys.map((key: string) => {
           return `${key}=***`;
        }).join(', ');

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
            testScript: config.testScript,
            nodeId: node.id,
            testId: testId,
            testLanguage: runtime,
            playwrightVersion: config.playwrightVersion || 'latest',
            editorApiUrl: reqBody.editorApiUrl || process.env.EDITOR_API_URL || 'http://host.docker.internal:3001',
            bucketName: reqBody.bucketName || bucketName || null,
            cloudProvider
          },
          github: settings?.github,
          settings: reqBody.settings
        };
        
        console.log(`[Orchestrator] Sending payload to runner for ${node.id}:`, JSON.stringify(payloadData, null, 2));
        if (!settings?.github?.accessToken) {
          console.warn(`[Orchestrator WARNING] No GitHub accessToken found in settings. settings.github keys:`, settings?.github ? Object.keys(settings.github) : 'null');
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
              process.on('exit', () => {
                delete activeProcesses[activeNodeId];
              });
              process.on('error', () => {
                delete activeProcesses[activeNodeId];
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
               throw new Error("Missing cloudId in Jira node config. Please reselect project.");
            }

            const replaceVars = (text: string) => {
               if (!text) return text;
               let result = text;
               for (const [k, v] of Object.entries(globalEnvVars)) {
                  result = result.replace(new RegExp(`{{\\s*env\\.${k}\\s*}}`, 'g'), v);
               }
               return result;
            };

            const summary = replaceVars(config.summary || "");
            const description = replaceVars(config.description || "");

            if (action === 'create') {
              await publishLog('Creating Jira issue...', 'info');
              
              const fields: any = {
                project: { id: config.projectId },
                summary: summary || "Untitled Issue",
                issuetype: { name: config.issueType }
              };
              
              if (description) {
                fields.description = {
                  type: "doc",
                  version: 1,
                  content: [
                    {
                      type: "paragraph",
                      content: [
                        { type: "text", text: description }
                      ]
                    }
                  ]
                };
              }

              const body = { fields };

              const res = await fetch(`https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/issue`, {
                method: 'POST',
                headers: {
                  'Authorization': `Bearer ${jiraSettings.accessToken}`,
                  'Accept': 'application/json',
                  'Content-Type': 'application/json'
                },
                body: JSON.stringify(body)
              });

              if (!res.ok) {
                const errData = await res.text();
                throw new Error(`Jira API returned ${res.status}: ${errData}`);
              }

              const data = await res.json();
              await publishLog(`Successfully created Jira issue: ${data.key}`, 'info');
            } else if (action === 'update') {
               await publishLog('Updating Jira issue...', 'info');
               const issueKey = replaceVars(config.issueKey || "");
               if (!issueKey) throw new Error("Issue key is required for update action.");

               const fields: any = {};
               if (summary) fields.summary = summary;
               if (description) {
                 fields.description = {
                   type: "doc",
                   version: 1,
                   content: [
                     {
                       type: "paragraph",
                       content: [
                         { type: "text", text: description }
                       ]
                     }
                   ]
                 };
               }

               const body = { fields };

               const res = await fetch(`https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/issue/${issueKey}`, {
                 method: 'PUT',
                 headers: {
                   'Authorization': `Bearer ${jiraSettings.accessToken}`,
                   'Accept': 'application/json',
                   'Content-Type': 'application/json'
                 },
                 body: JSON.stringify(body)
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
        // Just generic logging for other nodes like Jira, etc.
        await publishLog(`Processing node: ${node.label} (${node.id})`, 'info');
      }

      await publishNodeState(node.id, finalState);
      
      nodeIsRunning[nodeId] = false;
      nodeHasRun[nodeId] = true;
      activeNodeCount--;
      
      // TRIGGER DOWNSTREAM
      const hasConditionals = outgoing.some(c => c.type === 'success' || c.type === 'failure');
      const isSuccess = finalState === 'success' || finalState === 'warning';
      
      const promises = outgoing.map(async conn => {
        const connType = conn.type || 'sequential';
        let shouldTrigger = false;
        
        if (connType === 'concurrent') {
          return; // Already triggered when started
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
      });
    };

    // Find starting nodes (nodes with no incoming connections)
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

    // Wait for all nodes to finish
    while (activeNodeCount > 0 || nodeQueue.length > 0) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }

  await publishLog('Workflow execution completed.', 'info');
  } finally {
    activeWorkflows--;
    if (!editorIsAlive && activeWorkflows === 0 && process.env.JOB_MODE !== 'true') {
      console.log('Lost heartbeat to editor and workflow completed. Shutting down gracefully.');
      process.exit(0);
    }
  }
}

// Endpoint called by the API to start a workflow
app.post('/execute', async (req, res) => {
  res.status(200).json({ status: 'started' }); // Immediately acknowledge receipt
  await executeWorkflow(req.body);
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).send('Runner is healthy and in standby.');
});

// Stop node endpoint
app.post('/stop', async (req, res) => {
  const { nodeId } = req.body;
  if (!nodeId) return res.status(400).json({ error: 'nodeId required' });
  
  if (activeProcesses[nodeId]) {
    await publishLog(`Stopping execution for node: ${nodeId}...`, 'warn');
    activeProcesses[nodeId].kill('SIGTERM');
    res.status(200).json({ status: 'stopped' });
  } else {
    res.status(404).json({ error: 'Node not running' });
  }
});

async function start() {
  await orchestratorRuntime.ready;
  console.log(`Standby Runner listening on port ${PORT}`);

  try {
    await pubsub.topic(PUBSUB_TOPIC).get({ autoCreate: true });
  } catch (e) {
    console.warn('Could not ensure Pub/Sub topic exists (Check GCP credentials)');
  }

  app.listen(PORT, () => {
    publishLog('Runner started and is now in standby ready for workflows.');
  });
}

start().catch((error) => {
  console.error('Failed to start orchestrator runtime:', error);
  process.exit(1);
});
