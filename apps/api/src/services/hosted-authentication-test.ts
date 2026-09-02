import crypto from 'node:crypto';
import type { Request } from 'express';
import { apiRuntime } from '../runtime';
import { state } from '../state';
import { executionEvents } from './execution-events';
import {
  recordAuthenticationProfileAudit,
  resolveAuthenticationState,
} from './authentication-profiles';

const HOSTED_PROVIDER_ID = 'PLAYRUNNER_CLOUD';
const SESSION_PREFIX = 'hosted-test';

type SuccessCondition = {
  type: 'element_visible' | 'url_exact' | 'url_prefix';
  value: string;
};

function literal(value: string) {
  return JSON.stringify(value);
}

export function hostedAuthenticationTestScript(args: {
  startUrl: string;
  successCondition: SuccessCondition;
}) {
  const assertion =
    args.successCondition.type === 'element_visible'
      ? `await expect(page.locator(${literal(args.successCondition.value)}).first()).toBeVisible({ timeout: 90_000 });`
      : args.successCondition.type === 'url_exact'
        ? `await expect(page).toHaveURL(${literal(args.successCondition.value)}, { timeout: 90_000 });`
        : `await expect.poll(() => page.url().startsWith(${literal(args.successCondition.value)}), { timeout: 90_000 }).toBe(true);`;

  return `import { test, expect } from '@playwright/test';

test('stored Authentication Profile opens an authenticated session', async ({ page }) => {
  await page.goto(${literal(args.startUrl)}, { waitUntil: 'domcontentloaded' });
  ${assertion}
});
`;
}

export function hostedAuthenticationTestSessionId(
  profileId: string,
  executionId: string,
) {
  return `${SESSION_PREFIX}.${profileId}.${executionId}`;
}

export function parseHostedAuthenticationTestSessionId(value: string) {
  const match = /^hosted-test\.([0-9a-f-]{36})\.([0-9a-f-]{36})$/i.exec(value);
  return match ? { executionId: match[2], profileId: match[1] } : null;
}

function safeSession(args: {
  executionId: string;
  profileId: string;
  status: string;
}) {
  const status =
    args.status === 'completed'
      ? 'completed'
      : args.status === 'failed'
        ? 'failed'
        : args.status === 'cancelled'
          ? 'cancelled'
          : 'started';
  return {
    ...(status === 'failed'
      ? {
          error:
            'Stored session test failed on the Hosted Runner. The Authentication Profile may need to be refreshed.',
        }
      : {}),
    id: hostedAuthenticationTestSessionId(args.profileId, args.executionId),
    mode: 'test' as const,
    profileId: args.profileId,
    status,
  };
}

export async function startHostedAuthenticationTest(args: {
  actorId: string;
  profileId: string;
  req: Request;
}) {
  const resolved = await resolveAuthenticationState(
    args.actorId,
    args.profileId,
  );
  const executionId = crypto.randomUUID();
  const environmentNodeId = crypto.randomUUID();
  const playwrightNodeId = crypto.randomUUID();
  const body = {
    cloudProvider: HOSTED_PROVIDER_ID,
    concurrency: 1,
    connections: [
      {
        id: crypto.randomUUID(),
        sourceId: environmentNodeId,
        targetId: playwrightNodeId,
        type: 'sequential',
      },
    ],
    nodes: [
      {
        config: { environmentId: resolved.profile.environmentId },
        id: environmentNodeId,
        label: 'Authentication Profile Environment',
        nodeType: 'environment',
      },
      {
        config: {
          action: 'run',
          authenticationProfileId: args.profileId,
          cpu: 2,
          memory: 4,
          playwrightVersion: 'latest',
          testLanguage: 'typescript',
          testScript: hostedAuthenticationTestScript({
            startUrl: resolved.profile.startUrl,
            successCondition: {
              type: resolved.profile
                .successConditionType as SuccessCondition['type'],
              value: resolved.profile.successConditionValue,
            },
          }),
          workers: 1,
        },
        id: playwrightNodeId,
        label: 'Test stored Authentication Profile',
        nodeType: 'playwright',
      },
    ],
    testId: executionId,
    workflow: {
      definition: {
        id: `authentication-profile-${args.profileId}`,
        name: `Test ${resolved.profile.name}`,
      },
      run: {
        runner: HOSTED_PROVIDER_ID,
        trigger: 'authentication_profile_test',
      },
    },
  };

  state.testCloudProviders[executionId] = HOSTED_PROVIDER_ID;
  const result = await apiRuntime.workflowExecution.execute({
    body,
    req: args.req,
    resourceOwnerUserId: args.actorId,
    testId: executionId,
  });
  if (result.status < 200 || result.status >= 300) {
    throw Object.assign(
      new Error(
        typeof result.body.error === 'string'
          ? result.body.error
          : 'Stored session test could not be started.',
      ),
      { statusCode: result.status },
    );
  }
  await recordAuthenticationProfileAudit({
    action: 'test_started',
    actorId: args.actorId,
    executionId,
    outcome: 'success',
    profileId: args.profileId,
  });
  return safeSession({
    executionId,
    profileId: args.profileId,
    status: 'running',
  });
}

export async function getHostedAuthenticationTest(args: {
  actorId: string;
  sessionId: string;
}) {
  const parsed = parseHostedAuthenticationTestSessionId(args.sessionId);
  if (!parsed) {
    throw Object.assign(
      new Error('Hosted Authentication Profile test not found.'),
      {
        statusCode: 404,
      },
    );
  }
  const execution = await executionEvents.getExecutionForUser(
    parsed.executionId,
    args.actorId,
  );
  if (!execution) {
    throw Object.assign(
      new Error('Hosted Authentication Profile test not found.'),
      {
        statusCode: 404,
      },
    );
  }
  return safeSession({
    executionId: parsed.executionId,
    profileId: parsed.profileId,
    status: execution.status,
  });
}
