import { Router } from 'express';
import type { IntegrationCredentialStore } from '@playrunner/integration-sdk/api';

function credentialStore(req: unknown): IntegrationCredentialStore | undefined {
  return (req as { integrationCredentials?: IntegrationCredentialStore })
    .integrationCredentials;
}

export const slackRouter = Router();

export const slackApiContribution = {
  id: 'slack',
  mountPath: '/api/slack',
  router: slackRouter,
};

export default slackApiContribution;

slackRouter.post('/oauth-token', async (req, res) => {
  const { code, client_id, client_secret, redirect_uri } = req.body;

  try {
    const params = new URLSearchParams({
      code,
      client_id,
      client_secret,
      redirect_uri,
    });

    const slackRes = await fetch('https://slack.com/api/oauth.v2.access', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });

    const text = await slackRes.text();

    try {
      const data = JSON.parse(text);

      if (!data.ok) {
        console.error('Slack OAuth token exchange failed:', data.error);
        return res.status(400).json({ error: data.error });
      }

      const store = credentialStore(req);
      if (!store) {
        return res
          .status(500)
          .json({ error: 'Credential storage is unavailable.' });
      }
      await store.save('integration', 'slack', {
        provider: 'slack',
        config: {
          authMode: 'oauth',
          teamId: data.team?.id,
          teamName: data.team?.name,
          botUserId: data.bot_user_id,
        },
        secrets: {
          clientId: client_id,
          clientSecret: client_secret,
          accessToken: data.access_token,
        },
      });
      return res.json({ connected: true });
    } catch {
      console.error('Token exchange failed. Slack returned non-JSON.');
      return res.status(500).json({ error: 'Failed to exchange token' });
    }
  } catch (err) {
    console.error('Slack token exchange error:', err);
    return res.status(500).json({ error: 'Failed to exchange token' });
  }
});

slackRouter.get('/channels', async (req, res) => {
  const connection = await credentialStore(req)?.resolve(
    'integration',
    'slack',
  );
  const token = connection?.secrets.accessToken;

  if (typeof token !== 'string' || !token) {
    return res.status(401).json({ error: 'Slack is not connected.' });
  }

  try {
    const channelsRes = await fetch(
      'https://slack.com/api/conversations.list?types=public_channel,private_channel&exclude_archived=true&limit=200',
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
        },
      },
    );

    const data = await channelsRes.json();

    if (!data.ok) {
      console.error('Failed to fetch Slack channels:', data.error);
      return res.status(400).json({ error: data.error });
    }

    const channels = (data.channels || []).map(
      (ch: { id: string; name: string; is_private: boolean }) => ({
        id: ch.id,
        name: ch.name,
        is_private: ch.is_private,
      }),
    );

    return res.json({ channels });
  } catch (err) {
    console.error('Failed to fetch Slack channels:', err);
    return res.status(500).json({ error: 'Failed to fetch Slack channels' });
  }
});
