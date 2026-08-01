const { EmbedBuilder } = require('@fluxerjs/core');
const emoji = require('node-emoji');

async function getRoles(roles, message, client, db, format = true, position = true, toDelete = true) {
  try {
    if (message.guild) await message.guild.fetchRoles().catch(() => {});
  } catch {}

  const me = (message.guild?.members.me ?? (message.guild ? await message.guild.members.fetchMe().catch(() => null) : null));

  if (!me) {
    return message.reply({
      embeds: [new EmbedBuilder().setColor("#FF0000").setDescription("Failed to fetch bot member.")]
    }).catch(() => {});
  }

  const processedRoles = roles.map(r => emoji.emojify(r).trim());
  const roleIds = [];

  let newRoles = processedRoles.map((processed) => {
    const stripped = processed.replace(/^<@&(\d+)>$/, '$1').trim();
    const isId = /^\d+$/.test(stripped);

    const guildRoles = [...message.guild.roles.values()];

    if (isId) {
      return guildRoles.find(role => role.id === stripped);
    }
    return guildRoles.find(role => stripped.toLowerCase() === role.name.toLowerCase());
  });

  newRoles.forEach(r => {
    if (r) roleIds.push(r);
  });

  if (roleIds.length !== newRoles.length) {
    const unknown = [];
    newRoles.forEach((r, i) => {
      if (!r) unknown.push(roles[i].trim());
    });

    message.reply({
      embeds: [new EmbedBuilder().setColor("#FF0000").setDescription(
        `${client.translate.get(db.language, "Events.messageCreate.unknown")}\n` +
        `${unknown.map(e => `\`${format ? `{role:${e}}` : e}\``).join(", ")}`
      )]
    }).then(m => {
      setTimeout(() => {
        if (toDelete) {
          message.delete().catch(() => {});
          m.delete().catch(() => {});
        }
      }, 9000);
    });

    return message.react(client.config.emojis.cross).catch(() => {});
  }

  const seen = new Set();
  const duplicate = [];

  roleIds.forEach((r, i) => {
    if (seen.has(r.id)) {
      duplicate.push(r);
    } else {
      seen.add(r.id);
    }
  });

  if (duplicate.length > 0) {
    message.reply({
      embeds: [new EmbedBuilder().setColor("#FF0000").setDescription(
        `${client.translate.get(db.language, "Events.messageCreate.duplicate")}\n` +
        `${duplicate.map(e => `\`${format ? `{role:${e.name.trim()}}` : e.name.trim()}\``).join(", ")}`
      )]
    }).then(m => {
      setTimeout(() => {
        if (toDelete) {
          message.delete().catch(() => {});
          m.delete().catch(() => {});
        }
      }, 9000);
    });
    return message.react(client.config.emojis.cross).catch(() => {});
  }

    if (position) {
    const botHighestRole = [...me.roles.cache.values()]
      .reduce((highest, role) =>
        role.position > highest.position ? role : highest
      );

    if (!botHighestRole) {
      message.reply({
        embeds: [new EmbedBuilder().setColor("#FF0000").setDescription(
          client.translate.get(db.language, "Events.messageCreate.noBotRole")
        )]
      }).then(m => {
        setTimeout(() => {
          if (toDelete) {
            message.delete().catch(() => {});
            m.delete().catch(() => {});
          }
        }, 9000);
      });
      return message.react(client.config.emojis.cross).catch(() => {});
    }

    const tooHigh = roleIds.filter(r => r.position >= botHighestRole.position);

    if (tooHigh.length > 0) {
      message.reply({
        embeds: [new EmbedBuilder().setColor("#FF0000").setDescription(
          `${client.translate.get(db.language, "Events.messageCreate.positions")}\n` +
          `${tooHigh.map(e => `\`${format ? `{role:${e.name.trim()}}` : e.name.trim()}\``).join(", ")}\n\n` +
          client.translate.get(db.language, "Events.messageCreate.fix")
        )]
      }).then(m => {
        setTimeout(() => {
          if (toDelete) {
            message.delete().catch(() => {});
            m.delete().catch(() => {});
          }
        }, 9000);
      });
      return message.react(client.config.emojis.cross).catch(() => {});
    }
  }

  return roleIds;
}

module.exports = getRoles;
