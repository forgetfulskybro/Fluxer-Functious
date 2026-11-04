const { Router } = require('express');
const { EmbedBuilder, PermissionFlags } = require('@fluxerjs/core');
const { makeRequireApiKey } = require('../middleware');
const { trackResource, actorFromReq } = require('../trackSettings');
const { syncReactions, reactionKey } = require('../../functions/syncReactions');

function reactionRolesRouter(client, apiKey) {
  const router = Router({ mergeParams: true });
  const requireApiKey = makeRequireApiKey(apiKey);

  router.get('/:messageId', requireApiKey, async (req, res) => {
    const { guildId, messageId } = req.params;

    try {
      const db = await client.database.getGuild(guildId, false);
      if (!db) return res.status(404).json({ error: 'Guild not found' });

      const entry = db.roles.find((e) => e.msgId === messageId);
      if (!entry) return res.status(404).json({ error: 'Reaction role message not found' });

      const channel = await client.channels.resolve(entry.chanId);
      if (!channel) return res.status(404).json({ error: 'Channel not found' });

      const message = await channel.messages.fetch(messageId).catch(() => null);
      if (!message) return res.status(404).json({ error: 'Message not found' });

      if (entry.custom === true) {
        return res.json({
          ok: true,
          content: String(message.content || message.embeds?.[0]?.description || ''),
          type: 'custom',
          useMention: false,
          custom: true,
          entry,
        });
      }

      const isContent = (message.content || '').length > 0;
      const rawText = isContent ? message.content : message.embeds?.[0]?.description || '';
      const { text, useMention } = reverseRolePlaceholders(rawText, entry.roles || []);

      return res.json({
        ok: true,
        content: text,
        type: isContent ? 'content' : 'embed',
        useMention,
        entry,
      });
    } catch (err) {
      console.log(err);
      return res.status(500).json({ error: String(err?.message || err) });
    }
  });

  router.post('/', requireApiKey, async (req, res) => {
    try {
      const { guildId } = req.params;
      const {
        type = 'content',
        channelId,
        messageId: targetMessageId,
        messageLink,
        content,
        roles: roleMappings,
        exclusive,
        useMention,
        custom,
      } = req.body || {};
      const isCustom = custom === true;

      if (!Array.isArray(roleMappings) || roleMappings.length === 0) {
        return res.status(400).json({ error: 'At least one role mapping required' });
      }
      if (roleMappings.length > 30) {
        return res.status(400).json({ error: 'Maximum 30 reactions per message' });
      }
      if (!isCustom && (!channelId || !content)) {
        return res.status(400).json({ error: 'channelId and content are required' });
      }

      const liveGuild = client.guilds?.get(guildId);
      if (!liveGuild) return res.status(404).json({ error: 'Guild not found on bot' });

      const db = await client.database.getGuild(guildId, false);
      if (!db) return res.status(404).json({ error: 'Guild not found' });
      if (db.roles.length > 30) {
        return res.status(400).json({ error: 'Maximum 30 reaction role messages reached' });
      }

      const me = liveGuild.members.me ?? (await liveGuild.members.fetchMe());

      if (isCustom) {
        const parsedLink =
          typeof messageLink === 'string'
            ? /(\d{17,20})\/(\d{17,20})\/(\d{17,20})/.exec(messageLink)
            : null;
        const targetChannelId = parsedLink?.[2] || channelId;
        const targetId = parsedLink?.[3] || targetMessageId;

        if (!targetChannelId || !targetId) {
          return res.status(400).json({ error: 'A channel and message ID, or a message link, is required' });
        }

        const channel = await client.channels.resolve(targetChannelId);
        if (!channel || channel.type === 2 || channel.type === 4) {
          return res.status(400).json({ error: 'Invalid text channel' });
        }
        if (channel.guildId && channel.guildId !== guildId) {
          return res.status(400).json({ error: 'Channel is not in this guild' });
        }

        const perms = me.permissionsIn(channel);
        if (!perms.has(PermissionFlags.AddReactions) || !perms.has(PermissionFlags.ViewChannel)) {
          return res.status(403).json({ error: 'Bot missing Add Reactions / View Channel' });
        }

        const targetMessage = await channel.messages.fetch(String(targetId)).catch(() => null);
        if (!targetMessage) return res.status(404).json({ error: 'Message not found' });
        if (targetMessage.guildId && targetMessage.guildId !== guildId) {
          return res.status(400).json({ error: 'Message is not in this guild' });
        }

        const { processedRoles, invalid, tooHigh } = processCustomMappings(
          roleMappings,
          liveGuild,
          me
        );
        if (invalid.length) {
          return res.status(400).json({ error: 'Unknown role(s)', detail: invalid.join(', ') });
        }
        if (tooHigh.length) {
          return res.status(403).json({
            error: 'Roles are above the bot highest role',
            detail: tooHigh.join(', '),
          });
        }
        if (!processedRoles.length) {
          return res.status(400).json({ error: 'At least one valid role mapping required' });
        }

        const failed = await addCustomReactions(targetMessage, processedRoles);
        const entry = {
          msgId: targetMessage.id,
          chanId: channel.id,
          roles: processedRoles,
          custom: true,
          type: 'custom',
          authorId: targetMessage.author?.id ?? null,
          exclusive: exclusive ? true : null,
        };

        db.roles = db.roles || [];
        const existingIndex = db.roles.findIndex((item) => item.msgId === targetMessage.id);
        if (existingIndex === -1) {
          db.roles.push(entry);
        } else {
          const previous = db.roles[existingIndex];
          const newKeys = new Set(processedRoles.map((role) => reactionKey(role.emoji)));
          for (const old of previous.roles || []) {
            if (!old?.emoji || newKeys.has(reactionKey(old.emoji))) continue;
            await targetMessage.removeReactionEmoji(old.emoji).catch(() => {});
          }
          db.roles[existingIndex] = entry;
        }
        await client.database.updateGuild(guildId, { roles: db.roles });

        await trackResource(client, {
          userId: actorFromReq(req),
          groupId: guildId,
          category: 'reactionroles',
          key: 'roles',
          action: 'create',
          label: 'Custom Reaction Role Panel',
          value: { ...entry },
          previous: null,
        });

        return res.status(201).json({ ok: true, entry, failedReactions: failed });
      }

      const channel = await client.channels.resolve(channelId);
      if (!channel || channel.type === 2 || channel.type === 4) {
        return res.status(400).json({ error: 'Invalid text channel' });
      }

      const perms = me.permissionsIn(channel);
      if (
        !perms.has(PermissionFlags.SendMessages) ||
        !perms.has(PermissionFlags.AddReactions) ||
        !perms.has(PermissionFlags.ViewChannel)
      ) {
        return res.status(403).json({ error: 'Bot missing Send Messages / Add Reactions / View Channel' });
      }

      const { finalText, processedRoles } = buildMessageContent(content, roleMappings, useMention);

      const payload =
        type === 'embed'
          ? { embeds: [new EmbedBuilder().setColor(db.theme).setDescription(finalText.slice(0, 4040))] }
          : { content: finalText.slice(0, 1960) };

      const msg = await channel.send(payload);

      const { failed } = await syncReactions(msg, processedRoles.map((r) => r.emoji));
      if (failed.length) {
        await msg.delete().catch(() => {});
        return res.status(500).json({
          error: 'Failed to add reactions to the new reaction role message',
          detail: failed.join(', '),
        });
      }

      const entry = {
        msgId: msg.id,
        chanId: channel.id,
        roles: processedRoles,
        exclusive: exclusive ? true : null,
      };

      db.roles = db.roles || [];
      db.roles.push(entry);
      await client.database.updateGuild(guildId, { roles: db.roles });

      await trackResource(client, {
        userId: actorFromReq(req),
        groupId: guildId,
        category: 'reactionroles',
        key: 'roles',
        action: 'create',
        label: 'Reaction Role Panel',
        value: {
          msgId: entry.msgId,
          chanId: entry.chanId,
          exclusive: entry.exclusive,
          roles: processedRoles,
          type,
        },
        previous: null,
      });

      return res.status(201).json({ ok: true, entry });
    } catch (err) {
      console.error('[API] POST reaction-roles:', err);
      return res.status(500).json({
        error: 'Failed to create reaction role message',
        detail: String(err?.message || err),
      });
    }
  });

  router.patch('/:messageId', requireApiKey, async (req, res) => {
    try {
      const { guildId, messageId } = req.params;
      const body = req.body || {};
      const { type, content, roles: roleMappings, exclusive, useMention } = body;

      const db = await client.database.getGuild(guildId, false);
      if (!db) return res.status(404).json({ error: 'Guild not found' });

      const idx = (db.roles || []).findIndex((e) => e.msgId === messageId);
      if (idx === -1) return res.status(404).json({ error: 'Reaction role message not found' });

      const existing = db.roles[idx];

      const onlyExclusive =
        Object.prototype.hasOwnProperty.call(body, 'exclusive') &&
        content === undefined &&
        roleMappings === undefined;

      if (onlyExclusive) {
        const nextExclusive = exclusive ? true : null;
        const entry = { ...existing, exclusive: nextExclusive };
        db.roles[idx] = entry;
        await client.database.updateGuild(guildId, { roles: db.roles });

        await trackResource(client, {
          userId: actorFromReq(req),
          groupId: guildId,
          category: 'reactionroles',
          key: 'roles',
          action: 'update',
          label: 'Reaction Role Exclusive',
          value: { msgId: messageId, exclusive: nextExclusive },
          previous: { msgId: messageId, exclusive: existing.exclusive ?? null },
        });

        return res.json({ ok: true, entry });
      }

      if (existing.custom === true) {
        if (!Array.isArray(roleMappings) || roleMappings.length === 0) {
          return res.status(400).json({ error: 'At least one role mapping required' });
        }

        const liveGuild = client.guilds?.get(guildId);
        if (!liveGuild) return res.status(404).json({ error: 'Guild not found on bot' });

        const channel = await client.channels.resolve(existing.chanId);
        if (!channel) return res.status(400).json({ error: 'Channel no longer exists' });

        const me = liveGuild.members.me ?? (await liveGuild.members.fetchMe());
        const perms = me.permissionsIn(channel);
        if (!perms.has(PermissionFlags.AddReactions)) {
          return res.status(403).json({ error: 'Bot missing Add Reactions' });
        }

        const msg = await channel.messages.fetch(messageId).catch(() => null);
        if (!msg) return res.status(404).json({ error: 'Fluxer message not found' });

        const { processedRoles, invalid, tooHigh } = processCustomMappings(
          roleMappings,
          liveGuild,
          me
        );
        if (invalid.length) {
          return res.status(400).json({ error: 'Unknown role(s)', detail: invalid.join(', ') });
        }
        if (tooHigh.length) {
          return res.status(403).json({
            error: 'Roles are above the bot highest role',
            detail: tooHigh.join(', '),
          });
        }
        if (!processedRoles.length) {
          return res.status(400).json({ error: 'At least one valid role mapping required' });
        }

        const newKeys = new Set(processedRoles.map((role) => reactionKey(role.emoji)));
        for (const role of existing.roles || []) {
          if (newKeys.has(reactionKey(role.emoji))) continue;
          await msg.removeReactionEmoji(role.emoji).catch(() => {});
        }

        const failed = await addCustomReactions(msg, processedRoles);
        const entry = {
          ...existing,
          roles: processedRoles,
          custom: true,
          type: 'custom',
          exclusive: Object.prototype.hasOwnProperty.call(body, 'exclusive')
            ? exclusive
              ? true
              : null
            : existing.exclusive ?? null,
        };

        db.roles[idx] = entry;
        await client.database.updateGuild(guildId, { roles: db.roles });

        await trackResource(client, {
          userId: actorFromReq(req),
          groupId: guildId,
          category: 'reactionroles',
          key: 'roles',
          action: 'update',
          label: 'Custom Reaction Role Panel',
          value: { ...entry },
          previous: { ...existing },
        });

        return res.json({ ok: true, entry, failedReactions: failed });
      }

      if (!content || !Array.isArray(roleMappings) || roleMappings.length === 0) {
        return res.status(400).json({ error: 'content and at least one role mapping required for full edit' });
      }

      const channel = await client.channels.resolve(existing.chanId);
      if (!channel) return res.status(400).json({ error: 'Channel no longer exists' });

      const liveGuild = client.guilds?.get(guildId);
      if (liveGuild) {
        const me = liveGuild.members.me ?? (await liveGuild.members.fetchMe());
        const perms = me.permissionsIn(channel);
        if (!perms.has(PermissionFlags.AddReactions)) {
          return res.status(403).json({ error: 'Bot missing Add Reactions' });
        }
      }

      const msg = await channel.messages.fetch(messageId).catch(() => null);
      if (!msg) return res.status(404).json({ error: 'Fluxer message not found' });

      const msgType = type || (msg.content?.length > 0 ? 'content' : 'embed');
      const { finalText, processedRoles } = buildMessageContent(content, roleMappings, useMention);

      const payload =
        msgType === 'embed'
          ? { embeds: [new EmbedBuilder().setColor(db.theme).setDescription(finalText.slice(0, 4040))], content: null }
          : { content: finalText.slice(0, 1960), embeds: [] };

      await msg.edit(payload);
      const { failed } = await syncReactions(msg, processedRoles.map((r) => r.emoji));

      const entry = {
        ...existing,
        roles: processedRoles,
        exclusive: Object.prototype.hasOwnProperty.call(body, 'exclusive')
          ? exclusive
            ? true
            : null
          : existing.exclusive ?? null,
      };

      db.roles[idx] = entry;
      await client.database.updateGuild(guildId, { roles: db.roles });

      await trackResource(client, {
        userId: actorFromReq(req),
        groupId: guildId,
        category: 'reactionroles',
        key: 'roles',
        action: 'update',
        label: 'Reaction Role Panel',
        value: {
          msgId: entry.msgId,
          chanId: entry.chanId,
          exclusive: entry.exclusive,
          roles: processedRoles,
          type: msgType,
        },
        previous: {
          msgId: existing.msgId,
          chanId: existing.chanId,
          exclusive: existing.exclusive ?? null,
          roles: existing.roles,
        },
      });

      return res.json({ ok: true, entry, failedReactions: failed });
    } catch (err) {
      console.error('[API] PATCH reaction-roles:', err);
      return res.status(500).json({
        error: 'Failed to update reaction role message',
        detail: String(err?.message || err),
      });
    }
  });

  router.post('/:messageId/exclusive', requireApiKey, async (req, res) => {
    try {
      const { guildId, messageId } = req.params;

      const db = await client.database.getGuild(guildId, false);
      if (!db) return res.status(404).json({ error: 'Guild not found' });

      const entry = (db.roles || []).find((e) => e.msgId === messageId);
      if (!entry) return res.status(404).json({ error: 'Reaction role message not found' });

      const isExclusive = entry.exclusive ?? false;
      const nextExclusive = isExclusive ? null : true;

      const updated = db.roles.map((e) =>
        e.msgId === messageId ? { ...e, exclusive: nextExclusive } : e
      );

      await client.database.updateGuild(guildId, { roles: updated });

      const newEntry = updated.find((e) => e.msgId === messageId);

      await trackResource(client, {
        userId: actorFromReq(req),
        groupId: guildId,
        category: 'reactionroles',
        key: 'roles',
        action: 'update',
        label: 'Reaction Role Exclusive',
        value: { msgId: messageId, exclusive: nextExclusive },
        previous: { msgId: messageId, exclusive: entry.exclusive ?? null },
      });

      return res.json({
        ok: true,
        entry: newEntry,
        exclusive: nextExclusive === true,
      });
    } catch (err) {
      console.error('[API] POST reaction-roles exclusive:', err);
      return res.status(500).json({ error: 'Failed to toggle exclusive', detail: String(err?.message || err) });
    }
  });

  router.delete('/:messageId', requireApiKey, async (req, res) => {
    try {
      const { guildId, messageId } = req.params;
      const db = await client.database.getGuild(guildId, false);
      if (!db) return res.status(404).json({ error: 'Guild not found' });

      const entry = db.roles.find((e) => e.msgId === messageId);
      if (!entry) return res.status(404).json({ error: 'Not found' });

      try {
        const ch = await client.channels.resolve(entry.chanId);
        const msg = await ch?.messages?.fetch(messageId).catch(() => null);
        if (entry.custom === true) {
          for (const role of entry.roles || []) {
            await msg?.removeReactionEmoji(role.emoji).catch(() => {});
          }
        } else {
          await msg?.delete().catch(() => {});
        }
      } catch {}

      const next = db.roles.filter((e) => e.msgId !== messageId);
      await client.database.updateGuild(guildId, { roles: next });

      await trackResource(client, {
        userId: actorFromReq(req),
        groupId: guildId,
        category: 'reactionroles',
        key: 'roles',
        action: 'delete',
        label: 'Reaction Role Panel',
        value: null,
        previous: {
          msgId: entry.msgId,
          chanId: entry.chanId,
          exclusive: entry.exclusive ?? null,
          roles: entry.roles,
          custom: entry.custom === true,
        },
      });

      return res.json({ ok: true });
    } catch (err) {
      console.error('[API] DELETE reaction-roles:', err);
      return res.status(500).json({ error: 'Failed to delete' });
    }
  });

  return router;
}

