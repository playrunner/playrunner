import React from 'react';
import {
  IntegrationConfigField,
  type IntegrationConfigPanelProps,
  useIntegrationHost,
} from '@playrunner/integration-sdk';

type Operation = 'send' | 'wait';

export const ResendConfigPanel: React.FC<IntegrationConfigPanelProps> = ({
  config,
  onChange,
  nodeId,
  integrationData,
}) => {
  const { ui } = useIntegrationHost();
  const Select = ui.Select;
  const operation = (config.action === 'wait' ? 'wait' : 'send') as Operation;

  const update = (next: Record<string, unknown>) => {
    onChange(nodeId, { ...config, ...next });
  };

  return (
    <div className="space-y-4">
      <IntegrationConfigField
        label="Operation"
        hint="The form and execution behavior change with this selection."
      >
        <Select
          aria-label="Resend operation"
          value={operation}
          onChange={(event: React.ChangeEvent<HTMLSelectElement>) => {
            update({ action: event.target.value });
          }}
        >
          <option value="send">Send Email</option>
          <option value="wait">Wait for Email</option>
        </Select>
      </IntegrationConfigField>

      {operation === 'send' ? (
        <SendEmailFields config={config} update={update} />
      ) : (
        <WaitForEmailFields
          config={config}
          receivingAddress={
            typeof integrationData?.config?.receivingAddress === 'string'
              ? integrationData.config.receivingAddress
              : ''
          }
          update={update}
        />
      )}
    </div>
  );
};

function SendEmailFields({
  config,
  update,
}: {
  config: Record<string, any>;
  update: (next: Record<string, unknown>) => void;
}) {
  const { ui } = useIntegrationHost();
  const Input = ui.Input;
  const Select = ui.Select;
  const Textarea = ui.Textarea;
  const contentMode = config.contentMode === 'template' ? 'template' : 'body';

  return (
    <>
      <IntegrationConfigField label="From">
        <Input
          value={config.from || ''}
          onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
            update({ from: event.target.value });
          }}
          placeholder="Playrunner <automation@example.com>"
        />
      </IntegrationConfigField>
      <IntegrationConfigField
        label="To"
        hint="Separate multiple recipients with commas or new lines."
      >
        <Textarea
          value={config.to || ''}
          onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) => {
            update({ to: event.target.value });
          }}
          placeholder="user@example.com"
          className="min-h-[72px]"
        />
      </IntegrationConfigField>
      <IntegrationConfigField label="Subject">
        <Input
          value={config.subject || ''}
          onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
            update({ subject: event.target.value });
          }}
          placeholder="Your workflow has finished"
        />
      </IntegrationConfigField>
      <IntegrationConfigField label="Content">
        <Select
          value={contentMode}
          onChange={(event: React.ChangeEvent<HTMLSelectElement>) => {
            update({ contentMode: event.target.value });
          }}
        >
          <option value="body">Text / HTML</option>
          <option value="template">Published Resend template</option>
        </Select>
      </IntegrationConfigField>

      {contentMode === 'template' ? (
        <>
          <IntegrationConfigField label="Template ID or alias">
            <Input
              value={config.templateId || ''}
              onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
                update({ templateId: event.target.value });
              }}
              placeholder="welcome-email"
            />
          </IntegrationConfigField>
          <IntegrationConfigField
            label="Template variables"
            hint="Optional JSON object."
          >
            <Textarea
              value={config.templateVariables || ''}
              onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) => {
                update({ templateVariables: event.target.value });
              }}
              placeholder={'{"name":"{{workflow.definition.name}}"}'}
              className="min-h-[96px] font-mono text-xs"
            />
          </IntegrationConfigField>
        </>
      ) : (
        <>
          <IntegrationConfigField label="Plain text">
            <Textarea
              value={config.text || ''}
              onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) => {
                update({ text: event.target.value });
              }}
              placeholder="Workflow {{workflow.definition.name}} completed."
              className="min-h-[120px]"
            />
          </IntegrationConfigField>
          <IntegrationConfigField label="HTML (optional)">
            <Textarea
              value={config.html || ''}
              onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) => {
                update({ html: event.target.value });
              }}
              placeholder="<p>Workflow completed.</p>"
              className="min-h-[120px] font-mono text-xs"
            />
          </IntegrationConfigField>
        </>
      )}

      <details className="rounded-xl border border-[var(--border)] bg-[var(--background)] p-3">
        <summary className="cursor-pointer text-xs font-medium text-[var(--foreground)]">
          Advanced send options
        </summary>
        <div className="mt-4 space-y-4">
          <IntegrationConfigField label="CC">
            <Input
              value={config.cc || ''}
              onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
                update({ cc: event.target.value });
              }}
              placeholder="team@example.com"
            />
          </IntegrationConfigField>
          <IntegrationConfigField label="BCC">
            <Input
              value={config.bcc || ''}
              onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
                update({ bcc: event.target.value });
              }}
              placeholder="audit@example.com"
            />
          </IntegrationConfigField>
          <IntegrationConfigField label="Reply to">
            <Input
              value={config.replyTo || ''}
              onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
                update({ replyTo: event.target.value });
              }}
              placeholder="support@example.com"
            />
          </IntegrationConfigField>
          <IntegrationConfigField label="Idempotency key">
            <Input
              value={config.idempotencyKey || ''}
              onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
                update({ idempotencyKey: event.target.value });
              }}
              placeholder="Defaults to execution ID + node ID"
            />
          </IntegrationConfigField>
          <IntegrationConfigField label="Tags" hint="Optional JSON object.">
            <Textarea
              value={config.tags || ''}
              onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) => {
                update({ tags: event.target.value });
              }}
              placeholder={'{"workflow":"login"}'}
              className="min-h-[80px] font-mono text-xs"
            />
          </IntegrationConfigField>
          <IntegrationConfigField
            label="Custom headers"
            hint="Optional JSON object."
          >
            <Textarea
              value={config.headers || ''}
              onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) => {
                update({ headers: event.target.value });
              }}
              placeholder={'{"X-Workflow":"playrunner"}'}
              className="min-h-[80px] font-mono text-xs"
            />
          </IntegrationConfigField>
        </div>
      </details>
    </>
  );
}

