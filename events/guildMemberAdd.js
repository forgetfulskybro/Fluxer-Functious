const dhms = require("../functions/dhms");

module.exports = async (client, member) => {
  if (member.user.bot) return;
  const db = await client.database.getGuild(member.guild.id);
  if (!db) return;

  if (db.timedRoles?.length > 0) {
    const now = Date.now();
    const roleIds = [];

    for (const role of db.timedRoles) {
      roleIds.push({
        id: role.id,
        time: now + role.time,
      });
    }

    let updatedUsersJoined = db.usersJoined || [];
    const existingUserEntry = updatedUsersJoined.find(
      (u) => u.userId === member.user.id,
    );

    if (existingUserEntry) {
      existingUserEntry.roleIds = existingUserEntry.roleIds.concat(roleIds);
    } else {
      updatedUsersJoined.push({
        userId: member.user.id,
        roleIds: roleIds,
      });
    }

    await client.database.updateGuild(member.guild.id, {
      usersJoined: updatedUsersJoined,
    });
  }
 
  if (db.joinRoles?.length > 0) {
    const roleAdds = db.joinRoles.map((roleId) =>
      member.roles.add(roleId).catch(() => null),
    );
    await Promise.all(roleAdds);
  }

  if (db.stickyRolesEnabled) {
    const user = db.stickyRoles.find((r) => r.user === member.user.id);
    if (user?.roles?.length > 0) {
      const roleAdds = user.roles.map((roleId) =>
        member.roles.add(roleId).catch(() => null),
      );
      await Promise.all(roleAdds);

      const newRoles = db.stickyRoles.filter((r) => r.user !== member.user.id);
      await client.database.updateGuild(member.guild.id, {
        stickyRoles: newRoles,
      });
    }
  }
};
