module.exports = async (client, message, userId, emojiId, event = "add") => {
  const exclusiveRoles = [];
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

  let otherRoles = 0;
  let error = false;
  if (event === "add") {
    await member.roles.add(role.role).catch(() => {
      error = true;
    });

    if (msgRoles.exclusive && !error) {
      otherRoles = msgRoles.roles.filter((e) => e.emoji !== emote && member.roles.cache.has(e.role));
      for (const otherRole of otherRoles) {
        exclusiveRoles.push(otherRole);
        await member.roles.remove(otherRole.role).catch(() => {});
      }
    }
  } else {
    await member.roles.remove(role.role).catch(() => {
      error = true;
    });
  }

  if (db2.dm) {
    const key = error
      ? guild.ownerId === userId ? `Events.messageReactionAdd.ownerError` : `Events.messageReaction${event === "add" ? "Add" : "Remove"}.noPerms`
      : otherRoles.length > 0 ? `Events.messageReactionAdd.exclusive` : `Events.messageReaction${event === "add" ? "Add" : "Remove"}.success`;

    const dmContent = `**[${guild.name}]** ${client.translate.get(db2.language, key, otherRoles?.length > 0 ? { role: `**${role.name}**`, role2: `**${exclusiveRoles.map((e) => e.name).join(", ")}**` } : { role: `**${role.name}**` })}!`;
    member.user?.createDM().then((dm) => dm.send(dmContent)).catch(() => {});
  }
};
