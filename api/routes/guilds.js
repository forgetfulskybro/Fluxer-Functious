const { Router } = require('express');
const { makeRequireApiKey } = require('../middleware');
const { trackGuildUpdates, actorFromReq } = require('../trackSettings');
const UserDB = require('../../models/users');
const {
  nextBirthdayTimestamp,
  buildBirthdayAnnouncement,
} = require('../../functions/birthdayHelpers');

function collectMembers(liveGuild) {
  if (!liveGuild) return [];
  try {
    if (liveGuild.members?.values && typeof liveGuild.members.values === 'function') {
      return [...liveGuild.members.values()];
    }
    if (Array.isArray(liveGuild.members)) return liveGuild.members;
    if (liveGuild.members?.toJSON) return Object.values(liveGuild.members.toJSON());
    if (liveGuild.members && typeof liveGuild.members === 'object') return Object.values(liveGuild.members);
  } catch { }
  return [];
}

function mapMember(member) {
  const user = member.user ?? member;
  return {
    id: String(member.id ?? member.userId ?? ''),
    username: user.username ?? String(member.id ?? ''),
    globalName: user.globalName ?? user.global_name ?? null,
    avatar: user.avatar ?? null,
  };
}

function buildGuildBirthdayResponse(guild) {
  return {
    birthdayChannel: guild.birthdayChannel ?? null,
    birthdayRole: guild.birthdayRole ?? null,
    birthdayPing: guild.birthdayPing ?? true,
    birthdayBlacklist: guild.birthdayBlacklist ?? [],
    birthdayMessageWithAge: guild.birthdayMessageWithAge ?? null,
    birthdayMessageNoAge: guild.birthdayMessageNoAge ?? null,
  };
}

