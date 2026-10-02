const crypto = require("crypto");
const { EmbedBuilder } = require("@fluxerjs/core");
const { handleNewReminder } = require("../functions/checkReminders");
const { findUserWatcher, WATCH_EMOJI, beginSelfSend, endSelfSend } = require("../functions/checkReactionReminders");
const { buildFingerprint, attachNames, buildSample, createProfile } = require("../functions/messageSimilarity");
const fetchTime = require("../functions/fetchTime");

const MAX_REMINDERS = 25;
const MAX_MESSAGE_LENGTH = 400;
const DISPLAY_LENGTH = 120;
const MIN_TIME_SECONDS = 59;
const MAX_TIME_SECONDS = 63115209;
const CONFIRM_TIME_MS = 30000;
const CODE_CHARS_REGEX = /[`\\]/g;
const DISPLAY_WHITESPACE_REGEX = /\s+/g;

function truncate(str, maxLen) {
  if (!str) return str;
  return str.length > maxLen ? str.substring(0, maxLen - 3) + "..." : str;
}

function escapeCode(text) {
  return String(text ?? "").replace(CODE_CHARS_REGEX, "\\$&");
}

function codeSample(text, maxLen = DISPLAY_LENGTH) {
  const flat = String(text ?? "").replace(DISPLAY_WHITESPACE_REGEX, " ").trim();
  return `\`${escapeCode(truncate(flat, maxLen))}\``;
}

function choiceEmojis(client) {
  return {
    "yes": client.config?.emojis?.check || "✅",
    "no": client.config?.emojis?.cross || "❌",
  };
}

function timeLabel(client, durationSeconds, language) {
  return fetchTime(durationSeconds * 1000, client, language, false, true).replace(/,/g, "");
}

async function replyTracked(target, payload) {
  beginSelfSend();
  let sent;
  try {
    sent = await target.reply(payload);
    return sent;
  } finally {
    endSelfSend(sent?.id);
  }
}

async function clearTrigger(reactionMsg) {
  try {
    await reactionMsg.removeReactionEmoji?.(WATCH_EMOJI);
  } catch {
  }
}

function createdEmbed(client, options) {
  const embed = new EmbedBuilder()
    .setColor(options.color)
    .setDescription(client.translate.get(options.language, "Commands.remind.clickCreated", {
      "time": options.timeStr,
      "date": `<t:${options.timestamp}:f>`,
      "message": codeSample(options.reminderText),
      "emoji": WATCH_EMOJI,
    }));
  if (options.footer) embed.setFooter(options.footer);
  return embed;
}

async function storeReminder(client, options) {
  const reminder = {
    id: crypto.randomUUID(),
    timestamp: options.timestamp,
    message: options.reminderText,
    channelId: options.channelId,
    sourceMessageId: options.sourceMessageId,
    createdAt: options.now,
    type: "guild",
  };

  const userData = await client.database.getUser(options.userId, true);
  await client.database.updateUser(
    options.userId,
    { reminders: [...(userData.reminders || []), reminder] },
    true
  );

  handleNewReminder(options.userId, reminder);
  return reminder;
}

function findExistingReminder(reminders, channelId, sourceMessageId, now) {
  return (reminders || []).find(
    (reminder) =>
      reminder?.channelId === channelId &&
      reminder?.sourceMessageId === sourceMessageId &&
      Number(reminder?.timestamp) > now
  );
}

