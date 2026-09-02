import {
  sealAuthenticationEnvelope,
  type AuthenticationEnvelope,
} from '../../../runners/shared/authentication-envelope';
import { prisma } from '../lib/prisma';
import { resolveAuthenticationState } from './authentication-profiles';

type Grant = {
  expiresAt: Date;
  fetches: number;
  ownerUserId: string;
  profileId: string;
};

const GRANT_TTL_MS = 2 * 60 * 60 * 1_000;
const MAX_FETCHES_PER_GRANT = 128;

type ExecutionAuthenticationGrantStore = Pick<
  typeof prisma.executionAuthenticationGrant,
  'deleteMany' | 'findFirst' | 'findUniqueOrThrow' | 'updateMany' | 'upsert'
>;

export class ExecutionAuthenticationGrants {
  constructor(
    private readonly grantStore: ExecutionAuthenticationGrantStore = prisma.executionAuthenticationGrant,
  ) {}

  async register(args: {
    executionId: string;
    nodeId: string;
    ownerUserId: string;
    profileId: string;
  }) {
    const grant = {
      expiresAt: new Date(Date.now() + GRANT_TTL_MS),
      fetches: 0,
      ownerUserId: args.ownerUserId,
      profileId: args.profileId,
    } satisfies Grant;
    await this.grantStore.upsert({
      create: { ...args, ...grant },
      update: grant,
      where: {
        executionId_nodeId: {
          executionId: args.executionId,
          nodeId: args.nodeId,
        },
      },
    });
  }

  async has(executionId: string, nodeId: string) {
    return Boolean(
      await this.grantStore.findFirst({
        select: { executionId: true },
        where: {
          executionId,
          nodeId,
          expiresAt: { gt: new Date() },
          fetches: { lt: MAX_FETCHES_PER_GRANT },
        },
      }),
    );
  }

  async seal(args: {
    executionId: string;
    nodeId: string;
    recipientPublicKey: string;
  }): Promise<AuthenticationEnvelope> {
    const claimed = await this.grantStore.updateMany({
      data: { fetches: { increment: 1 } },
      where: {
        executionId: args.executionId,
        nodeId: args.nodeId,
        expiresAt: { gt: new Date() },
        fetches: { lt: MAX_FETCHES_PER_GRANT },
      },
    });
    if (claimed.count !== 1) {
      throw Object.assign(
        new Error('Execution Authentication Profile is unavailable.'),
        { statusCode: 404 },
      );
    }
    const grant = await this.grantStore.findUniqueOrThrow({
      where: {
        executionId_nodeId: {
          executionId: args.executionId,
          nodeId: args.nodeId,
        },
      },
    });
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

  async clearExecution(executionId: string) {
    await this.grantStore.deleteMany({
      where: { executionId },
    });
  }
}

export const executionAuthenticationGrants =
  new ExecutionAuthenticationGrants();
