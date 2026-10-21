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
    const available = [...client.translate.availableLanguages].sort((a, b) => {
      if (a === "en_EN") return -1;
      if (b === "en_EN") return 1;
      const diff =
        client.translate.getLanguageProgress(b).percent -
        client.translate.getLanguageProgress(a).percent;
      return diff !== 0 ? diff : a.localeCompare(b);
    });
    const current = client.translate.get(db.language, "Commands.language.current");

    const languageList = available
      .map((language) => {
        const isCurrent = language === db.language;
        const marker = isCurrent ? "▸" : " ";
        const progress = client.translate.formatProgress(language);
        const label = isCurrent ? ` - ${current}` : "";
        const alias = client.translate.getAlias(language);
        const name = client.translate.getLanguageNames(language)[0];
        const hint = name ? ` (${name})` : alias !== language ? ` (${alias})` : "";

        return `${marker} \`${language}\`${hint} ${progress}${label}`;
      })
      .join("\n");

    const embed = new EmbedBuilder()
      .setDescription(
        `**${client.translate.get(db.language, "Commands.language.current")}**: ${db.language}\n**${client.translate.get(db.language, "Commands.language.example")}**: \`${db.prefix}language en\`\n${client.translate.get(db.language, "Commands.language.change")}\n\n**${client.translate.get(db.language, "Commands.language.avail")}**:\n${languageList}`,
      )
      .setColor(db.theme);

    if (!args[0]) return message.reply({ embeds: [embed] });

    const resolved = client.translate.resolveLanguage(args[0]);
    if (!resolved) {
      const errorEmbed = new EmbedBuilder()
        .setDescription(client.translate.get(db.language, "Commands.language.notAvailable"))
        .setColor("#FF0000");
      return message.reply({ embeds: [errorEmbed] });
    }

    await client.database.updateGuild(message.guildId, { language: resolved });

    await trackGuildUpdates(client, {
      guildId: message.guildId,
      userId: message.author.id,
      existing: db,
      updates: { language: resolved },
    }); 
    
    const progress = client.translate.getLanguageProgress(resolved);

    const successEmbed = new EmbedBuilder()
      .setDescription(
        `${client.translate.get(resolved, "Commands.language.success", { language: `**${resolved}**` })}\n${client.translate.get(resolved, "Commands.language.translated")} **${progress.percent.toFixed(1)}%** (${progress.translated}/${progress.total})`,
      )
      .setColor(db.theme);
    message.reply({ embeds: [successEmbed] });
  },
};
