import { Router } from 'express';

export const jiraRouter = Router();

export const jiraApiContribution = {
  id: 'jira',
  mountPath: '/api/jira',
  router: jiraRouter,
};

jiraRouter.post('/token', async (req, res) => {
  const { code, client_id, client_secret, redirect_uri } = req.body;

  try {
    const jRes = await fetch('https://auth.atlassian.com/oauth/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        client_id,
        client_secret,
        code,
        redirect_uri,
      }),
    });

    const text = await jRes.text();

    try {
      const data = JSON.parse(text);

      if (!jRes.ok) {
        console.error('Jira Token exchange failed:', data);
        return res.status(jRes.status).json(data);
      }

      return res.json(data);
    } catch {
      console.error('Token exchange failed. Jira returned non-JSON:', text);
      return res
        .status(500)
        .json({ error: 'Failed to exchange token', details: text });
    }
  } catch (err) {
    console.error('Token exchange error:', err);
    return res.status(500).json({ error: 'Failed to exchange token' });
  }
});

jiraRouter.post('/refresh', async (req, res) => {
  const { refresh_token, client_id, client_secret } = req.body;

  try {
    const jRes = await fetch('https://auth.atlassian.com/oauth/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        grant_type: 'refresh_token',
        client_id,
        client_secret,
        refresh_token,
      }),
    });

    const text = await jRes.text();

    try {
      const data = JSON.parse(text);

      if (!jRes.ok) {
        console.error('Jira Token refresh failed:', data);
        return res.status(jRes.status).json(data);
      }

      return res.json(data);
    } catch {
      console.error('Token refresh failed. Jira returned non-JSON:', text);
      return res
        .status(500)
        .json({ error: 'Failed to refresh token', details: text });
    }
  } catch (err) {
    console.error('Token refresh error:', err);
    return res.status(500).json({ error: 'Failed to refresh token' });
  }
});

jiraRouter.get('/projects', async (req, res) => {
  const token = req.headers['x-jira-auth'];

  if (!token) {
    return res.status(401).json({ error: 'Missing x-jira-auth header' });
  }

  try {
    const resourceRes = await fetch(
      'https://api.atlassian.com/oauth/token/accessible-resources',
      {
        headers: { Authorization: `Bearer ${token}` },
      },
    );

    if (!resourceRes.ok) {
      const errData = await resourceRes.json().catch(() => ({}));
      return res.status(resourceRes.status).json(errData);
    }

    const resources = await resourceRes.json();

    if (!resources || resources.length === 0) {
      return res.json({ cloudId: null, projects: [] });
    }

    const cloudId = resources[0].id;
    const projectsRes = await fetch(
      `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/project?expand=issueTypes`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
        },
      },
    );

    if (!projectsRes.ok) {
      const errData = await projectsRes.json().catch(() => ({}));
      return res.status(projectsRes.status).json(errData);
    }

    const projects = await projectsRes.json();
    return res.json({ cloudId, projects });
  } catch (err) {
    console.error('Failed to fetch Jira projects:', err);
    return res.status(500).json({ error: 'Failed to fetch Jira projects' });
  }
});
