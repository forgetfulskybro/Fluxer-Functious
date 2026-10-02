const crypto = require("crypto");
const fetchTime = require("../functions/fetchTime");
const { handleNewReminder, handleDeletedReminder } = require("../functions/checkReminders");
const { EmbedBuilder } = require("@fluxerjs/core");
const { parseTimeForUser, parseWatchTime } = require("../functions/reminderTime");
const { addWatcher, removeWatchers, MAX_WATCHERS, WATCH_EMOJI, beginSelfSend, endSelfSend } = require("../functions/checkReactionReminders");
const { buildFingerprint, buildSample, detectSourceType, attachNames, isMatchable } = require("../functions/messageSimilarity");

const EMBED_COLORS = {
  ERROR: "#FF0000",
  DEFAULT: "#A52F05",
};

const CONFIG = {
  MAX_REMINDERS: 25,
  MAX_MESSAGE_LENGTH: 400,
  DISPLAY_LENGTH: 120,
  MIN_TIME_SECONDS: 59,
  MAX_TIME_SECONDS: 63115209,
  WORDS_TO_REMOVE: ["me", "to", "for"],
  MENTIONS: ["@here", "@everyone"]
};

const SNOWFLAKE_REGEX = /^\d{17,20}$/;
const LINK_REGEX = /(\d{17,20})\/(\d{17,20})\/(\d{17,20})/;
const CODE_CHARS_REGEX = /[`\\]/g;
const DISPLAY_WHITESPACE_REGEX = /\s+/g;
const CONFIRM_TIME_MS = 30000;

function truncate(str, maxLen) {
  if (!str) return str;
  return str.length > maxLen ? str.substring(0, maxLen - 3) + "..." : str;
}

function escapeCode(text) {
  return String(text ?? "").replace(CODE_CHARS_REGEX, "\\$&");
}

function codeSample(text, maxLen = CONFIG.DISPLAY_LENGTH) {
  const flat = String(text ?? "").replace(DISPLAY_WHITESPACE_REGEX, " ").trim();
  return `\`${escapeCode(truncate(flat, maxLen))}\``;
}

async function sendTracked(channel, payload) {
  beginSelfSend();
  let sent;
  try {
    sent = await channel.send(payload);
    return sent;
  } finally {
    endSelfSend(sent?.id);
  }
}

function cleanReminderMessage(text) {
  let cleaned = text;
  CONFIG.MENTIONS.forEach(mention => {
    cleaned = cleaned.replace(new RegExp(mention, 'gi'), '');
  });

  const words = cleaned.split(/\s+/).filter(w => w.length > 0);
  const removedWords = new Set();
  let contentStarted = false;

  return words
    .filter((word) => !CONFIG.MENTIONS.includes(word.toLowerCase()))
    .filter((word) => {
      const lowerWord = word.toLowerCase();
      if (contentStarted) return true;
      
      if (CONFIG.WORDS_TO_REMOVE.includes(lowerWord) && !removedWords.has(lowerWord)) {
        removedWords.add(lowerWord);
        return false;
      }
      
      contentStarted = true;
      return true;
    })
    .join(" ");
}

function cleanWatcherMessage(text) {
  return String(text ?? "")
    .split(/\s+/)
    .filter((word) => word.length > 0)
    .filter((word) => !CONFIG.MENTIONS.includes(word.toLowerCase().replace(/[<>]/g, "")))
    .join(" ");
}

function createEmbed(color, title = null, description = null) {
  const embed = new EmbedBuilder().setColor(color);
  if (title) embed.setTitle(title);
  if (description) embed.setDescription(description);
  return embed;
}

function getExamples(prefix, client, language) {
  return {
    basic: `\`${prefix}remind ${client.translate.get(language, "Commands.remind.basic")}\`\n\`${prefix}remind 1h30m meeting\``,
    dm: `\`${prefix}remind dm ${client.translate.get(language, "Commands.remind.dm")}\``,
    list: `\`${prefix}remind list\``,
    delete: `\`${prefix}remind delete 1\``,
    create: `\`${prefix}remind ${client.translate.get(language, "Commands.remind.create")}\``,
    timeFormats: client.translate.get(language, "Commands.remind.timeFormats"),
    shortFormats: client.translate.get(language, "Commands.remind.shortFormats"),
    add: `\`${prefix}remind add <${client.translate.get(language, "Commands.remind.source")}> <${client.translate.get(language, "Commands.remind.time")}> [${client.translate.get(language, "Commands.remind.reminderText")}]\``,
    rlist: `\`${prefix}remind rlist\``,
    rdelete: `\`${prefix}remind rdelete 1\``,
  };
}

