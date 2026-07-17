import { Router } from 'express';

export const gcpRouter = Router();

export const gcpApiContribution = {
  id: 'gcp',
  mountPath: '/api/gcp',
  router: gcpRouter,
};

export default gcpApiContribution;

gcpRouter.post('/token', async (req, res) => {
  const { code, client_id, client_secret, redirect_uri } = req.body;

  try {
    const gRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        client_id,
        client_secret,
        code,
        grant_type: 'authorization_code',
        redirect_uri,
      }),
    });

    const text = await gRes.text();
    try {
      const data = JSON.parse(text);
      if (!gRes.ok) {
        console.error('GCP Token exchange failed:', data);
        return res.status(gRes.status).json(data);
      }
      res.json(data);
    } catch {
      console.error('Token exchange failed. GCP returned non-JSON:', text);
      res
        .status(500)
        .json({ error: 'Failed to exchange token', details: text });
    }
  } catch (err) {
    console.error('Token exchange error:', err);
    res.status(500).json({ error: 'Failed to exchange token' });
  }
});

gcpRouter.post('/refresh', async (req, res) => {
  const { refresh_token, client_id, client_secret } = req.body;

  try {
    const gRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
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
      if (!gRes.ok) {
        console.error('GCP Token refresh failed:', data);
        return res.status(gRes.status).json(data);
      }
      res.json(data);
    } catch {
      console.error('Token refresh failed. GCP returned non-JSON:', text);
      res.status(500).json({ error: 'Failed to refresh token', details: text });
    }
  } catch (err) {
    console.error('Token refresh error:', err);
    res.status(500).json({ error: 'Failed to refresh token' });
  }
});
