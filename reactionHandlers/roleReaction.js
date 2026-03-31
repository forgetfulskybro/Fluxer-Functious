export default async (client, message, userId, emojiId, event = "add") => {
  const emote = message.emoji?.id
    ? `<:${emojiId}:${message.emoji.id}>`
    : emojiId;
  const db2 = await client.database.getGuild(message.guildId, true);

  if (!db2) return;
  const msgRoles = db2.roles.find((e) => e.msgId === message.messageId);
  if (!msgRoles || !msgRoles.roles.find((e) => e.emoji === emote)) return;

  if (client.reactions.get(userId)) return;

  const roles = msgRoles.roles;
  const role = roles.find((e) => e.emoji === emote);

  const guild = client.guilds.cache.get(message.guildId) || (await client.guilds.fetch(message.guildId));
  const member = await guild?.fetchMember(userId);
  if (!member) return;

  let error = false;
  if (event === "add") {
    if (member.roles.cache.has(role.role)) return;

    client.reactions.set(userId, Date.now() + 1500);
    setTimeout(() => client.reactions.delete(userId), 1500);

    await member.roles.add(role.role).catch(() => {
      error = true;
    });

    if (db2.dm) {
      const dmContent = error
        ? `**[${guild.name}]** ${client.translate.get(db2.language, "Events.messageReactionAdd.noPerms", { role: `**${role.name}**` })}!`
        : `**[${guild.name}]** ${client.translate.get(db2.language, "Events.messageReactionAdd.success", { role: `**${role.name}**` })}!`;

      member.user
        ?.createDM()
        .then((dm) => dm.send(dmContent))
        .catch(() => {});
    }
    return;
  }

  console.log(`has role: ${member?.roles?.cache?.has(role.role)}`)
  if (!member.roles.cache.has(role.role)) return;

  client.reactions.set(userId, Date.now() + 1500);
  setTimeout(() => client.reactions.delete(userId), 1500);

  await member.roles.remove(role.role).catch(() => {
    error = true;
  });

  if (db2.dm) {
    const dmContent = error
      ? `**[${guild.name}]** ${client.translate.get(db2.language, "Events.messageReactionRemove.noPerms", { role: `**${role.name}**` })}!`
      : `**[${guild.name}]** ${client.translate.get(db2.language, "Events.messageReactionRemove.success", { role: `**${role.name}**` })}!`;

    member.user
      ?.createDM()
      .then((dm) => dm.send(dmContent))
      .catch(() => {});
  }
};
