import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import type {
  ApiRuntimeContribution,
  CloudProviderRegistry,
  OutputProxyBackend,
  OutputSyncBackend,
  RunnerProvisioner,
  SchedulerProvisionRequest,
  SchedulerProvisioner,
  SchedulerProvisionResult,
  WorkflowExecutionBackend,
  WorkflowExecutionRequest,
  WorkflowExecutionResult,
} from './contracts';
import { DatabaseLogTransport } from './log-transport';
import {
  createGcpApiRuntimeContribution,
  createGcpPubSubEventStreamManager,
} from '@playrunner/gcp/api-runtime';
import { NoopOutputProxyBackend } from './output-proxy';
import { NoopOutputSyncBackend } from './output-sync';
import { LocalDockerRunnerProvisioner } from './runner-provisioning';
import { LocalWorkflowExecutionBackend } from './workflow-execution';
import { executionEvents } from '../services/execution-events';
import { state } from '../state';
import {
  createIntegrationCredentialStore,
  resolveConnection,
} from '../services/connections';
import { preparePackageCredentials } from '../integrations/package-registry';

const HOST_NODE_TYPES = new Set([
  'environment',
  'javascript',
  'playwright',
  'schedule',
]);

async function resolveWorkflowSettings(request: WorkflowExecutionRequest) {
  const userId = request.req.authUser?.providerUserId;
  if (!userId) {
    throw Object.assign(new Error('Unauthorized'), { statusCode: 401 });
  }
  const nodes = Array.isArray(request.body.nodes) ? request.body.nodes : [];
  const providers = new Set<string>();
  for (const node of nodes) {
    const nodeType =
      node && typeof node === 'object' && typeof node.nodeType === 'string'
        ? node.nodeType.trim()
        : '';
    if (nodeType && !HOST_NODE_TYPES.has(nodeType)) providers.add(nodeType);
    if (nodeType === 'playwright') providers.add('github');
  }

  const cloudProvider = request.body.cloudProvider || 'LOCAL_RUNNER';
  const settings: Record<string, Record<string, unknown>> = {};
  const credentialStore = createIntegrationCredentialStore(userId);
  await Promise.all(
    [...providers].map(async (provider) => {
      await preparePackageCredentials(provider, credentialStore, 'integration');
      const connection = await resolveConnection(
        userId,
        'integration',
        provider,
      );
      if (connection) {
        settings[provider] = { ...connection.config, ...connection.secrets };
      }
    }),
  );
  if (cloudProvider !== 'LOCAL_RUNNER') {
    const provider = String(cloudProvider).toLowerCase();
    await preparePackageCredentials(provider, credentialStore, 'cloud');
    const connection = await resolveConnection(userId, 'cloud', provider);
    if (connection) {
      settings[provider] = { ...connection.config, ...connection.secrets };
    }
  }
  return settings;
}

class StaticCloudProviderRegistry implements CloudProviderRegistry {
  constructor(
    private readonly providers = [{ id: 'LOCAL_RUNNER', label: 'Local Dev' }],
  ) {}

  list() {
    return [...this.providers];
  }

  register(providers: { id: string; label: string }[]) {
    for (const provider of providers) {
      if (!this.providers.some((existing) => existing.id === provider.id)) {
        this.providers.push(provider);
      }
    }
  }
}

class WorkflowExecutionRegistry {
  constructor(private readonly backends: WorkflowExecutionBackend[]) {}

  async execute(
    request: WorkflowExecutionRequest,
  ): Promise<WorkflowExecutionResult> {
    // The browser is never authoritative for credentials. Rebuild the settings
    // payload from encrypted server-side connections for every execution path.
    request.body.settings = await resolveWorkflowSettings(request);
    const cloudProvider = request.body.cloudProvider || 'LOCAL_RUNNER';
    const backend = this.backends.find((candidate) =>
      candidate.supports(cloudProvider),
    );
    if (!backend) {
      return {
        body: { error: `Unknown cloud provider: ${cloudProvider}` },
        status: 400,
      };
    }

    return backend.execute(request);
  }

  register(backends: WorkflowExecutionBackend[]) {
    this.backends.push(...backends);
  }
}

class OutputSyncRegistry {
  constructor(private readonly backends: OutputSyncBackend[]) {}

  async sync(request: Parameters<OutputSyncBackend['sync']>[0]): Promise<void> {
    for (const backend of this.backends) {
      await backend.sync(request);
    }
  }

  register(backends: OutputSyncBackend[]) {
    this.backends.push(...backends);
  }
}

