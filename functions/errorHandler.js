const { EmbedBuilder } = require("@erinjs/core");

const DEFAULT_CONFIG = {
  command: {
    title: "Command Error",
    permissionTitle: "Permission Error",
    defaultDescription: "An unexpected error occurred while running this command.",
    permissionFooter: "Please contact a server admin to resolve this issue.",
    errorFooter: "Please join the support server and report to Sky about this issue: https://fluxer.gg/YnINU09E",
    rateLimitDescription: "The bot is currently being **Rate Limited**. Please try again in a moment.",
    plainTextFormat: "**{title}**\n{description}\n\n**What happened?**\n```{error}```\n\n{footer}"
  },
  event: {
    title: "Event Error",
    permissionTitle: "Permission Error",
    defaultDescription: "An unexpected error occurred while processing this event.",
    permissionFooter: "Please contact a server admin to resolve this issue.",
    errorFooter: "Please report this issue to the bot developers.",
    silent: true
  },
  function: {
    title: "Function Error",
    permissionTitle: "Permission Error",
    defaultDescription: "An unexpected error occurred while executing a function.",
    permissionFooter: "Please contact a server admin to resolve this issue.",
    errorFooter: "Please report this issue to the bot developers.",
    silent: true
  }
};

const PERMISSION_MAP = {
  "Message.send": "Send Messages",
  "TextChannel.send": "Send Messages",
  "_Message._send": "Send Messages",
  "VoiceChannel.edit": "Edit Channels",
  "Guild.createChannel": "Create Channels"
};

function analyzeError(error) {
  const errorMessage = error?.stack || String(error);
  let isPermissionIssue = false;
  let description = null;

  if (errorMessage.includes("permissions required") || errorMessage.includes("Missing Permissions")) {
    isPermissionIssue = true;
    
    for (const [pattern, permission] of Object.entries(PERMISSION_MAP)) {
      if (errorMessage.includes(pattern)) {
        description = `The bot is missing permission to **${permission}**.`;
        break;
      }
    }
  } else if (errorMessage.includes("rate limited") || errorMessage.includes("RateLimit")) {
    description = "The bot is currently being **Rate Limited**. Please try again in a moment.";
  }

  return { isPermissionIssue, description, errorMessage };
}

function createErrorEmbed(options) {
  const {
    type = "command",
    error,
    config = {},
  } = options;

  const typeConfig = { ...DEFAULT_CONFIG[type], ...config };
  const { isPermissionIssue, description, errorMessage } = analyzeError(error);

  const embed = new EmbedBuilder()
    .setColor(typeConfig.color || "#FF0000")
    .setTitle(isPermissionIssue ? typeConfig.permissionTitle : typeConfig.title)
    .setDescription(description || typeConfig.defaultDescription)
    .addFields({ name: "What happened?", value: `\`\`\`\n${errorMessage.slice(0, 1000)}\n\`\`\`` })
    .setFooter({ 
      text: isPermissionIssue ? typeConfig.permissionFooter : typeConfig.errorFooter 
    });

  return { embed, isPermissionIssue, errorMessage, typeConfig };
}

async function errorHandler(options) {
  const {
    type = "command",
    message,
    error,
    config = {},
    sendInChannel = true,
  } = options;

  const typeConfig = { ...DEFAULT_CONFIG[type], ...config };
  const { isPermissionIssue, description, errorMessage } = analyzeError(error);

  const title = isPermissionIssue ? typeConfig.permissionTitle : typeConfig.title;
  const desc = description || typeConfig.defaultDescription;
  const footer = isPermissionIssue ? typeConfig.permissionFooter : typeConfig.errorFooter;

  const embed = new EmbedBuilder()
    .setColor(typeConfig.color || "#FF0000")
    .setTitle(title)
    .setDescription(desc)
    .addFields({ name: "What happened?", value: `\`\`\`\n${errorMessage.slice(0, 1000)}\n\`\`\`` })
    .setFooter({ text: footer });

  if (!sendInChannel && message) {
    try {
      const dmChannel = await message.client.users.get(message._data.user_id).createDM();
      await dmChannel.send({ embeds: [embed] });
    } catch {}
    return;
  } else if (config?.client) {
    try {
      const dmChannel = await config.client.users.get(config.userId).createDM();
      await dmChannel.send({ embeds: [embed] });
    } catch {}
  }

  if (message) {
    try {
      if (errorMessage.includes("TextChannel.send") || errorMessage.includes("embed")) {
        const plainText = typeConfig.plainTextFormat
          ?.replace(/{title}/g, title)
          ?.replace(/{description}/g, desc)
          ?.replace(/{error}/g, errorMessage.slice(0, 500))
          ?.replace(/{footer}/g, footer);

        if (plainText) {
          return await message.reply(plainText);
        }
      }

      await message.reply({ embeds: [embed] });
    } catch {
      try {
        const dmChannel = await message.author.createDM();
        await dmChannel.send({ embeds: [embed] });
      } catch {}
    }
    return;
  }
}

module.exports = errorHandler;
module.exports.createErrorEmbed = createErrorEmbed;
module.exports.analyzeError = analyzeError;
module.exports.DEFAULT_CONFIG = DEFAULT_CONFIG;
