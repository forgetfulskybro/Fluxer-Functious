const { removeGuild } = require("../functions/checkReactionReminders");

module.exports = async (client, guild) => {
  if (!guild?.id) return;
  removeGuild(client, guild.id, guild.name).catch(() => {});
};
