const { Router } = require('express');
const { makeRequireApiKey } = require('../middleware');
const { getChannelProfiles } = require('../../functions/channelProfiles');

const MAX_BATCH_IDS = 100;

function channelsRouter(client, apiKey) {
  const router = Router();
  const requireApiKey = makeRequireApiKey(apiKey);

  router.post('/profiles', requireApiKey, async (req, res) => {
    try {
      const ids = Array.isArray(req.body?.ids)
        ? [...new Set(req.body.ids.map(String))]
        : [];
      const validIds = ids
        .filter((id) => /^\d{17,20}$/.test(id))
        .slice(0, MAX_BATCH_IDS);
      const profiles = await getChannelProfiles(client, validIds);
      return res.json({ channels: profiles });
    } catch (err) {
      console.error('[API] POST /api/channels/profiles:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  });

  return router;
}

module.exports = channelsRouter;