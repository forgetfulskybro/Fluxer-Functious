import { EmbedBuilder, PermissionFlags } from "@fluxerjs/core";

export const config = {
  name: "prefix",
  cooldown: 3000,
  available: true,
  usage: true,
  permissions: {
    name: "Manage Guild",
    bitField: PermissionFlags.ManageGuild,
  },
  aliases: [],
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
  const embed = new EmbedBuilder().setColor(`#A52F05`).setDescription(
    `${client.translate.get(db.language, "Commands.prefix.prefix")}: \`${db.prefix}\`\n\n${client.translate.get(db.language, "Commands.prefix.change")} \`${db.prefix}prefix change <${client.translate.get(db.language, "Commands.prefix.new")}>\``
  );

  const acceptable = ["set", "change"];
  if (!args[0]) return message.reply({ embeds: [embed] });
  if (!acceptable.includes(args[0])) return message.reply({ embeds: [embed] });
  if (!args[1]) return message.reply({ embeds: [embed] });
  if (args[1] === db.prefix) return message.reply({ embeds: [embed] });
  if (args[1].length > 8)
    return message.reply({ embeds: [new EmbedBuilder().setDescription(client.translate.get(db.language, "Commands.prefix.tooMany")).setColor(`#FF0000`)] });

  await client.database.updateGuild(message.guild.id, { prefix: args[1] });
  return message.reply({ embeds: [new EmbedBuilder().setDescription(`${client.translate.get(db.language, "Commands.prefix.success")} \`${args[1]}\``).setColor(`#A52F05`)] });
}
