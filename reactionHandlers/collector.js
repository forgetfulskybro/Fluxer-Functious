const { EmbedBuilder } = require("@fluxerjs/core");
const { trackResource } = require('../api/trackSettings');
const explainCooldown = new Map();

module.exports = async (client, message, userId, collector, reactionChan, reactionMsg, emojiId, event = "add") => {
  if (event === "add" && message.messageId === collector.oldMessageId && emojiId !== client.config.emojis.check && emojiId !== client.config.emojis.cross) {
    const cooldownKey = `${userId}_${collector.oldMessageId}`;
    const lastExplanation = explainCooldown.get(cooldownKey);
    const now = Date.now();
    
    if (!lastExplanation || now - lastExplanation > 5000) {
      explainCooldown.set(cooldownKey, now);

      const db = await client.database.getGuild(message.reaction.guildId);
      const botMessage = await reactionChan.messages.fetch(collector.messageId).catch(() => null);
      let explanation;
      if (botMessage) {
        explanation = await botMessage.reply({
          content: client.translate.get(db.language, "Commands.roles.reactWrong"),
        }).catch(() => { });
      } else {
        explanation = await reactionChan.send({
          content: client.translate.get(db.language, "Commands.roles.reactWrong"),
        }).catch(() => { });
      }
      
      setTimeout(() => {
        if (explanation) explanation.delete().catch(() => { });
        explainCooldown.delete(cooldownKey);
      }, 5000);
    }
    return;
  }

  if (emojiId === client.config.emojis.check && collector.oldMessageId === reactionMsg.id) {
    if (collector.roles.length === 0 && collector.rolesDone.length > 0 && collector.regex.length === 0) {
      if (collector.finalizing) return;

      const guildId = collector.guildId ?? message.reaction?.guildId;
      if (!guildId) return;

      collector.finalizing = true;
      let panelMessage = null;
      let saved = false;

      try {
        const db = await client.database.getGuild(guildId);
        const oldMsg = await reactionChan?.messages?.fetch(collector?.oldMessageId).catch(() => null);
        const msg = await reactionChan?.messages?.fetch(collector?.messageId).catch(() => null);
        if (!msg) throw new Error("Reaction role setup message not found");

        const targetChannelId = collector.targetChannelId || reactionMsg.channelId;
        const targetChannel = await client.channels.resolve(targetChannelId).catch(() => null);
        if (!targetChannel) throw new Error("Reaction role target channel not found");

        const finalContent = collector.type === "content"
          ? { content: msg.content || "" }
          : { embeds: [new EmbedBuilder().setColor(db.theme).setDescription(msg.embeds?.[0]?.description || "")] };

        panelMessage = await targetChannel.send(finalContent);

        const entry = {
          msgId: panelMessage.id,
          chanId: targetChannel.id,
          roles: [...collector.rolesDone],
          exclusive: null,
          type: collector.type,
          authorId: panelMessage.author?.id ?? client.user?.id ?? null,
        };

        const freshDb = (await client.database.getGuild(guildId, false)) || db;
        const existingRoles = Array.isArray(freshDb.roles) ? freshDb.roles : [];
        const roles = [
          ...existingRoles.filter((role) => role.msgId !== entry.msgId),
          entry,
        ];
        const result = await client.database.updateGuild(guildId, { roles });
        if (!result || result.matchedCount === 0) throw new Error("Failed to save reaction role panel");
        saved = true;

        await oldMsg?.delete().catch(() => { });
        await reactionMsg?.delete().catch(() => { });
        await msg?.delete().catch(() => { });

        const sortedReactions = [...collector.rolesDone]
          .sort((a, b) => a.position - b.position)
          .map(entry => entry.emoji);

        for (const reaction of sortedReactions) {
          await panelMessage.react(reaction).catch(() => { });
        }

        await trackResource(client, {
          userId: userId,
          groupId: guildId,
          category: 'reactionroles',
          key: 'roles',
          action: 'create',
          label: 'Reaction Role Panel',
          value: entry,
          previous: null,
        });

        if (targetChannel.id !== message.channelId) {
          await reactionChan.send(client.translate.get(db.language, "Commands.roles.success", { channel: `<#${targetChannel.id}>` })).catch(() => { });
        }

        clearTimeout(collector.timeout);
        if (client.messageCollector.get(userId) === collector) client.messageCollector.delete(userId);
        return;
      } catch (e) {
        console.error("[Collector] Error saving reaction role panel:", e);

        if (saved) {
          clearTimeout(collector.timeout);
          if (client.messageCollector.get(userId) === collector) client.messageCollector.delete(userId);
          return;
        }

        collector.finalizing = false;
        if (panelMessage) await panelMessage.delete().catch(() => { });
      }
    }
    return;
  }

  if (emojiId === client.config.emojis.cross && collector.oldMessageId === reactionMsg.id) {
    const db = await client.database.getGuild(message.reaction.guildId);
    client.messageCollector.delete(userId);
        
    reactionMsg?.delete({ silent: true }).catch(() => { });
    return reactionChan?.send({
      embeds: [new EmbedBuilder().setColor(db.theme).setDescription(client.translate.get(db.language, "Events.messageReactionAdd.deleteCollector"))]
    });
  }

  const rawEmoji = message.emoji;
  const isCustom = Boolean(rawEmoji?.id);
  const emote = isCustom
    ? `<${rawEmoji.animated ? "a" : ""}:${rawEmoji.name}:${rawEmoji.id}>`
    : (rawEmoji?.name || emojiId);
  const emojiKey = isCustom ? rawEmoji.id : emote;
  
  if (event === "remove" && message.messageId === collector.messageId) {
    const emojiEntry = collector.rolesDone.find(e => e.emojiKey === emojiKey);
    if (emojiEntry) {
      collector.rolesDone = collector.rolesDone.filter(object => object.emojiKey !== emojiKey);
      collector.roles.unshift({ id: emojiEntry.role, name: emojiEntry.name, oldPosition: emojiEntry.position });
      collector.regex.unshift(emojiEntry.name);
  
      const db = await client.database.getGuild(message.reaction.guildId);
      const roleDisplay = collector.useMention ? `<@&${emojiEntry.role}>` : emojiEntry.name;
  
      const newMsg = await (await client.channels.resolve(message.channelId))
        ?.messages?.fetch(message.messageId)
        .catch(() => null);
      if (!newMsg) return;
  
      return newMsg.edit(
        collector.type === "content"
          ? { content: newMsg.content.replace(`${emojiEntry.emoji} ${roleDisplay}`, `{role:${emojiEntry.name}}`) }
          : {
            embeds: [
              new EmbedBuilder()
                .setColor(db.theme)
                .setDescription(
                  newMsg.embeds[0].description.replace(
                    `${emojiEntry.emoji} ${roleDisplay}`,
                    `{role:${emojiEntry.name}}`
                  )
                ),
            ],
          }
      ).catch(() => { });
    }
    return;
  }
  
  if (collector.roles.length === 0) return;
  
  if (message.messageId === collector.messageId) {
    const assignedRole = collector.roles[0];
    if (!assignedRole?.oldPosition) collector.rolePosition = collector.rolePosition + 1;
    const position = assignedRole?.oldPosition ?? collector.rolePosition;
  
    collector.rolesDone.push({
      emoji: emote,
      emojiKey,
      role: assignedRole.id,
      name: assignedRole.name,
      position,
    });
  
    const db = await client.database.getGuild(message.reaction.guildId);
    const roleDisplay = collector.useMention ? `<@&${assignedRole.id}>` : assignedRole.name;
  
    const freshMsg = await (await client.channels.resolve(message.channelId))
      ?.messages?.fetch(collector.messageId)
      .catch(() => null);
  
    if (!freshMsg) return;
  
    const newContentOrEmbed =
      collector.type === "content"
        ? {
          content: freshMsg.content.replace(
            `{role:${collector.regex[0]}}`,
            `${emote} ${roleDisplay}`
          ),
        }
        : {
          embeds: [
            new EmbedBuilder()
              .setColor(db.theme)
              .setDescription(
                freshMsg.embeds[0].description.replace(
                  `{role:${collector.regex[0]}}`,
                  `${emote} ${roleDisplay}`
                )
              ),
          ],
        };
  
    await freshMsg.edit(newContentOrEmbed).catch(() => { });
  
    collector.roles.shift();
    collector.regex.shift();
  }
};