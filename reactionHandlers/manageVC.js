const { EmbedBuilder, resolvePermissionsToBitfield } = require("@erinjs/core");
const errorHandler = require("../functions/errorHandler");

const COLOR = "#A52F05";

module.exports = async (client, message, userId, emojiId) => {
  if (client.manageVC.get(userId)) return;
  
  const emote = message.emoji?.id ? `<:${emojiId}:${message.emoji.id}>` : emojiId;
  const connected = client.observedVoiceUsers.get(userId);
  const db = await client.database.getGuild(connected.guildId);
  const tempVC = db.tempChannels?.find((vc) => vc.channelId === connected.channelId);
  if (!tempVC || tempVC.ownerId !== userId) return;
  
  const guild = client.guilds.get(connected.guildId);
  
  let result;
  let type;
  switch (emote) {
    case "<:channelName:1498099550363509257>":
      type = "channelName";
      result = new EmbedBuilder()
        .setColor(COLOR)
        .setTitle(`${guild.name} - ${client.translate.get(db.language, "Functions.manageVC.renameChannel")}`)
        .setDescription(`${client.translate.get(db.language, "Functions.manageVC.renameChannelDesc")}\n\n${client.translate.get(db.language, "Functions.manageVC.cancelLimit")}`);
      break;
    
    case "<:userLimit:1498101792919392863>":
      type = "userLimit";
      result = new EmbedBuilder()
        .setColor(COLOR)
        .setTitle(`${guild.name} - ${client.translate.get(db.language, "Functions.manageVC.setLimit")}`)
        .setDescription(`${client.translate.get(db.language, "Functions.manageVC.setLimitDesc")}\n\n${client.translate.get(db.language, "Functions.manageVC.cancelLimit")}`);
      break;
    
    case "<:blockUser:1498101705656877648>":
      type = "blockUser";
      result = new EmbedBuilder()
        .setColor(COLOR)
        .setTitle(`${guild.name} - ${client.translate.get(db.language, "Functions.manageVC.setBlock")}`)
        .setDescription(`${client.translate.get(db.language, "Functions.manageVC.setBlockDesc")}\n\n${client.translate.get(db.language, "Functions.manageVC.cancelLimit")}`);
      break;
    
    case "<:unblockUser:1498101686866420308>":
      type = "unblockUser";
      result = new EmbedBuilder()
        .setColor(COLOR)
        .setTitle(`${guild.name} - ${client.translate.get(db.language, "Functions.manageVC.allowUser")}`)
        .setDescription(`${client.translate.get(db.language, "Functions.manageVC.allowUserDesc")}\n\n${client.translate.get(db.language, "Functions.manageVC.cancelLimit")}`);
      break;
    
    case "<:view:1498405262088803743>":
      try {
        const channel = guild.channels.get(connected.channelId);
        const everyone = guild.roles.find((r) => r.name === "@everyone");

        let isPrivate = !connected?.private;
        connected.private = isPrivate;
        
        await channel.editPermission(userId, {
          type: 1,
          allow: resolvePermissionsToBitfield(["Connect"]),
        });
        
        await channel.editPermission(everyone.id, {
          type: 0,
          [isPrivate ? 'deny' : 'allow']: resolvePermissionsToBitfield(["Connect"]),
        });
      
        type = "private";
        const statusText = isPrivate 
          ? client.translate.get(db.language, "Functions.manageVC.isPrivate")
          : client.translate.get(db.language, "Functions.manageVC.isNotPrivate");
        
        result = new EmbedBuilder()
          .setColor(COLOR)
          .setTitle(`${guild.name} - ${client.translate.get(db.language, "Functions.manageVC.privacy")}`)
          .setDescription(statusText);
      } catch (error) {
        result = null;
        await errorHandler({
          type: "function",
          message,
          error,
          config: {},
          sendInChannel: false,
        });
      }
        break;
  }
  
  if (result) {
    const user = client.users.get(userId);
    try {
      const DM = await user.createDM();
      await DM.send({ embeds: [result] }).then((d) => { 
        if (type !== "private") client.manageVC.set(userId, { type, channelId: connected.channelId, guildId: connected.guildId })
        const timeout = setTimeout(() => {
          if (client.manageVC.get(userId)) {
            d.edit({ content: client.translate.get(db.language, "Functions.manageVC.collectEnded"), embeds: [result] });
            client.manageVC.delete(userId)
          }
        }, 60000);
        
        connected.timeout = timeout;
      })
    } catch (e) {
      if (client.reactions.get(userId)) return;
      if (!db.config?.manage) return;
      guild.channels.get(db.config.manage).send(`<@${userId}>, ${client.translate.get(db.language, "Functions.manageVC.dmsOff")}`).then((m) => { 
        client.reactions.set(userId, Date.now() + 2500);
        setTimeout(() => client.reactions.delete(userId), 2500)
        setTimeout(() => m.delete(), 8000);
      }).catch(() => {})
      
    }
  }
};
