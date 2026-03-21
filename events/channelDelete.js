module.exports = async (client, channel) => {
  const guildId = channel.guildId;
  const db = await client.database.getGuild(guildId);
  if (!db) return;

  if (channel.id === db.parentChannel || channel.id === db.childChannel) {
    await client.database.updateGuild(guildId, {
      parentChannel: null,
      childChannel: null,
      tempChannels: [],
      config: null,
    });
  }
};