class OutputProxyRegistry {
  constructor(private readonly backends: OutputProxyBackend[]) {}

  async tryHandle(
    req: Parameters<OutputProxyBackend['tryHandle']>[0],
    res: Parameters<OutputProxyBackend['tryHandle']>[1],
  ): Promise<boolean> {
    for (const backend of this.backends) {
      if (await backend.tryHandle(req, res)) {
        return true;
      }
    }
    return false;
  }

  register(backends: OutputProxyBackend[]) {
    this.backends.push(...backends);
  }
}

class SchedulerProvisionerRegistry {
  constructor(private readonly provisioners: SchedulerProvisioner[]) {}

  private getProvisioner(provider: string): SchedulerProvisioner {
    const provisioner = this.provisioners.find((candidate) =>
      candidate.supports(provider),
    );
    if (!provisioner) {
      throw new Error(`No scheduler provisioner registered for ${provider}.`);
    }
    return provisioner;
  }

  async delete(request: SchedulerProvisionRequest): Promise<void> {
    await this.getProvisioner(request.schedule.provider).delete(request);
  }

  async pause(
    request: SchedulerProvisionRequest,
  ): Promise<SchedulerProvisionResult | void> {
    return await this.getProvisioner(request.schedule.provider).pause(request);
  }

  register(provisioners: SchedulerProvisioner[]) {
    this.provisioners.push(...provisioners);
  }

  async upsert(
    request: SchedulerProvisionRequest,
  ): Promise<SchedulerProvisionResult> {
    return await this.getProvisioner(request.schedule.provider).upsert(request);
  }
}

const logTransport = new DatabaseLogTransport();
const gcpPubSubEventStreamManager =
  createGcpPubSubEventStreamManager(executionEvents);
const cloudProviders = new StaticCloudProviderRegistry();
const outputProxy = new OutputProxyRegistry([new NoopOutputProxyBackend()]);
const outputSync = new OutputSyncRegistry([new NoopOutputSyncBackend()]);
const scheduler = new SchedulerProvisionerRegistry([]);
const workflowExecution = new WorkflowExecutionRegistry([
  new LocalWorkflowExecutionBackend(logTransport, gcpPubSubEventStreamManager),
]);

function isPremiumEnabled(): boolean {
  return process.env.ENABLE_PREMIUM !== 'false';
}

function resolvePremiumApiRuntimeEntry(): string | null {
  const configuredPath = process.env.PREMIUM_API_RUNTIME_PATH;
  const candidates = [
    configuredPath,
    path.resolve(__dirname, '../../../../premium/api/src/runtime/register.ts'),
    path.resolve(
      __dirname,
      '../../../../../premium/api/src/runtime/register.ts',
    ),
  ].filter(Boolean) as string[];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

function applyContribution(contribution: ApiRuntimeContribution) {
  if (contribution.cloudProviders?.length) {
    cloudProviders.register(contribution.cloudProviders);
  }
  if (contribution.outputProxyBackends?.length) {
    outputProxy.register(contribution.outputProxyBackends);
  }
  if (contribution.outputSyncBackends?.length) {
    outputSync.register(contribution.outputSyncBackends);
  }
  if (contribution.schedulerProvisioners?.length) {
    scheduler.register(contribution.schedulerProvisioners);
  }
  if (contribution.workflowExecutionBackends?.length) {
    workflowExecution.register(contribution.workflowExecutionBackends);
  }
}

async function loadPremiumContribution(): Promise<void> {
  if (!isPremiumEnabled()) {
    return;
  }

  const premiumRuntimeEntry = resolvePremiumApiRuntimeEntry();
  if (!premiumRuntimeEntry) {
    return;
  }

  const premiumModule = await import(pathToFileURL(premiumRuntimeEntry).href);
  if (typeof premiumModule.createPremiumApiRuntimeContribution !== 'function') {
    return;
  }

  const contribution = await premiumModule.createPremiumApiRuntimeContribution({
    logTransport,
  });
  applyContribution(contribution);
}

applyContribution(
  createGcpApiRuntimeContribution({
    executionEvents,
    logTransport,
    pubSubEventStreamManager: gcpPubSubEventStreamManager,
    state,
  }),
);

export const apiRuntime = {
  cloudProviders,
  logTransport,
  outputProxy,
  outputSync,
  ready: loadPremiumContribution(),
  runnerProvisioner: new LocalDockerRunnerProvisioner() as RunnerProvisioner,
  scheduler,
  workflowExecution,
};
