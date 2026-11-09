const { Router } = require('express');
const { randomUUID } = require('node:crypto');
const { makeRequireApiKey } = require('../middleware');
const { trackGuildUpdates, trackResource, actorFromReq } = require('../trackSettings');
const { runChecks } = require('../../functions/launchpad');
const UserDB = require('../../models/users');
const {
  nextBirthdayTimestamp,
  buildBirthdayAnnouncementPayload,
} = require('../../functions/birthdayHelpers');
const { refreshGuild: refreshTagIndex } = require('../../functions/tagIndex');
const {
  MAX_STICKIES,
  hasEmbedContent,
  normalizeStickyDelay,
  normalizeMentionPolicy,
  refreshSticky,
  deleteStickyMessage,
  clearStickyTimer,
} = require('../../functions/stickyMessages');

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
    communityBirthday: guild.communityBirthday ?? null,
  };
}

function isSnowflake(value) {
  return typeof value === 'string' && /^\d{17,20}$/.test(value);
}

function cleanText(value, max) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text ? text.slice(0, max) : null;
}

function sanitizeCommunityBirthday(raw, existing) {
  if (raw == null) return { value: null };
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    return { error: 'communityBirthday must be an object or null' };
  }

  const base = existing?.toObject?.() ?? existing ?? {};
  const value = (key) => (key in raw ? raw[key] : base[key]);
  const toNumberOrNull = (input) => {
    if (input == null || input === '') return null;
    const number = Number(input);
    return Number.isFinite(number) ? number : null;
  };

  const month = toNumberOrNull(value('month'));
  const day = toNumberOrNull(value('day'));
  const year = toNumberOrNull(value('year'));
  if ((month == null) !== (day == null)) {
    return { error: 'communityBirthday.month and day must both be set or both be null' };
  }
  if (month != null && (!Number.isInteger(month) || month < 1 || month > 12)) {
    return { error: 'communityBirthday.month must be between 1 and 12' };
  }
  if (day != null) {
    const daysInMonth = new Date(Date.UTC(2024, month, 0)).getUTCDate();
    if (!Number.isInteger(day) || day < 1 || day > daysInMonth) {
      return { error: 'communityBirthday.day is not valid for that month' };
    }
  }
  if (year != null && (!Number.isInteger(year) || year < 2000 || year > new Date().getFullYear())) {
    return { error: 'communityBirthday.year must be between 2000 and the current year' };
  }

  const channelId = value('channelId');
  if (channelId != null && !isSnowflake(channelId)) {
    return { error: 'communityBirthday.channelId must be a valid channel ID or null' };
  }
  const roleId = value('roleId');
  if (roleId != null && !isSnowflake(roleId)) {
    return { error: 'communityBirthday.roleId must be a valid role ID or null' };
  }

  const timezone = value('timezone') ?? 'UTC';
  if (typeof timezone !== 'string' || !timezone.trim()) {
    return { error: 'communityBirthday.timezone must be an IANA timezone' };
  }
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format();
  } catch {
    return { error: 'communityBirthday.timezone must be an IANA timezone' };
  }

  const message = value('message');
  if (message != null && (typeof message !== 'string' || message.trim().length > 1000)) {
    return { error: 'communityBirthday.message must be a string of at most 1000 characters' };
  }

  return {
    value: {
      month,
      day,
      year,
      enabled: value('enabled') === true,
      channelId: channelId ?? null,
      roleId: roleId ?? null,
      ping: value('ping') === true,
      message: typeof message === 'string' ? message.trim() || null : null,
      timezone: timezone.trim(),
      lastAnnouncedYear: toNumberOrNull(base.lastAnnouncedYear),
    },
  };
}

function cleanStickyScript(value) {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  const fenced = trimmed.match(/^```(?:[a-zA-Z0-9_-]+)?\s*\n?([\s\S]*?)```$/);
  return (fenced ? fenced[1] : trimmed).trim();
}

