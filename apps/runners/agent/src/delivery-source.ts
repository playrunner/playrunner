import { normalizeGitHubRepository } from './payload';
import type { PreparedRepository } from './repository';

export type BotDeliverySource = {
  headRef: string;
  headSha: string;
  repository: string;
};

export function resolveBotDeliverySource(
  prepared: PreparedRepository,
  config: Record<string, unknown>,
): BotDeliverySource {
  if (prepared.changeContext) {
    return {
      headRef: prepared.changeContext.headRef,
      headSha: prepared.changeContext.headSha,
      repository: prepared.changeContext.repository,
    };
  }
  return {
    headRef: String(config.branch || 'main').trim() || 'main',
    headSha: prepared.headRevision,
    repository: normalizeGitHubRepository(config.repository),
  };
}
