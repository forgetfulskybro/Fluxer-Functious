module.exports = async (client, member) => {
  if (member.user.bot) return;

  const db = await client.database.getGuild(member.guild.id);
  if (!db) return;

  if (db.stickyRolesEnabled) {
    const roleIds = member.roles.ids ?? [];
    if (roleIds.length > 0) {
      const stickyRoles = [
        ...db.stickyRoles.filter((s) => s.user !== member.user.id),
        { user: member.user.id, roles: roleIds },
      ];
      const usersJoined = (db.usersJoined ?? []).filter((u) => u !== member.user.id);
      await client.database.updateGuild(member.guild.id, { stickyRoles, usersJoined });
    }
  }

  const userData = await client.database.getUser(member.user.id, true).catch(() => null);
  if (userData?.birthday?.enabledGuilds?.includes(member.guild.id)) {
    const updatedGuilds = userData.birthday.enabledGuilds.filter((id) => id !== member.guild.id);
    await client.database.updateUser(member.user.id, {
      birthday: { ...userData.birthday, enabledGuilds: updatedGuilds },
    }, true);
  }

  // if (db.birthdayBlacklist?.includes(member.user.id)) {
  //   const updatedBlacklist = db.birthdayBlacklist.filter((id) => id !== member.user.id);
  //   await client.database.updateGuild(member.guild.id, { birthdayBlacklist: updatedBlacklist });
  // }
};