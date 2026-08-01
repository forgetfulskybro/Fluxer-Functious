const { EmbedBuilder } = require("@fluxerjs/core");
const { handleDelete } = require("../functions/checkGiveaways");

module.exports = async (client, message, userId, db, emojiId, event = "add") => {
  const lang = db.lang || db.language;

  if (emojiId !== client.config.emojis.confetti && emojiId !== client.config.emojis.stop) return;
  if (db.ended) return;
  if (client.reactions.get(userId)) return;

  if (emojiId === client.config.emojis.stop && db.owner === userId) {
    const endDate = Date.now();

    if (db.users.length === 0) {
      const noUsers = new EmbedBuilder()
        .setColor("#A52F05")
        .setTitle(db.prize)
        .setDescription(
          `${client.translate.get(lang, "Events.messageReactionAdd.early")}\n${client.translate.get(lang, "Events.messageReactionAdd.endNone")}!\n\n${client.translate.get(lang, "Events.messageReactionAdd.ended")}: <t:${Math.floor(endDate / 1000)}:R>\n${client.translate.get(lang, "Commands.giveaway.hosted")}: <@${db.owner}>\n${client.translate.get(lang, "Events.messageReactionAdd.winnersNone")}${db.requirement ? `\n\n${client.translate.get(lang, "Events.messageReactionAdd.reqs")}:\n${db.requirement}` : ""}`,
        );

      await db.updateOne({ ended: true, endDate });
      handleDelete(db.messageId);

      const channel = await client.channels.resolve(db.channelId);
      const foundMsg = await channel?.messages?.fetch(db.messageId).catch(() => null);
      await foundMsg?.removeAllReactions().catch(() => { });
      return foundMsg?.edit({ embeds: [noUsers] });
    }

    const winners = [];
    const pool = [...db.picking];

    for (let i = 0; i < db.winners && pool.length > 0; i++) {
      const idx = Math.floor(Math.random() * pool.length);
      winners.push(pool.splice(idx, 1)[0]);
    }

    db.pickedWinners = winners.map((w) => ({ id: w.userID }));

    await db.updateOne({
      ended: true,
      endDate,
      pickedWinners: db.pickedWinners,
    });
    handleDelete(db.messageId);

    const winnersEmbed = new EmbedBuilder()
      .setColor("#A52F05")
      .setTitle(db.prize)
      .setDescription(
        `${client.translate.get(lang, "Events.messageReactionAdd.early")}\n\n${client.translate.get(lang, "Events.messageReactionAdd.ended")}: <t:${Math.floor(endDate / 1000)}:R>\n${client.translate.get(lang, "Commands.giveaway.hosted")}: <@${db.owner}>\n${client.translate.get(lang, "Events.messageReactionAdd.partici")}: ${db.users.length}\n${client.translate.get(lang, "Events.messageReactionAdd.winners")}: ${db.pickedWinners.length ? db.pickedWinners.map((w) => `<@${w.id}>`).join(", ") : client.translate.get(lang, "Events.messageReactionAdd.none")}${db.requirement ? `\n${client.translate.get(lang, "Events.messageReactionAdd.reqs")}: ${db.requirement}` : ""}`,
      );

    const channel = await client.channels.resolve(db.channelId);
    const foundMsg = await channel?.messages?.fetch(db.messageId).catch(() => null);
    await foundMsg?.removeAllReactions().catch(() => { });
    await foundMsg?.edit({ embeds: [winnersEmbed] }).catch(() => { });

    channel
      ?.send({
        content: `${client.translate.get(lang, "Events.messageReactionAdd.congrats")} ${db.pickedWinners.map((w) => `<@${w.id}>`).join(", ")}! ${client.translate.get(lang, "Events.messageReactionAdd.youWon")} **${db.prize}**\nhttps://fluxer.app/channels/${db.serverId}/${db.channelId}/${db.messageId}`,
      })
      .catch(() => {});

    client.reactions.set(userId, Date.now() + 3000);
    setTimeout(() => client.reactions.delete(userId), 3000);
    return;
  }

  if (emojiId === client.config.emojis.confetti) {
    const userEntry = db.users.find((u) => u.userID === userId);
    if (event === "remove") {
      if (!userEntry) return;

      db.users = db.users.filter((u) => u.userID !== userId);
      db.picking = db.picking.filter((u) => u.userID !== userId);
      await db.save();

      client.reactions.set(userId, Date.now() + 3000);
      setTimeout(() => client.reactions.delete(userId), 3000);

      client.users
        .get(userId)
        ?.createDM()
        .then((dm) =>
          dm.send(
            `${client.translate.get(lang, "Events.messageReactionRemove.left")} [${db.prize}](https://fluxer.app/channels/${db.serverId}/${db.channelId}/${db.messageId})!\n${client.translate.get(lang, "Events.messageReactionRemove.left2")} **${db.users.length}** ${client.translate.get(lang, "Events.messageReactionRemove.left3")}!`,
          ),
        )
        .catch(() => { });
      return;
    }

    if (userEntry) return;
    db.users.push({ userID: userId });
    db.picking.push({ userID: userId });
    await db.save();

    client.reactions.set(userId, Date.now() + 3000);
    setTimeout(() => client.reactions.delete(userId), 3000);

    client.users
      .get(userId)
      ?.createDM()
      .then((dm) =>
        dm.send(
          `${client.translate.get(lang, "Events.messageReactionAdd.joined")} [${db.prize}](https://fluxer.app/channels/${db.serverId}/${db.channelId}/${db.messageId})!\n${client.translate.get(lang, "Events.messageReactionAdd.joined2")} **${db.users.length}** ${client.translate.get(lang, "Events.messageReactionAdd.joined3")}`,
        ),
      )
      .catch(() => { });
  }
  };