function sanitizeStickyEmbed(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;

  const embed = {};
  const title = cleanText(value.title, 256);
  const description = cleanText(value.description, 4096);
  const url = cleanText(value.url, 2048);
  const color = cleanText(value.color, 32);
  const image = cleanText(value.image, 2048);
  const thumbnail = cleanText(value.thumbnail, 2048);

  if (title) embed.title = title;
  if (description) embed.description = description;
  if (url) embed.url = url;
  if (color) embed.color = color;
  if (image) embed.image = image;
  if (thumbnail) embed.thumbnail = thumbnail;

  if (value.footer && typeof value.footer === 'object' && !Array.isArray(value.footer)) {
    const text = cleanText(value.footer.text, 2048);
    const iconURL = cleanText(value.footer.iconURL, 2048);
    if (text || iconURL) {
      embed.footer = {};
      if (text) embed.footer.text = text;
      if (iconURL) embed.footer.iconURL = iconURL;
    }
  }

  if (value.author && typeof value.author === 'object' && !Array.isArray(value.author)) {
    const name = cleanText(value.author.name, 256);
    const iconURL = cleanText(value.author.iconURL, 2048);
    const authorUrl = cleanText(value.author.url, 2048);
    if (name || iconURL || authorUrl) {
      embed.author = {};
      if (name) embed.author.name = name;
      if (iconURL) embed.author.iconURL = iconURL;
      if (authorUrl) embed.author.url = authorUrl;
    }
  }

  if (value.useTimestamp === true) embed.useTimestamp = true;
  return Object.keys(embed).length ? embed : null;
}

function resolveConfigurableCommand(client, name) {
  if (typeof name !== 'string') return null;
  const command =
    client.commands.get(name) || client.commands.get(client.aliases.get(name));
  if (!command || command.config?.available !== true) return null;
  return command;
}

function buildCommandCatalog(client, guild) {
  const catalog = [];

  for (const command of client.commands.values()) {
    const config = command.config;
    if (!config || config.available !== true || !config.name) continue;

    let description = null;
    if (guild?.language) {
      const translated = client.translate.get(
        guild.language,
        `Commands.${config.descriptionKey ?? config.name}.description`
      );
      if (
        typeof translated === 'string' &&
        !translated.startsWith('Unknown translation:')
      ) {
        description = translated;
      }
    }

    catalog.push({
      name: config.name,
      aliases: Array.isArray(config.aliases) ? config.aliases : [],
      description,
      category: config.category ?? 'commands',
      cooldownMs: Math.max(0, Number(config.cooldown) || 0),
      permissions: config.permissions?.name ?? null,
    });
  }

  return catalog.sort((a, b) => a.name.localeCompare(b.name));
}

