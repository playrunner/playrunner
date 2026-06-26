import { auth } from './auth';

async function getAuthenticatedUser() {
  if (auth.currentUser) {
    return auth.currentUser;
  }

  return await new Promise<typeof auth.currentUser>((resolve) => {
    const unsubscribe = auth.onAuthStateChanged((user) => {
      unsubscribe();
      resolve(user);
    });
  });
}

async function getApiHeaders() {
  const headers: Record<string, string> = {};
  const user = await getAuthenticatedUser();
  const token = user ? await user.getIdToken() : '';

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  return headers;
}

async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    ...(init.body ? { 'Content-Type': 'application/json' } : {}),
    ...(await getApiHeaders()),
    ...((init.headers as Record<string, string> | undefined) ?? {}),
  };

  const response = await fetch(path, {
    ...init,
    headers,
  });

  if (response.status === 204) {
    return null as T;
  }

  const payload = (await response.json().catch(() => null)) as
    | {
        error?: string;
      }
    | T
    | null;

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      await auth.signOut();
    }

    const message =
      payload &&
      typeof payload === 'object' &&
      'error' in payload &&
      typeof payload.error === 'string'
        ? payload.error
        : `Request failed with status ${response.status}`;
    throw new Error(message);
  }

  return payload as T;
}

function createPollingSubscription<T>(
  loader: () => Promise<T | null>,
  callback: (exists: boolean, data?: T) => void,
) {
  let cancelled = false;

  const run = async () => {
    try {
      const data = await loader();
      if (cancelled) {
        return;
      }

      callback(Boolean(data), data ?? undefined);
    } catch (error) {
      if (!cancelled) {
        console.error('Subscription refresh failed:', error);
      }
    }
  };

  void run();

  if (typeof window === 'undefined') {
    return () => {
      cancelled = true;
    };
  }

  const intervalId = window.setInterval(() => {
    void run();
  }, 5000);

  return () => {
    cancelled = true;
    window.clearInterval(intervalId);
  };
}

async function saveIntegrationRecord(integrationId: string, data: any) {
  await apiRequest(`/api/store/integrations/${integrationId}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

async function deleteIntegrationRecord(integrationId: string) {
  await apiRequest(`/api/store/integrations/${integrationId}`, {
    method: 'DELETE',
  });
}

async function saveCloudCredentialRecord(providerId: string, data: any) {
  await apiRequest(`/api/store/cloud-credentials/${providerId}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

function isBadGithubRefreshTokenError(tokenData: any) {
  return tokenData?.error === 'bad_refresh_token';
}

async function refreshGithubTokenIfNeeded(
  userId: string,
  integrationData: any,
) {
  if (
    !integrationData ||
    !integrationData.accessToken ||
    !integrationData.refreshToken ||
    !integrationData.expiresAt
  ) {
    return integrationData;
  }

  if (Date.now() + 5 * 60 * 1000 > integrationData.expiresAt) {
    try {
      console.log('GitHub token is expired or expiring soon, refreshing...');
      const res = await fetch('/api/github/refresh', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(await getApiHeaders()),
        },
        body: JSON.stringify({
          refresh_token: integrationData.refreshToken,
          client_id: integrationData.clientId,
          client_secret: integrationData.clientSecret,
        }),
      });

      const tokenData = await res.json();

      if (tokenData.access_token) {
        integrationData.accessToken = tokenData.access_token;
        if (tokenData.refresh_token) {
          integrationData.refreshToken = tokenData.refresh_token;
        }
        if (tokenData.expires_in) {
          integrationData.expiresAt = Date.now() + tokenData.expires_in * 1000;
        }
        if (tokenData.refresh_token_expires_in) {
          integrationData.refreshTokenExpiresAt =
            Date.now() + tokenData.refresh_token_expires_in * 1000;
        }
        integrationData.updatedAt = new Date().toISOString();

        await saveIntegrationRecord('github', integrationData);
        console.log('GitHub token refreshed successfully.');
      } else {
        if (isBadGithubRefreshTokenError(tokenData)) {
          console.warn(
            'GitHub refresh token is invalid or expired. Clearing the saved GitHub connection; reconnect GitHub to continue.',
          );
          await deleteIntegrationRecord('github');
          return null;
        }

        console.error(
          'Failed to refresh GitHub token, no access_token returned:',
          tokenData,
        );
      }
    } catch (error) {
      console.error('Failed to refresh GitHub token:', error);
    }
  }

  return integrationData;
}

