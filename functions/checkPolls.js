const { EmbedBuilder } = require("@erinjs/core");
const db = require("../models/polls");
const cron = require("node-cron");
const Polls = require("./poll");

let cronJob = null;

async function endPoll(client, poll) {
  try {
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
            `${client.translate.get(poll.lang, "Functions.poll.end")}${tooMuch.length > 0 ? `\n\n${tooMuch.map((e) => e).join("\n")}` : ""}\n_ _`,
          )
          .setImage(`${process.env.CDN}${pollImage.url}`)
          .setColor(`#A52F05`),
      ],
    });

    await msg.removeAllReactions().catch(() => { });
    client.polls.delete(poll.messageId);
  } catch {}
}

async function processDuePolls(client) {
  const polls = await db.find({ ended: false });
  if (!polls?.length) return;

  for (const poll of polls) {
    const now = Number(poll.now);
    const time = Number(poll.time);
    const dueTime = now + time;
    if (Date.now() >= dueTime) {
      await endPoll(client, poll);
    }
  }
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
    //await pollInstance.update();

    client.polls.set(poll.messageId, {
      poll: pollInstance,
      messageId: poll.messageId,
      channelId: poll.channelId,
      owner: poll.owner,
    });
  }
}

async function startPollsCron(client) {
  if (cronJob) {
    cronJob.stop();
  }

  await initializePolls(client);

  cronJob = cron.schedule("*/5 * * * * *", async () => {
    await processDuePolls(client);
  });
}

function stopPollsCron() {
  if (cronJob) {
    cronJob.stop();
    cronJob = null;
  }
}

module.exports = { startPollsCron, stopPollsCron };
