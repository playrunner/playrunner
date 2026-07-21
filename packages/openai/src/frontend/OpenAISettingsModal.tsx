import React, { useState } from 'react';
import {
  IntegrationConnectionAutofillGuard,
  IntegrationConnectionInput,
  IntegrationConfigField,
  IntegrationSettingsModal,
  useIntegrationHost,
} from '@playrunner/integration-sdk';
import { BookOpen, ExternalLink } from 'lucide-react';
import { createOpenAIIntegrationData } from '../connection';
import { OpenAIIcon } from './OpenAIIcon';

interface OpenAISettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const DEFAULT_DOCS_URL = 'https://playrunner.dev';
const OPENAI_SETUP_DOCS_URL = getDocsUrl('docs/integration-packages/openai');

type DocsImportMeta = ImportMeta & {
  env?: {
    VITE_DOCS_URL?: string;
  };
};

function getDocsUrl(path = '') {
  const baseUrl = (
    (import.meta as DocsImportMeta).env?.VITE_DOCS_URL || DEFAULT_DOCS_URL
  )
    .trim()
    .replace(/\/+$/, '');
  const normalizedPath = path.trim().replace(/^\/+/, '');

  return normalizedPath ? `${baseUrl}/${normalizedPath}` : baseUrl;
}

export function OpenAISettingsModal({
  isOpen,
  onClose,
}: OpenAISettingsModalProps) {
  const { auth, store } = useIntegrationHost();
  const [apiKey, setApiKey] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isConnected, setIsConnected] = useState(false);

  React.useEffect(() => {
    let active = true;

    const loadConnection = async () => {
      if (!isOpen || !auth.currentUser) return;

      try {
        const data = await store.getIntegration(auth.currentUser.uid, 'openai');
        if (active) {
          setIsConnected(Boolean(data?.apiKey));
        }
      } catch (error) {
        console.error('Failed to load OpenAI connection', error);
      }
    };

    if (isOpen) {
      void loadConnection();
    } else {
      setApiKey('');
      setIsSaving(false);
      setIsConnected(false);
    }

    return () => {
      active = false;
    };
  }, [auth, isOpen, store]);

  const saveConnection = async () => {
    const currentUser = auth.currentUser;
    const normalizedKey = apiKey.trim();
    if (!currentUser || !normalizedKey) return;

    try {
      setIsSaving(true);
      await store.saveIntegration(
        currentUser.uid,
        'openai',
        createOpenAIIntegrationData(normalizedKey),
      );
      setApiKey('');
      setIsConnected(true);
    } catch (error) {
      console.error('Failed to save OpenAI connection', error);
    } finally {
      setIsSaving(false);
    }
  };

  const disconnect = async () => {
    if (!auth.currentUser) return;

    try {
      await store.deleteIntegration(auth.currentUser.uid, 'openai');
      setApiKey('');
      setIsConnected(false);
    } catch (error) {
      console.error('Failed to disconnect OpenAI', error);
    }
  };

  return (
    <IntegrationSettingsModal
      isOpen={isOpen}
      onClose={onClose}
      title="Connect to OpenAI"
      icon={<OpenAIIcon className="w-5 h-5 text-[var(--foreground)]" />}
      isConnected={isConnected}
      connectedTitle="OpenAI Connected Successfully"
      connectedDescription="Your API key is stored with your Playrunner integration settings and is ready for workflow runs."
      onChangeCredentials={() => {
        setApiKey('');
        setIsConnected(false);
      }}
      onDisconnect={disconnect}
      primaryActionLabel="Save API key"
      primaryActionPendingLabel="Saving..."
      primaryActionPending={isSaving}
      primaryActionDisabled={!apiKey.trim() || isSaving}
      onPrimaryAction={saveConnection}
    >
      <IntegrationConnectionAutofillGuard connectionId="openai" />

      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-hover)] p-4 text-left">
        <div className="flex items-start gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--background)]">
            <BookOpen className="h-4 w-4 text-muted" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-[var(--foreground)]">
              API key authentication
            </p>
            <p className="mt-1 text-xs leading-relaxed text-muted">
              OpenAI API access uses an API key. The key is sent only by the
              workflow runner to OpenAI and is excluded from node output and
              error messages.
            </p>
            <a
              href={OPENAI_SETUP_DOCS_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-[var(--foreground)] underline underline-offset-4 hover:text-muted"
            >
              Open OpenAI setup guide
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </div>
        </div>
      </div>

      <IntegrationConfigField
        label="API key"
        htmlFor="openai-connection-field-a"
        hint="Existing keys are never displayed here. Enter a new key to replace the saved credential."
      >
        <IntegrationConnectionInput
          id="openai-connection-field-a"
          connectionId="openai"
          fieldSlot="a"
          mode="secret"
          placeholder="Paste OpenAI API key"
          value={apiKey}
          onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
            setApiKey(event.target.value);
          }}
        />
      </IntegrationConfigField>
    </IntegrationSettingsModal>
  );
}
