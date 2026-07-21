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

async function saveCloudCredentialRecord(providerId: string, data: any) {
  await apiRequest(`/api/store/cloud-credentials/${providerId}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export const DbAPI = {
  async changePassword(data: { currentPassword: string; newPassword: string }) {
    await apiRequest<{ ok: boolean }>('/api/auth/password', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async getInsights(days: string) {
    const payload = await apiRequest<{ insights?: any; report?: any }>(
      `/api/insights?days=${encodeURIComponent(days)}`,
    );
    return payload.insights ?? payload.report;
  },

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

  async getIntegration(_userId: string, integrationId: string) {
    const payload = await apiRequest<{ integration: any | null }>(
      `/api/store/integrations/${integrationId}`,
    );
    return payload.integration;
  },

  async saveIntegration(_userId: string, integrationId: string, data: any) {
    await saveIntegrationRecord(integrationId, data);
  },

  async getAllIntegrations(_userId: string) {
    const payload = await apiRequest<{ integrations: Record<string, any> }>(
      '/api/store/integrations',
    );
    return payload.integrations;
  },

  subscribeToIntegration(
    userId: string,
    integrationId: string,
    callback: (exists: boolean, data?: any) => void,
  ) {
    return createPollingSubscription(
      async () => await DbAPI.getIntegration(userId, integrationId),
      (_exists, data) =>
        callback(Boolean(data?.credentialStatus?.configured), data),
    );
  },

  async deleteIntegration(_userId: string, integrationId: string) {
    await apiRequest(`/api/store/integrations/${integrationId}`, {
      method: 'DELETE',
    });
  },

  async getCloudCredential(_userId: string, providerId: string) {
    const payload = await apiRequest<{ cloudCredential: any | null }>(
      `/api/store/cloud-credentials/${providerId}`,
    );
    return payload.cloudCredential;
  },

  async saveCloudCredential(_userId: string, providerId: string, data: any) {
    await saveCloudCredentialRecord(providerId, data);
  },

  subscribeToCloudCredential(
    userId: string,
    providerId: string,
    callback: (exists: boolean, data?: any) => void,
  ) {
    return createPollingSubscription(
      async () => await DbAPI.getCloudCredential(userId, providerId),
      (_exists, data) =>
        callback(Boolean(data?.credentialStatus?.configured), data),
    );
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