async function askForAnother(client, options) {
  const { yes, no } = choiceEmojis(client);
  const footer = options.footer;

  const embed = new EmbedBuilder()
    .setColor(options.color)
    .setDescription(
      client.translate.get(options.language, "Commands.remind.clickDuplicate", {
        "time": options.timeStr,
        "date": `<t:${options.existing.timestamp}:f>`,
        "message": codeSample(options.reminderText),
        "yes": yes,
        "no": no,
      })
    );
  if (footer) embed.setFooter(footer);

  const prompt = await replyTracked(options.reactionMsg, { embeds: [embed] });
  await prompt.react(yes).catch(() => {});
  await prompt.react(no).catch(() => {});

  const answered = await new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    let collector;
    try {
      collector = prompt.createReactionCollector({
        filter: (r, user) => (r.emoji?.name === yes || r.emoji?.name === no) && user?.id === options.userId,
        time: CONFIRM_TIME_MS,
      });
    } catch (err) {
      finish(null);
      return;
    }

    collector.on("collect", (r) => finish(r.emoji?.name === yes));
    collector.on("end", () => finish(null));
  });

  if (answered === true) {
    const latest = await client.database.getUser(options.userId, true);
    if ((latest?.reminders?.length || 0) >= MAX_REMINDERS) {
      await prompt.edit({
        embeds: [new EmbedBuilder().setColor("#FF0000").setDescription(
          client.translate.get(options.language, "Commands.remind.maxReminders", {
            "max": MAX_REMINDERS,
            "cmd1": "`remind delete <index>`",
            "cmd2": "`remind list`",
          })
        )],
      }).catch(() => {});
    } else {
      await storeReminder(client, options);
      await prompt.edit({ embeds: [createdEmbed(client, options)] }).catch(() => {});
    }
    await prompt.removeAllReactions().catch(() => {});
  } else {
    await prompt.delete().catch(() => {});
  }

  return answered === true;
}

module.exports = async function reminderReactionHandler(client, reaction, userId, reactionMsg, reactionChan) {
  if (reaction.emoji?.name !== WATCH_EMOJI) return;

  const guildId = reactionMsg?.guildId || reactionChan?.guildId || reaction?.guildId || null;
  const channelId = reactionMsg?.channelId || reactionChan?.id || reaction?.channelId || null;
  if (!guildId || !channelId) return;

  const guildDb = await client.database.getGuild(guildId, false).catch(() => null);
  const language = guildDb?.language || "en_EN";
  const color = guildDb?.theme || "#A52F05";

  const profile = createProfile(
    buildFingerprint(reactionMsg),
    attachNames(reactionMsg)
  );

  const match = await findUserWatcher(userId, profile, guildId, channelId);
  if (!match) return;

  const durationSeconds = Math.floor(Number(match.watcher.durationSeconds));
  if (!Number.isFinite(durationSeconds)) return;
  if (durationSeconds < MIN_TIME_SECONDS || durationSeconds > MAX_TIME_SECONDS) return;

  const userData = await client.database.getUser(userId, true);
  if (!userData) return;
  if ((userData.reminders?.length || 0) >= MAX_REMINDERS) {
    await replyTracked(reactionMsg, {
      embeds: [
        new EmbedBuilder()
          .setColor("#FF0000")
          .setDescription(
            client.translate.get(language, "Commands.remind.maxReminders", {
              "max": MAX_REMINDERS,
              "cmd1": "`remind delete <index>`",
              "cmd2": "`remind list`",
            })
          ),
      ],
    }).catch(() => {});
    await clearTrigger(reactionMsg);
    return;
  }

  const now = Math.floor(Date.now() / 1000);
  const timestamp = now + durationSeconds;
  const sample = buildSample(reactionMsg);
  const customMessage = typeof match.watcher.reminderMessage === "string"
    ? match.watcher.reminderMessage.trim()
    : "";
  const reminderText = (customMessage || sample || profile.fingerprint).slice(0, MAX_MESSAGE_LENGTH);

  const owner = await client.users.fetch(userId).catch(() => null);
  const ownerName = owner
    ? (owner.displayName || owner.username || owner.globalName || `<@${userId}>`)
    : null;

  const footer = ownerName
    ? {
      "text": client.translate.get(language, "Commands.remind.clickFooter", { "user": ownerName }),
      "iconURL": owner?.displayAvatarURL?.({ size: 128 }) || owner?.avatarURL?.({ size: 128 }) || undefined,
    }
    : null;

  const options = {
    userId,
    language,
    color,
    footer,
    ownerName,
    now,
    timestamp,
    timeStr: timeLabel(client, durationSeconds, language),
    channelId,
    sourceMessageId: reactionMsg?.id || null,
    reminderText,
    reactionMsg,
  };

  const existing = findExistingReminder(userData.reminders, channelId, options.sourceMessageId, now);

  if (existing) {
    await askForAnother(client, { ...options, existing });
    await clearTrigger(reactionMsg);
    return;
  }

  await storeReminder(client, options);

  await replyTracked(reactionMsg, { embeds: [createdEmbed(client, options)] })
    .catch(() => {});
  await clearTrigger(reactionMsg);
};
