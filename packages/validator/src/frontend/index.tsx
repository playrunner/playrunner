import React, { useEffect } from 'react';
import { ShieldCheck } from 'lucide-react';
import {
  IntegrationConfigField,
  type Integration,
  type IntegrationConfigPanelProps,
  useIntegrationHost,
} from '@playrunner/integration-sdk';

const DEFAULT_MINIMUM = {
  lineCoverage: 80,
  changedLineCoverage: 80,
  branchCoverage: 70,
  requirementCoverage: 100,
  assertionQuality: 100,
};

const DEFAULT_VALIDATION_COMMAND =
  'npm run test:coverage -- --reporter=line --retries=0';
const DEFAULT_VALIDATION_TIMEOUT_MINUTES = 30;

const DEFAULT_COVERAGE_SUMMARY_PATHS = [
  'coverage/coverage-final.json',
  'coverage/lcov.info',
];

const DEFAULT_FAIL_ON = [
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
];

const MINIMUM_FIELDS = [
  ['lineCoverage', 'Line coverage'],
  ['changedLineCoverage', 'Changed-line coverage'],
  ['branchCoverage', 'Branch coverage'],
  ['requirementCoverage', 'Requirement coverage'],
  ['assertionQuality', 'Assertion quality'],
] as const;

function boundedPercentage(value: unknown, fallback: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(100, Math.max(0, parsed));
}

function boundedValidationTimeout(value: unknown) {
  const parsed = Number(value) || DEFAULT_VALIDATION_TIMEOUT_MINUTES;
  return Math.min(120, Math.max(1, parsed));
}

function normalizedStringList(value: unknown): string[] {
  return Array.isArray(value)
    ? Array.from(
        new Set(
          value
            .filter((item): item is string => typeof item === 'string')
            .map((item) => item.trim())
            .filter(Boolean),
        ),
      )
    : [];
}

