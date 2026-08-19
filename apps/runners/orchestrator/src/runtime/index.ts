import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import type {
  AgentExecutionBackend,
  AgentExecutionRequest,
  OrchestratorRuntimeContribution,
  PlaywrightExecutionBackend,
  PlaywrightExecutionRequest,
  PreparedPlaywrightRunner,
} from './contracts';
import { LocalAgentExecutionBackend } from './agent-local';
import { GcpPlaywrightExecutionBackend } from './playwright-gcp';
import { LocalPlaywrightExecutionBackend } from './playwright-local';

class PlaywrightExecutionRegistry {
  constructor(private readonly backends: PlaywrightExecutionBackend[]) {}

  private getBackend(request: PlaywrightExecutionRequest) {
    const cloudProvider = request.reqBody.cloudProvider || 'LOCAL_RUNNER';
    const backend = this.backends.find((candidate) =>
      candidate.supports(cloudProvider),
    );
    if (!backend) {
      throw new Error(
        `Unsupported cloud provider for Playwright execution: ${cloudProvider}`,
      );
    }

    return backend;
  }

  async execute(request: PlaywrightExecutionRequest): Promise<void> {
    const backend = this.getBackend(request);

    return backend.execute(request);
  }

  async prepare(
    request: PlaywrightExecutionRequest,
  ): Promise<PreparedPlaywrightRunner> {
    const backend = this.getBackend(request);
    if (backend.prepare) {
      return backend.prepare(request);
    }

    let started = false;
    const start = async () => {
      if (started) return;
      started = true;
      await backend.execute(request);
    };

    return {
      start,
      waitForCompletion: async () => ({ outcome: 'success', output: {} }),
      waitUntilReady: async () => {},
    };
  }

  register(backends: PlaywrightExecutionBackend[]) {
    this.backends.push(...backends);
  }
}

class AgentExecutionRegistry {
  constructor(private readonly backends: AgentExecutionBackend[]) {}

  async prepare(request: AgentExecutionRequest) {
    const cloudProvider = request.reqBody.cloudProvider || 'LOCAL_RUNNER';
    const backend = this.backends.find((candidate) =>
      candidate.supports(cloudProvider),
    );
    if (!backend) {
      throw new Error(
        `AI Container execution is not available for cloud provider ${cloudProvider}.`,
      );
    }
    return backend.prepare(request);
  }

  register(backends: AgentExecutionBackend[]) {
    this.backends.push(...backends);
  }
}

const agentExecution = new AgentExecutionRegistry([
  new LocalAgentExecutionBackend(),
]);

const playwrightExecution = new PlaywrightExecutionRegistry([
  new LocalPlaywrightExecutionBackend(),
  new GcpPlaywrightExecutionBackend(),
]);

function applyContribution(contribution: OrchestratorRuntimeContribution) {
  if (contribution.agentExecutionBackends?.length) {
    agentExecution.register(contribution.agentExecutionBackends);
  }
  if (contribution.playwrightExecutionBackends?.length) {
    playwrightExecution.register(contribution.playwrightExecutionBackends);
  }
}

async function loadPremiumContribution(): Promise<void> {
  const premiumRuntimeEntry = resolvePremiumRuntimeEntry();
  if (!premiumRuntimeEntry) {
    return;
  }

  const premiumModule = await import(pathToFileURL(premiumRuntimeEntry).href);
  if (
    typeof premiumModule.createPremiumOrchestratorRuntimeContribution !==
    'function'
  ) {
    return;
  }

  const contribution =
    await premiumModule.createPremiumOrchestratorRuntimeContribution();
  applyContribution(contribution);
}

function resolvePremiumRuntimeEntry(): string | null {
  const candidates = [
    process.env.PREMIUM_ORCHESTRATOR_RUNTIME_PATH,
    path.resolve(
      __dirname,
      '../../../../../premium/runners/orchestrator/register.mjs',
    ),
    path.resolve(
      process.cwd(),
      '../../../premium/runners/orchestrator/register.mjs',
    ),
    path.resolve(process.cwd(), 'premium/runners/orchestrator/register.mjs'),
  ].filter(Boolean) as string[];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

export const orchestratorRuntime = {
  agentExecution,
  playwrightExecution,
  ready: loadPremiumContribution(),
};