function errorEmbed(prefix, type, client, language, extra = "") {
  const examples = getExamples(prefix, client, language);
  const messages = {
    noArgs: `${client.translate.get(language, "Commands.remind.noArgs")}\n\n**${client.translate.get(language, "Commands.remind.example")}:**\n${examples.basic}\n${examples.list}\n${examples.delete}`,
    noInput: `${client.translate.get(language, "Commands.remind.noInput")}\n\n**${client.translate.get(language, "Commands.remind.example")}:**\n${examples.basic}\n${examples.dm}`,
    noMessage: `${client.translate.get(language, "Commands.remind.noMessage")}\n\n**${client.translate.get(language, "Commands.remind.example")}:**\n${examples.create}\n\`${prefix}remind 2h meeting with team\``,
    invalidTime: `${client.translate.get(language, "Commands.remind.invalidTime")}\n\n**${client.translate.get(language, "Commands.remind.example")}:**\n${examples.basic}\n\`${prefix}remind tomorrow at 5pm call mom\``,
    pastTime: `${client.translate.get(language, "Commands.remind.pastTime")}\n\n**${client.translate.get(language, "Commands.remind.example")}:**\n\`${prefix}remind in 30 minutes ...\`\n\`${prefix}remind 2 hours ...\`\n\`${prefix}remind tomorrow at 5pm ...\``,
    tooShort: `${client.translate.get(language, "Commands.remind.tooShort")}\n\n**${client.translate.get(language, "Commands.remind.example")}:**\n\`${prefix}remind in 1 minute ...\`\n\`${prefix}remind in 5 minutes ...\`\n\`${prefix}remind 1h ...\``,
    tooLong: `${client.translate.get(language, "Commands.remind.tooLong", { "max": CONFIG.MAX_MESSAGE_LENGTH })}\n${extra}`,
    maxReminders: client.translate.get(language, "Commands.remind.maxReminders", { "max": CONFIG.MAX_REMINDERS, "cmd1": `${prefix}remind delete <index>`, "cmd2": `${prefix}remind list` }),
    noReminders: `${client.translate.get(language, "Commands.remind.noReminders")}\n\n**Create one:** ${examples.create}`,
    invalidIndex: client.translate.get(language, "Commands.remind.invalidIndex", { "cmd": `${prefix}remind list` }),
    deleteUsage: `${client.translate.get(language, "Commands.remind.deleteUsage")}\n\n**${client.translate.get(language, "Commands.remind.example")}:** ${examples.delete}`,
    tooFar: `${client.translate.get(language, "Commands.remind.tooFar")}\n\n**${client.translate.get(language, "Commands.remind.example")}:**\n\`${prefix}remind 1 year ...\`\n\`${prefix}remind 1y ...\``,
    numberOnly: `${client.translate.get(language, "Commands.remind.numberOnly")}\n\n**${client.translate.get(language, "Commands.remind.example")}:**\n${examples.basic}\n${examples.list}\n${examples.delete}`,
    addNoTime: `${client.translate.get(language, "Commands.remind.addNoTime")}\n\n**${client.translate.get(language, "Commands.remind.example")}:**\n${examples.add}`,
    addInvalidTime: `${client.translate.get(language, "Commands.remind.addInvalidTime")}\n\n**${client.translate.get(language, "Commands.remind.example")}:**\n${examples.add}\n\`${prefix}remind add ${client.translate.get(language, "Commands.remind.addExample")}\``,
    addNoSource: `${client.translate.get(language, "Commands.remind.addNoSource")}\n\n**${client.translate.get(language, "Commands.remind.example")}:**\n${examples.add}`,
    addNoGuild: client.translate.get(language, "Commands.remind.addNoGuild"),
    addMessageTooLong: `${client.translate.get(language, "Commands.remind.addMessageTooLong", { "max": CONFIG.MAX_MESSAGE_LENGTH })}\n${extra}`,
    addTooShort: client.translate.get(language, "Commands.remind.addTooShort"),
    addNotTextChannel: client.translate.get(language, "Commands.remind.addNotTextChannel"),
    addMaxWatchers: client.translate.get(language, "Commands.remind.addMaxWatchers", { "max": MAX_WATCHERS, "cmd": `${prefix}remind rlist` }),
    noReactionReminders: `${client.translate.get(language, "Commands.remind.noReactionReminders")}\n\n**${client.translate.get(language, "Commands.remind.example")}:** ${examples.add}`,
    rdeleteUsage: `${client.translate.get(language, "Commands.remind.rdeleteUsage")}\n\n**${client.translate.get(language, "Commands.remind.example")}:** ${examples.rdelete}`,
    rdeleteInvalidIndex: client.translate.get(language, "Commands.remind.rdeleteInvalidIndex", { "cmd": `${prefix}remind rlist` }),
  };
  return createEmbed(EMBED_COLORS.ERROR, null, messages[type]);
}

