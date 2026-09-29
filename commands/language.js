const { EmbedBuilder, PermissionFlags } = require("@fluxerjs/core");
const { trackGuildUpdates } = require("../api/trackSettings");
module.exports = {
  config: {
    name: "language",
    usage: true,
    cooldown: 5000,
    available: true,
    permissions: {
      name: "Manage Guild",
      bitField: PermissionFlags.ManageGuild,
    },
    aliases: ["lang"],
  },
  run: async (client, message, args, db) => {
    const available = client.translate.availableLanguages;
    const current = client.translate.get(db.language, "Commands.language.current");

    const languageList = available
      .map((language) => {
        const isCurrent = language === db.language;
        const marker = isCurrent ? "▸" : " ";
        const progress = client.translate.formatProgress(language);
        const label = isCurrent ? ` - ${current}` : "";

        return `${marker} \`${language}\` ${progress}${label}`;
      })
      .join("\n");

    const embed = new EmbedBuilder()
      .setDescription(
        `**${client.translate.get(db.language, "Commands.language.current")}**: ${db.language}\n**${client.translate.get(db.language, "Commands.language.example")}**: \`${db.prefix}language en_EN\`\n${client.translate.get(db.language, "Commands.language.change")}\n\n**${client.translate.get(db.language, "Commands.language.avail")}**:\n${languageList}`,
      )
      .setColor(db.theme);

    if (!args[0]) return message.reply({ embeds: [embed] });
    if (!available.includes(args[0])) {
      const errorEmbed = new EmbedBuilder()
        .setDescription(client.translate.get(db.language, "Commands.language.notAvailable"))
        .setColor("#FF0000");
      return message.reply({ embeds: [errorEmbed] });
    }

    await client.database.updateGuild(message.guildId, { language: args[0] });

    await trackGuildUpdates(client, {
      guildId: message.guildId,
      userId: message.author.id,
      existing: db,
      updates: { language: args[0] },
    }); 
    
    const progress = client.translate.getLanguageProgress(args[0]);

    const successEmbed = new EmbedBuilder()
      .setDescription(
        `${client.translate.get(args[0], "Commands.language.success")} **${args[0]}**\n${client.translate.get(args[0], "Commands.language.translated")} **${progress.percent.toFixed(1)}%** (${progress.translated}/${progress.total})`,
      )
      .setColor(db.theme);
    message.reply({ embeds: [successEmbed] });
  },
};
