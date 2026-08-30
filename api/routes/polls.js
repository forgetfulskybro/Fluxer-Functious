const { Router } = require('express');
const { handleNew, handleDelete } = require('../../functions/checkPolls');
const { makeRequireApiKey } = require('../middleware');
const PollInstance = require('../../functions/poll');
const { EmbedBuilder } = require('@fluxerjs/core');
const dhms = require('../../functions/dhms');
const Polls = require('../../models/polls');
const { trackResource, actorFromReq } = require('../trackSettings');

function pollsRouter(client, apiKey) {
  const router = Router({ mergeParams: true });
  const requireApiKey = makeRequireApiKey(apiKey);

  router.get('/', requireApiKey, async (req, res) => {
    try {
      const { guildId } = req.params;
      const all = await client.database.getAllPolls();
      const list = all
        .filter((p) => p.serverId === guildId && !p.ended)
        .map((p) => ({
          id: p._id?.toString() || p.messageId,
          messageId: p.messageId,
          channelId: p.channelId,
          owner: p.owner,
          desc: p.desc,
          options: p.options,
          votes: p.votes,
          users: p.users,
          time: p.time,
          now: p.now,
          lang: p.lang,
          ended: !!p.ended,
        }));
      return res.json({ polls: list });
    } catch (err) {
      console.error('[API] GET polls:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  });

  router.post('/', requireApiKey, async (req, res) => {
    try {
      const { guildId } = req.params;
      const { channelId, question, duration, options: optionList, ownerId = null } = req.body || {};

      if (!channelId || !question || !duration || !Array.isArray(optionList) || optionList.length < 2) {
        return res.status(400).json({ error: 'channelId, question, duration, and at least 2 options are required' });
      }
      if (optionList.length > 10) {
        return res.status(400).json({ error: 'Maximum 10 options allowed' });
      }

      const liveGuild = client.guilds?.get(guildId);
      if (!liveGuild) return res.status(404).json({ error: 'Guild not found on bot' });

      const db = await client.database.getGuild(guildId, false);
      if (!db) return res.status(404).json({ error: 'Guild not found' });

      const activePollCount = (await client.database.getAllPolls()).filter(
        (p) => p.serverId === guildId && !p.ended
      ).length;
      if (activePollCount >= 5) {
        return res.status(400).json({ error: 'Too many active polls (max 5)' });
      }

      const durationMs = dhms(String(duration));
      if (!durationMs || durationMs <= 0) {
        return res.status(400).json({ error: 'Invalid duration format (use e.g. 30m, 2h, 1d)' });
      }
      if (durationMs < 30000) {
        return res.status(400).json({ error: 'Duration must be at least 30 seconds' });
      }
      if (durationMs > 2592000000) {
        return res.status(400).json({ error: 'Duration must be less than 30 days' });
      }

      const channel = await client.channels.resolve(channelId);
      if (!channel || channel.type === 2 || channel.type === 4) {
        return res.status(400).json({ error: 'Invalid text channel' });
      }

      const hostId = actorFromReq(req);
      const names = optionList.map(String).slice(0, 10);

      const emojiKeys = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
      const reactions = [
        ...names.map((_, i) => client.config.emojis[emojiKeys[i]]).filter(Boolean),
        client.config.emojis.stop,
      ];

      const msg = await channel.send({
        embeds: [
          new EmbedBuilder()
            .setDescription(`${client.translate.get(db.language, 'Commands.polls.loading')}...`)
            .setColor('#A52F05'),
        ],
      });

      for (const reaction of reactions) {
        await msg.react(reaction).catch(() => {});
      }

      const votesArray = names.map(() => 0);

      const pollData = await Polls.create({
        owner: hostId,
        serverId: guildId,
        channelId: channel.id,
        messageId: msg.id,
        desc: String(question).slice(0, 256),
        options: { name: names },
        votes: votesArray,
        users: [],
        avatars: [],
        time: durationMs,
        now: Date.now(),
        lang: db.language,
        ended: false,
      });

      const pollInstance = new PollInstance({
        time: durationMs,
        client,
        name: {
          name: client.translate.get(db.language, 'Commands.polls.polls'),
          description: String(question).slice(0, 256),
        },
        options: { name: names },
        votes: votesArray,
        users: [],
        avatars: [],
        owner: hostId,
        lang: db.language,
      });

      await pollInstance.update();

      client.polls.set(msg.id, {
        poll: pollInstance,
        messageId: msg.id,
        channelId: channel.id,
        serverId: guildId,
        owner: hostId,
      });

      try {
        const pollImage = await fetch(`${process.env.CDN}/api/upload`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            apikey: process.env.CDN_KEY,
            image: pollInstance.canvas.toDataURL('image/png'),
            timeframe: durationMs,
            messageId: msg.id,
          }),
        }).then((r) => r.json());

        await msg
          .edit({
            embeds: [
              new EmbedBuilder()
                .setDescription(
                  `${client.translate.get(db.language, 'Commands.giveaway.time')}: <t:${Math.floor((durationMs + Date.now()) / 1000)}:R>`
                )
                .setImage(`${process.env.CDN}${pollImage.url}`)
                .setColor('#A52F05'),
            ],
          })
          .catch(() => {});
      } catch {}

      handleNew(pollData);

      await trackResource(client, {
        userId: hostId,
        groupId: guildId,
        category: 'polls',
        key: 'poll',
        action: 'create',
        label: 'Poll',
        value: {
          messageId: msg.id,
          channelId: channel.id,
          question: pollData.desc,
          options: names,
          durationMs,
        },
        previous: null,
      });

      return res.status(201).json({
        ok: true,
        poll: {
          id: pollData._id?.toString() || msg.id,
          messageId: msg.id,
          channelId: channel.id,
          owner: hostId,
          desc: pollData.desc,
          options: pollData.options,
          votes: votesArray,
          users: [],
          time: durationMs,
          now: pollData.now,
          lang: db.language,
          ended: false,
        },
      });
    } catch (err) {
      console.error('[API] POST polls:', err);
      return res.status(500).json({ error: 'Failed to create poll', detail: String(err?.message || err) });
    }
  });

  router.delete('/:messageId', requireApiKey, async (req, res) => {
    try {
      const { guildId, messageId } = req.params;

      const poll = await Polls.findOne({ messageId, serverId: guildId });
      if (!poll) return res.status(404).json({ error: 'Poll not found' });

      handleDelete(messageId);
      await Polls.findOneAndUpdate({ messageId }, { ended: true });

      try {
        const ch = await client.channels.resolve(poll.channelId);
        const msg = await ch?.messages?.fetch(poll.messageId).catch(() => null);
        if (msg) {
          await msg.removeAllReactions().catch(() => {});
          await msg.delete().catch(() => {});
        }
      } catch {}

      client.polls.delete(messageId);

      await trackResource(client, {
        userId: actorFromReq(req),
        groupId: guildId,
        category: 'polls',
        key: 'poll',
        action: 'delete',
        label: 'Poll',
        value: null,
        previous: {
          messageId: poll.messageId,
          channelId: poll.channelId,
          question: poll.desc,
        },
      });

      return res.json({ ok: true });
    } catch (err) {
      console.error('[API] DELETE poll:', err);
      return res.status(500).json({ error: 'Failed to delete poll' });
    }
  });

  return router;
}

module.exports = pollsRouter;