function sanitizeCommandSettings(rawList, client) {
  if (!Array.isArray(rawList)) {
    return { error: 'commandSettings must be an array' };
  }

  const next = [];
  const seen = new Set();

  for (let index = 0; index < rawList.length; index += 1) {
    const raw = rawList[index];
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return { error: `commandSettings[${index}] must be an object` };
    }

    const command = resolveConfigurableCommand(client, raw.name);
    if (!command) {
      return {
        error: `commandSettings[${index}].name is not a configurable command`,
      };
    }

    const name = command.config.name;
    const minimumCooldownMs = Math.max(0, Number(command.config.cooldown) || 0);
    if (seen.has(name)) {
      return { error: `commandSettings[${index}].name is duplicated` };
    }

    if (raw.allowedChannels !== undefined && !Array.isArray(raw.allowedChannels)) {
      return {
        error: `commandSettings[${index}].allowedChannels must be an array`,
      };
    }
    if (raw.allowedRoles !== undefined && !Array.isArray(raw.allowedRoles)) {
      return {
        error: `commandSettings[${index}].allowedRoles must be an array`,
      };
    }

    const allowedChannels = Array.isArray(raw.allowedChannels)
      ? [...new Set(raw.allowedChannels)]
      : [];
    const allowedRoles = Array.isArray(raw.allowedRoles)
      ? [...new Set(raw.allowedRoles)]
      : [];

    if (!allowedChannels.every(isSnowflake)) {
      return {
        error: `commandSettings[${index}].allowedChannels must contain valid channel IDs`,
      };
    }
    if (!allowedRoles.every(isSnowflake)) {
      return {
        error: `commandSettings[${index}].allowedRoles must contain valid role IDs`,
      };
    }

    let cooldownMs = null;
    if (raw.cooldownMs !== null && raw.cooldownMs !== undefined) {
      if (
        typeof raw.cooldownMs !== 'number' ||
        !Number.isFinite(raw.cooldownMs) ||
        raw.cooldownMs < 0 ||
        raw.cooldownMs > 3600000
      ) {
        return {
          error: `commandSettings[${index}].cooldownMs must be between 0 and 3600000`,
        };
      }
      cooldownMs = Math.max(minimumCooldownMs, Math.round(raw.cooldownMs));
    }

    seen.add(name);
    next.push({
      name,
      enabled: raw.enabled !== false,
      cooldownMs,
      allowedChannels,
      allowedRoles,
      deleteInvocation: raw.deleteInvocation === true,
    });
  }

  return { value: next };
}

function sanitizeSticky(raw, existing, actorId, index) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { error: `stickies[${index}] must be an object` };
  }

  const type =
    raw.type === 'content' || raw.type === 'embed' || raw.type === 'script'
      ? raw.type
      : null;
  if (!type) {
    return { error: `stickies[${index}].type must be content, embed, or script` };
  }

  const channelId = typeof raw.channelId === 'string' ? raw.channelId.trim() : '';
  if (!isSnowflake(channelId)) {
    return { error: `stickies[${index}].channelId must be a valid channel ID` };
  }

  let content = null;
  let embedData = null;

  if (type === 'embed') {
    embedData = sanitizeStickyEmbed(raw.embedData);
    if (!embedData || !hasEmbedContent(embedData)) {
      return { error: `stickies[${index}].embedData must contain an embed` };
    }
  } else {
    const max = type === 'script' ? 12000 : 2000;
    content =
      type === 'script'
        ? cleanStickyScript(raw.content)
        : typeof raw.content === 'string'
          ? raw.content.trim()
          : null;
    if (!content) {
      return { error: `stickies[${index}].content cannot be empty` };
    }
    if (content.length > max) {
      return { error: `stickies[${index}].content must be ${max} characters or fewer` };
    }
  }

  const id =
    cleanText(raw.id, 100) ??
    existing?.id ??
    randomUUID();
  const enabled = raw.enabled !== false;
  const sameChannel = existing?.channelId === channelId;

  return {
    value: {
      id,
      channelId,
      type,
      content,
      embedData,
      enabled,
      stickyMessageId:
        enabled && sameChannel ? existing?.stickyMessageId ?? null : null,
      createdBy: existing?.createdBy ?? actorId ?? null,
      createdAt: Number(existing?.createdAt) || Date.now(),
      updatedAt: Date.now(),
      sendCount: Number(existing?.sendCount) || 0,
      lastSentAt: existing?.lastSentAt ?? null,
      repostDelayMs: normalizeStickyDelay(
        raw.repostDelayMs ?? existing?.repostDelayMs
      ),
      mentionPolicy: normalizeMentionPolicy(
        raw.mentionPolicy ?? existing?.mentionPolicy
      ),
    },
  };
}

