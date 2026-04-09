const cron = require("node-cron");
const Giveaways = require("../models/giveaways");
const { EmbedBuilder } = require("@erinjs/core");

let cronJob = null;

async function endGiveaway(client, db) {
  try {
  const endDate = Date.now();
  const channel = await client.channels.resolve(db.channelId);
  
  if (db.users.length === 0) {
    const noUsers = new EmbedBuilder()
      .setColor("#A52F05")
      .setTitle(db.prize)
      .setDescription(
        `${client.translate.get(db.lang, "Functions.giveawaysEnd.noUsers")}!\n\n${client.translate.get(db.lang, "Functions.giveawaysEnd.ended")}: <t:${Math.floor(endDate / 1000)}:R>\n${client.translate.get(db.language, "Commands.giveaway.hosted")}: <@${db.owner}>\n${client.translate.get(db.lang, "Functions.giveawaysEnd.winnersNone")}${db.requirement ? `\n\n${client.translate.get(db.lang, "Functions.giveawaysEnd.reqs")}:\n${db.requirement}` : ``}`,
      );

    await db.updateOne({ ended: true, endDate: endDate });
    await channel?.send({ content: `${client.translate.get(db.lang, "Functions.giveawaysEnd.noOne")} **${db.prize}**\nhttps://fluxer.app/channels/${db.serverId}/${db.channelId}/${db.messageId}` })

    try {
      const foundMsg = await channel.messages?.fetch(db.messageId);
      if (foundMsg) {
        await foundMsg.edit({ embeds: [noUsers] });
        await foundMsg.removeAllReactions();
      }
    } catch (err) {
      console.error("[Giveaway] Failed to edit no-users message:", err.message);
    }
    return;
  }

  for (let i = 0; i < db.winners; i++) {
    let winner = db.picking[Math.floor(Math.random() * db.picking.length)];
    if (winner) {
      const filtered = db.picking.filter(
        (object) => object.userID != winner.userID,
      );
      db.picking = filtered;
      db.pickedWinners.push({ id: winner.userID });
    }
  }

  await db.updateOne({ ended: true, endDate: endDate, pickedWinners: db.pickedWinners });

  const embed = new EmbedBuilder()
    .setColor("#A52F05")
    .setTitle(db.prize)
    .setDescription(
      `${client.translate.get(db.lang, "Functions.giveawaysEnd.ended")}: <t:${Math.floor(endDate / 1000)}:R>\n${client.translate.get(db.language, "Commands.giveaway.hosted")}: <@${db.owner}>\n${client.translate.get(db.lang, "Functions.giveawaysEnd.partici")}: ${db.users.length}\n${client.translate.get(db.lang, "Functions.giveawaysEnd.winners")}: ${db.pickedWinners.map((w) => `<@${w.id}>`).join(", ")}${db.requirement ? `\n\n${client.translate.get(db.lang, "Functions.giveawaysEnd.reqs")}:\n${db.requirement}` : ``}`,
    );

    const foundChannel = await client.channels.resolve(db.channelId);
    if (!foundChannel) return;

    await foundChannel.send({
      content: `${client.translate.get(db.lang, "Functions.giveawaysEnd.congrats")} ${db.pickedWinners.map((w) => `<@${w.id}>`).join(", ")}! ${client.translate.get(db.lang, "Functions.giveawaysEnd.youWon")} **${db.prize}**\nhttps://fluxer.app/channels/${db.serverId}/${db.channelId}/${db.messageId}`,
    });

    const foundMsg = await foundChannel.messages?.fetch(db.messageId);
    if (foundMsg) {
      await foundMsg.edit({ embeds: [embed] });
      await foundMsg.removeAllReactions();
    }
  } catch (err) {
    console.error("[Giveaway] Failed to end giveaway:", err.message);
  }
}

async function processDueGiveaways(client) {
  const giveaways = await Giveaways.find({ ended: false });

  for (const giveaway of giveaways) {
    const now = Number(giveaway.now);
    const time = Number(giveaway.time);
    const endTime = now + time;
    if (Date.now() >= endTime) {
      await endGiveaway(client, giveaway);
    }
  }
}

function startGiveawaysCron(client) {
  if (cronJob) {
    cronJob.stop();
  }

  cronJob = cron.schedule("*/5 * * * * *", async () => {
    await processDueGiveaways(client);
  });
}

function stopGiveawaysCron() {
  if (cronJob) {
    cronJob.stop();
    cronJob = null;
  }
}

module.exports = { startGiveawaysCron, stopGiveawaysCron };