async function refreshJiraTokenIfNeeded(userId: string, integrationData: any) {
  if (
    !integrationData ||
    !integrationData.accessToken ||
    !integrationData.refreshToken ||
    !integrationData.expiresAt
  ) {
    return integrationData;
  }

  if (Date.now() + 5 * 60 * 1000 > integrationData.expiresAt) {
    try {
      console.log('Jira token is expired or expiring soon, refreshing...');
      const res = await fetch('/api/jira/refresh', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(await getApiHeaders()),
        },
        body: JSON.stringify({
          refresh_token: integrationData.refreshToken,
          client_id: integrationData.clientId,
          client_secret: integrationData.clientSecret,
        }),
      });

      const tokenData = await res.json();

      if (tokenData.access_token) {
        integrationData.accessToken = tokenData.access_token;
        if (tokenData.refresh_token) {
          integrationData.refreshToken = tokenData.refresh_token;
        }
        if (tokenData.expires_in) {
          integrationData.expiresAt = Date.now() + tokenData.expires_in * 1000;
        }
        integrationData.updatedAt = new Date().toISOString();

        await saveIntegrationRecord('jira', integrationData);
        console.log('Jira token refreshed successfully.');
      } else {
        console.error(
          'Failed to refresh Jira token, no access_token returned:',
          tokenData,
        );
      }
    } catch (error) {
      console.error('Failed to refresh Jira token:', error);
    }
  }

  return integrationData;
}

async function refreshGcpTokenIfNeeded(userId: string, credentialData: any) {
  if (
    !credentialData ||
    !credentialData.accessToken ||
    !credentialData.refreshToken
  ) {
    return credentialData;
  }

  const isExpired =
    !credentialData.expiresAt ||
    Date.now() + 5 * 60 * 1000 > credentialData.expiresAt;
  if (!isExpired) {
    return credentialData;
  }

  try {
    console.log('GCP token is expired or expiring soon, refreshing...');
    const res = await fetch('/api/gcp/refresh', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(await getApiHeaders()),
      },
      body: JSON.stringify({
        refresh_token: credentialData.refreshToken,
        client_id: credentialData.clientId,
        client_secret: credentialData.clientSecret,
      }),
    });

    const tokenData = await res.json();

    if (tokenData.access_token) {
      credentialData.accessToken = tokenData.access_token;
      if (tokenData.expires_in) {
        credentialData.expiresAt = Date.now() + tokenData.expires_in * 1000;
      }
      credentialData.updatedAt = new Date().toISOString();

      await saveCloudCredentialRecord('gcp', credentialData);
      console.log('GCP token refreshed successfully.');
    } else {
      console.error(
        'Failed to refresh GCP token, no access_token returned:',
        tokenData,
      );
    }
  } catch (error) {
    console.error('Failed to refresh GCP token:', error);
  }

  return credentialData;
}