function sanitizeStickies(rawList, existingList, actorId) {
  if (!Array.isArray(rawList)) {
    return { error: 'stickies must be an array' };
  }
  if (rawList.length > MAX_STICKIES) {
    return { error: `stickies cannot contain more than ${MAX_STICKIES} entries` };
  }

  const existingById = new Map(
    (existingList ?? [])
      .filter((sticky) => sticky && typeof sticky.id === 'string')
      .map((sticky) => [String(sticky.id), sticky])
  );
  const next = [];
  const ids = new Set();
  const channels = new Set();

  for (let index = 0; index < rawList.length; index += 1) {
    const raw = rawList[index];
    const existing = raw && typeof raw === 'object' && typeof raw.id === 'string'
      ? existingById.get(raw.id)
      : null;
    const result = sanitizeSticky(raw, existing, actorId, index);
    if (result.error) return result;

    const sticky = result.value;
    if (ids.has(sticky.id)) {
      return { error: `stickies[${index}].id is duplicated` };
    }
    if (channels.has(sticky.channelId)) {
      return { error: 'Only one sticky message can be assigned to each channel' };
    }

    ids.add(sticky.id);
    channels.add(sticky.channelId);
    next.push(sticky);
  }

  return { value: next };
}

function stableJson(value) {
  try {
    return JSON.stringify(value ?? null);
  } catch {
    return null;
  }
}

