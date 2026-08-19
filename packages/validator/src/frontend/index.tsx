import React from 'react';
import { ShieldCheck } from 'lucide-react';
import {
  IntegrationConfigField,
  type Integration,
  type IntegrationConfigPanelProps,
  useIntegrationHost,
} from '@playrunner/integration-sdk';

const DEFAULT_FAIL_ON = [
  'zero_assertion_test',
  'hardcoded_wait',
  'skipped_requirement',
  'untested_critical_path',
];

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

  return (
    <div className="mt-6 space-y-4">
      <p className="text-xs text-muted">
        This validator is available to the agent as a tool and is also run by
        the container supervisor after every attempt.
      </p>
      <div className="grid grid-cols-2 gap-3">
        {[
          ['lineCoverage', 'Line coverage'],
          ['branchCoverage', 'Branch coverage'],
          ['requirementCoverage', 'Requirement coverage'],
          ['assertionQuality', 'Assertion quality'],
        ].map(([field, label]) => (
          <IntegrationConfigField key={field} label={`${label} (%)`}>
            <Input
              data-testid={`validator-${field}`}
              type="number"
              min={0}
              max={100}
              value={config.minimum?.[field] ?? 0}
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
      <IntegrationConfigField
        label="Requirements"
        hint="One requirement per line. Include stable IDs where possible, for example PAY-DECLINED: declined cards show an error."
      >
        <Textarea
          data-testid="validator-requirements"
          rows={5}
          value={config.requirements || ''}
          onChange={(event) => update('requirements', event.target.value)}
        />
      </IntegrationConfigField>
      <IntegrationConfigField
        label="Fail on"
        hint="Comma-separated validator rule IDs."
      >
        <Textarea
          data-testid="validator-fail-on"
          rows={3}
          value={(config.failOn || DEFAULT_FAIL_ON).join(', ')}
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
