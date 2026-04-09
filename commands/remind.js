const crypto = require("crypto");
const fetchTime = require("../functions/fetchTime");
const { EmbedBuilder } = require("@erinjs/core");
const chrono = require("chrono-node");

const EMBED_COLORS = {
  ERROR: "#FF0000",
  SUCCESS: "#A52F05",
  INFO: "#A52F05",
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

const timeRegex =
  /(?:(?<months>\d+)mo)?(?:(?<weeks>\d+)w)?(?:(?<days>\d+)d)?(?:(?<hours>\d+)h)?(?:(?<minutes>\d+)m)?(?:(?<seconds>\d+)s)?/i;

function truncate(str, maxLen) {
  if (!str) return str;
  return str.length > maxLen ? str.substring(0, maxLen - 3) + "..." : str;
}

function cleanReminderMessage(text) {
  let cleaned = text;
  CONFIG.MENTIONS.forEach(mention => {
    cleaned = cleaned.replace(new RegExp(mention, 'gi'), '');
  });

  const words = cleaned.split(/\s+/);
  const removedWords = new Set();

  return words
    .filter((word) => !CONFIG.MENTIONS.includes(word.toLowerCase()))
    .filter((word) => {
      const lowerWord = word.toLowerCase();
      if (CONFIG.WORDS_TO_REMOVE.includes(lowerWord) && !removedWords.has(lowerWord)) {
        removedWords.add(lowerWord);
        return false;
      }
      return true;
    })
    .join(" ");
}

function createEmbed(color = EMBED_COLORS.INFO, title = null, description = null) {
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
  };
  return createEmbed(EMBED_COLORS.ERROR, null, messages[type]);
}

function successEmbed(message) {
  return createEmbed(EMBED_COLORS.SUCCESS, null, message);
}

function infoEmbed(title, description) {
  return createEmbed(EMBED_COLORS.INFO, title, description);
}

function parseRelativeTime(txt) {
  if (!txt) return false;
  txt = txt.trim();

  let time = 0;
  let currentTxt = txt;

  if (/^\d+$/.test(currentTxt)) {
    time += parseInt(currentTxt, 10);
  } else {
    const firstWord = currentTxt.split(/\s+/)[0];
    if (/^\d+$/.test(firstWord)) {
      const s = firstWord;
      time += parseInt(s, 10);
      currentTxt = currentTxt.slice(currentTxt.indexOf(s) + s.length);
    } else {
      const match = timeRegex.exec(currentTxt);
      if (!match || !match[0]) return false;

      const g = match.groups || {};
      if (g.months) time += parseInt(g.months, 10) * 2592000;
      if (g.weeks) time += parseInt(g.weeks, 10) * 604800;
      if (g.days) time += parseInt(g.days, 10) * 86400;
      if (g.hours) time += parseInt(g.hours, 10) * 3600;
      if (g.minutes) time += parseInt(g.minutes, 10) * 60;
      if (g.seconds) time += parseInt(g.seconds, 10);

      currentTxt = currentTxt.replace(timeRegex, "");
    }
  }

  let text = currentTxt;
  if (text && text[0] === " ") text = text.slice(1);
  text = text.trim();

  return { time, text };
}

function parseTimeWithTimezone(inputText, timezone) {
  if (!timezone) {
    return chrono.parse(inputText);
  }
  
  try {
    const referenceDate = new Date();
    const tzDate = new Date(referenceDate.toLocaleString("en-US", { timeZone: timezone }));
    const offset = tzDate.getTime() - referenceDate.getTime();
    const adjustedRef = new Date(referenceDate.getTime() + offset);
    
    return chrono.parse(inputText, adjustedRef);
  } catch {
    return chrono.parse(inputText);
  }
}

function parseTimeAndMessage(inputText, timezone) {
  const parsedResults = parseTimeWithTimezone(inputText, timezone);

  if (parsedResults && parsedResults.length > 0) {
    const parsedResult = parsedResults[0];
    const parsedDate = parsedResult.start.date();
    const timestamp = Math.floor(parsedDate.getTime() / 1000);
    const timeText = parsedResult.text;
    const beforeTime = inputText.substring(0, parsedResult.index).trim();
    const afterTime = inputText
      .substring(parsedResult.index + timeText.length)
      .trim();
    const reminderMessage = beforeTime ? (beforeTime + " " + afterTime).trim() : afterTime;
    return { timestamp, reminderMessage };
  }

  const relativeResult = parseRelativeTime(inputText);
  if (relativeResult && relativeResult.time > 0) {
    const now = Math.floor(Date.now() / 1000);
    return {
      timestamp: now + relativeResult.time,
      reminderMessage: relativeResult.text,
    };
  }

  return null;
}

async function parseTimeAndMessageWithUserTimezone(inputText, userId, client) {
  const userData = await client.database.getUser(userId, false);
  return parseTimeAndMessage(inputText, userData?.timezone);
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

  await client.database.updateUser(
    userId,
    { reminders: userData.reminders.filter(r => r.id !== reminderToDelete.id) },
    true
  );
  return { success: true };
}

async function handleHelp(message, prefix, client, language) {
  const examples = getExamples(prefix, client, language);
  const embed = infoEmbed(
    "Remind Help",
    `**${client.translate.get(language, "Commands.remind.setReminder")}:**\n\`${prefix}remind <time> <message>\`\n${client.translate.get(language, "Commands.remind.example")}: ${examples.basic}\n\n**${client.translate.get(language, "Commands.remind.setDMReminder")}:**\n\`${prefix}remind dm <time> <message>\`\n${client.translate.get(language, "Commands.remind.example")}: ${examples.dm}\n*${client.translate.get(language, "Commands.remind.dmExplain")}*\n\n**${client.translate.get(language, "Commands.remind.view")}:**\n\`${prefix}remind list\`\n\n**${client.translate.get(language, "Commands.remind.delete")}:**\n\`${prefix}remind delete <index>\`\n${client.translate.get(language, "Commands.remind.example")}: ${examples.delete}\n\n**${client.translate.get(language, "Commands.remind.naturalLang")}:**\n${examples.timeFormats}\n\n**${client.translate.get(language, "Commands.remind.shortForm")}:**\n${examples.shortFormats}\n${client.translate.get(language, "Commands.remind.exampleTime")}`
  );
  return message.channel.send({ embeds: [embed] });
}

