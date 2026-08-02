const express = require('express');
const cors = require('cors');
const { WebSocketServer } = require('ws');
const http = require('http');

const FLUXER_API = 'https://api.fluxer.app/v1';

function createApiServer(client) {
const app = express();

  app.use((req, res, next) => {
    console.log(`[API DEBUG] ${req.method} ${req.url} - headers:`, JSON.stringify(req.headers));
    next();
  });

  const port = process.env.API_PORT || 4000;
  const apiKey = process.env.API_KEY;
  const allowedOrigin = process.env.WEBSITE_URL || 'http://localhost:3000';

  app.use(express.json());
  app.use(cors({
    origin: allowedOrigin,
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
  }));

  function requireApiKey(req, res, next) {
    if (!apiKey) {
      return res.status(500).json({ error: 'API_KEY not configured on bot server' });
    }
    if (req.headers['x-api-key'] !== apiKey) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
  }

  app.post('/api/oauth/exchange', requireApiKey, async (req, res) => {
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
        headers: { 'Origin': 'https://api.fluxer.app' },
        body,
      });

      if (!tokenRes.ok) {
        const body = await tokenRes.text();
        console.error('[API] OAuth exchange failed:', tokenRes.status, body);
        return res.status(502).json({ error: 'Token exchange failed', detail: body });
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

  app.get('/health', (_req, res) => {
    res.json(getBotStatus());
  });

  app.post('/api/guilds/filter', requireApiKey, async (req, res) => {
    try {
      const { guildIds } = req.body;
      if (!Array.isArray(guildIds)) {
        return res.status(400).json({ error: 'guildIds must be an array' });
      }
      const botGuildIds = new Set(
        client.guilds?.keys ? [...client.guilds.keys()] : []
      );
      const present = guildIds.filter(id => botGuildIds.has(id));
      return res.json({ present });
    } catch (err) {
      console.error('[API] /api/guilds/filter:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.get('/api/guilds/:guildId', requireApiKey, async (req, res) => {
    try {
      const { guildId } = req.params;

      const guild = await client.database.getGuild(guildId, false);
      if (!guild) return res.status(404).json({ error: 'Guild not found' });

      const liveGuild = client.guilds?.get(guildId);

      let rolesList = [];
      try {
        const fetched = await liveGuild?.fetchRoles?.();
        if (fetched?.values) rolesList = [...fetched.values()];
        else if (Array.isArray(fetched)) rolesList = fetched;
        else if (liveGuild?.roles?.values) rolesList = [...liveGuild.roles.values()];
        else if (liveGuild?.roles) rolesList = [...liveGuild.roles];
      } catch {
        rolesList = [];
      }

      let channelsList = [];
      try {
        const fetched = await liveGuild?.fetchChannels?.();
        if (fetched?.values) channelsList = [...fetched.values()];
        else if (Array.isArray(fetched)) channelsList = fetched;
        else if (liveGuild?.channels?.values) channelsList = [...liveGuild.channels.values()];
        else if (liveGuild?.channels) channelsList = [...liveGuild.channels];
      } catch {
        channelsList = [];
      }

      const guildChannels = channelsList
        .map((c) => ({
          id: String(c.id ?? ''),
          name: String(c.name ?? 'unknown'),
          type: Number(c.type ?? 0),
        }))
        .filter((r) => r && r.id)
        .filter((r) => r.type === 0 || r.type === 2 || r.type === 4);

      const guildRoles = rolesList
        .map((entry) => {
          const role = Array.isArray(entry) ? entry[1] : entry;
          if (!role) return null;
          return {
            id: String(role.id ?? ''),
            name: String(role.name ?? 'unknown'),
            color: Number(role.color ?? 0),
            position: Number(role.position ?? 0),
            permissions: String(role._permissions ?? role.permissions ?? ''),
          };
        })
        .filter((r) => r && r.id);

      const allPolls = await client.database.getAllPolls();
      const activePolls = allPolls
        .filter(p => p.serverId === guildId && !p.ended)
        .map(p => ({
          id: p._id?.toString() || p.messageId,
          messageId: p.messageId,
          channelId: p.channelId,
          owner: p.owner,
          desc: p.desc,
          options: p.options,
          votes: p.votes,
          users: p.users,
          avatars: p.avatars,
          time: p.time,
          now: p.now,
          lang: p.lang,
          ended: p.ended,
        }));

      const allGiveaways = await client.database.getAllGiveaways();
      const activeGiveaways = allGiveaways
        .filter(g => g.serverId === guildId && !g.ended)
        .map(g => ({
          id: g._id?.toString() || g.messageId,
          messageId: g.messageId,
          channelId: g.channelId,
          owner: g.owner,
          prize: g.prize,
          winners: g.winners,
          pickedWinners: g.pickedWinners,
          users: g.users,
          time: g.time,
          now: g.now,
          endDate: g.endDate,
          requirement: g.requirement,
          lang: g.lang,
          ended: g.ended,
        }));

      return res.json({
        id: guild.id,
        name: liveGuild?.name ?? null,
        icon: liveGuild?.icon ?? null,
        guildRoles,
        guildChannels,
        prefix: guild.prefix,
        language: guild.language,
        dm: guild.dm,
        timezoneConvert: guild.timezoneConvert,
        stickyRolesEnabled: guild.stickyRolesEnabled,
        roles: guild.roles,
        joinRoles: guild.joinRoles,
        stickyRoles: guild.stickyRoles,
        bypassRoles: guild.bypassRoles,
        timedRoles: guild.timedRoles,
        tags: guild.tags,
        scheduledMessages: guild.scheduledMessages,
        userTimezones: guild.userTimezones,
        parentChannel: guild.parentChannel,
        childChannel: guild.childChannel,
        tempChannels: guild.tempChannels,
        config: guild.config,
        activePolls,
        activeGiveaways,
      });
    } catch (err) {
      console.error('[API] GET /api/guilds/:guildId:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.patch('/api/guilds/:guildId', requireApiKey, async (req, res) => {
    try {
      const { guildId } = req.params;

      const ALLOWED_FIELDS = [
        'prefix', 'language', 'dm', 'timezoneConvert',
        'stickyRolesEnabled', 'joinRoles', 'bypassRoles', 'config',
        'parentChannel', 'childChannel', 'tempChannels', 'scheduledMessages',
        'tags'
      ];

      const updates = {};
      for (const field of ALLOWED_FIELDS) {
        if (field in req.body) updates[field] = req.body[field];
      }

      if (Object.keys(updates).length === 0) {
        return res.status(400).json({ error: 'No valid fields to update' });
      }

      const existing = await client.database.getGuild(guildId, false);
      if (!existing) return res.status(404).json({ error: 'Guild not found' });

      await client.database.updateGuild(guildId, updates, false);
      return res.json({ ok: true });
    } catch (err) {
      console.error('[API] PATCH /api/guilds/:guildId:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.get('/api/guilds/:guildId/polls', requireApiKey, async (req, res) => {
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

  app.post('/api/guilds/:guildId/polls', requireApiKey, async (req, res) => {
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

      const dhms = require('../functions/dhms');
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

      const { EmbedBuilder } = require('@fluxerjs/core');
      const hostId = ownerId || client.user?.id;
      const names = optionList.map(String).slice(0, 10);

      const emojiKeys = ['one','two','three','four','five','six','seven','eight','nine','ten'];
      const reactions = [
        ...names.map((_, i) => client.config.emojis[emojiKeys[i]]).filter(Boolean),
        client.config.emojis.stop,
      ];

      const msg = await channel.send({
        embeds: [new EmbedBuilder().setDescription(`${client.translate.get(db.language, 'Commands.polls.loading')}...`).setColor('#A52F05')],
      });

      for (const reaction of reactions) {
        await msg.react(reaction).catch(() => {});
      }

      const votesArray = names.map(() => 0);

      const Polls = require('../models/polls');
      const { handleNew } = require('../functions/checkPolls');

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

      const PollInstance = require('../functions/poll');
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
        }).then(r => r.json());

        await msg.edit({
          embeds: [
            new EmbedBuilder()
              .setDescription(
                `${client.translate.get(db.language, 'Commands.giveaway.time')}: <t:${Math.floor((durationMs + Date.now()) / 1000)}:R>`
              )
              .setImage(`${process.env.CDN}${pollImage.url}`)
              .setColor('#A52F05'),
          ],
        }).catch(() => {});
      } catch {
      }

      handleNew(pollData);

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

  app.delete('/api/guilds/:guildId/polls/:messageId', requireApiKey, async (req, res) => {
    try {
      const { guildId, messageId } = req.params;
      const Polls = require('../models/polls');
      const { handleDelete } = require('../functions/checkPolls');

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

      return res.json({ ok: true });
    } catch (err) {
      console.error('[API] DELETE poll:', err);
      return res.status(500).json({ error: 'Failed to delete poll' });
    }
  });

  app.get('/api/guilds/:guildId/giveaways', requireApiKey, async (req, res) => {
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
          lang: g.lang,
          ended: !!g.ended,
        }));
      return res.json({ giveaways: list });
    } catch (err) {
      console.error('[API] GET giveaways:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.post('/api/guilds/:guildId/giveaways', requireApiKey, async (req, res) => {
    try {
      const { guildId } = req.params;
      const {
        channelId,
        prize,
        winners = 1,
        duration,
        requirement = null,
        ownerId = null,
      } = req.body || {};

      if (!channelId || !prize || !duration) {
        return res.status(400).json({ error: 'channelId, prize, and duration are required' });
      }

      const winnersNum = Math.min(50, Math.max(1, Number(winners) || 1));
      const prizeText = String(prize).slice(0, 500);
      const reqText = requirement ? String(requirement).slice(0, 500) : null;

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

      const dhms = require('../functions/dhms');
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

      const { EmbedBuilder, PermissionFlags } = require('@fluxerjs/core');
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
      } catch { }

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

      const msg = await channel.send({ embeds: [embed] });
      const reactions = [client.config.emojis.confetti, client.config.emojis.stop];
      for (const reaction of reactions) {
        await msg.react(reaction).catch(() => {});
      }

      const Giveaways = require('../models/giveaways');
      const { handleNew } = require('../functions/checkGiveaways');

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
      });

      handleNew(giveawayData);

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
        },
      });
    } catch (err) {
      console.error('[API] POST giveaways:', err);
      return res.status(500).json({
        error: 'Failed to create giveaway',
        detail: String(err?.message || err),
      });
    }
  });

  app.delete('/api/guilds/:guildId/giveaways/:messageId', requireApiKey, async (req, res) => {
    try {
      const { guildId, messageId } = req.params;
      const Giveaways = require('../models/giveaways');
      const { handleDelete } = require('../functions/checkGiveaways');

      const check = await Giveaways.findOne({ messageId, serverId: guildId });
      if (!check) return res.status(404).json({ error: 'Giveaway not found' });

      await Giveaways.findOneAndUpdate({ messageId }, { ended: true });
      handleDelete(messageId);

      try {
        const ch = await client.channels.resolve(check.channelId);
        const msg = await ch?.messages?.fetch(check.messageId).catch(() => null);
        await msg?.delete().catch(() => {});
      } catch { }

      return res.json({ ok: true });
    } catch (err) {
      console.error('[API] DELETE giveaway:', err);
      return res.status(500).json({ error: 'Failed to delete giveaway' });
    }
  });

  app.post('/api/guilds/:guildId/giveaways/:messageId/end', requireApiKey, async (req, res) => {
    try {
      const { guildId, messageId } = req.params;
      const Giveaways = require('../models/giveaways');
      const { handleDelete } = require('../functions/checkGiveaways');

      const check = await Giveaways.findOne({ messageId, serverId: guildId });
      if (!check) return res.status(404).json({ error: 'Giveaway not found' });
      if (check.ended) return res.json({ ok: true, alreadyEnded: true });

      await Giveaways.findOneAndUpdate({ messageId }, { ended: true });
      handleDelete(messageId);

      return res.json({ ok: true });
    } catch (err) {
      console.error('[API] POST end giveaway:', err);
      return res.status(500).json({ error: 'Failed to end giveaway' });
    }
  });

  app.post('/api/guilds/:guildId/tempchannels/setup', requireApiKey, async (req, res) => {
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

      if (reset || db.parentChannel || db.childChannel) {
        await disableTempChannels(client, guildId, db);
      }

      const { EmbedBuilder } = require('@fluxerjs/core');

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
        parent_id: category.id,
        bitrate: 64000,
      });

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
            const { resolvePermissionsToBitfield } = require('@fluxerjs/core');
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
        ...(channelLimit != null ? { channelLimit: Math.min(99, Math.max(0, Number(channelLimit) || 0)) } : {}),
        counting: !!counting,
        customParent: customCategoryId || null,
        manage: manageChannelId,
        manageMessage: manageMessageId,
      };

      await client.database.updateGuild(guildId, {
        parentChannel: category.id,
        childChannel: voiceChannel.id,
        tempChannels: [],
        config: newConfig,
      }, false);

      return res.json({
        ok: true,
        parentChannel: category.id,
        childChannel: voiceChannel.id,
        config: newConfig,
      });
    } catch (err) {
      console.error('[API] POST tempchannels/setup:', err);
      return res.status(500).json({ error: 'Failed to setup temp channels', detail: String(err?.message || err) });
    }
  });

  app.post('/api/guilds/:guildId/tempchannels/reset', requireApiKey, async (req, res) => {
    try {
      const { guildId } = req.params;
      const db = await client.database.getGuild(guildId, false);
      if (!db) return res.status(404).json({ error: 'Guild not found' });

      await disableTempChannels(client, guildId, db);

      return res.json({ ok: true });
    } catch (err) {
      console.error('[API] POST tempchannels/reset:', err);
      return res.status(500).json({ error: 'Failed to reset temp channels', detail: String(err?.message || err) });
    }
  });

  async function disableTempChannels(client, guildId, db) {
    if (Array.isArray(db.tempChannels)) {
      for (const entry of db.tempChannels) {
        const channelId = typeof entry === 'string' ? entry : (entry?.channelId ?? entry?.id);
        if (!channelId) continue;
        try {
          const ch = await client.channels.resolve(channelId);
          if (ch) await ch.delete();
        } catch {  }
      }
    }

    if (db.config?.manage) {
      try {
        const ch = await client.channels.resolve(db.config.manage);
        if (ch) await ch.delete();
      } catch {  }
    }

    if (db.childChannel) {
      try {
        const ch = await client.channels.resolve(db.childChannel);
        if (ch) await ch.delete();
      } catch {  }
    }

    if (db.parentChannel && !db.config?.customParent) {
      try {
        const ch = await client.channels.resolve(db.parentChannel);
        if (ch) await ch.delete();
      } catch { }
    }

    await client.database.updateGuild(guildId, {
      parentChannel: null,
      childChannel: null,
      tempChannels: [],
      config: {
        ...(db.config ?? {}),
        customParent: null,
        manage: null,
        manageMessage: null,
      },
    }, false);
  }

  app.get('/api/users/:userId', requireApiKey, async (req, res) => {
    try {
      const { userId } = req.params;
      const user = await client.database.getUser(userId, false);
      if (!user) return res.status(404).json({ error: 'User not found' });

      return res.json({
        userId: user.userId,
        timezone: user.timezone,
        reminderCount: user.reminders?.length ?? 0,
      });
    } catch (err) {
      console.error('[API] GET /api/users/:userId:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.get('/api/users/:userId/reminders', requireApiKey, async (req, res) => {
    try {
      const { userId } = req.params;
      const user = await client.database.getUser(userId, false);
      if (!user) return res.json({ reminders: [] });
      return res.json({ reminders: user.reminders ?? [] });
    } catch (err) {
      console.error('[API] GET reminders:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.post('/api/users/:userId/reminders', requireApiKey, async (req, res) => {
    try {
      const { userId } = req.params;
      const { message, timestamp } = req.body;
      if (!message || !timestamp) {
        return res.status(400).json({ error: 'message and timestamp are required' });
      }

      const MAX_SECONDS = 63115209;
      const nowTs = Math.floor(Date.now() / 1000);
      const ts = Number(timestamp);

      if (ts - nowTs > MAX_SECONDS) {
        return res.status(400).json({ error: 'Reminder cannot be more than 2 years in the future' });
      }
      if (ts <= nowTs + 59) {
        return res.status(400).json({ error: 'Reminder must be at least 1 minute in the future' });
      }

      const user = await client.database.getUser(userId, true);
      const newReminder = {
        id: require('crypto').randomUUID(),
        message: String(message).slice(0, 400),
        timestamp: ts,
        createdAt: Math.floor(Date.now() / 1000),
        type: 'dm',
      };

      const reminders = [...(user.reminders ?? []), newReminder];
      await client.database.updateUser(userId, { reminders }, true);
      return res.json({ reminder: newReminder });
    } catch (err) {
      console.error('[API] POST reminder:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.patch('/api/users/:userId/reminders/:reminderId', requireApiKey, async (req, res) => {
    try {
      const { userId, reminderId } = req.params;
      const { message, timestamp } = req.body;

      const user = await client.database.getUser(userId, false);
      if (!user) return res.status(404).json({ error: 'User not found' });

      const reminders = (user.reminders ?? []).map((r) => {
        if (r.id !== reminderId) return r;
        return {
          ...r,
          ...(message !== undefined ? { message: String(message).slice(0, 400) } : {}),
          ...(timestamp !== undefined ? { timestamp: Number(timestamp) } : {}),
        };
      });

      await client.database.updateUser(userId, { reminders }, false);
      return res.json({ ok: true });
    } catch (err) {
      console.error('[API] PATCH reminder:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.delete('/api/users/:userId/reminders/:reminderId', requireApiKey, async (req, res) => {
    try {
      const { userId, reminderId } = req.params;

      const user = await client.database.getUser(userId, false);
      if (!user) return res.status(404).json({ error: 'User not found' });

      const reminders = (user.reminders ?? []).filter(r => r.id !== reminderId);
      await client.database.updateUser(userId, { reminders }, false);
      return res.json({ ok: true });
    } catch (err) {
      console.error('[API] DELETE reminder:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.get('/api/stats', requireApiKey, async (req, res) => {
    try {
      const guildCount = client.guilds?.size ?? 0;
      const pollCount = (await client.database.getAllPolls()).filter(p => !p.ended).length;
      const giveawayCount = (await client.database.getAllGiveaways()).filter(g => !g.ended).length;

      return res.json({
        guilds: guildCount,
        activePolls: pollCount,
        activeGiveaways: giveawayCount,
        uptime: process.uptime(),
      });
    } catch (err) {
      console.error('[API] GET /api/stats:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  });

  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: '/health/ws' });

  function getBotStatus() {
    return {
      ok: true,
      online: client.isReady ? client.isReady() : false,
      uptime: process.uptime(),
      guilds: client.guilds?.size ?? 0,
      timestamp: Date.now(),
    };
  }

  wss.on('connection', (ws) => {
    ws.send(JSON.stringify(getBotStatus()));

    const interval = setInterval(() => {
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify(getBotStatus()));
      }
    }, 5000);

    ws.on('close', () => clearInterval(interval));
    ws.on('error', () => clearInterval(interval));
  });

  server.listen(port, '0.0.0.0', () => {
    console.log(`[API] Connected to ${port}`);
  });
  
  return { app, server, wss };
}

module.exports = createApiServer;