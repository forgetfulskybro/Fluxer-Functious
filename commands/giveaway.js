import { EmbedBuilder, PermissionFlags } from '@fluxerjs/core';
import Giveaways from `../models/giveaways`;
import dhms from `../functions/dhms`;
const regex = new RegExp(/^channel:\s*(?:<#!?\d+>|[\d.]+)$/);

export const config = {
  name: `giveaway`,
  usage: true,
  cooldown: 5000,
  permissions: { name: "Manage Guild", bitField: PermissionFlags.ManageGuild },
  available: true,
  aliases: ["gw"],
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
  if (args[0] === "reroll") {
    let winners;
    let picked = [];
    const options = args.join(` `).split(`|`).map(x => x.trim()).filter(x => x);
    const msgId = args[1];

    const check = await Giveaways.findOne({ messageId: msgId });
    if (!check) return message.reply({ embeds: [new EmbedBuilder().setDescription(`${client.translate.get(db.language, "Commands.reroll.notValid")}\n**${client.translate.get(db.language, 'Commands.help.embeds.first.cmdUsage')}**:\n\`${db.prefix}giveaway reroll ${client.translate.get(db.language, "Commands.reroll.usage")}\``).setColor(`#FF0000`)] });
    winners = options[1] ? options[1] : check.winners === 1 ? winners = 1 : null;
    if (!winners) return message.reply({ embeds: [new EmbedBuilder().setDescription(client.translate.get(db.language, "Commands.reroll.winners")).setColor(`#FF0000`)] });
    if (winners !== "all" && isNaN(winners) || winners > 5 || winners < 1) return message.reply({ embeds: [new EmbedBuilder().setDescription(client.translate.get(check.language, "Commands.reroll.winners")).setColor(`#FF0000`)] });

    if (!check.ended) return message.reply({ embeds: [new EmbedBuilder().setDescription(client.translate.get(db.language, "Commands.reroll.notEnded")).setColor(`#FF0000`)] });
    if (check.owner !== message.author.id) return message.reply({ embeds: [new EmbedBuilder().setDescription(client.translate.get(db.language, "Commands.reroll.notHosted")).setColor(`#FF0000`)] });
    if (check.users.length === 0) return message.reply({ embeds: [new EmbedBuilder().setDescription(client.translate.get(db.language, "Commands.reroll.noUsers")).setColor(`#FF0000`)] });
    if (check.picking.length === 0) return message.reply({ embeds: [new EmbedBuilder().setDescription(client.translate.get(db.language, "Commands.reroll.noPicks")).setColor(`#FF0000`)] });

    if (winners === "all") {
      check.pickedWinners = [];
      for (let i = 0; i < check.winners; i++) {
        let winner = check.picking[Math.floor(Math.random() * check.picking.length)];
        if (winner) {
          const filtered = check.picking.filter(object => object.userID != winner.userID);
          check.picking = filtered;
          check.pickedWinners.push({ id: winner.userID });
          picked.push({ id: winner.userID });
        }
      }
      await check.save();
    } else {
      if (winners > check.pickedWinners.length) return message.reply({ embeds: [new EmbedBuilder().setDescription(`${client.translate.get(check.language, "Commands.reroll.onlyWinners")} ${check.pickedWinners.length} ${client.translate.get(check.language, "Commands.reroll.onlyWinners2")}: \`${db.prefix}reroll ${msgId} [${client.translate.get(check.language, "Commands.reroll.winnerNum")}, E.g. 1, 2, all] \``).setColor(`#FF0000`)] });

      let winner = check.picking[Math.floor(Math.random() * check.picking.length)];
      const filtered = check.picking.filter(object => object.userID != winner.userID);
      check.picking = filtered;
      const filtered2 = check.pickedWinners.filter(object => object.id != check.pickedWinners[winners - 1].id);
      check.pickedWinners = filtered2;
      check.pickedWinners.push({ id: winner.userID });
      await check.save();
      picked.push({ id: winner.userID });
    }

    const embed = new EmbedBuilder()
      .setColor("#A52F05")
      .setTitle(check.prize)
      .setDescription(`${client.translate.get(check.language, "Commands.reroll.giveaway")}\n\n${client.translate.get(check.language, "Commands.reroll.ended")}: <t:${Math.floor((check.endDate) / 1000)}:R>\n${client.translate.get(check.language, "Commands.giveaway.hosted")}: <@${check.owner}>\n${client.translate.get(check.language, "Commands.reroll.partici")}: ${check.users.length}\n${client.translate.get(check.language, "Commands.reroll.winner")}: ${check.pickedWinners.map(w => `<@${w.id}>`).join(", ")}${check.requirement ? `\n${client.translate.get(check.language, "Commands.reroll.reqs")}: ${check.requirement}` : ``}`);

    try {
      const newMsg = await (await client.channels.resolve(check.channelId))?.messages?.fetch(check.messageId);
      newMsg.edit({ embeds: [embed] });
    } catch { }
    (await client.channels.resolve(check.channelId))?.send({ content: `${client.translate.get(check.language, "Commands.reroll.reroll")} ${picked.map(w => `<@${w.id}>`).join(", ")} ${client.translate.get(check.language, "Commands.reroll.reroll2")} [${check.prize}](https://fluxer.app/channels/${check.serverId}/${check.channelId}/${check.messageId})` });
  } else if (args[0] === "start") {
    const me = (message.guild?.members.me ?? (message.guild ? await message.guild.members.fetchMe() : null));
    const check = await Giveaways.find({ serverId: message.guildId, ended: false });
    if (check.length === 15) return message.reply({ embeds: [new EmbedBuilder().setDescription(client.translate.get(db.language, 'Commands.giveaway.tooMany')).setColor(`#FF0000`)] });

    const options = args.join(` `).split(`|`).map(x => x.trim()).filter(x => x);
    const prize = options[2] ? options[2].slice(0, 500) : null;
    const winners = options[1];
    const time = options[0];
    const reactions = [client.config.emojis.confetti, client.config.emojis.stop];

    let requirement;
    let channel = true;
    if (options[3]) {
      try { message.guild.fetchChannels(); } catch { };
      let option = options[3] ? options[3].match(regex) : null;
      requirement = options[3].slice(0, 500).replace(`${option ? option[0] : ''}`, "").trim();
      if (requirement.length === 0) requirement = null;
      if (options[3] && regex.test(options[3])) channel = option[3] ? message.guild.channels.find(e => e.id === option[3]) : message.guild.channels.find(e => e.id === option[2]);
      if (!channel) return message.reply({ embeds: [new EmbedBuilder().setDescription(`${client.translate.get(db.language, "Commands.giveaway.validChannel")}: \`${db.prefix}giveaway 20m | 3 | A t-shirt | channel:#giveaways\`\n\n> ${client.translate.get(db.language, "Commands.giveaway.validChannel2")}`).setColor(`#FF0000`)] });
      if (channel === true || /^\s*$/.test(requirement)) channel = message.channel;
    } else { requirement = null; channel = message.channel; }

    if (!time) return message.reply({ embeds: [new EmbedBuilder().setDescription(`${client.translate.get(db.language, "Commands.giveaway.validTime")}: \`${db.prefix}giveaway 20m | 3 | A t-shirt\``).setColor(`#FF0000`)] });
    if (Array.from({ length: 119999 }, (_, i) => i + 1).includes(dhms(time))) return message.reply({ embeds: [new EmbedBuilder().setDescription(`${client.translate.get(db.language, "Commands.giveaway.ormore")}: \`${db.prefix}giveaway 20m | 3 | A t-shirt\``).setColor(`#FF0000`)] });
    if (time > 31556952000) return message.reply({ embeds: [new EmbedBuilder().setDescription(`${client.translate.get(db.language, "Commands.giveaway.orless")}: \`${db.prefix}giveaway 20m | 3 | A t-shirt\``).setColor(`#FF0000`)] });
    if (!isNaN(time) || dhms(time) <= 0) return message.reply({ embeds: [new EmbedBuilder().setDescription(`${client.translate.get(db.language, "Commands.giveaway.format")}: \`${db.prefix}giveaway 20m | 3 | A t-shirt\``).setColor(`#FF0000`)] });
    if (!winners) return message.reply({ embeds: [new EmbedBuilder().setDescription(`${client.translate.get(db.language, "Commands.giveaway.validWinners")}: \`${db.prefix}giveaway 20m | 3 | A t-shirt\``).setColor(`#FF0000`)] });
    if (winners <= 0 || isNaN(winners)) return message.reply({ embeds: [new EmbedBuilder().setDescription(`${client.translate.get(db.language, "Commands.giveaway.formatWinners")}: \`${db.prefix}giveaway 20m | 3 | A t-shirt\``).setColor(`#FF0000`)] });
    if (winners > 50) return message.reply({ embeds: [new EmbedBuilder().setDescription(`${client.translate.get(db.language, "Commands.giveaway.maxwins")}: \`${db.prefix}giveaway 20m | 3 | A t-shirt\``).setColor(`#FF0000`)] });
    if (!options[2]) return message.reply({ embeds: [new EmbedBuilder().setDescription(`${client.translate.get(db.language, "Commands.giveaway.validPrize")}: \`${db.prefix}giveaway 20m | 3 | A t-shirt\``).setColor(`#FF0000`)] });

    const embed = new EmbedBuilder()
      .setColor("#A52F05")
      .setTitle(prize)
      .setDescription(`${client.translate.get(db.language, "Commands.giveaway.time")}: <t:${Math.floor((dhms(time) + Date.now()) / 1000)}:R>\n${client.translate.get(db.language, "Commands.giveaway.hosted")}: <@${message.author.id}>\n${client.translate.get(db.language, "Commands.giveaway.winners")}: ${winners}${requirement ? `\n\n${client.translate.get(db.language, "Commands.giveaway.reqs")}:\n${requirement.slice(0, 700)}` : ``}`)
      .setFooter({ text: `${client.translate.get(db.language, "Commands.giveaway.react")} ${client.config.emojis.confetti} ${client.translate.get(db.language, "Commands.giveaway.react2")}` });

    const chanPerms = me.permissionsIn(channel);
    if (!chanPerms.has(PermissionFlags.SendMessages)) return message.reply({ embeds: [new EmbedBuilder().setDescription(`${client.translate.get(db.language, "Commands.giveaway.noperms")} <#${channel.id}>`).setColor(`#FF0000`)] });
    if (!chanPerms.has(PermissionFlags.ViewChannel)) return message.reply({ embeds: [new EmbedBuilder().setDescription(`${client.translate.get(db.language, "Commands.giveaway.noperms2")} <#${channel.id}>`).setColor(`#FF0000`)] });
    if (!chanPerms.has(PermissionFlags.AddReactions)) return message.reply({ embeds: [new EmbedBuilder().setDescription(`${client.translate.get(db.language, "Commands.giveaway.noperms3")} <#${channel.id}>`).setColor(`#FF0000`)] });

    if (options[3] && regex.test(options[3]) || /^\s*$/.test(requirement)) { message.reply(`${client.translate.get(db.language, "Commands.giveaway.success")} <#${channel.id}>`); }
    else message.delete().catch(() => { });

    channel.send({ embeds: [embed] }).then(async (msg) => {
      for (const reaction of reactions) {
        await msg.react(reaction).catch(() => { });
      }

      await Giveaways.create({
        owner: message.author.id,
        serverId: message.guildId,
        channelId: channel.id,
        messageId: msg.id,
        time: dhms(time),
        now: Date.now(),
        prize: prize,
        winners: winners,
        lang: db.language,
        requirement: requirement
      });
    });
  } else if (args[0] === "delete") {
    const msgId = args[1];
    if (!msgId) return message.reply({ embeds: [new EmbedBuilder().setDescription(`${client.translate.get(db.language, "Commands.giveaway.notValid")}\n**${client.translate.get(db.language, 'Commands.help.embeds.first.cmdUsage')}**:\`${db.prefix}giveaway delete ${client.translate.get(db.language, "Commands.giveaway.deleting")}\``).setColor(`#FF0000`)] });

    const check = await Giveaways.findOne({ messageId: msgId });
    if (!check) return message.reply({ embeds: [new EmbedBuilder().setDescription(`${client.translate.get(db.language, "Commands.giveaway.notValid")}\n**${client.translate.get(db.language, 'Commands.help.embeds.first.cmdUsage')}**:\n\`${db.prefix}giveaway delete ${client.translate.get(db.language, "Commands.giveaway.deleting")}\``).setColor(`#FF0000`)] });
    if (check.owner !== message.author.id) return message.reply({ content: client.translate.get(db.language, "Commands.giveaway.notOwner") });

    await Giveaways.findOneAndDelete({ messageId: msgId });
    try {
      const newMsg = await (await client.channels.resolve(check.channelId))?.messages?.fetch(check.messageId);
      newMsg.delete().catch(() => { });
    } catch { };

    return message.reply({ content: `${client.translate.get(db.language, "Commands.giveaway.successDelete", { "giveawayName": `**${check.prize}**` })}` });
  } else {
    return message.reply({
      embeds: [new EmbedBuilder()
        .setTitle(client.translate.get(db.language, "Commands.giveaway.title"))
        .setDescription(`**${client.translate.get(db.language, "Commands.roles.explain")}**\n${client.translate.get(db.language, "Commands.giveaway.explain")}\n\n**Creating**\n\`${db.prefix}giveaway start ${client.translate.get(db.language, "Commands.giveaway.creating")}\`\n\n**Deleting**\n\`${db.prefix}giveaway delete ${client.translate.get(db.language, "Commands.giveaway.deleting")}\`\n\n**Rerolling**\n\`${db.prefix}giveaway reroll ${client.translate.get(db.language, "Commands.reroll.usage")}\``)
        .setColor(`#A52F05`)]
    });
  }
}
