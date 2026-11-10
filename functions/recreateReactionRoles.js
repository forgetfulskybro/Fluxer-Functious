const { parseMessageLink, fetchMessage, SNOWFLAKE_REGEX } = require('./messageSource');
const { validateRoles, targetLink } = require('./customRoleSetup');
const { trackResource } = require('../api/trackSettings');

const MAX_ROLES = 30;

function guildRoles(guild) {
  const roles = guild?.roles;
  if (!roles) return [];

  const values =
    typeof roles.values === 'function'
      ? [...roles.values()]
      : typeof roles.cache?.values === 'function'
        ? [...roles.cache.values()]
        : Array.isArray(roles)
          ? roles
          : [];

  return values.filter((role) => role && role.id && role.name && role.id !== guild.id);
}

function messageText(message) {
  const parts = [];

  if (typeof message?.content === 'string' && message.content.trim()) {
    parts.push(message.content);
  }

  for (const embed of message?.embeds ?? []) {
    if (!embed) continue;
    if (embed.title) parts.push(String(embed.title));
    if (embed.description) parts.push(String(embed.description));

    const fields = Array.isArray(embed.fields)
      ? embed.fields
      : embed.fields?.values
        ? [...embed.fields.values()]
        : [];

    for (const field of fields) {
      if (field?.name) parts.push(String(field.name));
      if (field?.value) parts.push(String(field.value));
    }
  }

  return parts.join('\n');
}

function displayEmoji(emoji) {
  if (!emoji?.name) return '';
  if (!emoji.id) return String(emoji.name);
  return `<${emoji.animated ? 'a' : ''}:${emoji.name}:${emoji.id}>`;
}

function reactionKey(reaction) {
  const emoji = reaction?.emoji;
  if (emoji?.id) return `custom:${emoji.id}`;
  return `unicode:${emoji?.name || reaction?.emojiIdentifier || ''}`;
}

function emojiCandidates(reaction) {
  const emoji = reaction?.emoji;
  const display = displayEmoji(emoji);
  if (!display) return [];

  const candidates = [display];

  if (emoji.id) {
    candidates.push(`${emoji.animated ? 'a:' : ''}${emoji.name}:${emoji.id}`);
    candidates.push(`:${emoji.name}:`);
  } else {
    candidates.push(display.replace(/\uFE0F/g, ''));
  }

  return [...new Set(candidates.filter(Boolean))].sort((a, b) => b.length - a.length);
}

function cleanLine(line) {
  return String(line ?? '')
    .replace(/^\uFEFF/, '')
    .trim()
    .replace(/^[-*•]\s+/, '')
    .trim();
}