function successEmbed(message, themeColor) {
  return createEmbed(themeColor, null, message);
}

function infoEmbed(title, description, themeColor) {
  return createEmbed(themeColor, title, description);
}

async function getSortedReminders(userId, client) {
  const userData = await client.database.getUser(userId, false);
  if (!userData) return { userData: null, reminders: [] };

  const sortedReminders = (userData.reminders || [])
    .map(r => r.toObject ? r.toObject() : r)
    .sort((a, b) => a.timestamp - b.timestamp)
    .map(r => ({ ...r, type: r.type === "dm" ? "DM" : "Guild" }));

  return { userData, reminders: sortedReminders };
}

async function deleteReminder(userId, index, client) {
  const { userData, reminders } = await getSortedReminders(userId, client);
  if (!userData || index < 0 || index >= reminders.length) {
    return { success: false, error: !userData ? "noReminders" : "invalidIndex" };
  }

  const reminderToDelete = reminders[index];

  handleDeletedReminder(userId, reminderToDelete.id);

  await client.database.updateUser(
    userId,
    { reminders: userData.reminders.filter(r => r.id !== reminderToDelete.id) },
    true
  );
  return { success: true, deletedReminder: reminderToDelete, remainingCount: reminders.length - 1 };
}

async function handleHelp(message, prefix, client, language, themeColor) {
  const examples = getExamples(prefix, client, language);
  const reactionHow = [
    client.translate.get(language, "Commands.remind.addDetailHeading"),
    client.translate.get(language, "Commands.remind.helpReactionSteps", { "emoji": WATCH_EMOJI }),
  ].join("\n");
  const embed = infoEmbed(
    "Remind Help",
    `**${client.translate.get(language, "Commands.remind.setReminder")}:**\n\`${prefix}remind <time> <message>\`\n${client.translate.get(language, "Commands.remind.example")}: ${examples.basic}\n\n**${client.translate.get(language, "Commands.remind.setDMReminder")}:**\n\`${prefix}remind dm <time> <message>\`\n${client.translate.get(language, "Commands.remind.example")}: ${examples.dm}\n*${client.translate.get(language, "Commands.remind.dmExplain")}*\n\n**${client.translate.get(language, "Commands.remind.view")}:**\n\`${prefix}remind list\`\n\n**${client.translate.get(language, "Commands.remind.delete")}:**\n\`${prefix}remind delete <index>\`\n${client.translate.get(language, "Commands.remind.example")}: ${examples.delete}\n\n**${client.translate.get(language, "Commands.remind.addWatcher")}:**\n\`${prefix}remind add <${client.translate.get(language, "Commands.remind.source")}> <${client.translate.get(language, "Commands.remind.time")}>\`\n${client.translate.get(language, "Commands.remind.example")}: ${examples.add}\n\`${prefix}remind add ${client.translate.get(language, "Commands.remind.addExample")}\`\n*${client.translate.get(language, "Commands.remind.addExplain")}*\n\n${reactionHow}\n\n**${client.translate.get(language, "Commands.remind.viewWatchers")}:**\n\`${prefix}remind rlist\`\n\n**${client.translate.get(language, "Commands.remind.deleteWatcher")}:**\n\`${prefix}remind rdelete <index>\`\n${client.translate.get(language, "Commands.remind.example")}: ${examples.rdelete}\n\n**${client.translate.get(language, "Commands.remind.naturalLang")}:**\n${examples.timeFormats}\n\n**${client.translate.get(language, "Commands.remind.shortForm")}:**\n${examples.shortFormats}\n${client.translate.get(language, "Commands.remind.exampleTime")}`,
    themeColor
  );
  return sendTracked(message.channel, { embeds: [embed] });
}

