const cron = require("node-cron");
const Giveaways = require("../models/giveaways");
const { EmbedBuilder } = require("@fluxerjs/core");
const TWELVE_HOURS_SECONDS = 12 * 60 * 60;

let refreshCronJob = null;
let clientRef = null;

const giveawayQueue = new Map();
let windowEndTime = 0;

function buildWeightedPool(users, bonusEntries, guild) {
  const pool = [];

  for (const u of users) {
    let weight = 1;

    if (Array.isArray(bonusEntries) && bonusEntries.length > 0 && guild) {
      try {
        const member = guild.members?.get(u.userID);
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
    }

    for (let i = 0; i < weight; i++) {
      pool.push(u);
    }
  }

  return pool;
}

function pickWinners(giveawayData, guild) {
  const {
    users = [],
    winners: winnerCount,
    allowMultipleWins = false,
    bonusEntries = [],
  } = giveawayData;

  let pool = buildWeightedPool(users, bonusEntries, guild);
  const picked = [];
  const pickedIds = new Set();

  for (let i = 0; i < winnerCount && pool.length > 0; i++) {
    const idx = Math.floor(Math.random() * pool.length);
    const winner = pool[idx];

    picked.push({ id: winner.userID });
    pickedIds.add(winner.userID);

    if (!allowMultipleWins) {
      pool = pool.filter((u) => u.userID !== winner.userID);
    } else {
      pool.splice(idx, 1);
    }
  }

  return picked;
}

async function endGiveaway(client, giveawayData) {
  try {
    const endDate = Date.now();
    const channel = await client.channels.resolve(giveawayData.channelId);

    removeFromQueue(giveawayData.messageId);

    const dmWinners = giveawayData.dmWinners ?? false;
    const pingWinners = giveawayData.pingWinners ?? true;

    if (giveawayData.users.length === 0) {
      const noUsers = new EmbedBuilder()
        .setColor("#A52F05")
        .setTitle(giveawayData.prize)
        .setDescription(
          `${client.translate.get(giveawayData.lang, "Functions.giveawaysEnd.noUsers")}!\n\n${client.translate.get(giveawayData.lang, "Functions.giveawaysEnd.ended")}: <t:${Math.floor(endDate / 1000)}:R>\n${client.translate.get(giveawayData.lang, "Commands.giveaway.hosted")}: <@${giveawayData.owner}>\n${client.translate.get(giveawayData.lang, "Functions.giveawaysEnd.winnersNone")}${giveawayData.requirement ? `\n\n${client.translate.get(giveawayData.lang, "Functions.giveawaysEnd.reqs")}:\n${giveawayData.requirement}` : ``}`,
        );

      if (giveawayData.imageUrl) noUsers.setImage(giveawayData.imageUrl);

      await Giveaways.findOneAndUpdate(
        { messageId: giveawayData.messageId },
        { ended: true, endDate },
      );
      await channel?.send({
        content: `${client.translate.get(giveawayData.lang, "Functions.giveawaysEnd.noOne")} **${giveawayData.prize}**\nhttps://fluxer.app/channels/${giveawayData.serverId}/${giveawayData.channelId}/${giveawayData.messageId}`,
      });

      try {
        const foundMsg = await channel.messages?.fetch(giveawayData.messageId);
        if (foundMsg) {
          await foundMsg.edit({ embeds: [noUsers] });
          await foundMsg.removeAllReactions();
        }
      } catch (err) {
      }
      return;
    }

    const guild = client.guilds?.get(giveawayData.serverId) ?? null;
    const pickedWinners = pickWinners(giveawayData, guild);

    await Giveaways.findOneAndUpdate(
      { messageId: giveawayData.messageId },
      { ended: true, endDate, pickedWinners },
    );

    const embed = new EmbedBuilder()
      .setColor("#A52F05")
      .setTitle(giveawayData.prize)
      .setDescription(
        `${client.translate.get(giveawayData.lang, "Functions.giveawaysEnd.ended")}: <t:${Math.floor(endDate / 1000)}:R>\n${client.translate.get(giveawayData.lang, "Commands.giveaway.hosted")}: <@${giveawayData.owner}>\n${client.translate.get(giveawayData.lang, "Functions.giveawaysEnd.partici")}: ${giveawayData.users.length}\n${client.translate.get(giveawayData.lang, "Functions.giveawaysEnd.winners")}: ${pickedWinners.map((w) => `<@${w.id}>`).join(", ")}${giveawayData.requirement ? `\n\n${client.translate.get(giveawayData.lang, "Functions.giveawaysEnd.reqs")}:\n${giveawayData.requirement}` : ``}`,
      );

    if (giveawayData.imageUrl) embed.setImage(giveawayData.imageUrl);

    const foundChannel = await client.channels.resolve(giveawayData.channelId);
    if (!foundChannel) return;

    if (pingWinners) {
      await foundChannel.send({
        content: `${client.translate.get(giveawayData.lang, "Functions.giveawaysEnd.congrats")} ${pickedWinners.map((w) => `<@${w.id}>`).join(", ")}! ${client.translate.get(giveawayData.lang, "Functions.giveawaysEnd.youWon")} **${giveawayData.prize}**\nhttps://fluxer.app/channels/${giveawayData.serverId}/${giveawayData.channelId}/${giveawayData.messageId}`,
      });
    }

    if (dmWinners) {
      for (const w of pickedWinners) {
        try {
          const user = await client.users?.get(w.id);
          if (user) {
            const dm = await user.createDM();
            await dm.send(
              `🎉 ${client.translate.get(giveawayData.lang, "Functions.giveawaysEnd.congrats")}! ${client.translate.get(giveawayData.lang, "Functions.giveawaysEnd.youWon")} **${giveawayData.prize}**\nhttps://fluxer.app/channels/${giveawayData.serverId}/${giveawayData.channelId}/${giveawayData.messageId}`,
            );
          }
        } catch {
        }
      }
    }

    const foundMsg = await foundChannel.messages?.fetch(giveawayData.messageId);
    if (foundMsg) {
      await foundMsg.edit({ embeds: [embed] });
      await foundMsg.removeAllReactions();
    }
  } catch (err) {
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
    if (existing.timeout) clearTimeout(existing.timeout);
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
  if (queued && queued.timeout) clearTimeout(queued.timeout);
  giveawayQueue.delete(messageId);
}

async function loadQueue() {
  if (!clientRef) return;

  const now = Math.floor(Date.now() / 1000);
  windowEndTime = now + TWELVE_HOURS_SECONDS;

  for (const [, value] of giveawayQueue) {
    if (value.timeout) clearTimeout(value.timeout);
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
    console.error("[Giveaway] loadQueue error:", err.message);
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
  return { queueSize: giveawayQueue.size, windowEndTime };
}

async function startCron(client) {
  clientRef = client;
  if (refreshCronJob) refreshCronJob.stop();
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
  for (const [, value] of giveawayQueue) {
    if (value.timeout) clearTimeout(value.timeout);
  }
  giveawayQueue.clear();
  clientRef = null;
}

module.exports = { startCron, stopCron, handleNew, handleDelete, getStatus };
