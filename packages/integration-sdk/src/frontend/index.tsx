import React, { createContext, useContext, useState } from 'react';

export interface Integration {
  id: string;
  name: string;
  category: string;
  description: string;
  icon: string | React.ComponentType<{ className?: string }>;
  iconRenderMode?: 'image' | 'mask';
  connected?: boolean;
  disabled?: boolean;
  disabledReason?: string;
  isPremiumFeature?: boolean;
  nodeType?: 'trigger' | 'action' | 'config';
  color?: string;
  nodeSelectorOrder?: number;
  showAuthenticationPanel?: boolean;
  showInIntegrationsPage?: boolean;
  showInNodeSelector?: boolean;
  showInputPanel?: boolean;
  SettingsModal?: React.FC<{ isOpen: boolean; onClose: () => void }>;
  requiresAuth?: boolean;
  authProviderId?: string;
  authProviders?: { id: string; label: string }[];
  getAuthPath?: (uid: string) => string;
  ConfigPanel?: React.FC<IntegrationConfigPanelProps>;
}

export interface IntegrationConfigPanelProps {
  config: Record<string, any>;
  onChange: (nodeId: string, newConfig: Record<string, any>) => void;
  nodeId: string;
  nodeLabel?: string;
  isConnected: boolean;
  onConnectOAuth?: (providerId?: string) => void;
  integrationData?: any;
  onLabelChange?: (newLabel: string) => void;
  workflowCloudProvider?: string;
}

export interface IntegrationAuthUser {
  uid: string;
  getIdToken: () => Promise<string>;
}

export interface IntegrationAuthClient {
  currentUser: IntegrationAuthUser | null;
  onAuthStateChanged?: (
    callback: (user: IntegrationAuthUser | null) => void,
  ) => () => void;
}

export interface ConnectionEnvelope<
  TProvider extends string = string,
  TConfig extends Record<string, unknown> = Record<string, unknown>,
  TSecrets extends Record<string, unknown> = Record<string, unknown>,
> {
  provider: TProvider;
  config: TConfig;
  secrets: TSecrets;
}

export interface PublicConnection<
  TProvider extends string = string,
  TConfig extends Record<string, unknown> = Record<string, unknown>,
> {
  id: string;
  provider: TProvider;
  kind: 'cloud' | 'integration';
  config: TConfig;
  credentialStatus: { configured: boolean };
  createdAt: string;
  updatedAt: string;
}

export interface IntegrationStore {
  getIntegration: (
    userId: string,
    integrationId: string,
  ) => Promise<PublicConnection | null>;
  saveIntegration: (
    userId: string,
    integrationId: string,
    data: Partial<ConnectionEnvelope>,
  ) => Promise<void>;
  deleteIntegration: (userId: string, integrationId: string) => Promise<void>;
  getCloudCredential?: (
    userId: string,
    providerId: string,
  ) => Promise<PublicConnection | null>;
  saveCloudCredential?: (
    userId: string,
    providerId: string,
    data: Partial<ConnectionEnvelope>,
  ) => Promise<void>;
  deleteCloudCredential?: (userId: string, providerId: string) => Promise<void>;
  getEnvironments?: (userId: string) => Promise<any[]>;
  saveEnvironment?: (
    userId: string,
    environmentId: string,
    data: any,
  ) => Promise<void>;
  deleteEnvironment?: (userId: string, environmentId: string) => Promise<void>;
  saveSecret?: (userId: string, secretKey: string, data: any) => Promise<void>;
}

export interface IntegrationModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  subtitle?: React.ReactNode;
  icon?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  maxWidth?: string;
  className?: string;
  bodyClassName?: string;
  zIndex?: number;
}

export interface IntegrationButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'tertiary' | 'danger' | 'ghost';
  size?: 'default' | 'sm' | 'icon';
}

export interface IntegrationSdkUiComponents {
  Modal: React.JSXElementConstructor<IntegrationModalProps>;
  Input: React.JSXElementConstructor<
    React.InputHTMLAttributes<HTMLInputElement> & { icon?: React.ReactNode }
  >;
  Select: React.JSXElementConstructor<
    React.SelectHTMLAttributes<HTMLSelectElement>
  >;
  Textarea: React.JSXElementConstructor<
    React.TextareaHTMLAttributes<HTMLTextAreaElement>
  >;
  Button?: React.JSXElementConstructor<IntegrationButtonProps>;
}

