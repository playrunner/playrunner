import { Router } from 'express';

export const githubRouter = Router();

// Proxy endpoint to exchange GitHub OAuth code for an access token to bypass CORS
githubRouter.post('/token', async (req, res) => {
  const { code, client_id, client_secret } = req.body;

  try {
    const gRes = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'User-Agent': 'Playrunner-App',
      },
      body: JSON.stringify({
        client_id,
        client_secret,
        code,
      }),
    });

    const text = await gRes.text();
    try {
      const data = JSON.parse(text);
      res.json(data);
    } catch {
      console.error('Token exchange failed. GitHub returned non-JSON:', text);
      res
        .status(500)
        .json({ error: 'Failed to exchange token', details: text });
    }
  } catch (err) {
    console.error('Token exchange error:', err);
    res.status(500).json({ error: 'Failed to exchange token' });
  }
});

// Proxy endpoint to refresh GitHub OAuth token
githubRouter.post('/refresh', async (req, res) => {
  const { refresh_token, client_id, client_secret } = req.body;

  try {
    const gRes = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'User-Agent': 'Playrunner-App',
      },
      body: JSON.stringify({
        client_id,
        client_secret,
        refresh_token,
        grant_type: 'refresh_token',
      }),
    });

    const text = await gRes.text();
    try {
      const data = JSON.parse(text);
      res.json(data);
    } catch {
      console.error('Token refresh failed. GitHub returned non-JSON:', text);
      res.status(500).json({ error: 'Failed to refresh token', details: text });
    }
  } catch (err) {
    console.error('Token refresh error:', err);
    res.status(500).json({ error: 'Failed to refresh token' });
  }
});
