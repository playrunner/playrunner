import React from 'react';
import {
  IntegrationConfigField,
  type IntegrationConfigPanelProps,
  useIntegrationHost,
} from '@playrunner/integration-sdk';

export const JavascriptConfigPanel: React.FC<IntegrationConfigPanelProps> = ({
  config,
  onChange,
  nodeId,
}) => {
  const { ui } = useIntegrationHost();
  const Textarea = ui.Textarea;

  return (
    <div className="flex flex-col h-[300px] gap-2">
      <IntegrationConfigField
        label="Script Editor"
        hint="Code runs in a sandboxed environment."
      >
        <Textarea
          value={config.code || ''}
          onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) => {
            onChange(nodeId, { ...config, code: event.target.value });
          }}
          placeholder="return { status: 'success' };"
          className="h-[260px] font-mono text-sm placeholder:text-muted text-[var(--foreground)] bg-[var(--background)] border-strong resize-none"
        />
      </IntegrationConfigField>
    </div>
  );
};
