const Reload = require("../functions/reload");
const { RELOAD_TYPES } = require("../functions/reload");
const { EmbedBuilder } = require("@erinjs/core");

module.exports = {
  config: {
    name: "reload",
    cooldown: 0,
    available: "Owner",
    permissions: {},
    aliases: ["r"]
  },
  run: async (client, message, args, db) => {
    if (!client.config.owners.includes(message.author.id)) return;

    const validTypes = ['command', 'event', 'function', 'reactionhandler', 'languages'];
    const firstArg = args[0]?.toLowerCase();

    let type, name;

    if (!firstArg) {
      const usageEmbed = new EmbedBuilder()
        .setColor("#A52F05")
        .setTitle("Reload Usage")
        .setDescription(
          `**Auto-detect:** \`${db.prefix}reload <filename>\`\n**Specify type:** \`${db.prefix}reload <type> <filename>\`\n\n**Types:** \`command\`, \`event\`, \`function\`, \`reactionHandler\`, \`languages\``
        );
      return message.reply({ embeds: [usageEmbed] });
    }

    if (validTypes.includes(firstArg)) {
      type = firstArg === 'reactionhandler' ? 'reactionHandler' : firstArg;
      name = args[1];
    } else {
      type = null;
      name = firstArg;
    }

    const result = await Reload(client, message, type, name);
    if (!result) return;
    return message.reply({ embeds: [result] });
  }
};