async function syncStickies(client, guildId, previousList, nextList) {
  const previousById = new Map(
    (previousList ?? [])
      .filter((sticky) => sticky && typeof sticky.id === 'string')
      .map((sticky) => [String(sticky.id), sticky])
  );
  const nextById = new Map(
    (nextList ?? [])
      .filter((sticky) => sticky && typeof sticky.id === 'string')
      .map((sticky) => [String(sticky.id), sticky])
  );
  const tasks = [];

  for (const old of previousById.values()) {
    if (!nextById.has(String(old.id))) {
      clearStickyTimer(old.channelId);
      tasks.push(deleteStickyMessage(client, guildId, old));
    }
  }

  for (const sticky of nextById.values()) {
    const old = previousById.get(String(sticky.id));

    if (!sticky.enabled) {
      if (old && (old.enabled !== false || old.stickyMessageId)) {
        clearStickyTimer(old.channelId);
        tasks.push(deleteStickyMessage(client, guildId, old));
      }
      continue;
    }

    if (old && old.channelId !== sticky.channelId) {
      clearStickyTimer(old.channelId);
      tasks.push(deleteStickyMessage(client, guildId, old));
    }

    const changed =
      !old ||
      old.channelId !== sticky.channelId ||
      old.type !== sticky.type ||
      old.content !== sticky.content ||
      old.repostDelayMs !== sticky.repostDelayMs ||
      old.mentionPolicy !== sticky.mentionPolicy ||
      stableJson(old.embedData) !== stableJson(sticky.embedData);

    if (!old || !old.enabled || changed) {
      tasks.push(refreshSticky(client, guildId, sticky.id));
    }
  }

  if (tasks.length === 0) return;
  const results = await Promise.allSettled(tasks);
  for (const result of results) {
    if (result.status === 'rejected') {
      console.error('[API] Sticky sync failed:', result.reason);
    } else if (result.value && result.value.ok === false && !result.value.busy) {
      console.error('[API] Sticky sync failed:', result.value.error ?? result.value);
    }
  }
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

      const commandCatalog = buildCommandCatalog(client, guild);
      const configurableCommands = new Set(
        commandCatalog.map((command) => command.name)
      );

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
        tagTriggerBots: guild.tagTriggerBots ?? false,
        scheduledMessages: guild.scheduledMessages,
        stickies: guild.stickies ?? [],
        commandSettings: (Array.isArray(guild.commandSettings)
          ? guild.commandSettings
          : []
        ).filter((setting) => configurableCommands.has(setting?.name)),
        commandCatalog,
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

  router.post('/:guildId/checkup', requireApiKey, async (req, res) => {
    try {
      const { guildId } = req.params;
      const guild = await client.database.getGuild(guildId, false);
      if (!guild) return res.status(404).json({ error: 'Guild not found' });

      const liveGuild = client.guilds?.get(guildId);
      if (!liveGuild) return res.status(404).json({ error: 'Bot is not in this server' });

      const results = await runChecks(client, liveGuild, guild, async () => {}, {
        delayMs: 0,
      });
      if (!results.length) {
        return res.status(409).json({ error: 'A health checkup is already running for this server' });
      }

      return res.json({ checkedAt: Date.now(), results });
    } catch (err) {
      console.error('[API] POST /api/guilds/:guildId/checkup:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  });

  router.patch('/:guildId', requireApiKey, async (req, res) => {
    try {
      const { guildId } = req.params;

      const ALLOWED_FIELDS = [
        'prefix',
        'tagTriggerBots',
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
        'stickies',
        'commandSettings',
        'tags',
        'roles',
        'mediaChannels',
        'birthdayChannel',
        'birthdayRole',
        'birthdayPing',
        'birthdayBlacklist',
        'birthdayMessageWithAge',
        'birthdayMessageNoAge',
        'communityBirthday',
      ];

      const updates = {};
      for (const field of ALLOWED_FIELDS) {
        if (field in req.body) updates[field] = req.body[field];
      }

      if ('tagTriggerBots' in updates && typeof updates.tagTriggerBots !== 'boolean') {
        return res.status(400).json({ error: 'tagTriggerBots must be a boolean' });
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

      if ('communityBirthday' in updates) {
        const sanitized = sanitizeCommunityBirthday(
          updates.communityBirthday,
          existing.communityBirthday
        );
        if (sanitized.error) {
          return res.status(400).json({ error: sanitized.error });
        }
        updates.communityBirthday = sanitized.value;
      }

      const previousStickies = Array.isArray(existing.stickies) ? existing.stickies : [];
      if ('stickies' in updates) {
        const sanitized = sanitizeStickies(
          updates.stickies,
          previousStickies,
          actorFromReq(req)
        );
        if (sanitized.error) {
          return res.status(400).json({ error: sanitized.error });
        }
        updates.stickies = sanitized.value;
      }

      if ('commandSettings' in updates) {
        const sanitized = sanitizeCommandSettings(
          updates.commandSettings,
          client
        );
        if (sanitized.error) {
          return res.status(400).json({ error: sanitized.error });
        }
        updates.commandSettings = sanitized.value;
      }

      await client.database.updateGuild(guildId, updates, false);
      await trackGuildUpdates(client, {
        guildId,
        userId: actorFromReq(req),
        existing,
        updates,
      });

      if ('tags' in updates || 'tagTriggerBots' in updates) {
        await refreshTagIndex(client, guildId);
      }

      if ('stickies' in updates) {
        await syncStickies(client, guildId, previousStickies, updates.stickies);
      }

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

      const result = buildBirthdayAnnouncementPayload(
        client,
        guild,
        targetMember,
        targetUserData,
        liveGuild?.name
      );
      const pingUser = (guild.birthdayPing ?? true) && (targetUserData.birthday.ping ?? true);

      if (guild.birthdayRole) {
        await targetMember.addRole?.(guild.birthdayRole).catch(() => {});
      }

      const content = (
        [pingUser ? `<@${userId}>` : "", result.payload.content ?? ""]
          .filter(Boolean)
          .join("\n") || undefined
      )?.slice(0, 2000);
      await announceChannel.send({
        ...result.payload,
        content,
        allowedMentions: { parse: ['users'] },
      });

      client.database.updateUser(userId, {
        birthday: { ...targetUserData.birthday, lastBirthday: new Date().getFullYear() },
      }, true).catch(() => {});

      await trackResource(client, {
        userId: actorFromReq(req),
        groupId: guildId,
        category: 'birthdays',
        key: 'birthdayAnnouncement',
        action: 'create',
        label: 'Announce Birthday',
        value: {
          userId,
          channelId: guild.birthdayChannel,
          roleId: guild.birthdayRole ?? null,
          ping: pingUser,
        },
      });

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