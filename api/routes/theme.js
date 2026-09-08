const { Router } = require('express');
const { makeRequireApiKey } = require('../middleware');
const { recolorAvatar, recolorBanner } = require("../../functions/avatarCanvas");
const path = require('path');
const fs = require('fs');
const { normalizeColor, hexToArgb } = require('../../functions/color');
const { trackGuildUpdates } = require('../../api/trackSettings');

function themeRouter(client, apiKey) {
  const router = Router({ mergeParams: true });
  const requireApiKey = makeRequireApiKey(apiKey);

  router.post('/', requireApiKey, async (req, res) => {
    try {
      const { guildId } = req.params;
      const { color, userId } = req.body;

      if (!color) return res.status(400).json({ error: 'color is required' });

      let hex = color.toLowerCase() === 'default' ? '#A52F05' : normalizeColor(color);
      if (!hex) return res.status(400).json({ error: 'Invalid color' });

      const guild = client.guilds.get(guildId);
      if (!guild) return res.status(404).json({ error: 'Guild not found / bot not present' });

      const normalizedHex =
        hex.length === 9 ? `#${hex.slice(1, 7).toUpperCase()}` : hex.toUpperCase();

      const isDefault = normalizedHex === '#A52F05';

      let avatarBuffer, bannerBuffer;
      if (isDefault) {
        avatarBuffer = fs.readFileSync(path.join(__dirname, '../../assets/theme-default.png'));
        bannerBuffer = fs.readFileSync(path.join(__dirname, '../../assets/theme-banner.png'));
      } else {
        avatarBuffer = await recolorAvatar(
          path.join(__dirname, '../../assets/theme-grayscale.png'),
          normalizedHex
        );
        bannerBuffer = await recolorBanner(
          path.join(__dirname, '../../assets/theme-banner-grayscale.png'),
          normalizedHex
        );
      }

      await guild.members.me.edit({
        avatar: `data:image/png;base64,${avatarBuffer.toString('base64')}`,
        banner: `data:image/png;base64,${bannerBuffer.toString('base64')}`,
        accentColor: hexToArgb(normalizedHex),
      });

      const existing = await client.database.getGuild(guildId);
      await client.database.updateGuild(guildId, { theme: normalizedHex });

      if (userId) {
        await trackGuildUpdates(client, {
          guildId,
          userId,
          existing,
          updates: { theme: normalizedHex },
        });
      }

      return res.json({ ok: true, theme: normalizedHex });
    } catch (err) {
      console.log(err)
      console.error('[API] POST /theme:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  });

  return router;
}

module.exports = themeRouter;