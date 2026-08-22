import { definePlayrunnerE2EContribution } from '@playrunner/integration-sdk/e2e';

export const validatorE2EContribution = definePlayrunnerE2EContribution({
  id: 'validator',
  createData: ({ runId }) => ({ runId }),
  createPom: ({ host, page }) => ({ host, page }),
  scenarios: [
    {
      id: 'configure-validator',
      mode: 'mock',
      title: 'configures and persists a Validator attachment',
      tags: ['@validator', '@integration', '@node'],
      async run({ expect, host, page }) {
        const expectDefaultConfig = async () => {
          await expect(page.getByTestId('validator-lineCoverage')).toHaveValue(
            '80',
          );
          await expect(
            page.getByTestId('validator-changedLineCoverage'),
          ).toHaveValue('80');
          await expect(
            page.getByTestId('validator-branchCoverage'),
          ).toHaveValue('70');
          await expect(
            page.getByTestId('validator-requirementCoverage'),
          ).toHaveValue('100');
          await expect(
            page.getByTestId('validator-assertionQuality'),
          ).toHaveValue('100');
          await expect(
            page.getByTestId('validator-validation-command'),
          ).toHaveValue('playwright test --reporter=line --retries=0');
          const validationTimeout = page.getByTestId(
            'validator-validation-timeout-minutes',
          );
          await expect(validationTimeout).toHaveValue('30');
          await expect(validationTimeout).toHaveAttribute('min', '1');
          await expect(validationTimeout).toHaveAttribute('max', '120');
          await expect(
            page.getByTestId('validator-coverage-summary-paths'),
          ).toHaveValue(
            ['coverage/coverage-final.json', 'coverage/lcov.info'].join('\n'),
          );
          await expect(
            page.getByTestId('validator-coverage-summary-paths'),
          ).toHaveAttribute('readonly', '');
          await expect(page.getByTestId('validator-fail-on')).toHaveValue(
            [
              'zero_assertion_test',
              'trivial_assertion',
              'hardcoded_wait',
              'skipped_test',
              'expected_failure_test',
              'focused_test',
              'retry_dependence',
              'weak_selector',
              'skipped_requirement',
              'untested_critical_path',
            ].join(', '),
          );
          await expect(page.getByLabel('Validation command')).toHaveAttribute(
            'id',
            'validator-validation-command',
          );
          await expect(
            page.getByLabel('Validation timeout (minutes)'),
          ).toHaveAttribute('id', 'validator-validation-timeout-minutes');
          await expect(
            page.getByLabel('Detailed coverage reports'),
          ).toHaveAttribute('id', 'validator-coverage-summary-paths');
          await expect(page.getByLabel('Requirements')).toHaveAttribute(
            'id',
            'validator-requirements',
          );
          await expect(page.getByLabel('Fail on')).toHaveAttribute(
            'id',
            'validator-fail-on',
          );
        };

        await host.openNewWorkflow();
        await host.addNode('validator');
        await host.openNodeSettings('validator');
        await expectDefaultConfig();
        await host.closeNodeSettings();
        await host.saveWorkflow();
        await host.reloadWorkflow();
        await host.openNodeSettings('validator');
        await expectDefaultConfig();

        await page.getByTestId('validator-lineCoverage').fill('75');
        await page.getByTestId('validator-changedLineCoverage').fill('85');
        await page.getByTestId('validator-branchCoverage').fill('65');
        await page.getByTestId('validator-requirementCoverage').fill('95');
        await page.getByTestId('validator-assertionQuality').fill('90');
        await page
          .getByTestId('validator-validation-command')
          .fill('playwright test tests/custom --reporter=line --retries=0');
        await page
          .getByTestId('validator-validation-timeout-minutes')
          .fill('45');
        await page
          .getByTestId('validator-requirements')
          .fill(
            'PAYMENT-SUCCESS: successful payment\nPAYMENT-DECLINED: declined card',
          );
        await page
          .getByTestId('validator-fail-on')
          .fill('zero_assertion_test, weak_selector');
        await host.closeNodeSettings();
        await host.saveWorkflow();
        await host.reloadWorkflow();
        await host.openNodeSettings('validator');

        await expect(page.getByTestId('validator-lineCoverage')).toHaveValue(
          '75',
        );
        await expect(
          page.getByTestId('validator-changedLineCoverage'),
        ).toHaveValue('85');
        await expect(page.getByTestId('validator-branchCoverage')).toHaveValue(
          '65',
        );
        await expect(
          page.getByTestId('validator-requirementCoverage'),
        ).toHaveValue('95');
        await expect(
          page.getByTestId('validator-assertionQuality'),
        ).toHaveValue('90');
        await expect(
          page.getByTestId('validator-validation-command'),
        ).toHaveValue(
          'playwright test tests/custom --reporter=line --retries=0',
        );
        await expect(
          page.getByTestId('validator-validation-timeout-minutes'),
        ).toHaveValue('45');
        await expect(
          page.getByTestId('validator-coverage-summary-paths'),
        ).toHaveValue(
          ['coverage/coverage-final.json', 'coverage/lcov.info'].join('\n'),
        );
        await expect(page.getByTestId('validator-requirements')).toHaveValue(
          'PAYMENT-SUCCESS: successful payment\nPAYMENT-DECLINED: declined card',
        );
        await expect(page.getByTestId('validator-fail-on')).toHaveValue(
          'zero_assertion_test, weak_selector',
        );

        await page.getByTestId('validator-lineCoverage').fill('105');
        await expect(page.getByTestId('validator-lineCoverage')).toHaveValue(
          '100',
        );
        await page.getByTestId('validator-branchCoverage').fill('-5');
        await expect(page.getByTestId('validator-branchCoverage')).toHaveValue(
          '0',
        );
        await page.getByTestId('validator-validation-command').fill('');
        await expect(
          page.getByTestId('validator-validation-command'),
        ).toHaveValue('playwright test --reporter=line --retries=0');
        await page
          .getByTestId('validator-validation-timeout-minutes')
          .fill('0');
        await expect(
          page.getByTestId('validator-validation-timeout-minutes'),
        ).toHaveValue('30');
        await expect(
          page.getByTestId('validator-coverage-summary-paths'),
        ).toHaveValue(
          ['coverage/coverage-final.json', 'coverage/lcov.info'].join('\n'),
        );
      },
    },
  ],
});

export default validatorE2EContribution;
