const { Router } = require('express');
const { handleNew, handleDelete } = require('../../functions/checkGiveaways');
const { EmbedBuilder, PermissionFlags } = require('@fluxerjs/core');
const { makeRequireApiKey } = require('../middleware');
const Giveaways = require('../../models/giveaways');
const dhms = require('../../functions/dhms');
const { trackResource, actorFromReq } = require('../trackSettings');

function giveawaysRouter(client, apiKey) {
  const router = Router({ mergeParams: true });
  const requireApiKey = makeRequireApiKey(apiKey);

  router.get('/', requireApiKey, async (req, res) => {
    try {
      const { guildId } = req.params;
      const all = await client.database.getAllGiveaways();
      const list = all
        .filter((g) => g.serverId === guildId && !g.ended)
        .map((g) => ({
          id: g._id?.toString() || g.messageId,
          messageId: g.messageId,
          channelId: g.channelId,
          owner: g.owner,
          prize: g.prize,
          winners: g.winners,
          pickedWinners: g.pickedWinners || [],
          users: g.users || [],
          time: g.time,
          now: g.now,
          endDate: g.endDate,
          requirement: g.requirement,
          dmWinners: g.dmWinners,
          pingWinners: g.pingWinners,
          allowMultipleWins: g.allowMultipleWins,
          imageUrl: g.imageUrl,
          bonusEntries: g.bonusEntries,
          lang: g.lang,
          ended: !!g.ended,
        }));
      return res.json({ giveaways: list });
    } catch (err) {
      console.error('[API] GET giveaways:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  });

  router.post('/', requireApiKey, async (req, res) => {
    try {
      const { guildId } = req.params;
      const {
        channelId,
        prize,
        winners = 1,
        duration,
        requirement = null,
        ownerId = null,
        dmWinners = false,
        pingWinners = true,
        allowMultipleWins = false,
        imageUrl = null,
        bonusEntries = [],
      } = req.body || {};

      if (!channelId || !prize || !duration) {
        return res.status(400).json({ error: 'channelId, prize, and duration are required' });
      }

      const winnersNum = Math.min(50, Math.max(1, Number(winners) || 1));
      const prizeText = String(prize).slice(0, 500);
      const reqText = requirement ? String(requirement).slice(0, 500) : null;
      const imageText = imageUrl && /^https?:\/\/.+/i.test(String(imageUrl)) ? String(imageUrl) : null;

      const bonusEntriesClean = Array.isArray(bonusEntries)
        ? bonusEntries
            .filter((b) => b && typeof b.roleId === 'string' && Number(b.entries) >= 1)
            .slice(0, 20)
            .map((b) => ({ roleId: String(b.roleId), entries: Math.min(100, Math.max(1, Number(b.entries))) }))
        : [];

      const liveGuild = client.guilds?.get(guildId);
      if (!liveGuild) return res.status(404).json({ error: 'Guild not found on bot' });

      const db = await client.database.getGuild(guildId, false);
      if (!db) return res.status(404).json({ error: 'Guild not found' });

      const active = (await client.database.getAllGiveaways()).filter(
        (g) => g.serverId === guildId && !g.ended
      );

      if (active.length >= 15) {
        return res.status(400).json({ error: 'Too many active giveaways (max 15)' });
      }

      const durationMs = dhms(String(duration));
      if (!durationMs || durationMs <= 0 || !isNaN(Number(duration))) {
        return res.status(400).json({ error: 'Invalid duration format (use e.g. 30m, 2h, 1d)' });
      }
      if (durationMs < 120000) {
        return res.status(400).json({ error: 'Duration must be at least 2 minutes' });
      }
      if (durationMs > 31556952000) {
        return res.status(400).json({ error: 'Duration must be less than ~1 year' });
      }

      const channel = await client.channels.resolve(channelId);
      if (!channel || channel.type === 2 || channel.type === 4) {
        return res.status(400).json({ error: 'Invalid text channel' });
      }

      const me =
        liveGuild.members?.me ??
        (liveGuild.members?.fetchMe ? await liveGuild.members.fetchMe() : null);

      try {
        const chanPerms = me?.permissionsIn?.(channel);
        if (chanPerms) {
          if (!chanPerms.has(PermissionFlags.SendMessages)) {
            return res.status(403).json({ error: 'Bot cannot send messages in that channel' });
          }
          if (!chanPerms.has(PermissionFlags.ViewChannel)) {
            return res.status(403).json({ error: 'Bot cannot view that channel' });
          }
          if (!chanPerms.has(PermissionFlags.AddReactions)) {
            return res.status(403).json({ error: 'Bot cannot add reactions in that channel' });
          }
        }
      } catch {}

      const endTs = Math.floor((durationMs + Date.now()) / 1000);
      const hostId = ownerId || client.user?.id;

      const embed = new EmbedBuilder()
        .setColor('#A52F05')
        .setTitle(prizeText)
        .setDescription(
          `${client.translate.get(db.language, 'Commands.giveaway.time')}: <t:${endTs}:R>\n` +
            `${client.translate.get(db.language, 'Commands.giveaway.hosted')}: <@${hostId}>\n` +
            `${client.translate.get(db.language, 'Commands.giveaway.winners')}: ${winnersNum}` +
            (reqText
              ? `\n\n${client.translate.get(db.language, 'Commands.giveaway.reqs')}:\n${reqText.slice(0, 700)}`
              : '')
        )
        .setFooter({
          text: `${client.translate.get(db.language, 'Commands.giveaway.react')} ${client.config.emojis.confetti} ${client.translate.get(db.language, 'Commands.giveaway.react2')}`,
        });

      if (imageText) embed.setImage(imageText);

      const msg = await channel.send({ embeds: [embed] });
      const reactions = [client.config.emojis.confetti, client.config.emojis.stop];
      for (const reaction of reactions) {
        await msg.react(reaction).catch(() => {});
      }

      const giveawayData = await Giveaways.create({
        owner: hostId,
        serverId: guildId,
        channelId: channel.id,
        messageId: msg.id,
        time: durationMs,
        now: Date.now(),
        prize: prizeText,
        winners: winnersNum,
        lang: db.language,
        requirement: reqText,
        dmWinners: !!dmWinners,
        pingWinners: pingWinners !== false,
        allowMultipleWins: !!allowMultipleWins,
        imageUrl: imageText,
        bonusEntries: bonusEntriesClean,
      });

      handleNew(giveawayData);

      await trackResource(client, {
        userId: actorFromReq(req) || hostId,
        groupId: guildId,
        category: 'giveaways',
        key: 'giveaway',
        action: 'create',
        label: 'Giveaway',
        value: {
          messageId: msg.id,
          channelId: channel.id,
          prize: prizeText,
          winners: winnersNum,
          durationMs,
          requirement: reqText,
        },
        previous: null,
      });

      return res.status(201).json({
        ok: true,
        giveaway: {
          id: giveawayData._id?.toString() || msg.id,
          messageId: msg.id,
          channelId: channel.id,
          owner: hostId,
          prize: prizeText,
          winners: winnersNum,
          users: [],
          pickedWinners: [],
          time: durationMs,
          now: Date.now(),
          requirement: reqText,
          lang: db.language,
          ended: false,
          dmWinners: !!dmWinners,
          pingWinners: pingWinners !== false,
          allowMultipleWins: !!allowMultipleWins,
          imageUrl: imageText,
          bonusEntries: bonusEntriesClean,
        },
      });
    } catch (err) {
      console.error('[API] POST giveaways:', err);
      return res.status(500).json({ error: 'Failed to create giveaway', detail: String(err?.message || err) });
    }
  });

  router.delete('/:messageId', requireApiKey, async (req, res) => {
    try {
      const { guildId, messageId } = req.params;
      const check = await Giveaways.findOne({ messageId, serverId: guildId });
      if (!check) return res.status(404).json({ error: 'Giveaway not found' });

      await Giveaways.findOneAndUpdate({ messageId }, { ended: true });
      handleDelete(messageId);

      try {
        const ch = await client.channels.resolve(check.channelId);
        const msg = await ch?.messages?.fetch(check.messageId).catch(() => null);
        await msg?.delete().catch(() => {});
      } catch {}

      await trackResource(client, {
        userId: actorFromReq(req),
        groupId: guildId,
        category: 'giveaways',
        key: 'giveaway',
        action: 'delete',
        label: 'Giveaway',
        value: null,
        previous: {
          messageId: check.messageId,
          channelId: check.channelId,
          prize: check.prize,
          winners: check.winners,
        },
      });

      return res.json({ ok: true });
    } catch (err) {
      console.error('[API] DELETE giveaway:', err);
      return res.status(500).json({ error: 'Failed to delete giveaway' });
    }
  });

  router.post('/:messageId/end', requireApiKey, async (req, res) => {
    try {
      const { guildId, messageId } = req.params;
      const check = await Giveaways.findOne({ messageId, serverId: guildId });
      if (!check) return res.status(404).json({ error: 'Giveaway not found' });
      if (check.ended) return res.json({ ok: true, alreadyEnded: true });

      await Giveaways.findOneAndUpdate({ messageId }, { ended: true });
      handleDelete(messageId);

      await trackResource(client, {
        userId: actorFromReq(req),
        groupId: guildId,
        category: 'giveaways',
        key: 'giveaway',
        action: 'update',
        label: 'Giveaway Ended',
        value: { messageId, ended: true },
        previous: { messageId, ended: false, prize: check.prize },
      });

      return res.json({ ok: true });
    } catch (err) {
      console.error('[API] POST end giveaway:', err);
      return res.status(500).json({ error: 'Failed to end giveaway' });
    }
  });

  return router;
}

module.exports = giveawaysRouter;