async function handleList(message, client, language, themeColor) {
  const { reminders } = await getSortedReminders(message.author.id, client);

  if (reminders.length === 0) {
    return sendTracked(message.channel, {
      embeds: [infoEmbed(client.translate.get(language, "Commands.remind.reminders"), client.translate.get(language, "Commands.remind.noReminders"), themeColor)],
    });
  }

  const description = reminders
    .map((r, i) => {
      const timeStr = `<t:${r.timestamp}:R>`;
      const icon = r.type === "DM" ? "📩" : "📢";
      const msg = truncate(r.message, CONFIG.DISPLAY_LENGTH);
      const channelInfo = r.type === "Guild" && r.channelId ? ` <#${r.channelId}>` : "";
      return `\`${i + 1}\`. ${icon}${channelInfo} ${timeStr} - \`${msg}\``;
    })
    .join("\n") + `\n\n📢 = ${client.translate.get(language, "Commands.remind.gReminder")} | 📩 = ${client.translate.get(language, "Commands.remind.dReminder")}`;

  return sendTracked(message.channel, {
    embeds: [infoEmbed(client.translate.get(language, "Commands.remind.reminders"), description, themeColor)],
  });
}

async function handleDelete(message, args, prefix, client, language, themeColor) {
  if (!args[1] || isNaN(args[1])) {
    return sendTracked(message.channel, {
      embeds: [errorEmbed(prefix, "deleteUsage", client, language)],
    });
  }

  const index = parseInt(args[1]) - 1;
  const result = await deleteReminder(message.author.id, index, client);

  if (!result.success) {
    return sendTracked(message.channel, {
      embeds: [errorEmbed(prefix, result.error, client, language)],
    });
  }

  const { reminders: remainingReminders } = await getSortedReminders(message.author.id, client);
  let description = `${client.translate.get(language, "Commands.remind.deleteReminder")} #${args[1]}.`;

  if (remainingReminders.length > 0) {
    const reminderList = remainingReminders
      .map((r, i) => {
        const timeStr = `<t:${r.timestamp}:R>`;
        const icon = r.type === "DM" ? "📩" : "📢";
        const msg = truncate(r.message, CONFIG.DISPLAY_LENGTH);
        const channelInfo = r.type === "Guild" && r.channelId ? ` <#${r.channelId}>` : "";
        return `\`${i + 1}\`. ${icon}${channelInfo} ${timeStr} - \`${msg}\``;
      })
      .join("\n") + `\n\n📢 = ${client.translate.get(language, "Commands.remind.gReminder")} | 📩 = ${client.translate.get(language, "Commands.remind.dReminder")}`;

    description += `\n\n**${client.translate.get(language, "Commands.remind.reminders")}:**\n${reminderList}`;
  }

  return sendTracked(message.channel, {
    embeds: [successEmbed(description, themeColor)],
  });
}

function parseMessageLink(input) {
  const match = String(input || "").match(LINK_REGEX);
  if (!match) return null;
  return { guildId: match[1], channelId: match[2], messageId: match[3] };
}

function isSourceToken(input) {
  if (!input) return false;
  return Boolean(parseMessageLink(input)) || SNOWFLAKE_REGEX.test(String(input).trim());
}

function isTextChannel(channel) {
  if (!channel) return false;
  if (typeof channel.isTextBased === "function" && !channel.isTextBased()) return false;
  if (channel.type === 4 || channel.type === 5) return false;
  return true;
}

async function fetchMessage(client, channelId, messageId) {
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel?.messages?.fetch) return null;
  const fetched = await channel.messages.fetch(messageId).catch(() => null);
  if (!fetched) return null;
  return { message: fetched, channel };
}

