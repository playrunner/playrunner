import { normalizeAuthenticationProfiles } from '../../../runners/shared/authentication-profiles';
import { getLinkedEnvironmentIds } from './workflow-environments';
import {
  recordAuthenticationProfileAudit,
  resolveAuthenticationState,
} from './authentication-profiles';
import { executionAuthenticationGrants } from './execution-authentication';

const defaults = {
  resolveState: resolveAuthenticationState,
  audit: recordAuthenticationProfileAudit,
  register: executionAuthenticationGrants.register.bind(
    executionAuthenticationGrants,
  ),
};

export async function prepareExecutionAuthentication(
  args: {
    ownerUserId?: string;
    actorUserId?: string;
    nodes: any[];
    executionId: string;
  },
  dependencies = defaults,
): Promise<string[]> {
  const { ownerUserId, actorUserId } = args;
  if (!ownerUserId || !actorUserId)
    throw Object.assign(new Error('Unauthorized'), { statusCode: 401 });
  const selections = args.nodes.flatMap((node) => {
    if (node?.nodeType !== 'playwright') return [];
    try {
      const profiles = normalizeAuthenticationProfiles(node.config || {});
      return profiles.length ? [{ nodeId: String(node.id), profiles }] : [];
    } catch (error) {
      throw Object.assign(error as Error, { statusCode: 400 });
    }
  });
  if (!selections.length) return [];
  if (ownerUserId !== actorUserId) {
    throw Object.assign(
      new Error(
        'Shared workflow runs cannot use the owner’s Authentication Profiles.',
      ),
      { code: 'authentication_profile_owner_only', statusCode: 403 },
    );
  }
  const linkedEnvironmentIds = new Set(getLinkedEnvironmentIds(args.nodes));
  // Validate the complete selection before issuing any grants or success audits.
  for (const { profiles } of selections) {
    for (const { profileId } of profiles) {
      const resolved = await dependencies.resolveState(ownerUserId, profileId);
      if (!linkedEnvironmentIds.has(resolved.profile.environmentId)) {
        throw Object.assign(
          new Error(
            `Authentication Profile “${resolved.profile.name}” requires its Environment to be linked in this workflow.`,
          ),
          {
            code: 'authentication_profile_environment_mismatch',
            statusCode: 409,
          },
        );
      }
    }
  }
  for (const { nodeId, profiles } of selections) {
    for (const { profileId } of profiles) {
      await dependencies.audit({
        action: 'execution_used',
        actorId: actorUserId,
        executionId: args.executionId,
        outcome: 'success',
        profileId,
      });
    }
    await dependencies.register({
      executionId: args.executionId,
      nodeId,
      ownerUserId,
      profiles,
    });
  }
  return selections.map(({ nodeId }) => nodeId);
}