async function handleList(message, client, language) {
  const { reminders } = await getSortedReminders(message.author.id, client);

  if (reminders.length === 0) {
    return message.channel.send({
      embeds: [infoEmbed(client.translate.get(language, "Commands.remind.reminders"), client.translate.get(language, "Commands.remind.noReminders"))],
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

  return message.channel.send({
    embeds: [infoEmbed(client.translate.get(language, "Commands.remind.reminders"), description)],
  });
}

async function handleDelete(message, args, prefix, client, language) {
  if (!args[1] || isNaN(args[1])) {
    return message.channel.send({
      embeds: [errorEmbed(prefix, "deleteUsage", client, language)],
    });
  }

  const index = parseInt(args[1]) - 1;
  const result = await deleteReminder(message.author.id, index, client);

  if (!result.success) {
    return message.channel.send({
      embeds: [errorEmbed(prefix, result.error, client, language)],
    });
  }

  return message.channel.send({
    embeds: [successEmbed(`${client.translate.get(language, "Commands.remind.deleteReminder")} #${args[1]}.`)],
  });
}

async function handleCreate(message, args, prefix, isDM, client, language) {
  let inputText = isDM ? args.slice(1).join(" ") : args.join(" ");

  if (!inputText.trim()) {
    return message.channel.send({
      embeds: [errorEmbed(prefix, "noInput", client, language)],
    });
  }

  const parsed = await parseTimeAndMessageWithUserTimezone(inputText, message.author.id, client);
  if (!parsed) {
    return message.channel.send({
      embeds: [errorEmbed(prefix, "invalidTime", client, language)],
    });
  }

  let { timestamp, reminderMessage } = parsed;
  timestamp = Number(timestamp);

  if (!reminderMessage) {
    return message.channel.send({
      embeds: [errorEmbed(prefix, "noMessage", client, language)],
    });
  }

  const cleanedMessage = cleanReminderMessage(reminderMessage);

  if (!cleanedMessage || cleanedMessage.length === 0) {
    return message.channel.send({
      embeds: [errorEmbed(prefix, "noMessage", client, language)],
    });
  }

  if (cleanedMessage.length > CONFIG.MAX_MESSAGE_LENGTH) {
    return message.channel.send({
      embeds: [errorEmbed(prefix, "tooLong", client, language, client.translate.get(language, "Commands.remind.yourMessage", { "numbers": cleanedMessage.length }))],
    });
  }

  const now = Math.floor(Date.now() / 1000);

  if (timestamp <= now) {
    return message.channel.send({
      embeds: [errorEmbed(prefix, "pastTime", client, language)],
    });
  }

  if (timestamp - now < CONFIG.MIN_TIME_SECONDS) {
    return message.channel.send({
      embeds: [errorEmbed(prefix, "tooShort", client, language)],
    });
  }

  if (timestamp - now > CONFIG.MAX_TIME_SECONDS) {
    return message.channel.send({
      embeds: [errorEmbed(prefix, "tooFar", client, language)],
    });
  }

  let userData = await client.database.getUser(message.author.id, false);
  if (!userData) {
    userData = { userId: message.author.id, reminders: [] };
  }

  const totalReminders = userData.reminders?.length || 0;
  if (totalReminders >= CONFIG.MAX_REMINDERS) {
    return message.channel.send({
      embeds: [errorEmbed(prefix, "maxReminders", client, language)],
    });
  }

  if (isDM) {
    try {
      await message.author.send({
        embeds: [successEmbed(client.translate.get(language, "Commands.remind.dmReminder"))],
      });
      await message.delete().catch(() => {});
    } catch (err) {
      return message.channel.send({
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

    const timeUntil = (timestamp - now) * 1000;
    const timeStr = fetchTime(timeUntil, client, language, false, true).replace(/,/g, "");
    const dateStr = `<t:${timestamp}:f>`;
    
    const displayMsg = truncate(cleanedMessage, CONFIG.DISPLAY_LENGTH);

    await message.channel.send({
      embeds: [successEmbed(`${client.translate.get(language, "Commands.remind.success")} ${timeStr} (${dateStr}): \`${displayMsg}\``)],
    });

  }
}

module.exports = {
  config: {
    name: "remind",
    usage: true,
    cooldown: 5000,
    available: true,
    permissions: {},
    aliases: ["reminder", "re", "reminders"],
  },
  run: async (client, message, args, db) => {
    const prefix = db.prefix;

    if (!args.length) {
      return message.channel.send({
        embeds: [errorEmbed(prefix, "noArgs", language)],
      });
    }

    const subcommand = args[0].toLowerCase();

    switch (subcommand) {
      case "help":
      case "h":
        return handleHelp(message, prefix, client, db.language);

      case "list":
        return handleList(message, client, db.language);

      case "delete":
        return handleDelete(message, args, prefix, client, db.language);

      case "dm":
        return handleCreate(message, args, prefix, true, client, db.language);

      default:
        if (args.length === 1 && /^\d+$/.test(args[0])) {
          return message.channel.send({
            embeds: [errorEmbed(prefix, "numberOnly", client, db.language)],
          });
        }
        return handleCreate(message, args, prefix, false, client, db.language);
    }
  },
};