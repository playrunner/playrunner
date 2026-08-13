import { definePlayrunnerE2EContribution } from '@playrunner/integration-sdk/e2e';
import { createScheduleE2EData } from './data';
import { ScheduleE2EPom } from './ScheduleE2EPom';

export const scheduleE2EContribution = definePlayrunnerE2EContribution({
  id: 'schedule',
  createData: createScheduleE2EData,
  createPom: ({ host, page }) => new ScheduleE2EPom(page, host),
  scenarios: [
    {
      id: 'configuration-only-composition',
      mode: 'mock',
      title: 'composes Schedule as a configuration-only integration',
      tags: ['@schedule', '@integration'],
      async run({ data, expect, pom }) {
        expect(data.runId).toBeTruthy();
        await pom.openCatalog();
        await expect(pom.card).toHaveCount(0);
      },
    },
    {
      id: 'configure-all-node-values',
      mode: 'mock',
      title: 'configures and persists every Schedule node value',
      tags: ['@schedule', '@integration', '@node'],
      async run({ data, expect, pom }) {
        await pom.createNodeWithGcpRunner();
        await pom.field('enabled').click();
        await pom.field('frequency-minute').click();
        await pom.field('interval').fill('7');
        await pom.field('frequency-hour').click();
        await pom.field('interval').fill('3');
        await pom.field('minute-of-hour').fill('17');
        await pom.field('frequency-day').click();
        await pom.field('time').fill('10:15');
        await pom.field('frequency-week').click();
        await pom.field('time').fill('11:20');
        await pom.field('day-0').click();
        await pom.field('day-2').click();
        await pom.field('frequency-month').click();
        await pom.field('time').fill('12:25');
        await pom.field('day-of-month').fill('23');
        await pom.field('timezone').selectOption(data.timezone);
        await pom.saveReloadAndReopenNode();

        await expect(pom.field('enabled')).toHaveAttribute(
          'aria-pressed',
          'false',
        );
        await expect(pom.field('frequency-month')).toHaveAttribute(
          'aria-pressed',
          'true',
        );
        await expect(pom.field('time')).toHaveValue('12:25');
        await expect(pom.field('day-of-month')).toHaveValue('23');
        await expect(pom.field('timezone')).toHaveValue(data.timezone);
        await pom.field('frequency-hour').click();
        await expect(pom.field('interval')).toHaveValue('3');
        await expect(pom.field('minute-of-hour')).toHaveValue('17');
        await pom.field('frequency-week').click();
        await expect(pom.field('day-0')).toHaveAttribute(
          'aria-pressed',
          'true',
        );
        await expect(pom.field('day-2')).toHaveAttribute(
          'aria-pressed',
          'false',
        );
      },
    },
  ],
});

export default scheduleE2EContribution;

export { createScheduleE2EData } from './data';
export type { ScheduleE2EData } from './data';
export { ScheduleE2EPom } from './ScheduleE2EPom';
