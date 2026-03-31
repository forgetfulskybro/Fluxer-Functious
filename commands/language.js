import { EmbedBuilder, PermissionFlags } from "@fluxerjs/core";
export const config = {
  name: "language",
  usage: true,
  cooldown: 5000,
  available: true,
  permissions: {
    name: "Manage Guild",
    bitField: PermissionFlags.ManageGuild,
  },
  aliases: ["lang"],
};
/**
 * 
 * @param {import('@fluxerjs/core').Client} client 
 * @param {import('@fluxerjs/core').Message} message 
 * @param {string[]} args 
 * @param {*} db 
 * @returns 
 */
export async function run(client, message, args, db) {
  const embed = new EmbedBuilder()
    .setDescription(
      `**${client.translate.get(db.language, "Commands.language.current")}**: ${db.language}\n**${client.translate.get(db.language, "Commands.language.example")}**: \`${db.prefix}language en_EN\`\n${client.translate.get(db.language, "Commands.language.change")}\n\n**${client.translate.get(db.language, "Commands.language.avail")}**: ${client.translate.availableLanguages.map((l) => `\`${l}\``).join(", ")}`
    )
    .setColor(`#A52F05`);

  if (!args[0]) return message.reply({ embeds: [embed] });
  if (!client.translate.availableLanguages.includes(args[0]))
    return message.reply(
      client.translate.get(db.language, "Commands.language.notAvailable"),
      { ping: false }
    );

  await client.database.updateGuild(message.guildId, { language: args[0] });
  await message.reply(
    `${client.translate.get(args[0], "Commands.language.success")} **${args[0]}**`,
    { ping: false }
  );
}
