import { Router } from 'express';

export const slackRouter = Router();

export const slackApiContribution = {
  id: 'slack',
  mountPath: '/api/slack',
  router: slackRouter,
};

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

      return res.json({
        access_token: data.access_token,
        token_type: data.token_type,
        team: data.team,
        bot_user_id: data.bot_user_id,
      });
    } catch {
      console.error(
        'Token exchange failed. Slack returned non-JSON:',
        text,
      );
      return res
        .status(500)
        .json({ error: 'Failed to exchange token', details: text });
    }
  } catch (err) {
    console.error('Slack token exchange error:', err);
    return res.status(500).json({ error: 'Failed to exchange token' });
  }
});

slackRouter.get('/channels', async (req, res) => {
  const token = req.headers['x-slack-auth'];

  if (!token || typeof token !== 'string') {
    return res.status(401).json({ error: 'Missing x-slack-auth header' });
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
