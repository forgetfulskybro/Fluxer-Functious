const { EmbedBuilder } = require('@fluxerjs/core');
const getRoles = require('./getRoles');
async function Collector(client, message, db) {
  if (message.content === `${db.prefix}roles stop`) {
    client.messageEdit.delete(message.author.id);
    return message.reply({ embeds: [new EmbedBuilder().setColor("#A52F05").setDescription(client.translate.get(db.language, "Commands.roles.stopped"))] })
  }
  
    const regex = /{role:(.*?)}/;
    const regexAll = /{role:(.*?)}/g;
    const collector = client.messageEdit.get(message.author.id);
    if (!message.content.match(regexAll) || message.content.match(regexAll)?.length === 0) {
        message.reply({ embeds: [new EmbedBuilder().setColor("#FF0000").setDescription(`${client.translate.get(db.language, "Events.messageCreate.noRoles")}: \`{role:Red}\`\n\n${client.translate.get(db.language, "Events.messageCreate.stop", { "prefix": db.prefix })}`)] }).then(async (m) => {
          await m.delete().catch(() => { });
        }).catch(() => { });
        return message.react(client.config.emojis.cross).catch(() => { });
    }

    const roles = message.content.match(regexAll).map((r) => r?.match(regex)[1]);
    if (roles.length > 30) {
        message.reply({ embeds: [new EmbedBuilder().setColor("#FF0000").setDescription(client.translate.get(db.language, "Events.messageCreate.maxRoles"))] }).catch(() => { });
        return message.react(client.config.emojis.cross).catch(() => { });
    }
    collector.regex = roles
    const roleIds = await getRoles(roles, message, client, db);
    if (!roleIds) return;

    message.delete().catch(() => { });
    collector.roles = roleIds;
    return message.channel.send(collector.type === "content" ? { content: message.content } : { embeds: [new EmbedBuilder().setDescription(message.content).setColor("#A52F05")] }).then(async (msg) => {
          await msg.react(client.config.emojis.check).catch(() => { });
          collector.messageId = msg.id;
      });
}

module.exports = Collector;