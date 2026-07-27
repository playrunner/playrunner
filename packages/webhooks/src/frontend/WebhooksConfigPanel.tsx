import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  IntegrationConfigField,
  IntegrationCopyableCode,
  type IntegrationConfigPanelProps,
  useIntegrationHost,
} from '@playrunner/integration-sdk';
import { webhookApi } from './api';
import {
  TunnelStatusConsole,
  type TunnelViewState,
} from './TunnelStatusConsole';

interface Endpoint {
  enabled: boolean;
  endpointId: string;
  path: string;
}

interface Settings {
  config: { exposureMode?: string; publicUrl?: string };
  localBaseUrl?: string;
  tunnel: TunnelViewState;
}

export function WebhooksConfigPanel({
  config,
  nodeId,
  onChange,
  onConnectOAuth,
  workflowId,
}: IntegrationConfigPanelProps) {
  const { auth, ui } = useIntegrationHost();
  const { Button, Input, Select, Textarea } = ui;
  const [endpoint, setEndpoint] = useState<Endpoint | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const mode = config.mode === 'inbound' ? 'inbound' : 'outbound';
  const localBaseUrl =
    settings?.localBaseUrl ||
    (typeof window === 'undefined' ? '' : window.location.origin);

  const publicBaseUrl = useMemo(() => {
    if (settings?.config.exposureMode === 'public-url') {
      return settings.config.publicUrl || '';
    }
    if (
      settings?.config.exposureMode === 'cloudflare' &&
      settings.tunnel.status === 'running'
    ) {
      return settings.tunnel.url;
    }
    return '';
  }, [settings]);

  const loadSettings = useCallback(
    () =>
      webhookApi<Settings>(auth, '/settings')
        .then(setSettings)
        .catch((caught) =>
          setError(caught instanceof Error ? caught.message : String(caught)),
        ),
    [auth],
  );

  useEffect(() => {
    void loadSettings();
    if (!workflowId) return;
    const query = new URLSearchParams({ nodeId, workflowId });
    void webhookApi<{ endpoint: Endpoint | null }>(auth, `/endpoint?${query}`)
      .then((result) => setEndpoint(result.endpoint))
      .catch((caught) => setError(String(caught)));
  }, [auth, loadSettings, nodeId, workflowId]);

  useEffect(() => {
    if (settings?.tunnel.status !== 'starting') return;
    const interval = window.setInterval(() => {
      void loadSettings();
    }, 1000);
    return () => window.clearInterval(interval);
  }, [loadSettings, settings?.tunnel.status]);

  const update = (patch: Record<string, unknown>) =>
    onChange(nodeId, { ...config, ...patch });

  const createEndpoint = async () => {
    if (!workflowId) {
      setError('Save the workflow before creating its inbound endpoint.');
      return;
    }
    setPending(true);
    setError('');
    try {
      const result = await webhookApi<{ endpoint: Endpoint }>(
        auth,
        '/endpoint',
        {
          method: 'POST',
          body: JSON.stringify({ enabled: true, nodeId, workflowId }),
        },
      );
      setEndpoint(result.endpoint);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setPending(false);
    }
  };

  const setEndpointEnabled = async (enabled: boolean) => {
    if (!workflowId) return;
    setPending(true);
    setError('');
    try {
      await webhookApi(auth, '/endpoint', {
        method: 'PATCH',
        body: JSON.stringify({ enabled, nodeId, workflowId }),
      });
      setEndpoint((current) => (current ? { ...current, enabled } : current));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setPending(false);
    }
  };

  const startManagedTunnel = async () => {
    setPending(true);
    setError('');
    try {
      await webhookApi(auth, '/settings', {
        method: 'PUT',
        body: JSON.stringify({
          exposureMode: 'cloudflare',
          publicUrl: settings?.config.publicUrl || '',
        }),
      });
      await webhookApi(auth, '/tunnel/start', { method: 'POST' });
      await loadSettings();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="border-b border-subtle pb-2">
        <h4 className="text-sm font-medium text-[var(--foreground)]">
          Webhook configuration
        </h4>
      </div>
      <IntegrationConfigField label="Direction">
        <Select
          value={mode}
          onChange={(event) => update({ mode: event.target.value })}
        >
          <option value="outbound">Send an outbound request</option>
          <option value="inbound">Receive an inbound trigger</option>
        </Select>
      </IntegrationConfigField>

      {mode === 'inbound' ? (
        <div className="space-y-5 rounded-xl border border-[var(--border)] bg-[var(--background)] p-4">
          <p className="text-xs leading-relaxed text-muted">
            Call the local endpoint from this machine, or expose it publicly
            with your own HTTPS URL or an opt-in Cloudflare tunnel.
          </p>
          {endpoint ? (
            <>
              <div className="space-y-4 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
                <div>
                  <p className="text-sm font-medium text-[var(--foreground)]">
                    Endpoint
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-muted">
                    Use the local URL on this machine. The path stays the same
                    when you expose it publicly.
                  </p>
                </div>
                <div>
                  <p className="text-xs font-medium text-[var(--foreground)]">
                    Local URL
                  </p>
                  <IntegrationCopyableCode
                    value={`${localBaseUrl}${endpoint.path}`}
                    label="Copy local webhook URL"
                  />
                </div>
                <div>
                  <p className="text-xs font-medium text-[var(--foreground)]">
                    Path
                  </p>
                  <IntegrationCopyableCode
                    value={endpoint.path}
                    label="Copy webhook endpoint path"
                  />
                </div>
              </div>

              <div className="space-y-4 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
                <div>
                  <p className="text-sm font-medium text-[var(--foreground)]">
                    Public access
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-muted">
                    Expose this endpoint with a temporary managed tunnel or your
                    own HTTPS base URL.
                  </p>
                </div>
                {publicBaseUrl ? (
                  <div>
                    <p className="text-xs font-medium text-[var(--foreground)]">
                      Public URL
                    </p>
                    <IntegrationCopyableCode
                      value={`${publicBaseUrl}${endpoint.path}`}
                      label="Copy public webhook URL"
                    />
                  </div>
                ) : (
                  <p className="text-xs text-muted">
                    No public endpoint is active.
                  </p>
                )}
                {Button ? (
                  <div className="flex flex-wrap gap-2 border-t border-subtle pt-4">
                    {settings?.tunnel.status !== 'running' ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="primary"
                        onClick={startManagedTunnel}
                        disabled={
                          pending || settings?.tunnel.status === 'starting'
                        }
                        title="Start a temporary Cloudflare tunnel to this local Playrunner API"
                      >
                        {pending || settings?.tunnel.status === 'starting'
                          ? 'Starting…'
                          : 'Start tunnel'}
                      </Button>
                    ) : null}
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      onClick={() => onConnectOAuth?.()}
                      disabled={pending}
                      title="Configure your own public HTTPS base URL"
                    >
                      Public URL
                    </Button>
                  </div>
                ) : null}
                {settings?.tunnel ? (
                  <TunnelStatusConsole tunnel={settings.tunnel} />
                ) : null}
              </div>

              {Button ? (
                <div className="space-y-4 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
                  <div>
                    <p className="text-sm font-medium text-[var(--foreground)]">
                      Endpoint controls
                    </p>
                    <p className="mt-1 text-xs leading-relaxed text-muted">
                      Rotate the secret if it is exposed, or temporarily stop
                      this endpoint from accepting requests.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      onClick={createEndpoint}
                      disabled={pending}
                      title="Replace the endpoint secret and invalidate the current URL"
                    >
                      Rotate secret
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant={endpoint.enabled ? 'danger' : 'secondary'}
                      onClick={() => setEndpointEnabled(!endpoint.enabled)}
                      disabled={pending}
                      title={
                        endpoint.enabled
                          ? 'Stop this endpoint from accepting webhook requests'
                          : 'Allow this endpoint to accept webhook requests'
                      }
                    >
                      {endpoint.enabled ? 'Disable' : 'Enable'}
                    </Button>
                  </div>
                </div>
              ) : null}
            </>
          ) : Button ? (
            <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
              <p className="text-sm font-medium text-[var(--foreground)]">
                Endpoint
              </p>
              <p className="mt-1 text-xs leading-relaxed text-muted">
                Create a unique URL and secret for this workflow step.
              </p>
              <div className="mt-4">
                <Button
                  type="button"
                  size="sm"
                  variant="primary"
                  onClick={createEndpoint}
                  disabled={pending}
                  title="Create an inbound webhook endpoint"
                >
                  Create endpoint
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      ) : (
        <>
          <IntegrationConfigField label="Target URL">
            <Input
              value={config.url || ''}
              placeholder="https://example.com/hooks/playrunner"
              onChange={(event) => update({ url: event.target.value })}
            />
          </IntegrationConfigField>
          <div className="grid grid-cols-2 gap-3">
            <IntegrationConfigField label="Method">
              <Select
                value={config.method || 'POST'}
                onChange={(event) => update({ method: event.target.value })}
              >
                {['POST', 'PUT', 'PATCH', 'DELETE', 'GET'].map((method) => (
                  <option key={method}>{method}</option>
                ))}
              </Select>
            </IntegrationConfigField>
            <IntegrationConfigField label="Retries">
              <Input
                type="number"
                min={0}
                max={3}
                value={config.retries ?? 0}
                onChange={(event) =>
                  update({ retries: Number(event.target.value) })
                }
              />
            </IntegrationConfigField>
          </div>
          <IntegrationConfigField
            label="Headers"
            hint="JSON object. Authorization is configured in integration settings."
          >
            <Textarea
              className="min-h-24 font-mono text-xs"
              value={config.headers || '{}'}
              onChange={(event) => update({ headers: event.target.value })}
            />
          </IntegrationConfigField>
          <IntegrationConfigField label="Body template">
            <Textarea
              className="min-h-40 font-mono text-xs"
              value={config.body || ''}
              placeholder={'{"status":"{{workflow.run.status}}"}'}
              onChange={(event) => update({ body: event.target.value })}
            />
          </IntegrationConfigField>
        </>
      )}
      {error ? (
        <p className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-500">
          {error}
        </p>
      ) : null}
    </div>
  );
}
