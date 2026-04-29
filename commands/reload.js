const Reload = require("../functions/reload");
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

    let type, namesInput;

    if (!firstArg) {
      const usageEmbed = new EmbedBuilder()
        .setColor("#A52F05")
        .setTitle("Reload Usage")
        .setDescription(
          `**Auto-detect:** \`${db.prefix}reload <filename>\`\n**Specify type:** \`${db.prefix}reload <type> <filename>\`\n**Multiple files:** \`${db.prefix}reload <filename1>, <filename2>, ...\`\n\n**Types:** \`command\`, \`event\`, \`function\`, \`reactionHandler\`, \`languages\``
        );
      return message.reply({ embeds: [usageEmbed] });
    }

    if (validTypes.includes(firstArg)) {
      type = firstArg === 'reactionhandler' ? 'reactionHandler' : firstArg;
      namesInput = args.slice(1).join(' ');
    } else {
      type = null;
      namesInput = args.join(' ');
    }

    const names = type === "languages" 
      ? [] 
      : namesInput.split(',').map(n => n.trim()).filter(n => n.length > 0);

    if (names.length === 0 && type !== "languages") {
      const usageEmbed = new EmbedBuilder()
        .setColor("#A52F05")
        .setTitle("Reload Usage")
        .setDescription(
          `❌ Please provide at least one file name.\n\n**Auto-detect:** \`${db.prefix}reload <filename>\`\n**Specify type:** \`${db.prefix}reload <type> <filename>\`\n**Multiple files:** \`${db.prefix}reload <filename1>, <filename2>, ...\``
        );
      return message.reply({ embeds: [usageEmbed] });
    }

    try {
      const result = await Reload(client, message, type, names);
      if (!result) return;
      return message.reply({ embeds: [result] });
    } catch (err) {
      return message.reply({ content: `Error: ${err.message}` });
    }
  }
};