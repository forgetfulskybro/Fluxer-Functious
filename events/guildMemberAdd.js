const GuildDB = require("../models/guilds");
module.exports = async (client, member) => {
  if (member.bot) return;
  const db = await client.database.getGuild(member.guild.id);
  if (db.joinRoles?.length > 0) {
    for (let i = 0; db.joinRoles.length > i; i++) {
      if (!(await member.guild.roles.get(db.joinRoles[i]))) continue;
      await member.roles.add(db.joinRoles[i]).catch(() => { });
    }
  }
  
  if (db.stickyRolesEnabled) {
    const user = db.stickyRoles.find((r) => r.user === member.user.id);
    if (!user) return;
    for (let i = 0; user.roles.length > i; i++) {
      if (!(await member.guild.roles.get(user.roles[i]))) continue;
      await member.roles.add(user.roles[i]).catch(() => { });
    }
    
    const newRoles = db.stickyRoles.filter((r) => r.user !== member.user.id);
    await client.database.updateGuild(member.guild.id, { stickyRoles: newRoles });
  }
}