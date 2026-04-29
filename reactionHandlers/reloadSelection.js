const { EmbedBuilder } = require("@erinjs/core");

const HANDLERS = {
  command: (client, name) => {
    const filePath = `../commands/${name}.js`;
    delete require.cache[require.resolve(filePath)];
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
    return `✅ Reloaded command: **${name}**.js`;
  },
  event: (client, name) => {
    const filePath = `../events/${name}.js`;
    delete require.cache[require.resolve(filePath)];
    const pull = require(filePath);
    const existingHandler = client._events[name];
    if (existingHandler) {
      client.off(name, typeof existingHandler === 'function' ? existingHandler : existingHandler[0]);
    }
    client.event.delete(name);
    const boundHandler = pull.bind(null, client);
    client.on(name, boundHandler);
    client.event.set(name, boundHandler);
    return `✅ Reloaded event: **${name}**.js`;
  },
  function: (client, name) => {
    const filePath = `../functions/${name}.js`;
    delete require.cache[require.resolve(filePath)];
    const pull = require(filePath);
    client.functions.delete(name);
    client.functions.set(name, pull);
    return `✅ Reloaded function: **${name}**.js`;
  },
  reactionHandler: (client, name) => {
    const filePath = `../reactionHandlers/${name}.js`;
    delete require.cache[require.resolve(filePath)];
    const pull = require(filePath);
    client.reactionHandlers.delete(name);
    client.reactionHandlers.set(name, pull);
    return `✅ Reloaded reaction handler: **${name}**.js`;
  }
};

function showFinalResults(message, results, allNames) {
  const successResults = results.filter(r => r.status === 'success');
  const errorResults = results.filter(r => r.status === 'error' || r.status === 'timeout');
  const notFoundResults = results.filter(r => r.status === 'notfound');

  let description = '';

  if (successResults.length > 0) {
    description += `✅ **Reloaded (${successResults.length}):**\n`;
    successResults.forEach(r => {
      description += `• **${r.name}**.js (${r.type}${r.autoDetected ? ', auto-detected' : ''})\n`;
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

  const embed = new EmbedBuilder()
    .setColor("#A52F05")
    .setTitle(`Reload Results (${results.length}/${allNames.length} files)`)
    .setDescription(description || 'No files processed.');

  message.edit({ embeds: [embed] }).catch(() => {});
  message.removeAllReactions().catch(() => {});
}

async function processNextSelection(client, userId, selectionData, numberEmojis) {
  const currentItem = selectionData.queue[selectionData.currentIndex];

  const options = currentItem.matches.slice(0, 10).map((match, i) => {
    return `${numberEmojis[i]} **${match.type}** - \`${currentItem.name}.js\``;
  }).join('\n');

  let progress = '';
  if (selectionData.results.length > 0) {
    const successCount = selectionData.results.filter(r => r.status === 'success').length;
    const errorCount = selectionData.results.filter(r => r.status === 'error').length;
    progress = `\n**Progress:** ${successCount} ✅ | ${errorCount} ❌ | ${selectionData.results.length} done\n`;
  }

  const embed = new EmbedBuilder()
    .setColor("#A52F05")
    .setTitle(`Select File to Reload (${selectionData.currentIndex + 1}/${selectionData.queue.length})`)
    .setDescription(
      `Multiple files found with name **${currentItem.name}**.js\n\n${options}\n${progress}\nReact with the number to select which one to reload.`
    );

  await selectionData.message.edit({ embeds: [embed] });
  await selectionData.message.removeAllReactions().catch(() => {});

  const collectorEmojis = currentItem.matches.slice(0, 10).map((_, i) => numberEmojis[i]);
  for (const emoji of collectorEmojis) {
    await selectionData.message.react(emoji).catch(() => {});
  }

  selectionData.emojis = collectorEmojis;
  client.reloadSelection.set(userId, selectionData);
}

module.exports = async (client, reaction, userId, selectionData, emojiId) => {
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

  const currentItem = selectionData.queue[selectionData.currentIndex];
  const index = numberEmojis.indexOf(emojiId);

  if (index === -1 || index >= currentItem.matches.length) return;

  const selected = currentItem.matches[index];
  if (!selected) return;

  try {
    const result = HANDLERS[selected.type](client, currentItem.name);
    selectionData.results.push({
      name: currentItem.name,
      type: selected.type,
      status: 'success',
      autoDetected: true
    });
  } catch (e) {
    selectionData.results.push({
      name: currentItem.name,
      type: selected.type,
      status: 'error',
      error: e.message
    });
  }

  selectionData.currentIndex++;

  if (selectionData.currentIndex < selectionData.queue.length) {
    await processNextSelection(client, userId, selectionData, numberEmojis);
  } else {
    showFinalResults(selectionData.message, selectionData.results, selectionData.allNames);
    client.reloadSelection.delete(userId);
  }
};
