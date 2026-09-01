import {
  sealAuthenticationEnvelope,
  type AuthenticationEnvelope,
} from '../../../runners/shared/authentication-envelope';
import { resolveAuthenticationState } from './authentication-profiles';

type Grant = {
  expiresAt: number;
  fetches: number;
  ownerUserId: string;
  profileId: string;
};

const GRANT_TTL_MS = 2 * 60 * 60 * 1_000;
const MAX_FETCHES_PER_GRANT = 128;

class ExecutionAuthenticationGrants {
  private readonly grants = new Map<string, Grant>();

  private key(executionId: string, nodeId: string) {
    return `${executionId}\0${nodeId}`;
  }

  register(args: {
    executionId: string;
    nodeId: string;
    ownerUserId: string;
    profileId: string;
  }) {
    const key = this.key(args.executionId, args.nodeId);
    const grant = {
      expiresAt: Date.now() + GRANT_TTL_MS,
      fetches: 0,
      ownerUserId: args.ownerUserId,
      profileId: args.profileId,
    };
    this.grants.set(key, grant);
    const timer = setTimeout(() => {
      if (this.grants.get(key) === grant) this.grants.delete(key);
    }, GRANT_TTL_MS);
    timer.unref();
  }

  has(executionId: string, nodeId: string) {
    const grant = this.grants.get(this.key(executionId, nodeId));
    return Boolean(grant && grant.expiresAt > Date.now());
  }

  async seal(args: {
    executionId: string;
    nodeId: string;
    recipientPublicKey: string;
  }): Promise<AuthenticationEnvelope> {
    const key = this.key(args.executionId, args.nodeId);
    const grant = this.grants.get(key);
    if (
      !grant ||
      grant.expiresAt <= Date.now() ||
      grant.fetches >= MAX_FETCHES_PER_GRANT
    ) {
      this.grants.delete(key);
      throw Object.assign(
        new Error('Execution Authentication Profile is unavailable.'),
        { statusCode: 404 },
      );
    }
    grant.fetches += 1;
    const resolved = await resolveAuthenticationState(
      grant.ownerUserId,
      grant.profileId,
    );
    return sealAuthenticationEnvelope({
      executionId: args.executionId,
      nodeId: args.nodeId,
      plaintext: Buffer.from(JSON.stringify(resolved.state), 'utf8'),
      recipientPublicKey: args.recipientPublicKey,
    });
  }

  clearExecution(executionId: string) {
    for (const key of this.grants.keys()) {
      if (key.startsWith(`${executionId}\0`)) this.grants.delete(key);
    }
  }
}

export const executionAuthenticationGrants =
  new ExecutionAuthenticationGrants();
