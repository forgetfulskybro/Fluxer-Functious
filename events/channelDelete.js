const Giveaways = require("../models/giveaways");
const Polls = require("../models/polls");

module.exports = async (client, channel) => {
  const guildId = channel.guildId;
  const db = await client.database.getGuild(guildId);
  if (!db) return;

  const parentChannelId = db.config?.customParent || db.parentChannel;
  if (channel.id === parentChannelId || channel.id === db.childChannel) {
    await client.database.updateGuild(guildId, {
      parentChannel: null,
      childChannel: null,
      tempChannels: [],
      config: null,
    });
  }

  const rolesInChannel = db.roles.filter(r => r.chanId === channel.id);
  if (rolesInChannel.length > 0) {
    await client.database.updateGuild(guildId, {
      roles: db.roles.filter(r => r.chanId !== channel.id),
    });
  }

  if (db.config?.manage === channel.id) {
    await client.database.updateGuild(guildId, {
      'config.manage': null,
      'config.manageMessage': null,
    });
  }

  await Giveaways.deleteMany({ serverId: guildId, channelId: channel.id });

  await Polls.deleteMany({ serverId: guildId, channelId: channel.id });
};