export interface IntegrationSdkHost {
  auth: IntegrationAuthClient;
  store: IntegrationStore;
  ui: IntegrationSdkUiComponents;
}

const IntegrationHostContext = createContext<IntegrationSdkHost | null>(null);

export function IntegrationSdkProvider({
  host,
  children,
}: {
  host: IntegrationSdkHost;
  children: React.ReactNode;
}) {
  return (
    <IntegrationHostContext.Provider value={host}>
      {children}
    </IntegrationHostContext.Provider>
  );
}

export function useIntegrationHost() {
  const host = useContext(IntegrationHostContext);

  if (!host) {
    throw new Error(
      'Integration packages must be rendered inside IntegrationSdkProvider.',
    );
  }

  return host;
}

export function IntegrationConfigField({
  label,
  hint,
  htmlFor,
  children,
}: {
  label: string;
  hint?: React.ReactNode;
  htmlFor?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="text-xs font-medium text-muted">
        {label}
      </label>
      {children}
      {hint ? <p className="text-[10px] text-muted">{hint}</p> : null}
    </div>
  );
}

export type IntegrationConnectionInputMode = 'text' | 'secret';

export interface IntegrationConnectionInputProps extends Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  'autoCapitalize' | 'autoComplete' | 'autoCorrect' | 'name' | 'spellCheck'
> {
  connectionId: string;
  fieldSlot: string;
  mode?: IntegrationConnectionInputMode;
}

function normalizeConnectionInputToken(value: string) {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return normalized || 'field';
}

function getConnectionInputName({
  connectionId,
  fieldSlot,
  mode,
}: {
  connectionId: string;
  fieldSlot: string;
  mode: IntegrationConnectionInputMode;
}) {
  return [
    'pr',
    normalizeConnectionInputToken(connectionId),
    normalizeConnectionInputToken(fieldSlot),
    mode === 'secret' ? 'protected' : 'manual',
    'entry',
  ].join('-');
}

export function IntegrationConnectionAutofillGuard({
  connectionId,
}: {
  connectionId: string;
}) {
  const token = normalizeConnectionInputToken(connectionId);

  return (
    <div
      aria-hidden="true"
      style={{
        height: 1,
        left: -10000,
        overflow: 'hidden',
        pointerEvents: 'none',
        position: 'absolute',
        top: 'auto',
        width: 1,
      }}
    >
      <input
        autoComplete="username"
        name={`pr-${token}-browser-user`}
        tabIndex={-1}
        type="text"
      />
      <input
        autoComplete="current-password"
        name={`pr-${token}-browser-pass`}
        tabIndex={-1}
        type="password"
      />
    </div>
  );
}

export function IntegrationConnectionInput({
  connectionId,
  fieldSlot,
  mode = 'text',
  onBlur,
  onFocus,
  onPointerDown,
  readOnly,
  type,
  ...props
}: IntegrationConnectionInputProps) {
  const { ui } = useIntegrationHost();
  const Input = ui.Input;
  const [isEditing, setIsEditing] = useState(false);
  const effectiveMode =
    mode === 'secret' || type === 'password' ? 'secret' : mode;
  const managedReadOnly = readOnly ?? !isEditing;

  const handlePointerDown: React.PointerEventHandler<HTMLInputElement> = (
    event,
  ) => {
    setIsEditing(true);
    onPointerDown?.(event);
  };

  const handleFocus: React.FocusEventHandler<HTMLInputElement> = (event) => {
    setIsEditing(true);
    onFocus?.(event);
  };

  const handleBlur: React.FocusEventHandler<HTMLInputElement> = (event) => {
    setIsEditing(false);
    onBlur?.(event);
  };

  return (
    <Input
      {...props}
      autoCapitalize="off"
      autoComplete={effectiveMode === 'secret' ? 'new-password' : 'off'}
      autoCorrect="off"
      data-1p-ignore="true"
      data-bwignore="true"
      data-form-type="other"
      data-lpignore="true"
      name={getConnectionInputName({
        connectionId,
        fieldSlot,
        mode: effectiveMode,
      })}
      onBlur={handleBlur}
      onFocus={handleFocus}
      onPointerDown={handlePointerDown}
      readOnly={managedReadOnly}
      spellCheck={false}
      type={effectiveMode === 'secret' ? 'password' : type}
    />
  );
}

