const { EmbedBuilder } = require('@fluxerjs/core');
const getRoles = require('./getRoles');
async function Collector(client, message, db) {
  const regex = /{role:(.*?)}/;
  const regexAll = /{role:(.*?)}/g;
  const collector = client.messageCollector.get(message.author.id);
  if (!message.content.match(regexAll) || message.content.match(regexAll)?.length === 0) {
    message.reply({ embeds: [new EmbedBuilder().setColor("#FF0000").setDescription(`${client.translate.get(db.language, "Events.messageCreate.noRoles")}: \`{role:Red}\``)] }).catch(() => { return });
    return message.react(client.config.emojis.cross).catch(() => { return });
  }

  const cooldownToggle = message.content.toLowerCase().includes("{cooldown:off}");
  const roles = message.content.match(regexAll).map((r) => r?.match(regex)[1]);
  if (roles.length > 30) {
    message.reply({ embeds: [new EmbedBuilder().setColor("#FF0000").setDescription(client.translate.get(db.language, "Events.messageCreate.maxRoles"))] }).catch(() => { return });
    return message.react(client.config.emojis.cross).catch(() => { return });
  }
  
  collector.regex = roles
  const roleIds = await getRoles(roles, message, client, db);
  if (!roleIds) return;

  message.delete().catch(() => { });
  collector.roles = roleIds;
  collector.cooldownToggle = cooldownToggle;
  return message.channel.send(collector.type === "content" ? { content: message.content.replace(/\{cooldown:off\}/g, '').trim() } : { embeds: [new EmbedBuilder().setDescription(message.content.replace(/\{cooldown:off\}/g, '').trim()).setColor("#A52F05")] }).then(async (msg) => {
    await msg.react(client.config.emojis.check)
    collector.messageId = msg.id;
  });
}

module.exports = Collector;