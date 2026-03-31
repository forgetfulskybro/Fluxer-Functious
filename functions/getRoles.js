import { EmbedBuilder } from '@fluxerjs/core';
import { emojify } from 'node-emoji';

async function getRoles(roles, message, client, db, format = true, position = true) {
  try { message.guild.fetchRoles(); } catch {}
  const me = (message.guild?.members.me ?? (message.guild ? await message.guild.members.fetchMe() : null));
  const processedRoles = roles.map(r => emojify(r));
  const roleIds = []
  let newRoles = processedRoles.map((processed) => {
    return [...message.guild.roles]
    .map((r) => r)
    .find((role) => processed.toLowerCase() === role[1]?.name?.toLowerCase());
  });
  
  newRoles.map((r) => roleIds.push(r));

  if (roleIds.map((r) => !r).includes(true)) {
      let unknown = [];
      roleIds.map((r, i) => {
          i++
          if (!r) {
              unknown.push(roles[i - 1]);
          }
      });

      message.reply({ embeds: [new EmbedBuilder().setColor("#FF0000").setDescription(`${client.translate.get(db.language, "Events.messageCreate.unknown")}\n${unknown.map(e => `\`${format ? `{role:${e}}` : e}\``).join(", ")}`)] }).catch(() => { return });
      return message.react(client.config.emojis.cross).catch(() => { return });
  }

  let duplicate = [];
  roleIds.map((r, i) => {
      i++
      if (roleIds.filter(e => e[0] === r[0]).length > 1) duplicate.push(roleIds[i - 1]);
  });

  if (duplicate.length > 0) {
      message.reply({ embeds: [new EmbedBuilder().setColor("#FF0000").setDescription(`${client.translate.get(db.language, "Events.messageCreate.duplicate")}\n${duplicate.map(e => `\`${format ? `{role:${e[1].name}}` : e[1].name}\``)}`)] }).catch(() => { return });
      return message.react(client.config.emojis.cross).catch(() => { return });
  }

  if (position) {
    let positions = [];
    const botRole = [...me.roles.cache.values()].reduce((high, role) => role.position > high.position ? role : high);
    if (!botRole) {
        message.reply({ embeds: [new EmbedBuilder().setColor("#FF0000").setDescription(client.translate.get(db.language, "Events.messageCreate.noBotRole"))] }).catch(() => { return });
        return message.react(client.config.emojis.cross).catch(() => { return });
    }
    
    roleIds.map((r, i) => {
        i++
        if (r[1].position >= botRole.position) positions.push(roleIds[i - 1])
    });
  
    if (positions.length > 0) {
        message.reply({ embeds: [new EmbedBuilder().setColor("#FF0000").setDescription(`${client.translate.get(db.language, "Events.messageCreate.positions")}\n${positions.map(e => `\`${format ? `{role:${e[1].name}}` : e[1].name}\``)}\n\n${client.translate.get(db.language, "Events.messageCreate.fix")}`)] }).catch(() => { return });
        return message.react(client.config.emojis.cross).catch(() => { return });
    } 
  }
  
  return roleIds;
}

export default getRoles;