function isSnowflake(value) {
  return typeof value === 'string' && /^\d{17,20}$/.test(value);
}

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
        mediaChannels: guild.mediaChannels ?? [],
        userTimezones: guild.userTimezones,
        parentChannel: guild.parentChannel,
        childChannel: guild.childChannel,
        tempChannels: guild.tempChannels,
        config: guild.config,
        activePolls,
        activeGiveaways,
        ...buildGuildBirthdayResponse(guild),
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
        'mediaChannels',
        'birthdayChannel',
        'birthdayRole',
        'birthdayPing',
        'birthdayBlacklist',
        'birthdayMessageWithAge',
        'birthdayMessageNoAge',
      ];

      const updates = {};
      for (const field of ALLOWED_FIELDS) {
        if (field in req.body) updates[field] = req.body[field];
      }

      if ('birthdayBlacklist' in updates) {
        const blacklist = updates.birthdayBlacklist;
        if (!Array.isArray(blacklist) || !blacklist.every(isSnowflake)) {
          return res.status(400).json({ error: 'birthdayBlacklist must be an array of valid user IDs' });
        }
        updates.birthdayBlacklist = [...new Set(blacklist)];
      }

      for (const field of ['birthdayMessageWithAge', 'birthdayMessageNoAge']) {
        if (!(field in updates)) continue;
        const value = updates[field];
        if (value == null) {
          updates[field] = null;
          continue;
        }
        if (typeof value !== 'string' || value.trim().length > 1000) {
          return res.status(400).json({ error: `${field} must be a string of at most 1000 characters` });
        }
        updates[field] = value.trim() || null;
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

  router.get('/:guildId/birthdays', requireApiKey, async (req, res) => {
    try {
      const { guildId } = req.params;
      const guild = await client.database.getGuild(guildId, false);
      if (!guild) return res.status(404).json({ error: 'Guild not found' });

      const blacklist = guild.birthdayBlacklist ?? [];
      const usersWithBirthday = await UserDB.find({
        'birthday.day': { $ne: null },
        'birthday.enabledGuilds': guildId,
        userId: { $nin: blacklist },
      }).lean();

      const liveGuild = client.guilds?.get(guildId);
      const members = collectMembers(liveGuild);
      const memberMap = new Map(members.map((m) => [String(m.id), m]));

      const list = usersWithBirthday
        .map((u) => {
          const member = memberMap.get(String(u.userId));
          return {
            userId: String(u.userId),
            username: member?.user?.username ?? null,
            globalName: member?.user?.globalName ?? member?.user?.global_name ?? null,
            avatar: member?.user?.avatar ?? null,
            month: u.birthday.month,
            day: u.birthday.day,
            age: u.birthday.age ?? null,
            nextTs: nextBirthdayTimestamp(u.birthday.month, u.birthday.day, u.timezone || 'UTC'),
          };
        })
        .sort((a, b) => a.nextTs - b.nextTs);

      return res.json({ ...buildGuildBirthdayResponse(guild), list });
    } catch (err) {
      console.error('[API] GET /api/guilds/:guildId/birthdays:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  });

  router.post('/:guildId/birthdays/blacklist', requireApiKey, async (req, res) => {
    try {
      const { guildId } = req.params;
      const { userId } = req.body ?? {};

      if (!isSnowflake(userId)) {
        return res.status(400).json({ error: 'A valid Fluxer user ID is required' });
      }

      const guild = await client.database.getGuild(guildId, false);
      if (!guild) return res.status(404).json({ error: 'Guild not found' });

      const blacklist = guild.birthdayBlacklist ?? [];
      if (blacklist.includes(userId)) {
        return res.status(409).json({ error: 'This user is already blacklisted' });
      }

      const next = [...new Set([...blacklist, userId])];
      await client.database.updateGuild(guildId, { birthdayBlacklist: next }, false);
      await trackGuildUpdates(client, {
        guildId,
        userId: actorFromReq(req),
        existing: guild,
        updates: { birthdayBlacklist: next },
      });

      return res.json({ ok: true, birthdayBlacklist: next });
    } catch (err) {
      console.error('[API] POST /api/guilds/:guildId/birthdays/blacklist:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  });

  router.delete('/:guildId/birthdays/blacklist/:targetUserId', requireApiKey, async (req, res) => {
    try {
      const { guildId, targetUserId } = req.params;

      if (!isSnowflake(targetUserId)) {
        return res.status(400).json({ error: 'A valid Fluxer user ID is required' });
      }

      const guild = await client.database.getGuild(guildId, false);
      if (!guild) return res.status(404).json({ error: 'Guild not found' });

      const blacklist = guild.birthdayBlacklist ?? [];
      if (!blacklist.includes(targetUserId)) {
        return res.status(404).json({ error: 'This user is not blacklisted' });
      }

      const next = blacklist.filter((id) => id !== targetUserId);
      await client.database.updateGuild(guildId, { birthdayBlacklist: next }, false);
      await trackGuildUpdates(client, {
        guildId,
        userId: actorFromReq(req),
        existing: guild,
        updates: { birthdayBlacklist: next },
      });

      return res.json({ ok: true, birthdayBlacklist: next });
    } catch (err) {
      console.error('[API] DELETE /api/guilds/:guildId/birthdays/blacklist/:userId:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  });

  router.post('/:guildId/birthdays/force', requireApiKey, async (req, res) => {
    try {
      const { guildId } = req.params;
      const { userId } = req.body ?? {};

      if (!userId || typeof userId !== 'string') {
        return res.status(400).json({ error: 'userId is required' });
      }

      const guild = await client.database.getGuild(guildId, false);
      if (!guild) return res.status(404).json({ error: 'Guild not found' });

      if (!guild.birthdayChannel) {
        return res.status(400).json({ error: 'No birthday channel set for this server' });
      }

      const liveGuild = client.guilds?.get(guildId);
      const announceChannel = guild.birthdayChannel
        ? await client.channels.resolve(guild.birthdayChannel).catch(() => null)
        : null;
      if (!announceChannel) {
        return res.status(400).json({ error: 'Birthday channel could not be resolved' });
      }

      let targetMember = null;
      try {
        targetMember = liveGuild?.members?.get(userId)
          ?? await liveGuild?.fetchMember?.(userId).catch(() => null);
      } catch {
        targetMember = null;
      }
      if (!targetMember) return res.status(404).json({ error: 'Member not found' });

      const targetUserData = await client.database.getUser(userId, false);
      if (!targetUserData?.birthday?.day) {
        return res.status(400).json({ error: 'This user has no birthday set' });
      }

      const result = buildBirthdayAnnouncement(client, guild, targetMember, targetUserData, liveGuild?.name);
      const pingUser = (guild.birthdayPing ?? true) && (targetUserData.birthday.ping ?? true);

      if (guild.birthdayRole) {
        await targetMember.addRole?.(guild.birthdayRole).catch(() => {});
      }

      const content = pingUser ? `<@${userId}>` : undefined;
      await announceChannel.send({ content, embeds: [result.embed] });

      client.database.updateUser(userId, {
        birthday: { ...targetUserData.birthday, lastBirthday: new Date().getFullYear() },
      }, true).catch(() => {});

      return res.json({ ok: true });
    } catch (err) {
      console.error('[API] POST /api/guilds/:guildId/birthdays/force:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  });

  router.get('/:guildId/members', requireApiKey, async (req, res) => {
    try {
      const { guildId } = req.params;
      const guild = await client.database.getGuild(guildId, false);
      if (!guild) return res.status(404).json({ error: 'Guild not found' });

      const liveGuild = client.guilds?.get(guildId);
      if (!liveGuild) return res.status(404).json({ error: 'Bot is not in this server' });

      const query = String(req.query.query ?? '').trim().toLowerCase();
      const members = collectMembers(liveGuild)
        .filter((m) => {
          if (!query) return true;
          const username = String(m.user?.username ?? '').toLowerCase();
          const globalName = String(m.user?.globalName ?? m.user?.global_name ?? '').toLowerCase();
          return username.includes(query) || globalName.includes(query) || String(m.id) === query;
        })
        .slice(0, 25)
        .map(mapMember);

      return res.json({ members });
    } catch (err) {
      console.error('[API] GET /api/guilds/:guildId/members:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  });

  return router;
}

module.exports = guildsRouter;