async function resolveSource(client, message, args) {
  const reference = message.messageReference;
  if (reference?.messageId) {
    const replied = await fetchMessage(client, reference.channelId, reference.messageId);
    if (replied) return replied;
  }

  const token = args[0];
  if (!isSourceToken(token)) return null;

  const link = parseMessageLink(token);
  if (link) return fetchMessage(client, link.channelId, link.messageId);

  const localChannel = await client.channels.fetch(message.channelId).catch(() => null);
  if (localChannel?.messages?.fetch) {
    const local = await localChannel.messages.fetch(String(token).trim()).catch(() => null);
    if (local) return { message: local, channel: localChannel };
  }

  if (!message.channel?.messages?.fetch) return null;
  const own = await message.channel.messages.fetch(String(token).trim()).catch(() => null);
  return own ? { message: own, channel: message.channel } : null;
}

function watcherList(userData) {
  return (userData?.reactionReminders || [])
    .map((w) => (w.toObject ? w.toObject() : w))
    .filter((w) => w && w.id && w.guildId && w.channelId);
}

function watcherLine(watcher, index, client, language) {
  const timeStr = fetchTime(watcher.durationSeconds * 1000, client, language, false, true).replace(/,/g, "");
  const sample = codeSample(watcher.sample || watcher.fingerprint || "");
  return `\`${index + 1}\`. ⏰ <#${watcher.channelId}> - ${sample} - \`${timeStr}\``;
}

async function askChannelChoice(client, message, language, themeColor, sourceChannelId, currentChannelId, timeStr) {
  const yes = client.config?.emojis?.check || "✅";
  const no = client.config?.emojis?.cross || "❌";

  const embed = createEmbed(themeColor, null, client.translate.get(language, "Commands.remind.channelPrompt", {
    "current": `<#${currentChannelId}>`,
    "source": `<#${sourceChannelId}>`,
    "yes": yes,
    "no": no,
    "time": timeStr,
  }));

  const prompt = await sendTracked(message.channel, { embeds: [embed] });
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
        filter: (r, user) => (r.emoji?.name === yes || r.emoji?.name === no) && user?.id === message.author.id,
        time: CONFIRM_TIME_MS,
      });
    } catch (err) {
      finish(null);
      return;
    }

    collector.on("collect", (r) => finish(r.emoji?.name === yes ? "current" : "source"));
    collector.on("end", () => finish(null));
  });

  if (answered === null) {
    await prompt.edit({
      embeds: [createEmbed(themeColor, null, client.translate.get(language, "Commands.remind.channelTimedOut"))],
    }).catch(() => {});
    await prompt.removeAllReactions().catch(() => {});
  } else {
    await prompt.delete().catch(() => {});
  }

  return answered;
}