function isEmojiToken(token) {
  if (!token) return false;
  if (/^<a?:[^:>\s]+:\d+>$/.test(token)) return true;
  if (/^(?:a:)?[A-Za-z0-9_+-]+:\d+$/.test(token)) return true;
  if (/^[0-9#*]\uFE0F?\u20E3$/u.test(token)) return true;
  if (/^[\u{1F1E6}-\u{1F1FF}]{2}$/u.test(token)) return true;
  return /\p{Extended_Pictographic}/u.test(token);
}

function splitRoleLine(line) {
  const space = line.search(/\s/);
  if (space === -1) return null;

  const emoji = line.slice(0, space);
  if (!isEmojiToken(emoji)) return null;

  return { emoji, rest: line.slice(space + 1) };
}

function cleanRemainder(value) {
  return String(value ?? '')
    .replace(/^[\uFE0E\uFE0F]+/u, '')
    .trim()
    .replace(/^[-–—|:•>]\s*/, '')
    .trim();
}

function resolveRole(value, roles, options = {}) {
  const text = cleanRemainder(value);
  if (!text) return null;

  let name = text
    .replace(/^@/, '')
    .replace(/^\*\*(.*?)\*\*$/, '$1')
    .replace(/^__(.*?)__$/, '$1')
    .replace(/^`(.*?)`$/, '$1')
    .trim();

  if (!name) return null;

  const mention = /^<@&(\d{17,20})>/.exec(name);
  if (mention) return roles.find((role) => role.id === mention[1]) || null;

  const lower = name.toLowerCase();
  const exact = roles.find((role) => String(role.name).toLowerCase() === lower);
  if (exact) return exact;

  const byId = roles.find((role) => role.id === name);
  if (byId) return byId;
  if (options.prefix === false) return null;

  const prefix = roles
    .filter((role) => role.name && lower.startsWith(String(role.name).toLowerCase()))
    .sort((a, b) => b.name.length - a.name.length)[0];

  if (!prefix) return null;

  const tail = name.slice(prefix.name.length);
  if (!tail || !/^[\p{L}\p{N}_]/u.test(tail)) return prefix;

  return null;
}

function parseReactionRoles(message, guild) {
  const botReactions = [...(message?.reactions ?? [])].filter(
    (reaction) => reaction?.me === true && reaction.emoji?.name
  );

  if (botReactions.length === 0) return { error: 'noReactions' };
  if (botReactions.length > MAX_ROLES) return { error: 'tooMany', max: MAX_ROLES };

  const roles = guildRoles(guild);
  if (roles.length === 0) return { error: 'noRoles' };

  const lines = messageText(message)
    .split(/\r?\n/)
    .map(cleanLine)
    .filter(Boolean);

  const candidates = [];
  for (const reaction of botReactions) {
    for (const text of emojiCandidates(reaction)) {
      candidates.push({ text, reaction });
    }
  }
  candidates.sort((a, b) => b.text.length - a.text.length);

  const mappings = [];
  const mappedKeys = new Set();
  const unresolved = [];
  const missingReactions = [];

  for (const line of lines) {
    const match = candidates.find((candidate) => line.startsWith(candidate.text));
    if (match) {
      const key = reactionKey(match.reaction);
      if (mappedKeys.has(key)) continue;

      const remainder = cleanRemainder(line.slice(match.text.length));
      if (!remainder) continue;

      const role = resolveRole(remainder, roles);
      if (!role) {
        unresolved.push(line);
        continue;
      }

      mappedKeys.add(key);
      mappings.push({
        reaction: match.reaction,
        role,
        position: mappings.length + 1,
      });
      continue;
    }

    const roleLine = splitRoleLine(line);
    if (!roleLine) continue;
    if (!resolveRole(roleLine.rest, roles, { prefix: false })) continue;

    missingReactions.push(line);
  }

  if (unresolved.length) {
    return { error: 'unresolved', items: unresolved.slice(0, 10) };
  }
  if (missingReactions.length) {
    return { error: 'missingReactions', items: missingReactions.slice(0, 10) };
  }
  if (mappings.length === 0) return { error: 'noRoles' };

  const missingRoles = botReactions
    .filter((reaction) => !mappedKeys.has(reactionKey(reaction)))
    .map((reaction) => displayEmoji(reaction.emoji))
    .filter(Boolean);

  if (missingRoles.length) {
    return { error: 'missingRoles', items: missingRoles.slice(0, 10) };
  }

  return { mappings };
}

async function resolveTarget(client, message, token) {
  const value = String(token ?? '').trim();
  if (!value) return { error: 'usage' };

  const link = parseMessageLink(value);
  if (link) {
    if (link.guildId !== message.guildId) return { error: 'guild' };

    const found = await fetchMessage(client, link.channelId, link.messageId);
    if (!found) return { error: 'notFound' };
    return found;
  }

  if (!SNOWFLAKE_REGEX.test(value)) return { error: 'usage' };

  const channel = await client.channels.fetch(message.channelId).catch(() => null);
  if (!channel?.messages?.fetch) return { error: 'notFound' };

  const found = await channel.messages.fetch(value).catch(() => null);
  return found ? { message: found, channel } : { error: 'notFound' };
}

async function recreateReactionRoles(client, message, db, token) {
  const target = await resolveTarget(client, message, token);
  if (target.error) return { ok: false, error: target.error };

  const targetMessage = target.message;
  if (targetMessage?.guildId && targetMessage.guildId !== message.guildId) {
    return { ok: false, error: 'guild' };
  }
  if (!client.user?.id || targetMessage.author?.id !== client.user.id) {
    return { ok: false, error: 'notBot' };
  }

  let guild = client.guilds?.get?.(message.guildId) || null;
  if (!guild && typeof client.guilds?.fetch === 'function') {
    guild = await client.guilds.fetch(message.guildId).catch(() => null);
  }
  if (!guild) return { ok: false, error: 'guild' };

  const parsed = parseReactionRoles(targetMessage, guild);
  if (parsed.error) return { ok: false, ...parsed };

  let me = guild.members?.me || null;
  if (!me && typeof guild.members?.fetchMe === 'function') {
    me = await guild.members.fetchMe().catch(() => null);
  }
  if (!me) return { ok: false, error: 'botMember' };

  const { tooHigh } = validateRoles(
    parsed.mappings.map((mapping) => ({
      id: mapping.role.id,
      name: mapping.role.name,
    })),
    guild,
    me
  );

  if (tooHigh.length) {
    return { ok: false, error: 'tooHigh', roles: tooHigh.slice(0, 10) };
  }

  const freshDb = (await client.database
    .getGuild(message.guildId, false, true)
    .catch(() => null)) || db;
  if (!freshDb) return { ok: false, error: 'save' };

  const freshGuild = freshDb.toObject ? freshDb.toObject() : freshDb;
  const existingEntries = Array.isArray(freshGuild.roles)
    ? freshGuild.roles
    : Array.isArray(db?.roles)
      ? db.roles
      : [];
  const existing = existingEntries.find((entry) => entry.msgId === targetMessage.id);

  const entry = {
    msgId: targetMessage.id,
    chanId: target.channel?.id || targetMessage.channelId,
    roles: parsed.mappings.map(({ reaction, role, position }) => ({
      emoji: displayEmoji(reaction.emoji),
      emojiKey: reaction.emoji?.id || reaction.emoji?.name,
      role: role.id,
      name: role.name,
      position,
    })),
    exclusive: existing?.exclusive ?? null,
    type: targetMessage.content?.trim() ? 'content' : 'embed',
    authorId: targetMessage.author?.id ?? client.user.id,
  };

  const nextRoles = existing
    ? existingEntries.map((item) => (item.msgId === targetMessage.id ? entry : item))
    : [...existingEntries, entry];

  const saved = await client.database
    .updateGuild(message.guildId, { roles: nextRoles })
    .catch(() => null);

  if (!saved || saved.matchedCount === 0) return { ok: false, error: 'save' };

  await trackResource(client, {
    userId: message.author.id,
    groupId: message.guildId,
    category: 'reactionroles',
    key: 'roles',
    action: existing ? 'update' : 'create',
    label: 'Reaction Role Panel',
    value: {
      msgId: entry.msgId,
      chanId: entry.chanId,
      exclusive: entry.exclusive,
      roles: entry.roles,
      type: entry.type,
    },
    previous: existing
      ? {
          msgId: existing.msgId,
          chanId: existing.chanId,
          exclusive: existing.exclusive ?? null,
          roles: existing.roles,
          custom: existing.custom === true,
        }
      : null,
  }).catch(() => {});

  return {
    ok: true,
    entry,
    count: entry.roles.length,
    updated: Boolean(existing),
    link: targetLink(targetMessage, message.guildId),
  };
}

module.exports = {
  recreateReactionRoles,
  parseReactionRoles,
  resolveRole,
};
