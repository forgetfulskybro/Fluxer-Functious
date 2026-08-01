const { EmbedBuilder } = require("@fluxerjs/core");
const db = require("../models/polls");
const cron = require("node-cron");
const Polls = require("./poll");
const TWELVE_HOURS_SECONDS = 12 * 60 * 60;

let refreshCronJob = null;
let clientRef = null;

const pollQueue = new Map();
let windowEndTime = 0;

async function endPoll(client, poll) {
  try {
    removeFromQueue(poll.messageId);

    const channel = await client.channels.resolve(poll.channelId);
    if (!channel) return;

    const msg = await channel.messages?.fetch(poll.messageId).catch(() => null);
    if (!msg) return;

    await db.findOneAndUpdate({ messageId: poll.messageId }, { ended: true });
    const newPoll = new Polls({
      time: 0,
      client,
      name: { name: "", description: poll.desc },
      options: poll.options,
      votes: poll.votes,
      users: poll.users,
      owner: poll.owner,
      lang: poll.lang,
    });
    await newPoll.update();

    let tooMuch = [];
    if (poll.desc?.length > 80)
      tooMuch.push(
        `**${client.translate.get(poll.lang, "Events.messageReactionRemove.title")}**: ${poll.desc}`,
      );
    poll.options?.name
      ?.filter((e) => e)
      .forEach((e, i) => {
        i++;
        if (e.length > 70) {
          tooMuch.push(`**${i}.** ${e}`);
        }
      });

    const pollImage = await fetch(`${process.env.CDN}/api/upload`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        apikey: process.env.CDN_KEY,
        image: newPoll.canvas.toDataURL("image/png"),
        timeframe: 60,
        messageId: poll.messageId,
        last: true,
      }),
    })
      .then((i) => i.json())

    await msg.edit({
      embeds: [
        new EmbedBuilder()
          .setDescription(
            `${client.translate.get(poll.lang, "Functions.poll.end")}${tooMuch.length > 0 ? `\n\n${tooMuch.map((e) => e).join("\n")}` : ""}`,
          )
          .setImage(`${process.env.CDN}${pollImage.url}`)
          .setColor(`#A52F05`),
      ],
    });

    await msg.removeAllReactions().catch(() => { });
    client.polls.delete(poll.messageId);
  } catch {}
}

function addToQueue(pollData) {
  const now = Date.now();
  const endTime = Number(pollData.now) + Number(pollData.time);
  const queueKey = pollData.messageId;

  if (pollQueue.has(queueKey)) {
    const existing = pollQueue.get(queueKey);
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

  pollQueue.set(queueKey, {
    timeout,
    messageId: pollData.messageId,
    endTime: Math.floor(endTime / 1000),
  });
}

function removeFromQueue(messageId) {
  const queued = pollQueue.get(messageId);

  if (queued && queued.timeout) {
    clearTimeout(queued.timeout);
  }

  pollQueue.delete(messageId);
}

async function processQueue(client, messageId) {
  pollQueue.delete(messageId);

  const poll = await db.findOne({ messageId });
  if (!poll || poll.ended) return;

  await endPoll(client, poll);
}

async function loadQueue() {
  if (!clientRef) return;

  const now = Math.floor(Date.now() / 1000);
  windowEndTime = now + TWELVE_HOURS_SECONDS;

  for (const [key, value] of pollQueue) {
    if (value.timeout) {
      clearTimeout(value.timeout);
    }
  }
  pollQueue.clear();

  try {
    const currentTime = Date.now();
    const windowEndMs = windowEndTime * 1000;

    const polls = await db.find({ ended: false });

    for (const poll of polls) {
      const endTime = Number(poll.now) + Number(poll.time);
      if (endTime <= currentTime) {
        await endPoll(clientRef, poll);
      } else if (endTime <= windowEndMs) {
        addToQueue(poll);
      }
    }
  } catch (err) {
  }
}

function handleNew(pollData) {
  if (!clientRef) return;

  const now = Date.now();
  const endTime = Number(pollData.now) + Number(pollData.time);

  if (endTime <= windowEndTime * 1000 && endTime > now) {
    addToQueue(pollData);
  }
}

function handleDelete(messageId) {
  removeFromQueue(messageId);
}

function getStatus() {
  return {
    queueSize: pollQueue.size,
    windowEndTime,
  };
}

async function initializePolls(client) {
  const polls = await db.find({ ended: false });
  if (!polls?.length) return;

  for (const poll of polls) {
    const pollInstance = new Polls({
      time: poll.time,
      client,
      name: { name: "", description: poll.desc },
      options: poll.options,
      votes: poll.votes,
      users: poll.users,
      owner: poll.owner,
      lang: poll.lang,
    });

    client.polls.set(poll.messageId, {
      poll: pollInstance,
      messageId: poll.messageId,
      channelId: poll.channelId,
      owner: poll.owner,
    });
  }
}

async function startCron(client) {
  clientRef = client;

  if (refreshCronJob) {
    refreshCronJob.stop();
  }

  await initializePolls(client);
  await loadQueue();

  refreshCronJob = cron.schedule("0 */12 * * *", async () => {
    await initializePolls(clientRef);
    await loadQueue();
  });
}

function stopCron() {
  if (refreshCronJob) {
    refreshCronJob.stop();
    refreshCronJob = null;
  }

  for (const [key, value] of pollQueue) {
    if (value.timeout) {
      clearTimeout(value.timeout);
    }
  }
  pollQueue.clear();
  clientRef = null;
}

module.exports = { startCron, stopCron, handleNew, handleDelete, getStatus };