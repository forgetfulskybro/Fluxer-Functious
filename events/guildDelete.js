const { removeGuild } = require("../functions/checkReactionReminders");

module.exports = async (client, guild) => {
  if (!guild?.id) return;

  for (const [userId, data] of client.observedVoiceUsers || []) {
    if (data?.guildId === guild.id) client.observedVoiceUsers.delete(userId);
  }
  for (const [userId, data] of client.observedVoiceBots || []) {
    if (data?.guildId === guild.id) client.observedVoiceBots.delete(userId);
  }

  removeGuild(client, guild.id, guild.name).catch(() => {});
};
