import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import type {
  OrchestratorRuntimeContribution,
  PlaywrightExecutionBackend,
  PlaywrightExecutionRequest,
} from './contracts';
import { GcpPlaywrightExecutionBackend } from './playwright-gcp';
import { LocalPlaywrightExecutionBackend } from './playwright-local';

class PlaywrightExecutionRegistry {
  constructor(private readonly backends: PlaywrightExecutionBackend[]) {}

  async execute(request: PlaywrightExecutionRequest): Promise<void> {
    const cloudProvider = request.reqBody.cloudProvider || 'LOCAL_RUNNER';
    const backend = this.backends.find((candidate) =>
      candidate.supports(cloudProvider),
    );
    if (!backend) {
      throw new Error(
        `Unsupported cloud provider for Playwright execution: ${cloudProvider}`,
      );
    }

    return backend.execute(request);
  }

  register(backends: PlaywrightExecutionBackend[]) {
    this.backends.push(...backends);
  }
}

const playwrightExecution = new PlaywrightExecutionRegistry([
  new LocalPlaywrightExecutionBackend(),
  new GcpPlaywrightExecutionBackend(),
]);

function isPremiumEnabled(): boolean {
  return process.env.ENABLE_PREMIUM !== 'false';
}

function applyContribution(contribution: OrchestratorRuntimeContribution) {
  if (contribution.playwrightExecutionBackends?.length) {
    playwrightExecution.register(contribution.playwrightExecutionBackends);
  }
}

async function loadPremiumContribution(): Promise<void> {
  if (!isPremiumEnabled()) {
    return;
  }

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
  playwrightExecution,
  ready: loadPremiumContribution(),
};
