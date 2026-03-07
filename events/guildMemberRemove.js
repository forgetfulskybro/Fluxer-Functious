const GuildDB = require("../models/guilds");
module.exports = async (client, member) => {
  if (member.bot) return;
  const db = await client.database.getGuild(member.guild.id);
  if (db.stickyRolesEnabled) {
    const roles = db.stickyRoles.concat({ user: member.user.id, roles: member.roles.roleIds.map(r => r) }).filter((s) => s)
    await client.database.updateGuild(member.guild.id, { stickyRoles: roles });
  }
}