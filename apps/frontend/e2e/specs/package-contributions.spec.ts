import { discoveredIntegrationContributions } from '../generated/package-e2e-contributions';
import { validateE2EContributions } from '../contribution-registry';
import { expect, test } from '../fixtures';

const selectedMode = process.env.PLAYRUNNER_E2E_MODE ?? 'mock';

if (!['all', 'live', 'mock'].includes(selectedMode)) {
  throw new Error(
    `PLAYRUNNER_E2E_MODE must be "mock", "live", or "all"; received "${selectedMode}".`,
  );
}

const contributions = validateE2EContributions(
  discoveredIntegrationContributions,
);

for (const entry of contributions) {
  test.describe(entry.integrationId, () => {
    for (const scenario of entry.contribution.scenarios) {
      test(
        scenario.title,
        {
          tag: [
            ...(scenario.tags ? [...scenario.tags] : []),
            `@${scenario.mode}`,
          ],
        },
        async ({ host, page }, testInfo) => {
          test.skip(
            selectedMode !== 'all' && scenario.mode !== selectedMode,
            `Scenario requires ${scenario.mode} provider mode.`,
          );

          const runId = [
            testInfo.testId,
            testInfo.workerIndex,
            testInfo.retry,
          ].join('-');
          const data = entry.contribution.createData({
            mode: scenario.mode,
            runId,
            testId: testInfo.testId,
            workerIndex: testInfo.workerIndex,
          });
          const pom = entry.contribution.createPom({ host, page });

          await scenario.run({ data, expect, host, page, pom });
        },
      );
    }
  });
}
