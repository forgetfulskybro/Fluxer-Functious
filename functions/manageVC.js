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
  }
  
  if (result) {
    clearTimeout(client.observedVoiceUsers.get(message.author.id).timeout);
    client.manageVC.delete(message.author.id);
    message.reply({ embeds: [result] });
  }
}

module.exports = manageVC;