const { Router } = require('express');
const { resolvePermissionsToBitfield } = require('@fluxerjs/core');
const { makeRequireApiKey } = require('../middleware');
const { trackResource, actorFromReq } = require('../trackSettings');
const { sendManagePanel } = require('../../functions/managePanel');

function tempChannelsRouter(client, apiKey) {
  const router = Router({ mergeParams: true });
  const requireApiKey = makeRequireApiKey(apiKey);

  router.post('/setup', requireApiKey, async (req, res) => {
    try {
      const { guildId } = req.params;
      const {
        customCategoryId = null,
        manage = false,
        managevc = false,
        channelName = null,
        channelLimit = null,
        counting = false,
        reset = false,
      } = req.body || {};

      const liveGuild = client.guilds?.get(guildId);
      if (!liveGuild) return res.status(404).json({ error: 'Guild not found on bot' });

      const db = await client.database.getGuild(guildId, false);
      if (!db) return res.status(404).json({ error: 'Guild not found' });

      const previous = {
        parentChannel: db.parentChannel ?? null,
        childChannel: db.childChannel ?? null,
        config: db.config ?? null,
      };

      if (reset || db.parentChannel || db.childChannel) {
        await disableTempChannels(client, guildId, db);
      }

      let category = null;
      if (customCategoryId) {
        category = await client.channels.resolve(customCategoryId);
        if (!category || category.type !== 4) {
          return res.status(400).json({ error: 'Invalid category channel' });
        }
      } else {
        category = await liveGuild.createChannel({
          type: 4,
          name: client.translate.get(db.language, 'Commands.tempchannels.tempChannels'),
        });
      }

      const voiceChannel = await liveGuild.createChannel({
        type: 2,
        name: client.translate.get(db.language, 'Commands.tempchannels.joinCreate'),
        parentId: category.id,
        bitrate: 64000,
      });

      let manageChannelId = null;
      let manageMessageId = null;

      if (manage) {
        const manageChannel = await liveGuild.createChannel({
          type: 0,
          name: client.translate.get(db.language, 'Commands.tempchannels.manageCreate'),
          parentId: category.id,
        });

        try {
          const everyone = liveGuild.roles?.find?.((r) => r.name === '@everyone');
          if (everyone) {
            await manageChannel.permissionOverwrites.edit(everyone.id, {
              type: 0,
              deny: resolvePermissionsToBitfield(['SendMessages', 'AddReactions']),
            });
          }
        } catch {}

        const manageMsg = await sendManagePanel(client, manageChannel, db);

        manageChannelId = manageChannel.id;
        manageMessageId = manageMsg.id;
      }

      const newConfig = {
        ...(db.config ?? {}),
        ...(channelName ? { channelName: String(channelName).slice(0, 26) } : {}),
        ...(channelLimit != null
          ? { channelLimit: Math.min(99, Math.max(0, Number(channelLimit) || 0)) }
          : {}),
        counting: !!counting,
        customParent: customCategoryId || null,
        manage: manageChannelId,
        manageMessage: manageMessageId,
        managevc: !!managevc,
      };

      await client.database.updateGuild(
        guildId,
        {
          parentChannel: category.id,
          childChannel: voiceChannel.id,
          tempChannels: [],
          config: newConfig,
        },
        false
      );

      await trackResource(client, {
        userId: actorFromReq(req),
        groupId: guildId,
        category: 'tempchannels',
        key: 'tempchannels',
        action: previous.parentChannel ? 'update' : 'create',
        label: previous.parentChannel ? 'Temp Channels Reconfigured' : 'Temp Channels Setup',
        value: {
          parentChannel: category.id,
          childChannel: voiceChannel.id,
          config: newConfig,
        },
        previous,
      });

      return res.json({
        ok: true,
        parentChannel: category.id,
        childChannel: voiceChannel.id,
        config: newConfig,
      });
    } catch (err) {
      console.error('[API] POST tempchannels/setup:', err);
      return res.status(500).json({
        error: 'Failed to setup temp channels',
        detail: String(err?.message || err),
      });
    }
  });

  router.post('/reset', requireApiKey, async (req, res) => {
    try {
      const { guildId } = req.params;
      const db = await client.database.getGuild(guildId, false);
      if (!db) return res.status(404).json({ error: 'Guild not found' });

      const previous = {
        parentChannel: db.parentChannel ?? null,
        childChannel: db.childChannel ?? null,
        config: db.config ?? null,
      };

      await disableTempChannels(client, guildId, db);

      await trackResource(client, {
        userId: actorFromReq(req),
        groupId: guildId,
        category: 'tempchannels',
        key: 'tempchannels',
        action: 'delete',
        label: 'Temp Channels Reset',
        value: null,
        previous,
      });

      return res.json({ ok: true });
    } catch (err) {
      console.error('[API] POST tempchannels/reset:', err);
      return res.status(500).json({
        error: 'Failed to reset temp channels',
        detail: String(err?.message || err),
      });
    }
  });

  return router;
}

async function disableTempChannels(client, guildId, db) {
  if (Array.isArray(db.tempChannels)) {
    for (const entry of db.tempChannels) {
      const channelId = typeof entry === 'string' ? entry : entry?.channelId ?? entry?.id;
      if (!channelId) continue;
      try {
        const ch = await client.channels.resolve(channelId);
        if (ch) await ch.delete();
      } catch {}
    }
  }

  if (db.config?.manage) {
    try {
      const ch = await client.channels.resolve(db.config.manage);
      if (ch) await ch.delete();
    } catch {}
  }

  if (db.childChannel) {
    try {
      const ch = await client.channels.resolve(db.childChannel);
      if (ch) await ch.delete();
    } catch {}
  }

  if (db.parentChannel && !db.config?.customParent) {
    try {
      const ch = await client.channels.resolve(db.parentChannel);
      if (ch) await ch.delete();
    } catch {}
  }

  await client.database.updateGuild(
    guildId,
    {
      parentChannel: null,
      childChannel: null,
      tempChannels: [],
      config: {
        ...(db.config ?? {}),
        customParent: null,
        manage: null,
        manageMessage: null,
        managevc: false,
      },
    },
    false
  );
}

module.exports = tempChannelsRouter;