function escapeRegex(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getGuildRole(guild, roleId) {
  const roles = guild?.roles;
  if (!roles) return null;
  if (typeof roles.get === 'function') return roles.get(roleId) || null;
  if (roles.cache?.get) return roles.cache.get(roleId) || null;
  return null;
}

function processCustomMappings(roleMappings, liveGuild, me) {
  const processedRoles = [];
  const invalid = [];
  const tooHigh = [];
  const highest = [...(me?.roles?.cache?.values?.() ?? me?.roles?.values?.() ?? [])].reduce(
    (current, role) => (role.position > current.position ? role : current),
    { position: -1 }
  );

  for (let i = 0; i < (roleMappings || []).length; i++) {
    const mapping = roleMappings[i];
    const emoji = String(mapping?.emoji ?? '').trim();
    const roleId = String(mapping?.role ?? '');
    if (!emoji || !roleId) continue;

    const role = getGuildRole(liveGuild, roleId);
    if (!role) {
      invalid.push(roleId);
      continue;
    }
    if (highest.position >= 0 && role.position >= highest.position) {
      tooHigh.push(role.name);
      continue;
    }

    processedRoles.push({
      emoji,
      emojiKey: emojiKeyFrom(emoji),
      role: roleId,
      name: String(mapping?.name || role.name),
      position: mapping?.position ?? i + 1,
    });
  }

  return { processedRoles, invalid, tooHigh };
}

async function addCustomReactions(message, processedRoles) {
  const present = new Set();
  for (const reaction of message?.reactions ?? []) {
    const identifier = reaction?.emojiIdentifier;
    if (identifier) present.add(reactionKey(identifier));
  }

  const failed = [];
  for (const role of processedRoles) {
    if (present.has(reactionKey(role.emoji))) continue;
    try {
      await message.react(role.emoji);
    } catch {
      failed.push(role.emoji);
    }
  }

  return failed;
}

function reverseRolePlaceholders(text, roleMappings) {
  let result = String(text || '');
  const useMention = /<@&\d+>/.test(result);
  const sorted = [...(roleMappings || [])].sort(
    (a, b) => String(b.emoji || '').length - String(a.emoji || '').length
  );

  for (const r of sorted) {
    const emoji = String(r.emoji || '');
    const roleName = String(r.name || r.roleName || '');
    const roleId = String(r.role || '');
    if (!emoji) continue;

    const esc = escapeRegex(emoji);
    const placeholder = `{role:${roleName || roleId}}`;

    if (roleId) {
      const mentionRe = new RegExp(esc + '\\s*<@&' + escapeRegex(roleId) + '>', 'gi');
      result = result.replace(mentionRe, placeholder);
    }

    if (roleName) {
      const nameRe = new RegExp(esc + '\\s*' + escapeRegex(roleName), 'gi');
      result = result.replace(nameRe, placeholder);
    }

    if (roleName) {
      const looseRe = new RegExp(esc + '\\s*\\w+', 'gi');
      result = result.replace(looseRe, (match) => (match.includes('{role:') ? match : placeholder));
    }
  }

  return { text: result.trim(), useMention };
}

function emojiKeyFrom(emoji) {
  const custom = emoji.match(/:(\d+)>/);
  if (custom) return custom[1];
  return emoji;
}

function buildMessageContent(content, roleMappings, useMention) {
  let finalText = String(content ?? '');
  const processedRoles = [];

  for (let i = 0; i < (roleMappings || []).length; i++) {
    const m = roleMappings[i];
    const emoji = String(m.emoji ?? '').trim();
    const roleId = String(m.role ?? '');
    const roleName = String(m.name ?? '');
    if (!emoji || !roleId) continue;

    const roleDisplay = useMention ? `<@&${roleId}>` : roleName;
    const placeholder = `{role:${roleName}}`;
    if (roleName && finalText.includes(placeholder)) {
      finalText = finalText.replace(new RegExp(escapeRegex(placeholder), 'g'), `${emoji} ${roleDisplay}`);
    }

    processedRoles.push({
      emoji,
      emojiKey: emojiKeyFrom(emoji),
      role: roleId,
      name: roleName,
      position: m.position ?? i + 1,
    });
  }

  finalText = finalText.replace(/\{mention\}/gi, '').trim();

  return { finalText, processedRoles };
}

module.exports = reactionRolesRouter;