import type { PlayrunnerE2EContribution } from '@playrunner/integration-sdk/e2e';

type DiscoveredContribution = {
  contribution: unknown;
  integrationId: string;
  packageName: string;
};

export function validateE2EContributions(
  entries: readonly DiscoveredContribution[],
) {
  const scenarioKeys = new Set<string>();

  return entries.map((entry) => {
    const contribution =
      entry.contribution as Partial<PlayrunnerE2EContribution>;

    if (!contribution || typeof contribution !== 'object') {
      throw new Error(
        `Integration package "${entry.packageName}" did not default-export an E2E contribution object.`,
      );
    }
    if (contribution.id !== entry.integrationId) {
      throw new Error(
        `Integration package "${entry.packageName}" declares E2E id "${entry.integrationId}" but exports "${String(contribution.id)}".`,
      );
    }
    if (
      typeof contribution.createData !== 'function' ||
      typeof contribution.createPom !== 'function' ||
      !Array.isArray(contribution.scenarios) ||
      contribution.scenarios.length === 0
    ) {
      throw new Error(
        `Integration package "${entry.packageName}" exports an incomplete E2E contribution.`,
      );
    }

    for (const scenario of contribution.scenarios) {
      if (
        !scenario ||
        typeof scenario.id !== 'string' ||
        !scenario.id ||
        typeof scenario.title !== 'string' ||
        !scenario.title ||
        typeof scenario.run !== 'function'
      ) {
        throw new Error(
          `Integration package "${entry.packageName}" exports an invalid E2E scenario.`,
        );
      }

      const scenarioKey = `${entry.integrationId}:${scenario.id}`;
      if (scenarioKeys.has(scenarioKey)) {
        throw new Error(`Duplicate E2E scenario id "${scenarioKey}".`);
      }
      scenarioKeys.add(scenarioKey);
    }

    return {
      ...entry,
      contribution: contribution as PlayrunnerE2EContribution,
    };
  });
}
