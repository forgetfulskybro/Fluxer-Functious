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

async function promptForSelection(client, message, matches, name, selectionQueue, results, allNames) {
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

  const selectionData = {
    messageId: msg.id,
    channelId: msg.channelId,
    matches: matches,
    name: name,
    message: msg,
    emojis: collectorEmojis,
    queue: selectionQueue,
    results: results,
    allNames: allNames,
    currentIndex: 0
  };

  client.reloadSelection.set(message.author.id, selectionData);

  setTimeout(() => {
    if (client.reloadSelection?.has(message.author.id)) {
      const data = client.reloadSelection.get(message.author.id);
      if (data && data.messageId === msg.id) {
        const remainingCount = data.queue.length - data.currentIndex;
        if (remainingCount > 0) {
          for (let i = data.currentIndex; i < data.queue.length; i++) {
            data.results.push({
              name: data.queue[i].name,
              type: null,
              status: 'timeout',
              error: 'Selection timed out'
            });
          }
        }
        showFinalResults(data.message, data.results, data.allNames);
        client.reloadSelection.delete(message.author.id);
      }
    }
  }, 180000);

  return null;
}

function showFinalResults(message, results, allNames) {
  const successResults = results.filter(r => r.status === 'success');
  const errorResults = results.filter(r => r.status === 'error' || r.status === 'timeout');
  const notFoundResults = results.filter(r => r.status === 'notfound');

  let description = '';

  if (successResults.length > 0) {
    description += `✅ **Reloaded (${successResults.length}):**\n`;
    successResults.forEach(r => {
      description += `• **${r.name}**.js (${r.type}})\n`;
    });
    description += '\n';
  }

  if (errorResults.length > 0) {
    description += `❌ **Errors (${errorResults.length}):**\n`;
    errorResults.forEach(r => {
      description += `• **${r.name}**.js${r.type ? ` (${r.type})` : ''} - ${r.error}\n`;
    });
    description += '\n';
  }

  if (notFoundResults.length > 0) {
    description += `⚠️ **Not Found (${notFoundResults.length}):**\n`;
    notFoundResults.forEach(r => {
      description += `• **${r.name}**.js\n`;
    });
  }

  const embed = createEmbed(
    description || 'No files processed.',
    COLORS.SUCCESS,
    `Reload Results (${results.length}/${allNames.length} files)`
  );

  message.edit({ embeds: [embed] }).catch(() => {});
  message.removeAllReactions().catch(() => {});
}

async function processSingleReload(client, type, name, autoDetected = false) {
  const result = { name, type, status: 'pending', autoDetected };

  if (type === RELOAD_TYPES.LANGUAGES) {
    try {
      HANDLERS[type].handler(client);
      result.status = 'success';
      return result;
    } catch (e) {
      result.status = 'error';
      result.error = e.message;
      return result;
    }
  }

  const handlerConfig = HANDLERS[type];
  if (!handlerConfig) {
    result.status = 'error';
    result.error = `Unknown reload type: ${type}`;
    return result;
  }

  if (handlerConfig.needsName && !name) {
    result.status = 'error';
    result.error = 'Missing file name';
    return result;
  }

  try {
    handlerConfig.handler(client, name);
    result.status = 'success';
    return result;
  } catch (e) {
    result.status = 'error';
    result.error = e.message;
    return result;
  }
}

async function Reload(client, message, type, names) {
  if (!Array.isArray(names)) {
    names = [names];
  }

  if (type !== "languages" && names.length === 0) {
    return createEmbed(
      '❌ Please provide at least one file name to reload.',
      COLORS.ERROR,
      'Missing Names'
    );
  }

  const results = [];
  const selectionQueue = [];

  if (type === RELOAD_TYPES.LANGUAGES) {
    const result = await processSingleReload(client, type, 'languages', false);
    results.push(result);
  }

  for (const name of names) {
    if (!name || name.trim().length === 0) continue;

    if (!type) {
      const matches = findAllMatches(name);

      if (matches.length === 0) {
        results.push({
          name,
          type: null,
          status: 'notfound'
        });
        continue;
      }

      if (matches.length === 1) {
        const result = await processSingleReload(client, matches[0].type, name, true);
        results.push(result);
      } else {
        selectionQueue.push({
          name,
          matches
        });
      }
    } else {
      const result = await processSingleReload(client, type, name, false);
      results.push(result);
    }
  }

  if (selectionQueue.length > 0) {
    await promptForSelection(
      client,
      message,
      selectionQueue[0].matches,
      selectionQueue[0].name,
      selectionQueue,
      results,
      names
    );
    return null;
  }

  if (results.length === 1 && results[0].status === 'success' && names.length === 1) {
    const r = results[0];
    let desc = `✅ Reloaded ${r.type}: **${r.name}**.js`;
    if (r.autoDetected) {
      desc = `🔍 Found **${r.type}**\n${desc}`;
    }
    return createEmbed(desc, COLORS.SUCCESS, 'Success');
  }

  const successResults = results.filter(r => r.status === 'success');
  const errorResults = results.filter(r => r.status === 'error');
  const notFoundResults = results.filter(r => r.status === 'notfound');

  let description = '';

  if (successResults.length > 0) {
    description += `✅ **Reloaded (${successResults.length}):**\n`;
    successResults.forEach(r => {
      description += `• **${r.name}**.js (${r.type}})\n`;
    });
    description += '\n';
  }

  if (errorResults.length > 0) {
    description += `❌ **Errors (${errorResults.length}):**\n`;
    errorResults.forEach(r => {
      description += `• **${r.name}**.js${r.type ? ` (${r.type})` : ''} - ${r.error}\n`;
    });
    description += '\n';
  }

  if (notFoundResults.length > 0) {
    description += `⚠️ **Not Found (${notFoundResults.length}):**\n`;
    notFoundResults.forEach(r => {
      description += `• **${r.name}**.js\n`;
    });
  }

  return createEmbed(
    description || 'No files processed.',
    COLORS.SUCCESS,
    `Reload Results (${results.length} files)`
  );
}

module.exports = Reload;