import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import type {
  ApiRuntimeContribution,
  CloudProviderRegistry,
  OutputProxyBackend,
  OutputSyncBackend,
  RunnerProvisioner,
  WorkflowExecutionBackend,
  WorkflowExecutionRequest,
  WorkflowExecutionResult,
} from './contracts';
import { DatabaseLogTransport } from './log-transport';
import { GcpOutputProxyBackend } from './gcp-output-proxy';
import { GcpOutputSyncBackend } from './gcp-output-sync';
import { GcpWorkflowExecutionBackend } from './gcp-workflow-execution';
import { NoopOutputProxyBackend } from './output-proxy';
import { NoopOutputSyncBackend } from './output-sync';
import { LocalDockerRunnerProvisioner } from './runner-provisioning';
import { LocalWorkflowExecutionBackend } from './workflow-execution';

class StaticCloudProviderRegistry implements CloudProviderRegistry {
  constructor(
    private readonly providers = [
      { id: 'LOCAL-DEV', label: 'Local Dev' },
      { id: 'GCP', label: 'GCP Runner' },
    ],
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
    const cloudProvider = request.body.cloudProvider || 'LOCAL-DEV';
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

const logTransport = new DatabaseLogTransport();
const cloudProviders = new StaticCloudProviderRegistry();
const outputProxy = new OutputProxyRegistry([
  new NoopOutputProxyBackend(),
  new GcpOutputProxyBackend(),
]);
const outputSync = new OutputSyncRegistry([
  new NoopOutputSyncBackend(),
  new GcpOutputSyncBackend(),
]);
const workflowExecution = new WorkflowExecutionRegistry([
  new LocalWorkflowExecutionBackend(logTransport),
  new GcpWorkflowExecutionBackend(logTransport),
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

export const apiRuntime = {
  cloudProviders,
  logTransport,
  outputProxy,
  outputSync,
  ready: loadPremiumContribution(),
  runnerProvisioner: new LocalDockerRunnerProvisioner() as RunnerProvisioner,
  workflowExecution,
};
