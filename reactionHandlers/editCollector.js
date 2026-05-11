const { EmbedBuilder } = require("@erinjs/core");

module.exports = async (client, message, userId, editCollector, reactionChan, reactionMsg, emojiId, event = "add") => {
  if (emojiId === client.config.emojis.check && editCollector.botMessage === reactionMsg?.id) {
    if (editCollector.roles.length > 0 || editCollector.rolesDone.length === 0 || editCollector.regex.length > 0) return;

    const db = await client.database.getGuild(message.guildId);
    const reactions = editCollector.rolesDone.map((e) => e.emoji);
    const oldMsg = await reactionChan?.messages?.fetch(editCollector.oldMessageId).catch(() => null);
    const msg = await reactionChan?.messages?.fetch(editCollector.messageId).catch(() => null);

    if (!oldMsg) {
      reactionMsg?.channel
        ?.send({
          embeds: [new EmbedBuilder().setColor("#FF0000").setDescription(client.translate.get(db.language, "Events.messageCreate.noMessage"))],
        })
        .catch(() => {});

      clearTimeout(client.messageEdit.get(userId)?.timeout);
      client.messageEdit.delete(userId);
      await reactionMsg?.delete().catch(() => {});
      return;
    }

    try {
      await reactionMsg?.delete().catch(() => {});
      await oldMsg.removeAllReactions().catch(() => {});
      await oldMsg.edit(
        editCollector.type === "content"
          ? { content: msg.content }
          : { embeds: [new EmbedBuilder().setColor("#A52F05").setDescription(msg.embeds[0]?.description || "")] },
      );

      for (const reaction of reactions) {
        await oldMsg.react(reaction).catch(() => {});
      }

      db.roles = [
        ...db.roles.filter((e) => e.msgId !== editCollector.oldMessageId),
        { msgId: oldMsg.id, chanId: message.channelId, roles: [...editCollector.rolesDone] },
      ];

      await client.database.updateGuild(message.guildId, { roles: db.roles });
      await msg.delete().catch(() => { });
      
      return reactionMsg.channel.send({ embeds: [new EmbedBuilder().setColor("#A52F05").setDescription(client.translate.get(db.language, "Commands.roles.successEdit", { message: `[msg](https://fluxer.app/channels/${message.guild.id}/${editCollector.channelId}/${editCollector.oldMessageId})` }))] }).catch(() => {});
    } catch (error) {
      reactionMsg.channel.send({ embeds: [new EmbedBuilder().setColor("#FF0000").setDescription(`An error occured: ${error.message}`)] }).catch(() => {});
      console.error(error);
    }

    clearTimeout(client.messageEdit.get(userId)?.timeout);
    client.messageEdit.delete(userId);
    return;
  }

  if (emojiId === client.config.emojis.cross && editCollector.botMessage === reactionMsg?.id) {
    const db = await client.database.getGuild(message.guildId);

    client.messageEdit.delete(userId);
    await reactionMsg?.delete({ silent: true }).catch(() => {});

    return reactionChan?.send({
      embeds: [new EmbedBuilder().setColor("#A52F05").setDescription(client.translate.get(db.language, "Events.messageReactionAdd.deleteCollector"))],
    });
  }

  if (event === "remove") {
    const emote = message.emoji?.id ? `<:${emojiId}:${message.emoji.id}>` : emojiId;
    const emoji = editCollector.rolesDone.find((e) => e.emoji === emote);

    if (!emoji) return;

    editCollector.rolesDone = editCollector.rolesDone.filter((e) => e.emoji !== emote);
    editCollector.roles.unshift([emoji.role, { name: emoji.name }]);
    editCollector.regex.unshift(emoji.name);

    const newMsg = await client.channels
      .resolve(message.channelId)
      ?.messages?.fetch(message.messageId)
      .catch(() => null);

    if (!newMsg) return;

    const replaceText = `${emote} ${emoji.name}`;
    const withText = `{role:${emoji.name}}`;

    const editContent =
      editCollector.type === "content"
        ? { content: newMsg.content.replace(replaceText, withText) }
        : { embeds: [new EmbedBuilder().setColor("#A52F05").setDescription(newMsg.embeds[0]?.description?.replace(replaceText, withText) || "")] };

    return newMsg.edit(editContent).catch(() => {});
  }

  if (editCollector.roles.length === 0) return;

  const emote = message.emoji?.id ? `<:${emojiId}:${message.emoji.id}>` : emojiId;
  editCollector.rolesDone.push({ emoji: emote, role: editCollector.roles[0][0], name: editCollector.roles[0][1].name });

  const replaceText = `{role:${editCollector.regex[0]}}`;
  const withText = `${emote} ${editCollector.roles[0][1].name}`;

  await reactionMsg?.edit(
    editCollector.type === "content"
      ? { content: reactionMsg.content.replace(replaceText, withText) }
      : { embeds: [new EmbedBuilder().setColor("#A52F05").setDescription(reactionMsg.embeds[0]?.description?.replace(replaceText, withText) || "")] },
  ).catch(() => {});

  editCollector.roles.shift();
  editCollector.regex.shift();
};