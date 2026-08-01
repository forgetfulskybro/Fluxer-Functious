const cron = require("node-cron");
const Giveaways = require("../models/giveaways");
const { EmbedBuilder } = require("@fluxerjs/core");
const TWELVE_HOURS_SECONDS = 12 * 60 * 60;

let refreshCronJob = null;
let clientRef = null;

const giveawayQueue = new Map();
let windowEndTime = 0;

async function endGiveaway(client, giveawayData) {
  try {
    const endDate = Date.now();
    const channel = await client.channels.resolve(giveawayData.channelId);

    removeFromQueue(giveawayData.messageId);

    if (giveawayData.users.length === 0) {
      const noUsers = new EmbedBuilder()
        .setColor("#A52F05")
        .setTitle(giveawayData.prize)
        .setDescription(
          `${client.translate.get(giveawayData.lang, "Functions.giveawaysEnd.noUsers")}!\n\n${client.translate.get(giveawayData.lang, "Functions.giveawaysEnd.ended")}: <t:${Math.floor(endDate / 1000)}:R>\n${client.translate.get(giveawayData.language, "Commands.giveaway.hosted")}: <@${giveawayData.owner}>\n${client.translate.get(giveawayData.lang, "Functions.giveawaysEnd.winnersNone")}${giveawayData.requirement ? `\n\n${client.translate.get(giveawayData.lang, "Functions.giveawaysEnd.reqs")}:\n${giveawayData.requirement}` : ``}`,
        );

      await Giveaways.findOneAndUpdate({ messageId: giveawayData.messageId }, { ended: true, endDate: endDate });
      await channel?.send({ content: `${client.translate.get(giveawayData.lang, "Functions.giveawaysEnd.noOne")} **${giveawayData.prize}**\nhttps://fluxer.app/channels/${giveawayData.serverId}/${giveawayData.channelId}/${giveawayData.messageId}` })

      try {
        const foundMsg = await channel.messages?.fetch(giveawayData.messageId);
        if (foundMsg) {
          await foundMsg.edit({ embeds: [noUsers] });
          await foundMsg.removeAllReactions();
        }
      } catch (err) {
        console.error("[Giveaway] Failed to edit no-users message:", err.message);
      }
      return;
    }

    let pickedWinners = giveawayData.pickedWinners || [];
    let picking = giveawayData.picking || giveawayData.users.slice();

    for (let i = 0; i < giveawayData.winners; i++) {
      let winner = picking[Math.floor(Math.random() * picking.length)];
      if (winner) {
        const filtered = picking.filter(
          (object) => object.userID != winner.userID,
        );
        picking = filtered;
        pickedWinners.push({ id: winner.userID });
      }
    }

    await Giveaways.findOneAndUpdate({ messageId: giveawayData.messageId }, { ended: true, endDate: endDate, pickedWinners: pickedWinners });

    const embed = new EmbedBuilder()
      .setColor("#A52F05")
      .setTitle(giveawayData.prize)
      .setDescription(
        `${client.translate.get(giveawayData.lang, "Functions.giveawaysEnd.ended")}: <t:${Math.floor(endDate / 1000)}:R>\n${client.translate.get(giveawayData.language, "Commands.giveaway.hosted")}: <@${giveawayData.owner}>\n${client.translate.get(giveawayData.lang, "Functions.giveawaysEnd.partici")}: ${giveawayData.users.length}\n${client.translate.get(giveawayData.lang, "Functions.giveawaysEnd.winners")}: ${pickedWinners.map((w) => `<@${w.id}>`).join(", ")}${giveawayData.requirement ? `\n\n${client.translate.get(giveawayData.lang, "Functions.giveawaysEnd.reqs")}:\n${giveawayData.requirement}` : ``}`,
      );

    const foundChannel = await client.channels.resolve(giveawayData.channelId);
    if (!foundChannel) return;

    await foundChannel.send({
      content: `${client.translate.get(giveawayData.lang, "Functions.giveawaysEnd.congrats")} ${pickedWinners.map((w) => `<@${w.id}>`).join(", ")}! ${client.translate.get(giveawayData.lang, "Functions.giveawaysEnd.youWon")} **${giveawayData.prize}**\nhttps://fluxer.app/channels/${giveawayData.serverId}/${giveawayData.channelId}/${giveawayData.messageId}`,
    });

    const foundMsg = await foundChannel.messages?.fetch(giveawayData.messageId);
    if (foundMsg) {
      await foundMsg.edit({ embeds: [embed] });
      await foundMsg.removeAllReactions();
    }
  } catch (err) {
    console.error("[Giveaway] Failed to end giveaway:", err.message);
  }
}