async function handleAdd(message, args, prefix, client, language, themeColor) {
  if (!message.guildId || !message.channelId) {
    return sendTracked(message.channel, { embeds: [errorEmbed(prefix, "addNoGuild", client, language)] });
  }

  const rest = args.slice(1);
  const hasSource = isSourceToken(rest[0]);
  const timeText = (hasSource ? rest.slice(1) : rest).join(" ").trim();

  if (!timeText) {
    return sendTracked(message.channel, { embeds: [errorEmbed(prefix, "addNoTime", client, language)] });
  }

  const userData = await client.database.getUser(message.author.id, false);
  const timezone = userData?.timezone;

  const parsed = parseWatchTime(timeText, timezone);
  if (!parsed || !parsed.timestamp) {
    return sendTracked(message.channel, { embeds: [errorEmbed(prefix, "addInvalidTime", client, language)] });
  }

  const reminderMessage = cleanWatcherMessage(parsed.reminderMessage);

  if (reminderMessage.length > CONFIG.MAX_MESSAGE_LENGTH) {
    return sendTracked(message.channel, {
      embeds: [errorEmbed(prefix, "addMessageTooLong", client, language, client.translate.get(language, "Commands.remind.yourMessage", { "numbers": reminderMessage.length }))],
    });
  }

  const resolved = await resolveSource(client, message, rest);
  if (!resolved) {
    return sendTracked(message.channel, { embeds: [errorEmbed(prefix, "addNoSource", client, language)] });
  }

  const source = resolved.message;
  const sourceChannel = resolved.channel;
  const sourceGuildId = source.guildId || sourceChannel?.guildId || null;
  const sourceChannelId = source.channelId || sourceChannel?.id || null;

  if (!sourceGuildId || !sourceChannelId) {
    return sendTracked(message.channel, { embeds: [errorEmbed(prefix, "addNoGuild", client, language)] });
  }

  if (!isTextChannel(sourceChannel)) {
    return sendTracked(message.channel, { embeds: [errorEmbed(prefix, "addNotTextChannel", client, language)] });
  }

  const fingerprint = buildFingerprint(source);
  const attachmentNames = attachNames(source);
  if (!isMatchable(fingerprint, attachmentNames)) {
    return sendTracked(message.channel, { embeds: [errorEmbed(prefix, "addTooShort", client, language)] });
  }

  const now = Math.floor(Date.now() / 1000);
  const durationSeconds = parsed.timestamp - now;

  if (durationSeconds < 0) {
    return sendTracked(message.channel, { embeds: [errorEmbed(prefix, "pastTime", client, language)] });
  }
  if (durationSeconds < CONFIG.MIN_TIME_SECONDS) {
    return sendTracked(message.channel, { embeds: [errorEmbed(prefix, "tooShort", client, language)] });
  }
  if (durationSeconds > CONFIG.MAX_TIME_SECONDS) {
    return sendTracked(message.channel, { embeds: [errorEmbed(prefix, "tooFar", client, language)] });
  }

  let guildId = sourceGuildId;
  let channelId = sourceChannelId;

  if (sourceChannelId !== message.channelId) {
    const timeStr = fetchTime(durationSeconds * 1000, client, language, false, true).replace(/,/g, "");
    const choice = await askChannelChoice(client, message, language, themeColor, sourceChannelId, message.channelId, timeStr);
    if (choice === null) return;
    if (choice === "current") {
      guildId = message.guildId;
      channelId = message.channelId;
    }
  }

  const watchedChannel = channelId === message.channelId ? message.channel : sourceChannel;
  const channelName = watchedChannel?.name || client.channels?.get?.(channelId)?.name || "";
  const guildName = guildId === message.guildId
    ? (message.guild?.name || client.guilds?.get?.(guildId)?.name || "")
    : (client.guilds?.get?.(guildId)?.name || "");

  const existing = watcherList(userData);
  const duplicate = existing.find(
    (w) =>
      w.guildId === guildId &&
      w.channelId === channelId &&
      w.fingerprint === fingerprint
  );

  if (!duplicate) {
    if (existing.length >= MAX_WATCHERS) {
      return sendTracked(message.channel, { embeds: [errorEmbed(prefix, "addMaxWatchers", client, language)] });
    }
  }

  const watcher = {
    id: duplicate?.id || crypto.randomUUID(),
    guildId,
    guildName,
    channelId,
    channelName,
    sourceMessageId: source.id,
    sourceAuthorId: source.author?.id || null,
    sourceType: detectSourceType(source),
    fingerprint,
    sample: buildSample(source),
    reminderMessage,
    attachmentNames,
    durationSeconds,
    language,
    createdAt: duplicate?.createdAt || now,
  };

  const next = duplicate
    ? existing.map((w) => (w.id === duplicate.id ? watcher : w))
    : [...existing, watcher];

  if (duplicate) {
    await removeWatchers(client, message.author.id, (w) => w.id === duplicate.id, { notify: false });
  }

  const timeStr = fetchTime(durationSeconds * 1000, client, language, false, true).replace(/,/g, "");
  const sample = codeSample(watcher.sample || watcher.fingerprint);
  const channelRef = `<#${channelId}>`;
  const params = { "channel": channelRef, "time": timeStr, "message": sample, "emoji": WATCH_EMOJI };

  const reminderLine = reminderMessage
    ? client.translate.get(language, "Commands.remind.addDetailReminder", {
      ...params,
      "reminder": codeSample(reminderMessage),
    })
    : client.translate.get(language, "Commands.remind.addDetailReminderFallback", params);

  const description = [
    client.translate.get(language, duplicate ? "Commands.remind.addUpdated" : "Commands.remind.addSuccess", params),
    client.translate.get(language, "Commands.remind.addDetailWatching", params),
    reminderLine,
    client.translate.get(language, "Commands.remind.addStepRemove", {
      ...params,
      "cmd": `${prefix}remind rlist`,
      "rm": `${prefix}remind rdelete <index>`,
    }),
  ].join("\n\n");

  const sent = await sendTracked(message.channel, { embeds: [successEmbed(description, themeColor)] });

  await client.database.updateUser(message.author.id, { reactionReminders: next }, true);
  await addWatcher(client, message.author.id, watcher);

  return sent;
}

