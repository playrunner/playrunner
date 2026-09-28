import { useCallback, useEffect, useState } from 'react';
import { IntegrationCopyableCode } from '@playrunner/integration-sdk';
import {
  Info,
  Laptop,
  Loader2,
  RefreshCw,
  Terminal,
  Trash2,
} from 'lucide-react';
import { auth } from '../lib/auth';
import { Badge, Button, Select } from '../components/ui';

const DEVICE_KEY = 'playrunner.authenticationCompanionDevice';

type Device = {
  cliVersion: string;
  id: string;
  lastSeenAt: string | null;
  name: string;
  online: boolean;
  platform: string;
  revokedAt: string | null;
};

async function request<T>(path: string, init: RequestInit = {}) {
  const token = await auth.currentUser?.getIdToken();
  const response = await fetch(path, {
    ...init,
    headers: {
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  });
  const payload = (await response.json().catch(() => ({}))) as T & {
    error?: string;
  };
  if (!response.ok) {
    throw new Error(
      payload.error || 'Authentication companion request failed.',
    );
  }
  return payload;
}

function selectedDeviceId() {
  return window.localStorage.getItem(DEVICE_KEY) || '';
}

export function AuthenticationCompanionPanel() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [selected, setSelected] = useState(selectedDeviceId);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const result = await request<{ devices: Device[] }>(
        '/api/auth-companion/devices',
      );
      setDevices(result.devices);
      const current = result.devices.find(
        (device) => device.id === selected && !device.revokedAt,
      );
      if (!current) {
        const firstOnline = result.devices.find(
          (device) => device.online && !device.revokedAt,
        );
        const next = firstOnline?.id || '';
        setSelected(next);
        if (next) window.localStorage.setItem(DEVICE_KEY, next);
        else window.localStorage.removeItem(DEVICE_KEY);
      }
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : 'Devices could not be loaded.',
      );
    } finally {
      setLoading(false);
    }
  }, [selected]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 30_000);
    return () => window.clearInterval(timer);
  }, [load]);

  const revoke = async (device: Device) => {
    try {
      await request(
        `/api/auth-companion/devices/${encodeURIComponent(device.id)}`,
        { method: 'DELETE' },
      );
      await load();
    } catch (revokeError) {
      setError(
        revokeError instanceof Error
          ? revokeError.message
          : 'Device could not be revoked.',
      );
    }
  };

  const active = devices.filter((device) => !device.revokedAt);

  return (
    <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-subtle pb-4">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface-hover)]">
            <Laptop className="h-4 w-4" aria-hidden="true" />
          </div>
          <div>
            <h2 className="text-xl font-medium">Paired devices</h2>
            <p className="mt-1 text-sm leading-relaxed text-muted">
              Authentication opens in native Chrome on the selected online
              device. Keep the terminal open while signing in, then press Enter
              there to save the session.
            </p>
          </div>
        </div>
        <Button variant="secondary" size="sm" onClick={() => void load()}>
          <RefreshCw className="h-4 w-4" /> Refresh
        </Button>
      </div>

      <div className="mt-4 flex items-start gap-3 rounded-lg border border-subtle bg-[var(--surface-hover)] p-3 text-muted shadow-inner">
        <Info className="h-4 w-4 shrink-0" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="text-xs leading-relaxed">
            Run this command in a terminal on your computer.
          </p>
          <IntegrationCopyableCode
            value={`npx playrunner@0.2.6 login --url ${window.location.origin} && npx playrunner@0.2.6 auth connect`}
            label="Copy device connection command"
          />
        </div>
      </div>

      {error ? (
        <p className="mt-4 text-sm text-red-500" role="alert">
          {error}
        </p>
      ) : null}
      {loading ? (
        <Loader2
          className="mt-4 h-5 w-5 animate-spin text-muted"
          aria-label="Loading paired devices"
        />
      ) : active.length ? (
        <div className="mt-4 space-y-3">
          <label
            className="block text-sm font-medium"
            htmlFor="authentication-device"
          >
            Device for authentication
          </label>
          <Select
            id="authentication-device"
            value={selected}
            onChange={(event) => {
              setSelected(event.target.value);
              window.localStorage.setItem(DEVICE_KEY, event.target.value);
            }}
          >
            <option value="">Choose a device</option>
            {active.map((device) => (
              <option
                key={device.id}
                value={device.id}
                disabled={!device.online}
              >
                {device.name} — {device.online ? 'online' : 'offline'}
              </option>
            ))}
          </Select>
          <div className="divide-y divide-[var(--border)] rounded-xl border border-[var(--border)] bg-[var(--background)]">
            {active.map((device) => (
              <div key={device.id} className="flex items-center gap-3 p-3">
                <Terminal
                  className="h-4 w-4 shrink-0 text-muted"
                  aria-hidden="true"
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{device.name}</p>
                  <p className="text-xs text-muted">
                    {device.platform} · CLI {device.cliVersion}
                  </p>
                </div>
                <Badge variant={device.online ? 'success' : 'outline'}>
                  {device.online ? 'Online' : 'Offline'}
                </Badge>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Revoke ${device.name}`}
                  title={`Revoke ${device.name}`}
                  onClick={() => void revoke(device)}
                >
                  <Trash2 className="h-4 w-4 text-red-500" />
                </Button>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <p className="mt-4 text-sm text-muted">No paired devices yet.</p>
      )}
    </section>
  );
}