async function fetchMsg(client, gw) {
  try {
    const givChannel = await client.channels.resolve(gw.channelId);
    if (!givChannel) return;

    await givChannel.messages?.fetch(gw.messageId).catch(() => {});
  } catch {}
}

async function processQueue(client, messageId) {
  giveawayQueue.delete(messageId);

  const gw = await Giveaways.findOne({ messageId });
  if (!gw || gw.ended) return;

  await fetchMsg(client, gw);
  await endGiveaway(client, gw);
}

function addToQueue(gw) {
  const now = Date.now();
  const endTime = Number(gw.now) + Number(gw.time);
  const queueKey = gw.messageId;

  if (giveawayQueue.has(queueKey)) {
    const existing = giveawayQueue.get(queueKey);
    if (existing.timeout) {
      clearTimeout(existing.timeout);
    }
  }

  const delay = endTime - now;

  if (delay <= 0) {
    processQueue(clientRef, queueKey);
    return;
  }

  const timeout = setTimeout(() => {
    processQueue(clientRef, queueKey);
  }, delay);

  giveawayQueue.set(queueKey, {
    timeout,
    messageId: gw.messageId,
    endTime: Math.floor(endTime / 1000),
  });
}

function removeFromQueue(messageId) {
  const queued = giveawayQueue.get(messageId);

  if (queued && queued.timeout) {
    clearTimeout(queued.timeout);
  }

  giveawayQueue.delete(messageId);
}

async function loadQueue() {
  if (!clientRef) return;

  const now = Math.floor(Date.now() / 1000);
  windowEndTime = now + TWELVE_HOURS_SECONDS;

  for (const [key, value] of giveawayQueue) {
    if (value.timeout) {
      clearTimeout(value.timeout);
    }
  }
  giveawayQueue.clear();

  try {
    const currentTime = Date.now();
    const windowEndMs = windowEndTime * 1000;

    const giveaways = await Giveaways.find({ ended: false });

    for (const gw of giveaways) {
      const endTime = Number(gw.now) + Number(gw.time);
      if (endTime <= currentTime) {
        await endGiveaway(clientRef, gw);
      } else if (endTime <= windowEndMs) {
        addToQueue(gw);
      }
    }
  } catch (err) {
  }
}

function handleNew(giveawayData) {
  if (!clientRef) return;

  const now = Date.now();
  const endTime = Number(giveawayData.now) + Number(giveawayData.time);

  if (endTime <= windowEndTime * 1000 && endTime > now) {
    addToQueue(giveawayData);
  }
}

function handleDelete(messageId) {
  removeFromQueue(messageId);
}

function getStatus() {
  return {
    queueSize: giveawayQueue.size,
    windowEndTime,
  };
}

async function startCron(client) {
  clientRef = client;

  if (refreshCronJob) {
    refreshCronJob.stop();
  }

  await loadQueue();

  refreshCronJob = cron.schedule("0 */12 * * *", async () => {
    await loadQueue();
  });
}

function stopCron() {
  if (refreshCronJob) {
    refreshCronJob.stop();
    refreshCronJob = null;
  }

  for (const [key, value] of giveawayQueue) {
    if (value.timeout) {
      clearTimeout(value.timeout);
    }
  }
  giveawayQueue.clear();
  clientRef = null;
}

module.exports = { startCron, stopCron, handleNew, handleDelete, getStatus };