function WaitForEmailFields({
  config,
  receivingAddress,
  update,
}: {
  config: Record<string, any>;
  receivingAddress: string;
  update: (next: Record<string, unknown>) => void;
}) {
  const { ui } = useIntegrationHost();
  const Input = ui.Input;
  const Select = ui.Select;
  const extraction = config.extraction || 'verification_code';

  return (
    <>
      <div className="rounded-xl border border-[var(--border)] bg-[var(--background)] p-3">
        <p className="text-xs leading-relaxed text-muted">
          This action polls Resend&apos;s durable receiving inbox and can
          recover messages delivered while Playrunner was briefly unavailable.
        </p>
      </div>
      <IntegrationConfigField
        label="Recipient"
        hint="Use a unique, templated address to correlate concurrent runs."
      >
        <Input
          value={config.to || ''}
          onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
            update({ to: event.target.value });
          }}
          placeholder={
            receivingAddress || 'login+{{workflow.run.id}}@example.resend.app'
          }
        />
      </IntegrationConfigField>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <IntegrationConfigField label="Timeout (seconds)">
          <Input
            type="number"
            min={5}
            max={240}
            value={config.timeoutSeconds || 120}
            onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
              update({ timeoutSeconds: event.target.value });
            }}
          />
        </IntegrationConfigField>
        <IntegrationConfigField
          label="Look back (seconds)"
          hint="Includes mail sent just before this node started."
        >
          <Input
            type="number"
            min={0}
            max={300}
            value={config.lookbackSeconds ?? 30}
            onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
              update({ lookbackSeconds: event.target.value });
            }}
          />
        </IntegrationConfigField>
      </div>
      <IntegrationConfigField label="Sender (optional)">
        <Input
          value={config.fromFilter || ''}
          onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
            update({ fromFilter: event.target.value });
          }}
          placeholder="security@example.com or @example.com"
        />
      </IntegrationConfigField>
      <IntegrationConfigField label="Subject contains (optional)">
        <Input
          value={config.subjectFilter || ''}
          onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
            update({ subjectFilter: event.target.value });
          }}
          placeholder="verification code"
        />
      </IntegrationConfigField>
      <IntegrationConfigField label="Body contains (optional)">
        <Input
          value={config.bodyFilter || ''}
          onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
            update({ bodyFilter: event.target.value });
          }}
          placeholder="sign in"
        />
      </IntegrationConfigField>
      <IntegrationConfigField label="Extract">
        <Select
          value={extraction}
          onChange={(event: React.ChangeEvent<HTMLSelectElement>) => {
            update({ extraction: event.target.value });
          }}
        >
          <option value="verification_code">Verification code</option>
          <option value="custom">Custom regular expression</option>
          <option value="none">No extracted value</option>
        </Select>
      </IntegrationConfigField>
      {extraction === 'custom' ? (
        <>
          <IntegrationConfigField label="Regular expression">
            <Input
              value={config.extractionPattern || ''}
              onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
                update({ extractionPattern: event.target.value });
              }}
              placeholder={'code[:\\s]+([A-Z0-9]{6})'}
              className="font-mono text-xs"
            />
          </IntegrationConfigField>
          <IntegrationConfigField label="Capture group">
            <Input
              type="number"
              min={0}
              max={20}
              value={config.captureGroup ?? 1}
              onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
                update({ captureGroup: event.target.value });
              }}
            />
          </IntegrationConfigField>
        </>
      ) : null}
      <IntegrationConfigField label="Attachments">
        <Select
          value={config.attachments || 'metadata'}
          onChange={(event: React.ChangeEvent<HTMLSelectElement>) => {
            update({ attachments: event.target.value });
          }}
        >
          <option value="metadata">Metadata and temporary download URL</option>
          <option value="none">Do not retrieve attachment links</option>
        </Select>
      </IntegrationConfigField>
    </>
  );
}
