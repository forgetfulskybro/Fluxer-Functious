const { removeGuild } = require("../functions/checkReactionReminders");
const Forms = require("../models/forms");
const FormSubmissions = require("../models/formSubmissions");

module.exports = async (client, guild) => {
  if (!guild?.id) return;

  for (const [userId, data] of client.observedVoiceUsers || []) {
    if (data?.guildId === guild.id) client.observedVoiceUsers.delete(userId);
  }
  for (const [userId, data] of client.observedVoiceBots || []) {
    if (data?.guildId === guild.id) client.observedVoiceBots.delete(userId);
  }

  removeGuild(client, guild.id, guild.name).catch(() => {});
  await Promise.all([
    Forms.deleteMany({ guildId: guild.id }).catch(() => {}),
    FormSubmissions.deleteMany({ guildId: guild.id }).catch(() => {}),
  ]);
};
