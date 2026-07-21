import type { Route } from '@playwright/test';

type StoredIntegration = {
  config: Record<string, unknown>;
  credentialStatus: { configured: boolean };
  id: string;
  provider: string;
};

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({
    body: JSON.stringify(body),
    contentType: 'application/json',
    status,
  });
}

export class IntegrationStoreDriver {
  private readonly integrations = new Map<string, StoredIntegration>();

  async handle(route: Route) {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();

    if (url.pathname === '/api/auth/session') {
      return json(route, {
        user: {
          uid: 'e2e-user',
          username: 'e2e@playrunner.dev',
          name: 'Playrunner E2E',
        },
      });
    }

    if (url.pathname === '/api/store/integrations' && method === 'GET') {
      return json(route, {
        integrations: Object.fromEntries(this.integrations),
      });
    }

    const integrationMatch = url.pathname.match(
      /^\/api\/store\/integrations\/([^/]+)$/,
    );
    if (integrationMatch) {
      const integrationId = decodeURIComponent(integrationMatch[1]);

      if (method === 'GET') {
        return json(route, {
          integration: this.integrations.get(integrationId) ?? null,
        });
      }

      if (method === 'PUT') {
        const body = request.postDataJSON() as {
          config?: Record<string, unknown>;
          provider?: string;
          secrets?: Record<string, unknown>;
        };
        this.integrations.set(integrationId, {
          config: body.config ?? {},
          credentialStatus: {
            configured: Boolean(
              body.secrets && Object.keys(body.secrets).length > 0,
            ),
          },
          id: integrationId,
          provider: body.provider ?? integrationId,
        });
        return route.fulfill({ status: 204 });
      }

      if (method === 'DELETE') {
        this.integrations.delete(integrationId);
        return route.fulfill({ status: 204 });
      }
    }

    if (url.pathname.startsWith('/api/store/cloud-credentials/')) {
      return json(route, { cloudCredential: null });
    }

    return json(
      route,
      { error: `Unhandled E2E API request: ${method} ${url.pathname}` },
      501,
    );
  }
}
