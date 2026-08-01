const { EmbedBuilder } = require("@fluxerjs/core");
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
        }).catch(() => {});
      } else {
        explanation = await reactionChan.send({ 
          content: client.translate.get(db.language, "Commands.roles.reactWrong"),
        }).catch(() => {});
      }
      
      if (explanation) {
        setTimeout(() => {
          explanation.delete().catch(() => {});
          explainCooldown.delete(cooldownKey);
        }, 5000);
      }
    }
    return;
  }

  if (emojiId === client.config.emojis.check && collector.oldMessageId === reactionMsg.id) {
    if (collector.roles.length === 0 && collector.rolesDone.length > 0 && collector.regex.length === 0) {
      const db = await client.database.getGuild(message.reaction.guildId);

      try {
        const oldMsg = await reactionChan?.messages?.fetch(collector?.oldMessageId).catch(() => null);
        const msg = await reactionChan?.messages?.fetch(collector?.messageId).catch(() => null);

        await oldMsg?.delete().catch(() => {});
        await reactionMsg?.delete().catch(() => {});

        const targetChannelId = collector.targetChannelId || reactionMsg.channelId;
        const targetChannel = await client.channels.resolve(targetChannelId).catch(() => null);

        const finalContent = collector.type === "content"
          ? { content: msg.content || "" }
          : { embeds: [new EmbedBuilder().setColor("#A52F05").setDescription(msg.embeds?.[0]?.description || "")] };

        targetChannel.send(finalContent).then(async m => {
          await msg?.delete().catch(() => {});

          console.log(collector.rolesDone)
          const sortedReactions = collector.rolesDone
            .sort((a, b) => a.position - b.position)
            .map(entry => entry.emoji);

          for (const reaction of sortedReactions) {
            await m.react(reaction).catch(() => {});
          }

          db.roles.push({ 
            msgId: m.id, 
            chanId: targetChannel.id, 
            roles: [...collector.rolesDone] 
          });
          await client.database.updateGuild(message.reaction.guildId, { roles: db.roles });

          if (targetChannel.id !== message.channelId) {
            await reactionChan.send(`${client.translate.get(db.language, "Commands.roles.success")} <#${targetChannel.id}>`).catch(() => {});
          }
        }).catch(err => {
          console.error("[Collector] Error sending final message:", err);
        });

        clearTimeout(client.messageCollector.get(userId)?.timeout);
        return client.messageCollector.delete(userId);
      } catch (e) {
        console.error("[Collector] Error in check handler:", e);
      }
    }
    return;
  }

  if (emojiId === client.config.emojis.cross && collector.oldMessageId === reactionMsg.id) {
    const db = await client.database.getGuild(message.reaction.guildId);
    client.messageCollector.delete(userId);
        
    reactionMsg?.delete({ silent: true }).catch(() => {});
    return reactionChan?.send({ 
      embeds: [new EmbedBuilder().setColor("#A52F05").setDescription(client.translate.get(db.language, "Events.messageReactionAdd.deleteCollector"))] 
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

      const roleDisplay = collector.useMention ? `<@&${emojiEntry.role}>` : emojiEntry.name;

      const newMsg = await (await client.channels.resolve(message.channelId))?.messages?.fetch(message.messageId).catch(() => null);
      if (!newMsg) return;

      return newMsg.edit(
        collector.type === "content"
          ? { content: newMsg.content.replace(`${emojiEntry.emoji} ${roleDisplay}`, `{role:${emojiEntry.name}}`) }
          : { embeds: [new EmbedBuilder().setColor("#A52F05").setDescription(newMsg.embeds[0].description.replace(`${emojiEntry.emoji} ${roleDisplay}`, `{role:${emojiEntry.name}}`))] }
      ).catch(() => {});
    }
    return;
  }

  if (collector.roles.length === 0) return;
  if (message.messageId === collector.messageId) {
    const assignedRole = collector.roles[0];

    if (!assignedRole?.oldPosition) collector.rolePosition = collector.rolePosition + 1;
    const position = assignedRole?.oldPosition ? assignedRole.oldPosition : collector.rolePosition;

    collector.rolesDone.push({
      emoji: emote,
      emojiKey,
      role: assignedRole.id,
      name: assignedRole.name,
      position,
    });

    const roleDisplay = collector.useMention ? `<@&${assignedRole.id}>` : assignedRole.name;

    reactionMsg?.edit(
      collector.type === "content"
        ? { content: reactionMsg.content.replace(`{role:${collector.regex[0]}}`, `${emote} ${roleDisplay}`) }
        : { embeds: [new EmbedBuilder().setColor("#A52F05").setDescription(reactionMsg.embeds[0].description.replace(`{role:${collector.regex[0]}}`, `${emote} ${roleDisplay}`))] }
    );

    collector.roles.shift();
    collector.regex.shift();
  }
};