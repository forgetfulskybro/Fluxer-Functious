const { Router } = require('express');
const { makeRequireApiKey } = require('../middleware');
const { trackGuildUpdates, actorFromReq } = require('../trackSettings');

function guildsRouter(client, apiKey) {
  const router = Router();
  const requireApiKey = makeRequireApiKey(apiKey);

  router.post('/filter', requireApiKey, async (req, res) => {
    try {
      const { guildIds } = req.body;
      if (!Array.isArray(guildIds)) {
        return res.status(400).json({ error: 'guildIds must be an array' });
      }
      const botGuildIds = new Set(
        client.guilds?.keys ? [...client.guilds.keys()] : []
      );
      const present = guildIds.filter((id) => botGuildIds.has(id));
      return res.json({ present });
    } catch (err) {
      console.error('[API] /api/guilds/filter:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  });

  router.get('/:guildId', requireApiKey, async (req, res) => {
    try {
      const { guildId } = req.params;

      const guild = await client.database.getGuild(guildId, false);
      if (!guild) return res.status(404).json({ error: 'Guild not found' });

      const liveGuild = client.guilds?.get(guildId);
      const fetchedEmojis = await liveGuild?.fetchEmojis();

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
          parentId: c.parentId ? String(c.parentId) : null,
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
        .filter((r) => r && r.id)
        .filter((r) => r.name !== '@everyone');

      const emojis = (fetchedEmojis ?? []).map((e) => ({
        id: String(e.id ?? ''),
        name: String(e.name ?? 'unknown'),
        animated: e.animated ?? false,
        url: `https://fluxerusercontent.com/emojis/${e.id}.webp?animated=${e.animated}&size=240&quality=lossless`,
      }));

      const allPolls = await client.database.getAllPolls();
      const activePolls = allPolls
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
          avatars: p.avatars,
          time: p.time,
          now: p.now,
          lang: p.lang,
          ended: p.ended,
        }));

      const allGiveaways = await client.database.getAllGiveaways();
      const activeGiveaways = allGiveaways
        .filter((g) => g.serverId === guildId && !g.ended)
        .map((g) => ({
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
          dmWinners: g.dmWinners,
          pingWinners: g.pingWinners,
          allowMultipleWins: g.allowMultipleWins,
          imageUrl: g.imageUrl,
          bonusEntries: g.bonusEntries,
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
        pollPerm: guild.pollPerm,
        emojis,
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

  router.patch('/:guildId', requireApiKey, async (req, res) => {
    try {
      const { guildId } = req.params;

      const ALLOWED_FIELDS = [
        'prefix',
        'language',
        'dm',
        'timezoneConvert',
        'pollPerm',
        'stickyRolesEnabled',
        'joinRoles',
        'timedRoles',
        'stickyRoles',
        'bypassRoles',
        'config',
        'parentChannel',
        'childChannel',
        'tempChannels',
        'scheduledMessages',
        'tags',
        'roles',
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
      await trackGuildUpdates(client, {
        guildId,
        userId: actorFromReq(req),
        existing,
        updates,
      });

      return res.json({ ok: true });
    } catch (err) {
      console.error('[API] PATCH /api/guilds/:guildId:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  });

  return router;
}

module.exports = guildsRouter;