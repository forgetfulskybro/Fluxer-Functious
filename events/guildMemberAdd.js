const GuildDB = require("../models/guilds");
module.exports = async (client, member) => {
  if (member.user.bot) return;
  const db = await client.database.getGuild(member.guild.id);
  if (db && db.joinRoles?.length > 0) {
    try { message.guild.fetchRoles(); } catch {}
    for (let i = 0; db.joinRoles.length > i; i++) {
      //if (!(await member.guild.roles.get(db.joinRoles[i]))) continue;
      try { await member.roles.add(db.joinRoles[i]); } catch { };
    }
  }
  
  if (db && db.stickyRolesEnabled) {
    const user = db.stickyRoles.find((r) => r.user === member.user.id);
    if (!user) return;
    try { message.guild.fetchRoles(); } catch {}
    for (let i = 0; user.roles.length > i; i++) {
      //if (!(await member.guild.roles.get(db.joinRoles[i]))) continue;
      try { await member.roles.add(db.joinRoles[i]); } catch { };
    }
    
    const newRoles = db.stickyRoles.filter((r) => r.user !== member.user.id);
    await client.database.updateGuild(member.guild.id, { stickyRoles: newRoles });
  }
}