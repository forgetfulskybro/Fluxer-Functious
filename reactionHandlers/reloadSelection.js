const { EmbedBuilder } = require("@erinjs/core");
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

  const index = numberEmojis.indexOf(emojiId);
  if (index === -1 || index >= selectionData.matches.length) return;

  const selected = selectionData.matches[index];
  if (!selected) return;

  client.reloadSelection.delete(userId);

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

  try {
    const result = HANDLERS[selected.type](client, selectionData.name);
    await selectionData.message.edit({
      embeds: [new EmbedBuilder().setColor("#A52F05").setDescription(`🔍 Selected **${selected.type}**\n${result}`)]
    });
    await selectionData.message.removeAllReactions().catch(() => null);
    client.reloadSelection.delete(userId);
  } catch (e) {
    await selectionData.message.edit({
      embeds: [new EmbedBuilder().setColor(0xFF0000).setTitle('Error').setDescription(`❌ Couldn't reload **${selected.type}/${selectionData.name}**\n\n**Error:** ${e.message}`)]
    });
    await selectionData.message.removeAllReactions().catch(() => null);
    client.reloadSelection.delete(userId);
  }
};
