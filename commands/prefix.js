const { EmbedBuilder, PermissionFlags } = require("@fluxerjs/core");

module.exports = {
  config: {
    name: "prefix",
    cooldown: 3000,
    available: true,
    usage: true,
    permissions: {
      name: "Manage Guild",
      bitField: PermissionFlags.ManageGuild,
    },
    aliases: [],
  },
  run: async (client, message, args, db) => {
    const embed = new EmbedBuilder().setDescription(
      `${client.translate.get(db.language, "Commands.prefix.prefix")}: \`${db.prefix}\`\n\n${client.translate.get(db.language, "Commands.prefix.change")} \`${db.prefix}prefix <${client.translate.get(db.language, "Commands.prefix.new")}>\``,
    );
    if (!args[0]) return message.reply({ embeds: [embed] }, false);
    if (args[0] === db.prefix) return message.reply({ embeds: [embed] }, false);
    if (args[0].length > 8)
      return message.reply(
        client.translate.get(db.language, "Commands.prefix.tooMany"),
        false,
      );

    await client.database.updateGuild(message.guild.id, { prefix: args[0] });
    return message.reply(
      `${client.translate.get(db.language, "Commands.prefix.success")} \`${args[0]}\``,
      false,
    );
  },
};
