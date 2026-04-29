module.exports = async (client, message, userId, emojiId, event = "add") => {
  const emote = message.emoji?.id
    ? `<:${emojiId}:${message.emoji.id}>`
    : emojiId;

  const db2 = await client.database.getGuild(message.guildId, true);
  if (!db2) return;

  const msgRoles = db2.roles.find((e) => e.msgId === message.messageId);
  if (!msgRoles) return;

  const role = msgRoles.roles.find((e) => e.emoji === emote);
  if (!role) return;

  if (client.reactions.get(userId)) return;

  const guild = client.guilds.cache.get(message.guildId) || (await client.guilds.fetch(message.guildId));
  const member = await guild?.fetchMember(userId);
  if (!member) return;

  client.reactions.set(userId, Date.now() + 1500);
  setTimeout(() => client.reactions.delete(userId), 1500);

  const hasRole = member.roles.cache.has(role.role);
  if (event === "add" && hasRole) return;
  if (event === "remove" && !hasRole) return;

  let error = false;
  if (event === "add") {
    await member.roles.add(role.role).catch(() => {
      error = true;
    });
  } else {
    await member.roles.remove(role.role).catch(() => {
      error = true;
    });
  }

  if (db2.dm) {
    const key = error
      ? guild.ownerId === userId ? `Events.messageReactionAdd.ownerError` : `Events.messageReaction${event === "add" ? "Add" : "Remove"}.noPerms`
      : `Events.messageReaction${event === "add" ? "Add" : "Remove"}.success`;

    const dmContent = `**[${guild.name}]** ${client.translate.get(db2.language, key, { role: `**${role.name}**` })}!`;
    member.user?.createDM().then((dm) => dm.send(dmContent)).catch(() => {});
  }
};
