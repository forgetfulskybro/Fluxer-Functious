const { EmbedBuilder } = require("@fluxerjs/core");
const { handleDelete } = require("../functions/checkGiveaways");

function getEntryWeight(client, userId, guildId, bonusEntries) {
  let weight = 1;
  if (!Array.isArray(bonusEntries) || bonusEntries.length === 0) return weight;
  try {
    const guild = client.guilds?.get(guildId);
    const member = guild?.members?.get(userId);
    if (member) {
      for (const bonus of bonusEntries) {
        const hasRole = Array.isArray(member.roles)
          ? member.roles.includes(bonus.roleId)
          : member.roles?.has?.(bonus.roleId);
        if (hasRole) weight += Number(bonus.entries) || 0;
      }
    }
  } catch {
  }
  return weight;
}

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

      if (db.imageUrl) noUsers.setImage(db.imageUrl);

      await db.updateOne({ ended: true, endDate });
      handleDelete(db.messageId);

      const channel = await client.channels.resolve(db.channelId);
      const foundMsg = await channel?.messages?.fetch(db.messageId).catch(() => null);
      await foundMsg?.removeAllReactions().catch(() => {});
      return foundMsg?.edit({ embeds: [noUsers] });
    }

    const pool = [...db.picking];
    const winners = [];
    const pickedIds = new Set();
    const allowMultipleWins = db.allowMultipleWins ?? false;

    let workingPool = [];
    for (const u of pool) {
      const weight = getEntryWeight(client, u.userID, db.serverId, db.bonusEntries);
      for (let i = 0; i < weight; i++) workingPool.push(u);
    }

    for (let i = 0; i < db.winners && workingPool.length > 0; i++) {
      const idx = Math.floor(Math.random() * workingPool.length);
      const winner = workingPool[idx];
      winners.push(winner);
      pickedIds.add(winner.userID);

      if (!allowMultipleWins) {
        workingPool = workingPool.filter((u) => u.userID !== winner.userID);
      } else {
        workingPool.splice(idx, 1);
      }
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

    if (db.imageUrl) winnersEmbed.setImage(db.imageUrl);

    const channel = await client.channels.resolve(db.channelId);
    const foundMsg = await channel?.messages?.fetch(db.messageId).catch(() => null);
    await foundMsg?.removeAllReactions().catch(() => {});
    await foundMsg?.edit({ embeds: [winnersEmbed] }).catch(() => {});

    const pingWinners = db.pingWinners ?? true;
    const dmWinnersFlag = db.dmWinners ?? false;

    if (pingWinners) {
      channel
        ?.send({
          content: `${client.translate.get(lang, "Events.messageReactionAdd.congrats")} ${db.pickedWinners.map((w) => `<@${w.id}>`).join(", ")}! ${client.translate.get(lang, "Events.messageReactionAdd.youWon")} **${db.prize}**\nhttps://fluxer.app/channels/${db.serverId}/${db.channelId}/${db.messageId}`,
        })
        .catch(() => {});
    }

    if (dmWinnersFlag) {
      for (const w of db.pickedWinners) {
        try {
          const user = client.users?.get(w.id);
          if (user) {
            const dm = await user.createDM();
            await dm.send(
              `🎉 ${client.translate.get(lang, "Events.messageReactionAdd.congrats")}! ${client.translate.get(lang, "Events.messageReactionAdd.youWon")} **${db.prize}**\nhttps://fluxer.app/channels/${db.serverId}/${db.channelId}/${db.messageId}`,
            );
          }
        } catch {
        }
      }
    }

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
        .catch(() => {});
      return;
    }

    if (userEntry) return;

    const weight = getEntryWeight(client, userId, db.serverId, db.bonusEntries);
    db.users.push({ userID: userId });
    for (let i = 0; i < weight; i++) {
      db.picking.push({ userID: userId });
    }
    await db.save();

    client.reactions.set(userId, Date.now() + 3000);
    setTimeout(() => client.reactions.delete(userId), 3000);

    const entryMsg = weight > 1
      ? ` (${weight}x entries due to role bonus)`
      : "";

    client.users
      .get(userId)
      ?.createDM()
      .then((dm) =>
        dm.send(
          `${client.translate.get(lang, "Events.messageReactionAdd.joined")} [${db.prize}](https://fluxer.app/channels/${db.serverId}/${db.channelId}/${db.messageId})!${entryMsg}\n${client.translate.get(lang, "Events.messageReactionAdd.joined2")} **${db.users.length}** ${client.translate.get(lang, "Events.messageReactionAdd.joined3")}`,
        ),
      )
      .catch(() => {});
  }
};
