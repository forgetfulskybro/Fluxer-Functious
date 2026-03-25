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
};