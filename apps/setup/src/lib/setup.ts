export type SetupPlatform = 'postgresql';

export type RuntimePostgresConfig = {
  databaseUrl: string;
  directUrl?: string;
};

export type RuntimeLocalAuthConfig = {
  username: string;
  password: string;
};

export type RuntimeSetupConfig = RuntimePostgresConfig & RuntimeLocalAuthConfig;

export type SetupSessionStatus = {
  completed: boolean;
  enabled: boolean;
};

function isBrowser() {
  return typeof window !== 'undefined';
}

function getSetupSessionToken(): string | null {
  const token = import.meta.env.VITE_SETUP_SESSION_TOKEN?.trim();
  return token ? token : null;
}

function isExplicitSetupRun() {
  return import.meta.env.VITE_SETUP_MODE === 'true';
}

export async function detectSetupMode(): Promise<SetupSessionStatus> {
  if (!isBrowser() || !isExplicitSetupRun()) {
    return {
      completed: false,
      enabled: false,
    };
  }

  const token = getSetupSessionToken();
  if (!token) {
    return {
      completed: false,
      enabled: false,
    };
  }

  try {
    const response = await window.fetch(
      `/setup-api/setup/session?token=${encodeURIComponent(token)}`,
      {
        cache: 'no-store',
      },
    );

    if (!response.ok) {
      return {
        completed: false,
        enabled: false,
      };
    }

    return (await response.json()) as SetupSessionStatus;
  } catch {
    return {
      completed: false,
      enabled: false,
    };
  }
}

export function getActiveSetupSessionToken(): string | null {
  return getSetupSessionToken();
}
