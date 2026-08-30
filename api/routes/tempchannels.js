const { Router } = require('express');
const { EmbedBuilder, resolvePermissionsToBitfield } = require('@fluxerjs/core');
const { makeRequireApiKey } = require('../middleware');
const { trackResource, actorFromReq } = require('../trackSettings');

function tempChannelsRouter(client, apiKey) {
  const router = Router({ mergeParams: true });
  const requireApiKey = makeRequireApiKey(apiKey);

  router.post('/setup', requireApiKey, async (req, res) => {
    try {
      const { guildId } = req.params;
      const {
        customCategoryId = null,
        manage = false,
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
      let voiceChannel = null;
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

        voiceChannel = await liveGuild.createChannel({
          type: 2,
          name: client.translate.get(db.language, 'Commands.tempchannels.joinCreate'),
          parent_id: category.id,
          bitrate: 64000,
        });
      }

      let manageChannelId = null;
      let manageMessageId = null;

      if (manage) {
        const manageChannel = await liveGuild.createChannel({
          type: 0,
          name: client.translate.get(db.language, 'Commands.tempchannels.manageCreate'),
          parent_id: category.id,
        });

        try {
          const everyone = liveGuild.roles?.find?.((r) => r.name === '@everyone');
          if (everyone) {
            await manageChannel.editPermission(everyone.id, {
              type: 0,
              deny: resolvePermissionsToBitfield(['SendMessages', 'AddReactions']),
            });
          }
        } catch {}

        const CDNLang = {
          en_EN: 'https://functious-cdn.vercel.app/api/images/ef27463013d7f69f67a0f3eb38129717.png',
          es_ES: 'https://functious-cdn.vercel.app/api/images/9e51affa3d366da1cb46aba84246d712.png',
          pt_BR: 'https://functious-cdn.vercel.app/api/images/bf709079782d5097798381835cf1e69b.png',
          ar_AR: 'https://functious-cdn.vercel.app/api/images/2791aacd0a1aef7ae25e124759f601a7.png',
        };

        const manageEmbed = new EmbedBuilder()
          .setColor('#A52F05')
          .setTitle(client.translate.get(db.language, 'Commands.tempchannels.manageTitle'))
          .setImage(CDNLang[db.language] ?? CDNLang.en_EN)
          .setFooter({ text: client.translate.get(db.language, 'Commands.tempchannels.manageFooter') });

        const manageMsg = await manageChannel.send({ embeds: [manageEmbed] });

        const manageReactions = [
          '<:rename:1502164676598628060>',
          '<:userlimit:1502164677802393309>',
          '<:region:1502164672647593687>',
          '<:privacy:1502164674153348824>',
          '<:unblock:1502164681409494751>',
          '<:block:1502164675642326745>',
          '<:transfer:1502164678616088286>',
          '<:close:1502185371235901763>',
        ];

        for (const reaction of manageReactions) {
          await manageMsg.react(reaction).catch(() => {});
        }

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
      },
    },
    false
  );
}

module.exports = tempChannelsRouter;