export function IntegrationSetupGuide({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ol className="list-decimal pl-4 space-y-3 text-sm text-[var(--foreground)]">
      {children}
    </ol>
  );
}

export function IntegrationCopyableCode({
  value,
  label = 'Copy value',
}: {
  value: string;
  label?: string;
}) {
  const [copied, setCopied] = useState(false);

  const copyValue = async () => {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="relative mt-2">
      <code className="block rounded-lg border border-subtle bg-[var(--background)] p-3 pr-14 font-mono text-xs text-blue-400 overflow-x-auto whitespace-nowrap select-all">
        {value}
      </code>
      <button
        type="button"
        onClick={copyValue}
        className="absolute top-2 right-2 rounded bg-[var(--background)] px-2 py-1 text-[10px] font-medium text-muted hover:text-[var(--foreground)] hover:bg-surface-hover transition-colors"
        title={label}
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  );
}

export function IntegrationSettingsModal({
  isOpen,
  onClose,
  title,
  icon,
  isConnected,
  connectedTitle,
  connectedDescription,
  onChangeCredentials,
  onDisconnect,
  children,
  primaryActionLabel,
  primaryActionPendingLabel = 'Working...',
  primaryActionDisabled,
  primaryActionPending,
  onPrimaryAction,
}: {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  icon?: React.ReactNode;
  isConnected: boolean;
  connectedTitle: string;
  connectedDescription: string;
  onChangeCredentials: () => void;
  onDisconnect: () => void;
  children: React.ReactNode;
  primaryActionLabel: string;
  primaryActionPendingLabel?: string;
  primaryActionDisabled?: boolean;
  primaryActionPending?: boolean;
  onPrimaryAction: () => void;
}) {
  const { ui } = useIntegrationHost();
  const Modal = ui.Modal;
  const Button = ui.Button;

  const primaryFooter = isConnected ? null : Button ? (
    <Button
      type="button"
      variant="primary"
      onClick={onPrimaryAction}
      disabled={primaryActionDisabled || primaryActionPending}
    >
      {primaryActionPending ? primaryActionPendingLabel : primaryActionLabel}
    </Button>
  ) : (
    <button
      type="button"
      onClick={onPrimaryAction}
      disabled={primaryActionDisabled || primaryActionPending}
      className="inline-flex h-9 items-center justify-center rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-[var(--accent-foreground)] shadow-sm transition-colors hover:bg-[var(--accent-hover)] disabled:pointer-events-none disabled:opacity-50"
    >
      {primaryActionPending ? primaryActionPendingLabel : primaryActionLabel}
    </button>
  );

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      zIndex={70}
      title={title}
      icon={icon}
      footer={primaryFooter}
    >
      {isConnected ? (
        <div className="flex flex-col items-center justify-center gap-4 py-8 text-center">
          <div className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-500">
            Connected
          </div>
          <div>
            <h3 className="mb-2 text-xl font-semibold text-[var(--foreground)]">
              {connectedTitle}
            </h3>
            <p className="mx-auto mb-4 max-w-[280px] text-sm text-muted">
              {connectedDescription}
            </p>
            <div className="flex items-center justify-center gap-4">
              <button
                type="button"
                onClick={onChangeCredentials}
                className="text-xs text-muted underline transition-colors hover:text-[var(--foreground)]"
              >
                Change Credentials
              </button>
              <span className="text-xs text-muted">/</span>
              <button
                type="button"
                onClick={onDisconnect}
                className="text-xs text-red-500 underline transition-colors hover:text-red-400"
              >
                Disconnect
              </button>
            </div>
          </div>
          {Button ? (
            <Button
              type="button"
              variant="secondary"
              onClick={onClose}
              className="mt-4"
            >
              Close
            </Button>
          ) : (
            <button
              type="button"
              onClick={onClose}
              className="mt-4 inline-flex h-9 items-center justify-center rounded-lg border border-subtle bg-surface px-4 py-2 text-sm font-medium text-[var(--foreground)] shadow-sm transition-colors hover:bg-surface-hover"
            >
              Close
            </button>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          <IntegrationConnectionAutofillGuard connectionId={title} />
          {children}
        </div>
      )}
    </Modal>
  );
}