async function listWatchers(message, prefix, client, language, themeColor) {
  const userData = await client.database.getUser(message.author.id, false);
  const watchers = watcherList(userData);

  if (watchers.length === 0) {
    return sendTracked(message.channel, {
      embeds: [errorEmbed(prefix, "noReactionReminders", client, language)],
    });
  }

  const description = watchers
    .map((w, i) => watcherLine(w, i, client, language))
    .join("\n");

  return sendTracked(message.channel, {
    embeds: [infoEmbed(client.translate.get(language, "Commands.remind.reactionReminders"), description, themeColor)],
  });
}

async function deleteWatcher(message, args, prefix, client, language, themeColor) {
  if (!args[1] || isNaN(args[1])) {
    return sendTracked(message.channel, { embeds: [errorEmbed(prefix, "rdeleteUsage", client, language)] });
  }

  const userData = await client.database.getUser(message.author.id, false);
  const watchers = watcherList(userData);
  const index = parseInt(args[1]) - 1;
  const target = watchers[index];

  if (!target) {
    return sendTracked(message.channel, {
      embeds: [errorEmbed(prefix, "rdeleteInvalidIndex", client, language)],
    });
  }

  const removed = await removeWatchers(
    client,
    message.author.id,
    (w) => w.id === target.id,
    { notify: false }
  );

  if (!removed || removed.length === 0) {
    return sendTracked(message.channel, { embeds: [errorEmbed(prefix, "rdeleteInvalidIndex", client, language)] });
  }

  const fresh = await client.database.getUser(message.author.id, false);
  const remaining = watcherList(fresh);
  let description = client.translate.get(language, "Commands.remind.rdeleteSuccess", { "index": args[1], "channel": `<#${target.channelId}>` });

  if (remaining.length > 0) {
    description += `\n\n**${client.translate.get(language, "Commands.remind.reactionReminders")}:**\n${remaining
      .map((w, i) => watcherLine(w, i, client, language))
      .join("\n")}`;
  }

  return sendTracked(message.channel, { embeds: [successEmbed(description, themeColor)] });
}