export const ValidatorConfigPanel: React.FC<IntegrationConfigPanelProps> = ({
  config,
  nodeId,
  onChange,
}) => {
  const { ui } = useIntegrationHost();
  const Input = ui.Input;
  const Textarea = ui.Textarea;
  const update = (field: string, value: unknown) =>
    onChange(nodeId, { ...config, [field]: value });

  useEffect(() => {
    const configuredMinimum =
      config.minimum &&
      typeof config.minimum === 'object' &&
      !Array.isArray(config.minimum)
        ? config.minimum
        : {};
    const minimum = Object.fromEntries(
      MINIMUM_FIELDS.map(([field]) => [
        field,
        boundedPercentage(configuredMinimum[field], DEFAULT_MINIMUM[field]),
      ]),
    );
    const normalized = {
      ...config,
      coverageSummaryPaths: [...DEFAULT_COVERAGE_SUMMARY_PATHS],
      failOn: Array.isArray(config.failOn)
        ? normalizedStringList(config.failOn)
        : [...DEFAULT_FAIL_ON],
      minimum,
      validationCommand:
        String(config.validationCommand || '').trim() ||
        DEFAULT_VALIDATION_COMMAND,
      validationTimeoutMinutes: boundedValidationTimeout(
        config.validationTimeoutMinutes,
      ),
    };

    if (JSON.stringify(normalized) !== JSON.stringify(config)) {
      onChange(nodeId, normalized);
    }
  }, [config, nodeId, onChange]);

  const failOn = Array.isArray(config.failOn)
    ? normalizedStringList(config.failOn)
    : [...DEFAULT_FAIL_ON];

  return (
    <div className="mt-6 space-y-4">
      <p className="text-xs text-muted">
        This validator is available to the agent as a tool and is also run by
        the container supervisor after every attempt.
      </p>
      <div className="grid grid-cols-2 gap-3">
        {MINIMUM_FIELDS.map(([field, label]) => (
          <IntegrationConfigField
            key={field}
            label={`${label} (%)`}
            htmlFor={`validator-${field}`}
          >
            <Input
              id={`validator-${field}`}
              data-testid={`validator-${field}`}
              type="number"
              min={0}
              max={100}
              value={boundedPercentage(
                config.minimum?.[field],
                DEFAULT_MINIMUM[field],
              )}
              onChange={(event) =>
                update('minimum', {
                  ...(config.minimum || {}),
                  [field]: Number(event.target.value),
                })
              }
            />
          </IntegrationConfigField>
        ))}
      </div>
      <p className="text-xs text-muted">
        Changed-line coverage applies in CI when the execution includes a
        trusted commit diff. Reports must contain coverage-final statement
        locations or LCOV DA line records. Repository-reported coverage is not
        independently attested, so generated pull requests remain drafts for
        human or trusted CI review.
      </p>
      <IntegrationConfigField
        label="Validation command"
        htmlFor="validator-validation-command"
        hint="Run from the repository root with retries disabled. When coverage thresholds are enabled, this command must generate one of the fixed detailed reports below."
      >
        <Input
          id="validator-validation-command"
          data-testid="validator-validation-command"
          value={
            typeof config.validationCommand === 'string'
              ? config.validationCommand
              : DEFAULT_VALIDATION_COMMAND
          }
          onChange={(event) => update('validationCommand', event.target.value)}
        />
      </IntegrationConfigField>
      <IntegrationConfigField
        label="Validation timeout (minutes)"
        htmlFor="validator-validation-timeout-minutes"
        hint="Maximum duration for each clean validation command."
      >
        <Input
          id="validator-validation-timeout-minutes"
          data-testid="validator-validation-timeout-minutes"
          type="number"
          min={1}
          max={120}
          step={1}
          value={boundedValidationTimeout(config.validationTimeoutMinutes)}
          onChange={(event) =>
            update('validationTimeoutMinutes', Number(event.target.value))
          }
        />
      </IntegrationConfigField>
      <IntegrationConfigField
        label="Detailed coverage reports"
        htmlFor="validator-coverage-summary-paths"
        hint="Fixed validator locations. Arbitrary paths and summary-only reports are not accepted."
      >
        <Textarea
          id="validator-coverage-summary-paths"
          data-testid="validator-coverage-summary-paths"
          readOnly
          rows={2}
          value={DEFAULT_COVERAGE_SUMMARY_PATHS.join('\n')}
        />
      </IntegrationConfigField>
      <IntegrationConfigField
        label="Requirements"
        htmlFor="validator-requirements"
        hint="One requirement per line (up to 100 and 256 KiB total). Include stable IDs, for example PAY-DECLINED: declined cards show an error."
      >
        <Textarea
          id="validator-requirements"
          data-testid="validator-requirements"
          rows={5}
          maxLength={256 * 1024}
          value={
            typeof config.requirements === 'string' ? config.requirements : ''
          }
          onChange={(event) => update('requirements', event.target.value)}
        />
      </IntegrationConfigField>
      <IntegrationConfigField
        label="Fail on"
        htmlFor="validator-fail-on"
        hint="Comma-separated validator rule IDs."
      >
        <Textarea
          id="validator-fail-on"
          data-testid="validator-fail-on"
          rows={3}
          value={failOn.join(', ')}
          onChange={(event) =>
            update(
              'failOn',
              event.target.value
                .split(',')
                .map((value) => value.trim())
                .filter(Boolean),
            )
          }
        />
      </IntegrationConfigField>
    </div>
  );
};

export const validatorIntegration: Integration = {
  id: 'validator',
  name: 'Test Validator',
  category: 'Testing',
  description:
    'Independent quality gate and feedback tool for generated Playwright tests',
  icon: ShieldCheck,
  color: 'text-sky-400',
  nodeType: 'config',
  nodeSelectorOrder: 14,
  showAuthenticationPanel: false,
  showInIntegrationsPage: false,
  showInputPanel: false,
  executionRole: 'attachment',
  attachmentKind: 'tool',
  ConfigPanel: ValidatorConfigPanel,
};

export default validatorIntegration;
