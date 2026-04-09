const fs = require('fs');
const path = require('path');
const { EmbedBuilder } = require('@erinjs/core');

const COLORS = {
  SUCCESS: '#A52F05',
  ERROR: '#FF0000',
  INFO: '#A52F05'
};

function createEmbed(description, color = COLORS.SUCCESS, title = null) {
  const embed = new EmbedBuilder().setColor(color).setDescription(description);
  if (title) embed.setTitle(title);
  return embed;
}

const RELOAD_TYPES = {
  COMMAND: 'command',
  EVENT: 'event',
  FUNCTION: 'function',
  REACTION_HANDLER: 'reactionHandler',
  LANGUAGES: 'languages'
};

const PATHS = {
  [RELOAD_TYPES.COMMAND]: '../commands',
  [RELOAD_TYPES.EVENT]: '../events',
  [RELOAD_TYPES.FUNCTION]: '../functions',
  [RELOAD_TYPES.REACTION_HANDLER]: '../reactionHandlers',
  [RELOAD_TYPES.LANGUAGES]: '../languages'
};

function clearModuleCache(filePath) {
  const resolved = require.resolve(filePath);
  if (require.cache[resolved]) {
    delete require.cache[resolved];
    return true;
  }
  return false;
}

function reloadCommand(client, name) {
  const filePath = `${PATHS[RELOAD_TYPES.COMMAND]}/${name}.js`;
  clearModuleCache(filePath);
  const pull = require(filePath);
  const existing = client.commands.get(name);

  if (existing?.config?.aliases) {
    existing.config.aliases.forEach(a => client.aliases.delete(a));
  }

  client.commands.delete(name);
  client.commands.set(name, pull);

  if (pull.config?.aliases) {
    pull.config.aliases.forEach(a => client.aliases.set(a, name));
  }

  return createEmbed(`✅ Reloaded command: **${name}**.js`);
}

function reloadEvent(client, name) {
  const filePath = `${PATHS[RELOAD_TYPES.EVENT]}/${name}.js`;
  clearModuleCache(filePath);
  const pull = require(filePath);

  const existingHandler = client._events[name];
  if (existingHandler) {
    client.off(name, typeof existingHandler === 'function' ? existingHandler : existingHandler[0]);
  }
  client.event.delete(name);

  const boundHandler = pull.bind(null, client);
  client.on(name, boundHandler);
  client.event.set(name, boundHandler);

  return createEmbed(`✅ Reloaded event: **${name}**.js`);
}

function reloadFunction(client, name) {
  const filePath = `${PATHS[RELOAD_TYPES.FUNCTION]}/${name}.js`;
  clearModuleCache(filePath);
  const pull = require(filePath);

  client.functions.delete(name);
  client.functions.set(name, pull);

  return createEmbed(`✅ Reloaded function: **${name}**.js`);
}

function reloadReactionHandler(client, name) {
  const filePath = `${PATHS[RELOAD_TYPES.REACTION_HANDLER]}/${name}.js`;
  clearModuleCache(filePath);
  const pull = require(filePath);

  client.reactionHandlers.delete(name);
  client.reactionHandlers.set(name, pull);

  return createEmbed(`✅ Reloaded reaction handler: **${name}**.js`);
}

function reloadLanguages(client) {
  const languagesPath = path.join(__dirname, PATHS[RELOAD_TYPES.LANGUAGES]);
  const languageFiles = fs.readdirSync(languagesPath).filter(file => file.endsWith('.json'));

  for (const file of languageFiles) {
    clearModuleCache(path.join(languagesPath, file));
  }

  if (typeof client.translate?.reload === 'function') {
    client.translate.reload();
  }

  return createEmbed(`✅ Reloaded **${languageFiles.length}** language file${languageFiles.length === 1 ? '' : 's'}`);
}

const HANDLERS = {
  [RELOAD_TYPES.COMMAND]: { handler: reloadCommand, needsName: true },
  [RELOAD_TYPES.EVENT]: { handler: reloadEvent, needsName: true },
  [RELOAD_TYPES.FUNCTION]: { handler: reloadFunction, needsName: true },
  [RELOAD_TYPES.REACTION_HANDLER]: { handler: reloadReactionHandler, needsName: true },
  [RELOAD_TYPES.LANGUAGES]: { handler: reloadLanguages, needsName: false }
};

