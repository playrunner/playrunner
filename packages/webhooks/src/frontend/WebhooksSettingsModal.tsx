import { useCallback, useEffect, useState } from 'react';
import {
  IntegrationConnectionAutofillGuard,
  IntegrationConnectionInput,
  useIntegrationHost,
} from '@playrunner/integration-sdk';
import { Cloud, Webhook } from 'lucide-react';
import { webhookApi } from './api';
import {
  TunnelStatusConsole,
  type TunnelViewState,
} from './TunnelStatusConsole';

type ExposureMode = 'none' | 'public-url' | 'cloudflare';

interface SettingsResponse {
  config: { exposureMode?: ExposureMode; publicUrl?: string };
  credentialStatus: { configured: boolean };
  localBaseUrl?: string;
  tunnel: TunnelViewState;
}

export function WebhooksSettingsModal({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  const { auth, ui } = useIntegrationHost();
  const { Button, Modal, Select } = ui;
  const [mode, setMode] = useState<ExposureMode>('none');
  const [publicUrl, setPublicUrl] = useState('');
  const [bearerToken, setBearerToken] = useState('');
  const [settings, setSettings] = useState<SettingsResponse | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const next = await webhookApi<SettingsResponse>(auth, '/settings');
    setSettings(next);
    setMode(next.config.exposureMode || 'none');
    setPublicUrl(next.config.publicUrl || '');
  }, [auth]);

  useEffect(() => {
    if (!isOpen) return;
    void load().catch((caught) => setError(String(caught)));
  }, [isOpen, load]);

  useEffect(() => {
    if (!isOpen || settings?.tunnel.status !== 'starting') return;
    const interval = window.setInterval(() => {
      void load().catch((caught) =>
        setError(caught instanceof Error ? caught.message : String(caught)),
      );
    }, 1000);
    return () => window.clearInterval(interval);
  }, [isOpen, load, settings?.tunnel.status]);

  const save = async () => {
    setPending(true);
    setError('');
    try {
      await webhookApi(auth, '/settings', {
        method: 'PUT',
        body: JSON.stringify({
          bearerToken,
          exposureMode: mode,
          publicUrl,
        }),
      });
      if (mode !== 'cloudflare') await load();
      else setSettings((current) => current);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setPending(false);
    }
  };

  const startTunnel = async () => {
    setPending(true);
    setError('');
    try {
      await save();
      await webhookApi(auth, '/tunnel/start', { method: 'POST' });
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setPending(false);
    }
  };

  const stopTunnel = async () => {
    setPending(true);
    try {
      await webhookApi(auth, '/tunnel/stop', { method: 'POST' });
      await load();
    } finally {
      setPending(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Webhooks settings"
      icon={<Webhook className="h-4 w-4" />}
      maxWidth="max-w-xl"
      footer={
        Button ? (
          <Button type="button" onClick={save} disabled={pending}>
            Save settings
          </Button>
        ) : null
      }
    >
      <IntegrationConnectionAutofillGuard connectionId="webhooks" />
      <div className="space-y-5">
        <div className="space-y-1.5">
          <label className="text-sm font-medium">Inbound exposure</label>
          <Select
            aria-label="Inbound exposure"
            value={mode}
            onChange={(event) => setMode(event.target.value as ExposureMode)}
          >
            <option value="none">No public exposure</option>
            <option value="public-url">Use configured public URL</option>
            <option value="cloudflare">Managed Cloudflare Tunnel</option>
          </Select>
          <p className="text-xs leading-relaxed text-muted">
            Cloudflare is opt-in and never starts just because an endpoint is
            enabled or viewed.
          </p>
        </div>

        {mode === 'public-url' ? (
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Public HTTPS base URL</label>
            <IntegrationConnectionInput
              aria-label="Public HTTPS base URL"
              connectionId="webhooks"
              fieldSlot="public-url"
              value={publicUrl}
              placeholder="https://playrunner.example.com"
              onChange={(event) => setPublicUrl(event.target.value)}
            />
          </div>
        ) : null}

        {mode === 'cloudflare' ? (
          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-hover)] p-4">
            <div className="flex items-start gap-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--background)]">
                <Cloud className="h-4 w-4 text-muted" />
              </div>
              <div className="min-w-0 flex-1 space-y-3">
                <div>
                  <p className="text-sm font-medium">Managed local tunnel</p>
                  <p className="mt-1 text-xs leading-relaxed text-muted">
                    Requires cloudflared on PATH. The temporary URL can change
                    whenever the API restarts.
                  </p>
                </div>
                {settings?.tunnel.url ? (
                  <p className="break-all font-mono text-xs">
                    {settings.tunnel.url}
                  </p>
                ) : null}
                {settings?.tunnel ? (
                  <TunnelStatusConsole tunnel={settings.tunnel} />
                ) : null}
                {Button ? (
                  settings?.tunnel.status === 'running' ? (
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={stopTunnel}
                      disabled={pending}
                    >
                      Stop tunnel
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={startTunnel}
                      disabled={
                        pending || settings?.tunnel.status === 'starting'
                      }
                    >
                      {settings?.tunnel.status === 'starting'
                        ? 'Starting tunnel…'
                        : 'Start tunnel'}
                    </Button>
                  )
                ) : null}
              </div>
            </div>
          </div>
        ) : null}

        <div className="space-y-1.5">
          <label className="text-sm font-medium">
            Default outbound bearer token
          </label>
          <IntegrationConnectionInput
            aria-label="Default outbound bearer token"
            connectionId="webhooks"
            fieldSlot="bearer"
            mode="secret"
            value={bearerToken}
            placeholder={
              settings?.credentialStatus.configured
                ? 'Saved — enter a value to replace'
                : 'Optional'
            }
            onChange={(event) => setBearerToken(event.target.value)}
          />
        </div>
        {error ? (
          <p className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-500">
            {error}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}
