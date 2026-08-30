const { Router } = require('express');
const { EmbedBuilder, PermissionFlags } = require('@fluxerjs/core');
const { makeRequireApiKey } = require('../middleware');
const { trackResource, actorFromReq } = require('../trackSettings');

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
      const { type = 'content', channelId, content, roles: roleMappings, exclusive, useMention } =
        req.body || {};

      if (!channelId || !content || !Array.isArray(roleMappings) || roleMappings.length === 0) {
        return res.status(400).json({ error: 'channelId, content and at least one role mapping required' });
      }
      if (roleMappings.length > 30) {
        return res.status(400).json({ error: 'Maximum 30 reactions per message' });
      }

      const liveGuild = client.guilds?.get(guildId);
      if (!liveGuild) return res.status(404).json({ error: 'Guild not found on bot' });

      const db = await client.database.getGuild(guildId, false);
      if (!db) return res.status(404).json({ error: 'Guild not found' });
      if (db.roles.length > 30) {
        return res.status(400).json({ error: 'Maximum 30 reaction role messages reached' });
      }

      const channel = await client.channels.resolve(channelId);
      if (!channel || channel.type === 2 || channel.type === 4) {
        return res.status(400).json({ error: 'Invalid text channel' });
      }

      const me = liveGuild.members.me ?? (await liveGuild.members.fetchMe());
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
          ? { embeds: [new EmbedBuilder().setColor('#A52F05').setDescription(finalText.slice(0, 4040))] }
          : { content: finalText.slice(0, 1960) };

      const msg = await channel.send(payload);

      for (const r of processedRoles) {
        await msg.react(r.emoji).catch(() => {});
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

      if (!content || !Array.isArray(roleMappings) || roleMappings.length === 0) {
        return res.status(400).json({ error: 'content and at least one role mapping required for full edit' });
      }

      const channel = await client.channels.resolve(existing.chanId);
      if (!channel) return res.status(400).json({ error: 'Channel no longer exists' });

      const msg = await channel.messages.fetch(messageId).catch(() => null);
      if (!msg) return res.status(404).json({ error: 'Fluxer message not found' });

      const msgType = type || (msg.content?.length > 0 ? 'content' : 'embed');
      const { finalText, processedRoles } = buildMessageContent(content, roleMappings, useMention);

      const payload =
        msgType === 'embed'
          ? { embeds: [new EmbedBuilder().setColor('#A52F05').setDescription(finalText.slice(0, 4040))], content: null }
          : { content: finalText.slice(0, 1960), embeds: [] };

      await msg.edit(payload);
      await msg.removeAllReactions().catch(() => {});

      for (const r of processedRoles) {
        await msg.react(r.emoji).catch(() => {});
      }

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

      return res.json({ ok: true, entry });
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
        await msg?.delete().catch(() => {});
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