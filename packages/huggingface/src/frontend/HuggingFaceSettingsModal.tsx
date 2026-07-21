import React, { useState } from 'react';
import {
  IntegrationConnectionAutofillGuard,
  IntegrationConnectionInput,
  IntegrationConfigField,
  IntegrationSettingsModal,
  useIntegrationHost,
} from '@playrunner/integration-sdk';
import { createHuggingFaceIntegrationData } from '../connection';
import { huggingFaceIconUrl } from './icon';

interface HuggingFaceSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const DEFAULT_DOCS_URL = 'https://playrunner.dev';
const HUGGING_FACE_SETUP_DOCS_URL = getDocsUrl(
  'docs/integration-packages/huggingface',
);

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

export function HuggingFaceSettingsModal({
  isOpen,
  onClose,
}: HuggingFaceSettingsModalProps) {
  const { auth, store } = useIntegrationHost();
  const [accessToken, setAccessToken] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isConnected, setIsConnected] = useState(false);

  React.useEffect(() => {
    let active = true;

    const loadConnection = async () => {
      if (!isOpen || !auth.currentUser) return;

      try {
        const data = await store.getIntegration(
          auth.currentUser.uid,
          'huggingface',
        );
        if (active) {
          setIsConnected(Boolean(data?.accessToken));
        }
      } catch (error) {
        console.error('Failed to load Hugging Face connection', error);
      }
    };

    if (isOpen) {
      void loadConnection();
    } else {
      setAccessToken('');
      setIsSaving(false);
      setIsConnected(false);
    }

    return () => {
      active = false;
    };
  }, [auth, isOpen, store]);

  const saveConnection = async () => {
    const currentUser = auth.currentUser;
    const normalizedToken = accessToken.trim();
    if (!currentUser || !normalizedToken) return;

    try {
      setIsSaving(true);
      await store.saveIntegration(
        currentUser.uid,
        'huggingface',
        createHuggingFaceIntegrationData(normalizedToken),
      );
      setAccessToken('');
      setIsConnected(true);
    } catch (error) {
      console.error('Failed to save Hugging Face connection', error);
    } finally {
      setIsSaving(false);
    }
  };

  const disconnect = async () => {
    if (!auth.currentUser) return;

    try {
      await store.deleteIntegration(auth.currentUser.uid, 'huggingface');
      setAccessToken('');
      setIsConnected(false);
    } catch (error) {
      console.error('Failed to disconnect Hugging Face', error);
    }
  };

  return (
    <IntegrationSettingsModal
      isOpen={isOpen}
      onClose={onClose}
      title="Connect to Hugging Face"
      icon={
        <img
          src={huggingFaceIconUrl}
          alt="Hugging Face"
          className="w-5 h-5 object-contain"
        />
      }
      isConnected={isConnected}
      connectedTitle="Hugging Face Connected Successfully"
      connectedDescription="Your access token is stored with your Playrunner integration settings and is ready for workflow runs."
      onChangeCredentials={() => {
        setAccessToken('');
        setIsConnected(false);
      }}
      onDisconnect={disconnect}
      primaryActionLabel="Save access token"
      primaryActionPendingLabel="Saving..."
      primaryActionPending={isSaving}
      primaryActionDisabled={!accessToken.trim() || isSaving}
      onPrimaryAction={saveConnection}
    >
      <IntegrationConnectionAutofillGuard connectionId="huggingface" />

      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-hover)] p-4 text-left">
        <p className="text-sm font-medium text-[var(--foreground)]">
          Inference Providers token
        </p>
        <p className="mt-1 text-xs leading-relaxed text-muted">
          Use a Hugging Face token with Inference Providers permission. The
          token is sent only by the workflow runner and is excluded from node
          output and error messages.
        </p>
        <a
          href={HUGGING_FACE_SETUP_DOCS_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 inline-flex text-xs font-medium text-[var(--foreground)] underline underline-offset-4 hover:text-muted"
        >
          Open Hugging Face setup guide
        </a>
      </div>

      <IntegrationConfigField
        label="Access token"
        htmlFor="huggingface-connection-field-a"
        hint="Existing tokens are never displayed here. Enter a new token to replace the saved credential."
      >
        <IntegrationConnectionInput
          id="huggingface-connection-field-a"
          connectionId="huggingface"
          fieldSlot="a"
          mode="secret"
          placeholder="Paste Hugging Face access token"
          value={accessToken}
          onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
            setAccessToken(event.target.value);
          }}
        />
      </IntegrationConfigField>
    </IntegrationSettingsModal>
  );
}