async function handleCreate(message, args, prefix, isDM, client, language, themeColor) {
  let inputText = isDM ? args.slice(1).join(" ") : args.join(" ");

  if (!inputText.trim()) {
    return sendTracked(message.channel, {
      embeds: [errorEmbed(prefix, "noInput", client, language)],
    });
  }

  const parsed = await parseTimeForUser(inputText, message.author.id, client);
  if (!parsed) {
    return sendTracked(message.channel, {
      embeds: [errorEmbed(prefix, "invalidTime", client, language)],
    });
  }

  let { timestamp, reminderMessage } = parsed;
  timestamp = Number(timestamp);

  if (!reminderMessage) {
    return sendTracked(message.channel, {
      embeds: [errorEmbed(prefix, "noMessage", client, language)],
    });
  }

  const cleanedMessage = cleanReminderMessage(reminderMessage);

  if (!cleanedMessage || cleanedMessage.length === 0) {
    return sendTracked(message.channel, {
      embeds: [errorEmbed(prefix, "noMessage", client, language)],
    });
  }

  if (cleanedMessage.length > CONFIG.MAX_MESSAGE_LENGTH) {
    return sendTracked(message.channel, {
      embeds: [errorEmbed(prefix, "tooLong", client, language, client.translate.get(language, "Commands.remind.yourMessage", { "numbers": cleanedMessage.length }))],
    });
  }

  const now = Math.floor(Date.now() / 1000);

  if (timestamp <= now) {
    return sendTracked(message.channel, {
      embeds: [errorEmbed(prefix, "pastTime", client, language)],
    });
  }

  if (timestamp - now < CONFIG.MIN_TIME_SECONDS) {
    return sendTracked(message.channel, {
      embeds: [errorEmbed(prefix, "tooShort", client, language)],
    });
  }

  if (timestamp - now > CONFIG.MAX_TIME_SECONDS) {
    return sendTracked(message.channel, {
      embeds: [errorEmbed(prefix, "tooFar", client, language)],
    });
  }

  let userData = await client.database.getUser(message.author.id, false);
  if (!userData) {
    userData = { userId: message.author.id, reminders: [] };
  }

  const totalReminders = userData.reminders?.length || 0;
  if (totalReminders >= CONFIG.MAX_REMINDERS) {
    return sendTracked(message.channel, {
      embeds: [errorEmbed(prefix, "maxReminders", client, language)],
    });
  }

  if (isDM) {
    try {
      await sendTracked(message.author, {
        embeds: [successEmbed(client.translate.get(language, "Commands.remind.dmReminder"), themeColor)],
      });
      await message.delete().catch(() => {});
    } catch (err) {
      return sendTracked(message.channel, {
        embeds: [errorEmbed(prefix, "dmFailed", client, language)],
      });
    }

    const reminderId = crypto.randomUUID();
    const newReminder = {
      id: reminderId,
      timestamp,
      message: cleanedMessage,
      createdAt: now,
      type: "dm",
    };

    await client.database.updateUser(
      message.author.id,
      { reminders: [...(userData.reminders || []), newReminder] },
      true
    );

    handleNewReminder(message.author.id, newReminder);
  } else {
    const reminderId = crypto.randomUUID();
    const newReminder = {
      id: reminderId,
      timestamp,
      message: cleanedMessage,
      channelId: message.channel.id,
      createdAt: now,
      type: "guild",
    };

    await client.database.updateUser(
      message.author.id,
      { reminders: [...(userData.reminders || []), newReminder] },
      true
    );

    handleNewReminder(message.author.id, newReminder);

    const timeUntil = (timestamp - now) * 1000;
    const timeStr = fetchTime(timeUntil, client, language, false, true).replace(/,/g, "");
    const dateStr = `<t:${timestamp}:f>`;
    
    const displayMsg = truncate(cleanedMessage, CONFIG.DISPLAY_LENGTH);

    await sendTracked(message.channel, {
      embeds: [successEmbed(`${client.translate.get(language, "Commands.remind.success")} ${timeStr} (${dateStr}): \`${displayMsg}\``, themeColor)],
    });
  }
}

module.exports = {
  config: {
    name: "remind",
    usage: 'help',
    cooldown: 2500,
    available: true,
    permissions: {},
    aliases: ["reminder", "re", "reminders"],
  },
  run: async (client, message, args, db) => {
    const prefix = db.prefix;
    const themeColor = db.theme || EMBED_COLORS.DEFAULT;

    if (!args.length) {
      return sendTracked(message.channel, {
        embeds: [errorEmbed(prefix, "noArgs", client, db.language)],
      });
    }

    const subcommand = args[0].toLowerCase();

    switch (subcommand) {
      case "help":
      case "h":
        return handleHelp(message, prefix, client, db.language, themeColor);

      case "list":
        return handleList(message, client, db.language, themeColor);

      case "delete":
        return handleDelete(message, args, prefix, client, db.language, themeColor);

      case "dm":
        return handleCreate(message, args, prefix, true, client, db.language, themeColor);

      case "add":
        return handleAdd(message, args, prefix, client, db.language, themeColor);

      case "rlist":
      case "reactions":
      case "reactlist":
        return listWatchers(message, prefix, client, db.language, themeColor);

      case "rdelete":
      case "removereaction":
        return deleteWatcher(message, args, prefix, client, db.language, themeColor);

      default:
        if (args.length === 1 && /^\d+$/.test(args[0])) {
          return sendTracked(message.channel, {
            embeds: [errorEmbed(prefix, "numberOnly", client, db.language)],
          });
        }
        return handleCreate(message, args, prefix, false, client, db.language, themeColor);
    }
  },
};