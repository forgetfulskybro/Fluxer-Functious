const { Router } = require('express');
const { makeRequireApiKey } = require('../middleware');

const FLUXER_API = 'https://api.fluxer.app/v1';

function oauthRouter(_client, apiKey) {
  const router = Router();
  const requireApiKey = makeRequireApiKey(apiKey);

  router.post('/exchange', requireApiKey, async (req, res) => {
    const { code } = req.body;
    if (!code || typeof code !== 'string') {
      return res.status(400).json({ error: 'Missing code' });
    }

    const redirectUri = process.env.FLUXER_REDIRECT_URI;

    try {
      const body = new FormData();
      body.set('grant_type', 'authorization_code');
      body.set('code', code);
      body.set('redirect_uri', redirectUri);
      body.set('client_id', process.env.FLUXER_CLIENT_ID);
      body.set('client_secret', process.env.FLUXER_CLIENT_SECRET);

      const tokenRes = await fetch(`${FLUXER_API}/oauth2/token`, {
        method: 'POST',
        headers: { Origin: 'https://api.fluxer.app' },
        body,
      });

      if (!tokenRes.ok) {
        const text = await tokenRes.text();
        console.error('[API] OAuth exchange failed:', tokenRes.status, text);
        return res.status(502).json({
          error: 'Token exchange failed',
          status: tokenRes.status,
          detail: text,
        });
      }

      const { access_token } = await tokenRes.json();

      const [userRes, guildsRes] = await Promise.all([
        fetch(`${FLUXER_API}/users/@me`, {
          headers: { Authorization: `Bearer ${access_token}` },
        }),
        
        fetch(`${FLUXER_API}/users/@me/guilds`, {
          headers: { Authorization: `Bearer ${access_token}` },
        }),
      ]);

      if (!userRes.ok) {
        return res.status(502).json({ error: 'Failed to fetch user' });
      }

      const user = await userRes.json();
      const guilds = guildsRes.ok ? await guildsRes.json() : [];

      return res.json({ accessToken: access_token, user, guilds });
    } catch (err) {
      console.error('[API] OAuth exchange error:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  });

  return router;
}

module.exports = oauthRouter;
