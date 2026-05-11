const { EmbedBuilder, resolvePermissionsToBitfield } = require('@erinjs/core');
const errorHandler = require("../functions/errorHandler");
const getMember = require('../functions/getMember');

const COLOR = "#A52F05";

async function processError(client, error, message) {
  client.manageVC.delete(message.author.id);
  return await errorHandler({
    type: "function",
    message,
    error,
    config: {},
  });
} 

async function manageVC(client, message) {
  const MVC = client.manageVC.get(message.author.id);
  const db = await client.database.getGuild(MVC.guildId);
  const channel = await client.channels.fetch(MVC.channelId);
  let content = message.content
  let member;
  let result;
  let guild;
  
  if (content.toLowerCase() === `cancel`) {
    clearTimeout(client.observedVoiceUsers.get(message.author.id).timeout);
    client.manageVC.delete(message.author.id);
    return message.reply({ embeds: [new EmbedBuilder().setColor(COLOR).setDescription(client.translate.get(db.language, "Functions.manageVC.stopped"))] })
  }
  
  switch (MVC.type) {
    case "channelName":
      if (content.length > 100) content = content.slice(0, 100);
      
      try {
        result = new EmbedBuilder()
          .setColor(COLOR)
          .setTitle(client.translate.get(db.language, "Functions.manageVC.rename"))
          .setDescription(client.translate.get(db.language, "Functions.manageVC.renameDesc", { "channelName": channel.name, "content": content }))
      
        await channel.edit({
          name: content
        });
      } catch (err) {
        result = null;
        await processError(client, err, message)
      }
      break;
    
    case "userLimit":
      if (isNaN(content)) return message.reply({ embeds: [new EmbedBuilder().setColor(COLOR).setDescription(client.translate.get(db.language, "Functions.manageVC.invalidLimit"))] })
      if (Number(content) > 99) content = "99";
      if (Number(content) < 0) content = 0;
      
      const limitText = content === "0" || content === 0 ? client.translate.get(db.language, "Functions.manageVC.unlimited") : client.translate.get(db.language, "Functions.manageVC.usersMax", { "number": content });
      const oldLimitText = channel.userLimit === 0 ? client.translate.get(db.language, "Functions.manageVC.unlimited") : client.translate.get(db.language, "Functions.manageVC.usersMax", { "number": channel.userLimit });
      
      result = new EmbedBuilder()
        .setColor(COLOR)
        .setTitle(client.translate.get(db.language, "Functions.manageVC.limitUpdate"))
        .setDescription(client.translate.get(db.language, "Functions.manageVC.limitUpdateDesc", { "oldText": oldLimitText, "newText": limitText }))
      
      try {
        await channel.edit({
          user_limit: Number(content)
        });
      } catch (err) {
        result = null;
        await processError(client, err, message)
      }
      break;
    
    case "blockUser":
      guild = await client.guilds.get(MVC.guildId);
      member = await getMember(guild, content)
      if (!member) return message.reply({ embeds: [new EmbedBuilder().setColor(COLOR).setDescription(client.translate.get(db.language, "Functions.manageVC.invalidUser"))] });
      
      if (client.observedVoiceUsers.get(member.id)) {
        const tempChannel = await guild.createChannel({
          name: `Blocked User`,
          type: 2,
          parent: db.parentChannel
        }).catch(() => {})
        
        await member.move(tempChannel.id).then(async () => await tempChannel.delete()).catch(() => { });
      }
      
      result = new EmbedBuilder()
        .setColor(COLOR)
        .setTitle(client.translate.get(db.language, "Functions.manageVC.blockUser"))
        .setDescription(client.translate.get(db.language, "Functions.manageVC.blockUserDesc", { "username": member.user.username, "userMention": `<@${member.user.id}>` }))
      
      try {
        await channel.editPermission(member.id, {
          type: 1,
          deny: resolvePermissionsToBitfield(["Connect"])
        });
      }  catch (err) {
        result = null;
        await processError(client, err, message)
      }
      break;
    
    case "unblockUser":
      guild = await client.guilds.get(MVC.guildId);
      member = await getMember(guild, content)
      if (!member) return message.reply({ embeds: [new EmbedBuilder().setColor(COLOR).setDescription(client.translate.get(db.language, "Functions.manageVC.invalidUser"))] });

      result = new EmbedBuilder()
        .setColor(COLOR)
        .setTitle(client.translate.get(db.language, "Functions.manageVC.userAccess"))
        .setDescription(client.translate.get(db.language, "Functions.manageVC.userAccessDesc", { "username": member.user.username, "userMention": `<@${member.user.id}>` }));

      try {
        await channel.editPermission(member.id, {
          type: 1,
          allow: resolvePermissionsToBitfield(["Connect"])
        });
      } catch (err) {
        result = null;
        await processError(client, err, message);
      }
      break;

    case "changeRegion":
      const regionInput = content.toLowerCase().replace(/\s/g, '');
      const regionMap = {
        'automatic': 'automatic',
        'australia': 'australia',
        'brazil': 'brazil',
        'chile': 'chile',
        'eucentral': 'eu-central',
        'eu-central': 'eu-central',
        'eueast': 'eu-east',
        'eu-east': 'eu-east',
        'euwest': 'eu-west',
        'eu-west': 'eu-west',
        'india': 'india',
        'singapore': 'singapore',
        'southafrica': 'southafrica',
        'south africa': 'southafrica',
        'southkorea': 'south-korea',
        'south korea': 'south-korea',
        'korea': 'south-korea',
        'useast': 'us-east',
        'us-east': 'us-east',
        'ussouth': 'us-south',
        'us-south': 'us-south',
        'uswest': 'us-west',
        'us-west': 'us-west'
      };

      const region = regionMap[regionInput];
      if (!region) {
        return message.reply({ embeds: [new EmbedBuilder().setColor(COLOR).setDescription(client.translate.get(db.language, "Functions.manageVC.invalidRegion"))] });
      }

      result = new EmbedBuilder()
        .setColor(COLOR)
        .setTitle(client.translate.get(db.language, "Functions.manageVC.regionUpdate"))
        .setDescription(client.translate.get(db.language, "Functions.manageVC.regionUpdateDesc", { "newRegion": region }));

      try {
        await channel.edit({
          rtc_region: region === 'automatic' ? null : region
        });
      } catch (err) {
        result = null;
        await processError(client, err, message);
      }
      break;

    case "transferOwner":
      guild = await client.guilds.get(MVC.guildId);
      member = await getMember(guild, content);
      if (!member) return message.reply({ embeds: [new EmbedBuilder().setColor(COLOR).setDescription(client.translate.get(db.language, "Functions.manageVC.invalidUser"))] });
      if (member.user.bot) return message.reply({ embeds: [new EmbedBuilder().setColor(COLOR).setDescription(client.translate.get(db.language, "Functions.manageVC.noBots"))] });

      result = new EmbedBuilder()
        .setColor(COLOR)
        .setTitle(client.translate.get(db.language, "Functions.manageVC.ownerTransferred"))
        .setDescription(client.translate.get(db.language, "Functions.manageVC.ownerTransferredDesc", { "username": member.user.username, "userMention": `<@${member.user.id}>` }));

      try {
        await client.database.updateGuild(MVC.guildId, {
          tempChannels: db.tempChannels.map(vc =>
            vc.channelId === MVC.channelId ? { ...vc, ownerId: member.id } : vc
          )
        });

        await channel.editPermission(member.id, {
          type: 1,
          allow: resolvePermissionsToBitfield(["Connect"])
        });
      } catch (err) {
        result = null;
        await processError(client, err, message);
      }
      break;

    case "closeChannel":
      if (content.toLowerCase() !== 'confirm') {
        return message.reply({ embeds: [new EmbedBuilder().setColor(COLOR).setDescription(client.translate.get(db.language, "Functions.manageVC.closeConfirm"))] });
      }

      try {
        client.observedVoiceUsers.delete(message.author.id);
        const updatedTemps = db.tempChannels.filter(vc => vc.channelId !== MVC.channelId);        
        await client.database.updateGuild(MVC.guildId, {
          tempChannels: updatedTemps
        });

        await channel.delete();

        result = new EmbedBuilder()
          .setColor(COLOR)
          .setTitle(client.translate.get(db.language, "Functions.manageVC.channelClosed"))
          .setDescription(client.translate.get(db.language, "Functions.manageVC.channelClosedDesc"));
      } catch (err) {
        result = null;
        await processError(client, err, message);
      }
      break;
  }
  
  if (result) {
    if (client.observedVoiceUsers.get(message.author.id)) clearTimeout(client.observedVoiceUsers.get(message.author.id).timeout);
    client.manageVC.delete(message.author.id);
    message.reply({ embeds: [result] });
  }
}

module.exports = manageVC;