const SEARCH_ORDER = [
  RELOAD_TYPES.COMMAND,
  RELOAD_TYPES.EVENT,
  RELOAD_TYPES.FUNCTION,
  RELOAD_TYPES.REACTION_HANDLER
];

function findAllMatches(name) {
  const matches = [];
  for (const type of SEARCH_ORDER) {
    const filePath = path.join(__dirname, PATHS[type], `${name}.js`);
    if (fs.existsSync(filePath)) {
      matches.push({ type, filePath });
    }
  }
  return matches;
}

async function promptForSelection(client, message, matches, name) {
  const numberEmojis = [
    client.config.emojis.one,
    client.config.emojis.two,
    client.config.emojis.three,
    client.config.emojis.four,
    client.config.emojis.five,
    client.config.emojis.six,
    client.config.emojis.seven,
    client.config.emojis.eight,
    client.config.emojis.nine,
    client.config.emojis.ten
  ];

  const options = matches.slice(0, 10).map((match, i) => {
    return `${numberEmojis[i]} **${match.type}** - \`${name}.js\``;
  }).join('\n');

  const embed = createEmbed(
    `Multiple files found with name **${name}**.js\n\n${options}\n\nReact with the number to select which one to reload.`,
    COLORS.INFO,
    'Select File to Reload'
  );

  const msg = await message.reply({ embeds: [embed] });

  const collectorEmojis = matches.slice(0, 10).map((_, i) => numberEmojis[i]);
  for (const emoji of collectorEmojis) {
    await msg.react(emoji).catch(() => {});
  }

  client.reloadSelection.set(message.author.id, {
    messageId: msg.id,
    channelId: msg.channelId,
    matches: matches,
    name: name,
    message: msg,
    emojis: collectorEmojis
  });

  setTimeout(() => {
    if (client.reloadSelection?.has(message.author.id)) {
      client.reloadSelection.delete(message.author.id);
      msg.edit({
        embeds: [createEmbed('❌ Selection timed out.', COLORS.ERROR, 'Timeout')]
      }).catch(() => { });
      msg.removeAllReactions().catch(() => { });
    }
  }, 30000);

  return null;
}

async function Reload(client, message, type, name) {
  if (!type && name) {
    const matches = findAllMatches(name);

    if (matches.length === 0) {
      return createEmbed(
        `❌ Couldn't find **${name}** in any folder (commands, events, functions, reactionHandlers)`,
        COLORS.ERROR,
        'Not Found'
      );
    }

    if (matches.length === 1) {
      type = matches[0].type;
    } else {
      await promptForSelection(client, message, matches, name);
      return null;
    }
  }

  if (type === RELOAD_TYPES.LANGUAGES) {
    try {
      return HANDLERS[type].handler(client);
    } catch (e) {
      return createEmbed(
        `❌ Couldn't reload **languages**\n\n**Error:** ${e.message}`,
        COLORS.ERROR,
        'Error'
      );
    }
  }

  const handlerConfig = HANDLERS[type];
  if (!handlerConfig) {
    if (!type) {
      return createEmbed(
        '❌ Provide a file name to auto-detect, or specify a type.\n\n**Usage:** `reload <file>` or `reload <type> <file>`\n**Types:** `command`, `event`, `function`, `reactionHandler`, `languages`',
        COLORS.ERROR,
        'Usage'
      );
    }
    return createEmbed(
      `❌ Unknown reload type: **${type}**\n\n**Available:** command, event, function, reactionHandler, languages`,
      COLORS.ERROR,
      'Error'
    );
  }

  if (handlerConfig.needsName && !name) {
    return createEmbed(
      `❌ Provide a **${type}** name to reload!`,
      COLORS.ERROR,
      'Missing Name'
    );
  }

  try {
    const result = handlerConfig.handler(client, name);
    if (!arguments[2]) {
      result.data.description = `🔍 Auto-detected as **${type}**\n${result.data.description}`;
    }
    return result;
  } catch (e) {
    return createEmbed(
      `❌ Couldn't reload **${type}${name ? `/${name}` : ''}**\n\n**Error:** ${e.message}`,
      COLORS.ERROR,
      'Error'
    );
  }
}

module.exports = Reload;