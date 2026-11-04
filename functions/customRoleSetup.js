const { EmbedBuilder, PermissionFlags } = require('@fluxerjs/core');
const { parseMessageLink, fetchMessage, SNOWFLAKE_REGEX } = require('./messageSource');
const { reactionKey } = require('./syncReactions');
const { trackResource } = require('../api/trackSettings');

const SETUP_TIMEOUT = 600000;
const MAX_ROLES = 30;
const LINK_REGEX = /(\d{17,20})\/(\d{17,20})\/(\d{17,20})/;

function escapeRegex(str) {
  return String(str ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function color(value) {
  return /^#?[0-9a-f]{6}$/i.test(String(value ?? '')) ? value : '#A52F05';
}

async function resolveChannel(client, channelId) {
  if (!channelId) return null;
  try {
    return (
      (typeof client.channels.resolve === 'function' ? client.channels.resolve(channelId) : null) ||
      (typeof client.channels.fetch === 'function' ? await client.channels.fetch(channelId) : null)
    );
  } catch {
    return null;
  }
}

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

function targetText(target) {
  if (!target) return '';
  if (typeof target.content === 'string' && target.content.trim()) return target.content;

  const embeds = target.embeds
    ? [...(target.embeds.values?.() ?? target.embeds)]
    : [];
  const parts = [];

  for (const embed of embeds) {
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

  return parts.join('\n').trim();
}

function detectRolesInContent(content, guild) {
  const text = String(content ?? '');
  if (!text.trim()) return [];

  const roles = guildRoles(guild);
  const found = [];

  const mentionRegex = /<@&(\d{17,20})>/g;
  for (const match of text.matchAll(mentionRegex)) {
    const role = roles.find((entry) => entry.id === match[1]);
    if (role) {
      found.push({ start: match.index, end: match.index + match[0].length, role });
    }
  }

  const placeholderRegex = /\{role:\s*([^{}\n]+?)\s*\}/gi;
  for (const match of text.matchAll(placeholderRegex)) {
    const name = match[1].trim();
    const role =
      roles.find((entry) => entry.name.toLowerCase() === name.toLowerCase()) ||
      roles.find((entry) => entry.id === name);
    if (role) {
      found.push({ start: match.index, end: match.index + match[0].length, role });
    }
  }

  const masked = text
    .replace(/<@&\d{17,20}>/g, (match) => ' '.repeat(match.length))
    .replace(placeholderRegex, (match) => ' '.repeat(match.length));

  const spans = [];
  const ordered = [...roles]
    .filter((role) => role.name && role.name.length >= 2)
    .sort((a, b) => b.name.length - a.name.length);

  for (const role of ordered) {
    let haystack = masked;
    const regex = new RegExp(
      `(^|[^\\p{L}\\p{N}_])(${escapeRegex(role.name)})(?=$|[^\\p{L}\\p{N}_])`,
      'giu'
    );

    let match;
    while ((match = regex.exec(haystack)) !== null) {
      const start = match.index + match[1].length;
      const end = start + role.name.length;
      if (spans.some((span) => start < span.end && end > span.start)) continue;

      spans.push({ start, end, role });
      haystack = haystack.slice(0, start) + ' '.repeat(end - start) + haystack.slice(end);
    }
  }

  found.push(...spans);
  found.sort((a, b) => a.start - b.start);

  const seen = new Set();
  const orderedRoles = [];
  for (const span of found) {
    if (!span.role || seen.has(span.role.id)) continue;
    seen.add(span.role.id);
    orderedRoles.push(span.role);
  }

  return orderedRoles;
}

function findRole(guild, token) {
  const roles = guildRoles(guild);
  const value = String(token ?? '').trim();
  if (!value) return null;

  const mention = value.match(/^<@&(\d{17,20})>$/);
  if (mention) return roles.find((role) => role.id === mention[1]) || null;

  const placeholder = value.match(/^\{role:\s*([^{}]+?)\s*\}$/i);
  if (placeholder) {
    const name = placeholder[1].trim();
    return (
      roles.find((role) => role.name.toLowerCase() === name.toLowerCase()) ||
      roles.find((role) => role.id === name) ||
      null
    );
  }

  return (
    roles.find((role) => role.id === value) ||
    roles.find((role) => role.name.toLowerCase() === value.toLowerCase()) ||
    null
  );
}

function resolveRoleInput(input, guild) {
  const text = String(input ?? '').trim();
  if (!text) return [];

  const tokens = [];
  const explicit = /<@&(\d{17,20})>|\{role:\s*([^{}]+?)\s*\}/gi;
  let match;
  while ((match = explicit.exec(text)) !== null) {
    tokens.push(match[0]);
  }

  if (tokens.length === 0) {
    const lines = text
      .split(/\r?\n|,|;/)
      .map((line) => line.trim())
      .filter(Boolean);

    for (const line of lines) {
      const direct = findRole(guild, line);
      if (direct) {
        tokens.push(line);
        continue;
      }

      for (const word of line.split(/\s+/).filter(Boolean)) {
        if (findRole(guild, word)) tokens.push(word);
      }
    }
  }

  const seen = new Set();
  const roles = [];
  for (const token of tokens) {
    const role = findRole(guild, token);
    if (!role || seen.has(role.id)) continue;
    seen.add(role.id);
    roles.push(role);
  }

  return roles;
}

function botHighestRole(me) {
  return [...(me?.roles?.cache?.values?.() ?? me?.roles?.values?.() ?? [])].reduce(
    (highest, role) => (role.position > highest.position ? role : highest),
    { position: -1 }
  );
}

function validateRoles(roles, guild, me) {
  const liveRoles = guildRoles(guild);
  const unknown = [];
  const tooHigh = [];
  const highest = botHighestRole(me);

  for (const role of roles) {
    const roleId = role.id || role.role;
    const live = liveRoles.find((entry) => entry.id === roleId);
    if (!live) {
      unknown.push(role.name || roleId);
      continue;
    }
    if (highest.position >= 0 && live.position >= highest.position) {
      tooHigh.push(live.name);
    }
  }

  return { unknown, tooHigh };
}

function targetLink(message, fallbackGuildId = null) {
  const guildId = fallbackGuildId || message?.guildId || message?.guild?.id || '@me';
  const channelId = message?.channelId || message?.channel?.id || '';
  return `https://fluxer.app/channels/${guildId}/${channelId}/${message?.id || ''}`;
}

function listRoles(roles) {
  return roles.map((role, index) => `**${index + 1}.** ${role.name}`).join('\n');
}

async function resolveCustomTarget(client, message, firstArg, channelArg) {
  const token = String(firstArg ?? '').trim();
  const link = parseMessageLink(token);

  if (link) {
    if (link.guildId !== message.guildId) return { error: 'guild' };
    const found = await fetchMessage(client, link.channelId, link.messageId);
    if (!found) return { error: 'missing' };
    return found;
  }

  if (message.messageReference?.messageId) {
    const found = await fetchMessage(
      client,
      message.messageReference.channelId ?? message.channelId,
      message.messageReference.messageId
    );
    if (found) return found;
  }

  if (SNOWFLAKE_REGEX.test(token)) {
    let channel = channelArg;
    if (!channel) {
      channel = await resolveChannel(client, message.channelId);
    }
    if (!channel?.messages?.fetch) return { error: 'missing' };
    const found = await foundMessage(channel, token);
    if (!found) return { error: 'missing' };
    return { message: found, channel };
  }

  return null;
}

async function foundMessage(channel, messageId) {
  const found = await channel.messages.fetch(messageId).catch(() => null);
  return found || null;
}

async function startCustomSetup(client, message, db, targetMessage, targetChannel, existingEntry = null) {
  const userId = message.author.id;
  const language = db.language;
  const theme = color(db.theme);
  const check = client.config?.emojis?.check || '✅';
  const cross = client.config?.emojis?.cross || '❌';

  const me =
    message.guild?.members.me ??
    (message.guild ? await message.guild.members.fetchMe().catch(() => null) : null);
  const perms = me?.permissionsIn?.(targetChannel);

  if (
    !me ||
    !perms ||
    !perms.has(PermissionFlags.ViewChannel) ||
    !perms.has(PermissionFlags.AddReactions)
  ) {
    await message.reply({
      embeds: [
        new EmbedBuilder()
          .setColor('#FF0000')
          .setDescription(client.translate.get(language, 'Commands.roles.customNoPerms')),
      ],
    }).catch(() => {});
    return false;
  }

  const content = targetText(targetMessage);
  let detected = detectRolesInContent(content, message.guild).slice(0, MAX_ROLES);

  if (detected.length === 0 && existingEntry?.roles?.length) {
    const roles = guildRoles(message.guild);
    detected = existingEntry.roles
      .map((entry) => roles.find((role) => role.id === entry.role))
      .filter(Boolean)
      .slice(0, MAX_ROLES);
  }

  const startEmbed = new EmbedBuilder()
    .setColor(theme)
    .setDescription(
      client.translate.get(language, 'Commands.roles.customStart', {
        target: `[${targetMessage.id}](${targetLink(targetMessage)})`,
        channel: `<#${targetChannel.id}>`,
        check,
        cross,
      })
    );

  await message.delete().catch(() => {});

  const controlMessage = await message.channel.send({ embeds: [startEmbed] }).catch(() => null);
  if (!controlMessage) return false;

  await controlMessage.react(check).catch(() => {});
  await controlMessage.react(cross).catch(() => {});

  const reactionDescription = detected.length
    ? client.translate.get(language, 'Commands.roles.customReactRoles', {
        roles: listRoles(detected),
        check,
      })
    : client.translate.get(language, 'Commands.roles.customReactNoRoles', { check });

  const reactionMessage = await message.channel
    .send({
      embeds: [new EmbedBuilder().setColor(theme).setDescription(reactionDescription)],
    })
    .catch(() => null);

  if (!reactionMessage) {
    await controlMessage.edit({
      embeds: [
        new EmbedBuilder()
          .setColor('#FF0000')
          .setDescription(client.translate.get(language, 'Commands.roles.customNoMessage')),
      ],
    }).catch(() => {});
    await controlMessage.removeAllReactions?.().catch(() => {});
    return false;
  }

  const session = {
    custom: true,
    user: userId,
    guildId: message.guildId,
    channelId: message.channel.id,
    controlMessageId: controlMessage.id,
    reactionMessageId: reactionMessage.id,
    targetChannelId: targetChannel.id,
    targetMessageId: targetMessage.id,
    targetAuthorId: targetMessage.author?.id ?? null,
    type: 'custom',
    stage: 'reacting',
    reactions: [],
    detectedRoles: detected.map((role) => ({
      id: role.id,
      name: role.name,
      position: role.position,
    })),
    roles: [],
    rolesDone: [],
    regex: [],
    existing: existingEntry || null,
    timeout: null,
  };

  const timeout = setTimeout(async () => {
    if (client.messageCollector.get(userId) !== session) return;
    await cancelCustomSetup(client, db, session, 'timeout');
  }, SETUP_TIMEOUT);

  session.timeout = timeout;
  client.messageCollector.set(userId, session);
  return true;
}

async function promptForRoles(client, session, db, count) {
  const theme = color(db.theme);
  const controlMessage = await fetchSetupMessage(client, session, 'control');
  if (!controlMessage) return false;

  session.stage = 'roles';

  await controlMessage.edit({
    embeds: [
      new EmbedBuilder()
        .setColor(theme)
        .setDescription(
          client.translate.get(db.language, 'Commands.roles.customRolePrompt', { count })
        ),
    ],
  }).catch(() => {});

  await controlMessage.removeAllReactions?.().catch(() => {});
  await controlMessage.react(client.config?.emojis?.cross || '❌').catch(() => {});

  const reactionMessage = await fetchSetupMessage(client, session, 'reaction');
  await reactionMessage?.delete().catch(() => {});
  return true;
}

async function fetchSetupMessage(client, session, kind) {
  const channel = await resolveChannel(client, session.channelId);
  if (!channel?.messages?.fetch) return null;
  const id = kind === 'control' ? session.controlMessageId : session.reactionMessageId;
  return channel.messages.fetch(id).catch(() => null);
}

async function finalizeCustomSetup(client, session, userId, db, suppliedRoles = null, replyMessage = null) {
  if (!session || !session.custom) return false;

  const language = db.language;
  const theme = color(db.theme);
  const check = client.config?.emojis?.check || '✅';
  const controlMessage = await fetchSetupMessage(client, session, 'control');

  const fail = async (key, data = {}) => {
    const message = client.translate.get(language, `Commands.roles.${key}`, data);
    if (controlMessage) {
      await controlMessage.edit({
        embeds: [new EmbedBuilder().setColor('#FF0000').setDescription(message)],
      }).catch(() => {});
    }
    return false;
  };

  if (!session.reactions.length) {
    return fail('customNoReactions', { check });
  }
  if (session.reactions.length > MAX_ROLES) {
    return fail('customTooMany', { max: MAX_ROLES });
  }

  const guild = client.guilds?.cache?.get?.(session.guildId) || client.guilds?.get?.(session.guildId);
  const targetChannel = await resolveChannel(client, session.targetChannelId);
  const targetMessage = await targetChannel?.messages?.fetch(session.targetMessageId).catch(() => null);
  if (!targetChannel || !targetMessage) {
    await cancelCustomSetup(client, db, session, 'missing');
    return false;
  }

  const roles = suppliedRoles?.length ? suppliedRoles : session.detectedRoles;
  if (!roles || roles.length < session.reactions.length) {
    await promptForRoles(client, session, db, session.reactions.length);
    return false;
  }

  const pairs = session.reactions.slice(0, session.reactions.length).map((reaction, index) => ({
    emoji: reaction.emoji,
    emojiKey: reaction.emojiKey,
    role: roles[index].id,
    name: roles[index].name,
    position: index + 1,
  }));

  const guildForValidation =
    guild || (await client.guilds?.fetch?.(session.guildId).catch(() => null));
  const me =
    guildForValidation?.members?.me ??
    (await guildForValidation?.members?.fetchMe?.().catch(() => null));

  if (!guildForValidation || !me) {
    return fail('customNoPerms');
  }

  const { unknown, tooHigh } = validateRoles(pairs, guildForValidation, me);
  if (unknown.length) {
    return fail('customRolesUnknown', { roles: unknown.join(', ') });
  }
  if (tooHigh.length) {
    return fail('customRolesTooHigh', { roles: tooHigh.join(', ') });
  }

  const existingKeys = new Set();
  try {
    for (const reaction of targetMessage.reactions ?? []) {
      const identifier = reaction?.emojiIdentifier;
      if (identifier) existingKeys.add(reactionKey(identifier));
    }
  } catch {}

  const failed = [];
  for (const pair of pairs) {
    if (existingKeys.has(reactionKey(pair.emoji))) continue;
    try {
      await targetMessage.react(pair.emoji);
    } catch {
      failed.push(pair.emoji);
    }
  }

  const freshDb = (await client.database.getGuild(session.guildId, false)) || db;
  const existing = (freshDb.roles || []).find((entry) => entry.msgId === targetMessage.id);
  const newKeys = new Set(pairs.map((pair) => reactionKey(pair.emoji)));
  for (const previous of existing?.roles || []) {
    if (!previous?.emoji || newKeys.has(reactionKey(previous.emoji))) continue;
    await targetMessage.removeReactionEmoji(previous.emoji).catch(() => {});
  }

  const entry = {
    msgId: targetMessage.id,
    chanId: targetChannel.id,
    roles: pairs,
    custom: true,
    type: 'custom',
    authorId: targetMessage.author?.id ?? null,
    exclusive: existing?.exclusive ?? session.existing?.exclusive ?? null,
  };

  freshDb.roles = existing
    ? freshDb.roles.map((item) => (item.msgId === targetMessage.id ? entry : item))
    : [...(freshDb.roles || []), entry];

  await client.database.updateGuild(session.guildId, { roles: freshDb.roles });

  await trackResource(client, {
    userId,
    groupId: session.guildId,
    category: 'reactionroles',
    key: 'roles',
    action: existing ? 'update' : 'create',
    label: existing ? 'Reaction Role Panel' : 'Reaction Role Panel',
    value: {
      msgId: entry.msgId,
      chanId: entry.chanId,
      exclusive: entry.exclusive,
      roles: entry.roles,
      type: 'custom',
      custom: true,
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

  const success = client.translate.get(language, 'Commands.roles.customSuccess', {
    count: pairs.length,
    target: `[${targetMessage.id}](${targetLink(targetMessage, session.guildId)})`,
  });
  const description = failed.length
    ? `${success}${client.translate.get(language, 'Commands.roles.customPartial', {
        reactions: failed.join(' '),
      })}`
    : success;

  if (controlMessage) {
    await controlMessage.edit({
      embeds: [new EmbedBuilder().setColor(theme).setDescription(description)],
    }).catch(() => {});
    await controlMessage.removeAllReactions?.().catch(() => {});
  }

  const reactionMessage = await fetchSetupMessage(client, session, 'reaction');
  await reactionMessage?.delete().catch(() => {});
  if (replyMessage) await replyMessage.delete().catch(() => {});

  return finishSession(client, session);
}

function finishSession(client, session) {
  clearTimeout(session.timeout);
  if (client.messageCollector.get(session.user) === session) {
    client.messageCollector.delete(session.user);
  }
  return true;
}

async function cancelCustomSetup(client, db, session, reason = 'cancel') {
  if (!session) return false;
  const controlMessage = await fetchSetupMessage(client, session, 'control');
  const reactionMessage = await fetchSetupMessage(client, session, 'reaction');

  const keys = {
    cancel: 'customCancelled',
    timeout: 'customEnded',
    stop: 'customStopped',
    missing: 'customTargetNotFound',
  };
  const key = keys[reason] || keys.cancel;

  if (controlMessage) {
    await controlMessage.edit({
      embeds: [
        new EmbedBuilder()
          .setColor(reason === 'cancel' || reason === 'stop' ? color(db.theme) : '#FF0000')
          .setDescription(client.translate.get(db.language, `Commands.roles.${key}`)),
      ],
    }).catch(() => {});
    await controlMessage.removeAllReactions?.().catch(() => {});
  }

  await reactionMessage?.delete().catch(() => {});
  return finishSession(client, session);
}

async function handleCustomRoleReply(client, message, db) {
  const session = client.messageCollector.get(message.author.id);
  if (!session?.custom || session.stage !== 'roles') return false;
  if (session.channelId !== message.channelId) return false;

  const roles = resolveRoleInput(message.content, message.guild);
  if (roles.length < session.reactions.length) {
    await message.reply({
      embeds: [
        new EmbedBuilder()
          .setColor('#FF0000')
          .setDescription(
            client.translate.get(db.language, 'Commands.roles.customRoleCount', {
              count: session.reactions.length,
              found: roles.length,
            })
          ),
      ],
    }).catch(() => {});
    return true;
  }

  await finalizeCustomSetup(client, session, message.author.id, db, roles, message);
  return true;
}

function addReactionToSession(session, reaction) {
  if (!session || session.stage !== 'reacting') return false;
  if (session.reactions.length >= MAX_ROLES) return false;

  const raw = reaction.emoji || {};
  const isCustom = Boolean(raw.id);
  const emote = isCustom
    ? `<${raw.animated ? 'a' : ''}:${raw.name}:${raw.id}>`
    : raw.name || reaction.emoji?.name;
  const key = isCustom ? raw.id : emote;

  if (!key || session.reactions.some((entry) => entry.emojiKey === key)) return false;

  session.reactions.push({
    emoji: emote,
    emojiKey: key,
    position: session.reactions.length + 1,
  });
  return true;
}

function removeReactionFromSession(session, reaction) {
  if (!session || session.stage !== 'reacting') return false;

  const raw = reaction.emoji || {};
  const key = raw.id || raw.name || reaction.emoji?.name;
  if (!key) return false;

  const before = session.reactions.length;
  session.reactions = session.reactions.filter((entry) => entry.emojiKey !== key);
  return session.reactions.length !== before;
}

module.exports = {
  SETUP_TIMEOUT,
  MAX_ROLES,
  escapeRegex,
  targetText,
  detectRolesInContent,
  resolveRoleInput,
  resolveCustomTarget,
  startCustomSetup,
  finalizeCustomSetup,
  cancelCustomSetup,
  handleCustomRoleReply,
  addReactionToSession,
  removeReactionFromSession,
  fetchSetupMessage,
  validateRoles,
  targetLink,
  LINK_REGEX,
};
