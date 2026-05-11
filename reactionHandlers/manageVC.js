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
    case "<:rename:1502164676598628060>":
      type = "channelName";
      result = new EmbedBuilder()
        .setColor(COLOR)
        .setTitle(`${guild.name} - ${client.translate.get(db.language, "Functions.manageVC.renameChannel")}`)
        .setDescription(`${client.translate.get(db.language, "Functions.manageVC.renameChannelDesc")}\n\n${client.translate.get(db.language, "Functions.manageVC.cancelLimit")}`);
      break;
    
    case "<:userlimit:1502164677802393309":
      type = "userLimit";
      result = new EmbedBuilder()
        .setColor(COLOR)
        .setTitle(`${guild.name} - ${client.translate.get(db.language, "Functions.manageVC.setLimit")}`)
        .setDescription(`${client.translate.get(db.language, "Functions.manageVC.setLimitDesc")}\n\n${client.translate.get(db.language, "Functions.manageVC.cancelLimit")}`);
      break;
    
    case "<:block:1502164675642326745>":
      type = "blockUser";
      result = new EmbedBuilder()
        .setColor(COLOR)
        .setTitle(`${guild.name} - ${client.translate.get(db.language, "Functions.manageVC.setBlock")}`)
        .setDescription(`${client.translate.get(db.language, "Functions.manageVC.setBlockDesc")}\n\n${client.translate.get(db.language, "Functions.manageVC.cancelLimit")}`);
      break;
    
    case "<:unblock:1502164681409494751>":
      type = "unblockUser";
      result = new EmbedBuilder()
        .setColor(COLOR)
        .setTitle(`${guild.name} - ${client.translate.get(db.language, "Functions.manageVC.allowUser")}`)
        .setDescription(`${client.translate.get(db.language, "Functions.manageVC.allowUserDesc")}\n\n${client.translate.get(db.language, "Functions.manageVC.cancelLimit")}`);
      break;
    
    case "<:region:1502164672647593687>":
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

    function groupRegions(reg) {
      const grouped = {};
    
      Object.entries(reg).forEach(([key, value]) => {
        if (!grouped[value]) {
          grouped[value] = [];
        }
        grouped[value].push(key);
      });
    
      const result = Object.entries(grouped).map(([canonical, aliases]) => {
        return canonical;
      });
    
      return result;
    }
      
      type = "changeRegion";
      result = new EmbedBuilder()
        .setColor(COLOR)
        .setTitle(`${guild.name} - ${client.translate.get(db.language, "Functions.manageVC.changeRegion")}`)
        .setDescription(`${client.translate.get(db.language, "Functions.manageVC.changeRegionDesc")}\`${(groupRegions(regionMap)).join(', ')}\`\n\n${client.translate.get(db.language, "Functions.manageVC.cancelLimit")}`);
      break;

    case "<:transfer:1502164678616088286>":
      type = "transferOwner";
      result = new EmbedBuilder()
        .setColor(COLOR)
        .setTitle(`${guild.name} - ${client.translate.get(db.language, "Functions.manageVC.transferOwner")}`)
        .setDescription(`${client.translate.get(db.language, "Functions.manageVC.transferOwnerDesc")}\n\n${client.translate.get(db.language, "Functions.manageVC.cancelLimit")}`);
      break;

    case "<:close:1502185371235901763>":
      type = "closeChannel";
      result = new EmbedBuilder()
        .setColor(COLOR)
        .setTitle(`${guild.name} - ${client.translate.get(db.language, "Functions.manageVC.closeChannel")}`)
        .setDescription(`${client.translate.get(db.language, "Functions.manageVC.closeChannelDesc")}\n\n${client.translate.get(db.language, "Functions.manageVC.cancelLimit")}`);
      break;

    case "<:privacy:1502164674153348824>":
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