export const DbAPI = {
  async getProject(_userId: string, projectId: string) {
    const payload = await apiRequest<{ project: any | null }>(
      `/api/store/projects/${projectId}`,
    );
    return payload.project;
  },

  async getProjects(_userId: string) {
    const payload = await apiRequest<{ projects: any[] }>(
      '/api/store/projects',
    );
    return payload.projects;
  },

  async createProject(_userId: string, data: any) {
    const payload = await apiRequest<{ project: { id: string } }>(
      '/api/store/projects',
      {
        method: 'POST',
        body: JSON.stringify(data),
      },
    );
    return payload.project.id;
  },

  async saveProject(_userId: string, projectId: string, data: any) {
    await apiRequest(`/api/store/projects/${projectId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },

  async deleteProject(_userId: string, projectId: string) {
    await apiRequest(`/api/store/projects/${projectId}`, {
      method: 'DELETE',
    });
  },

  async getWorkflow(_userId: string, workflowId: string = 'current') {
    const payload = await apiRequest<{ workflow: any | null }>(
      `/api/store/workflows/${workflowId}`,
    );
    return payload.workflow;
  },

  async getWorkflows(_userId: string) {
    const payload = await apiRequest<{ workflows: any[] }>(
      '/api/store/workflows',
    );
    return payload.workflows;
  },

  async getWorkflowsByProject(_userId: string, projectId: string) {
    const payload = await apiRequest<{ workflows: any[] }>(
      `/api/store/workflows?projectId=${encodeURIComponent(projectId)}`,
    );
    return payload.workflows;
  },

  async saveWorkflow(
    _userId: string,
    workflowId: string = 'current',
    data: any,
  ) {
    await apiRequest(`/api/store/workflows/${workflowId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },

  async createWorkflow(_userId: string, data: any) {
    const payload = await apiRequest<{ workflow: { id: string } }>(
      '/api/store/workflows',
      {
        method: 'POST',
        body: JSON.stringify(data),
      },
    );
    return payload.workflow.id;
  },

  async deleteWorkflow(_userId: string, workflowId: string) {
    await apiRequest(`/api/store/workflows/${workflowId}`, {
      method: 'DELETE',
    });
  },

  async getIntegration(userId: string, integrationId: string) {
    const payload = await apiRequest<{ integration: any | null }>(
      `/api/store/integrations/${integrationId}`,
    );
    let data = payload.integration;

    if (integrationId === 'github' && data) {
      data = await refreshGithubTokenIfNeeded(userId, data);
    }

    if (integrationId === 'jira' && data) {
      data = await refreshJiraTokenIfNeeded(userId, data);
    }

    return data;
  },

  async saveIntegration(_userId: string, integrationId: string, data: any) {
    await saveIntegrationRecord(integrationId, data);
  },

  async getAllIntegrations(userId: string) {
    const payload = await apiRequest<{ integrations: Record<string, any> }>(
      '/api/store/integrations',
    );
    const results = payload.integrations;

    if (results['github']) {
      const githubIntegration = await refreshGithubTokenIfNeeded(
        userId,
        results['github'],
      );

      if (githubIntegration) {
        results['github'] = githubIntegration;
      } else {
        delete results['github'];
      }
    }

    if (results['jira']) {
      results['jira'] = await refreshJiraTokenIfNeeded(userId, results['jira']);
    }

    return results;
  },

  subscribeToIntegration(
    userId: string,
    integrationId: string,
    callback: (exists: boolean, data?: any) => void,
  ) {
    return createPollingSubscription(async () => {
      return await DbAPI.getIntegration(userId, integrationId);
    }, callback);
  },

  async deleteIntegration(_userId: string, integrationId: string) {
    await apiRequest(`/api/store/integrations/${integrationId}`, {
      method: 'DELETE',
    });
  },

  async getCloudCredential(userId: string, providerId: string) {
    const payload = await apiRequest<{ cloudCredential: any | null }>(
      `/api/store/cloud-credentials/${providerId}`,
    );
    let data = payload.cloudCredential;

    if (providerId === 'gcp' && data) {
      data = await refreshGcpTokenIfNeeded(userId, data);
    }

    return data;
  },

  async saveCloudCredential(_userId: string, providerId: string, data: any) {
    await saveCloudCredentialRecord(providerId, data);
  },

  subscribeToCloudCredential(
    userId: string,
    providerId: string,
    callback: (exists: boolean, data?: any) => void,
  ) {
    return createPollingSubscription(async () => {
      return await DbAPI.getCloudCredential(userId, providerId);
    }, callback);
  },

  async deleteCloudCredential(_userId: string, providerId: string) {
    await apiRequest(`/api/store/cloud-credentials/${providerId}`, {
      method: 'DELETE',
    });
  },

  async saveSecret(_userId: string, secretKey: string, data: any) {
    await apiRequest(`/api/store/secrets/${encodeURIComponent(secretKey)}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },

  async getEnvironments(_userId: string) {
    const payload = await apiRequest<{ environments: any[] }>(
      '/api/store/environments',
    );
    return payload.environments;
  },

  async saveEnvironment(_userId: string, envId: string, data: any) {
    await apiRequest(`/api/store/environments/${envId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },

  async deleteEnvironment(_userId: string, envId: string) {
    await apiRequest(`/api/store/environments/${envId}`, {
      method: 'DELETE',
    });
  },
};
