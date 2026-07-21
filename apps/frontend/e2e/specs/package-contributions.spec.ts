import { discoveredIntegrationContributions } from '../generated/package-e2e-contributions';
import { validateE2EContributions } from '../contribution-registry';
import { expect, test } from '../fixtures';

const contributions = validateE2EContributions(
  discoveredIntegrationContributions,
);

for (const entry of contributions) {
  test.describe(entry.integrationId, () => {
    for (const scenario of entry.contribution.scenarios) {
      test(
        scenario.title,
        { tag: scenario.tags ? [...scenario.tags] : [] },
        async ({ host, page }, testInfo) => {
          const runId = [
            testInfo.testId,
            testInfo.workerIndex,
            testInfo.retry,
          ].join('-');
          const data = entry.contribution.createData({
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
