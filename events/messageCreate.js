const ScheduleCollector = require("../functions/scheduleCollector");
const { EmbedBuilder, PermissionFlags } = require("@fluxerjs/core");
const checkMediaChannel = require("../functions/checkMediaChannel");
const Collector = require("../functions/messageCollector");
const EditCollector = require("../functions/messageEdit");
const errorHandler = require("../functions/errorHandler");
const parseTime = require("../functions/parseTime");
const manageVC = require("../functions/manageVC");
const { checkMessage } = require("../functions/checkReactionReminders");
const { checkTagMessage } = require("../functions/tagIndex");
const { handleCustomRoleReply } = require("../functions/customRoleSetup");
const StickyCollector = require("../functions/stickyCollector");
const { scheduleSticky } = require("../functions/stickyMessages");
const { handleFormDM } = require("../functions/formHelpers");

function memberHasAnyRole(member, roleIds) {
  if (!member?.roles || !roleIds?.length) return false;

  if (Array.isArray(member.roles)) {
    return member.roles.some((role) =>
      roleIds.includes(typeof role === "string" ? role : role?.id)
    );
  }

  if (Array.isArray(member.roles.roleIds)) {
    return member.roles.roleIds.some((roleId) => roleIds.includes(roleId));
  }

  return roleIds.some((roleId) => member.roles.has?.(roleId));
}

function sendPolicyError(client, message, db, key, vars) {
  return message
    .reply({
      embeds: [
        new EmbedBuilder()
          .setColor("#FF0000")
          .setDescription(
            client.translate.get(db.language, `Events.messageCreate.${key}`, vars)
          ),
      ],
      allowedMentions: { parse: [] },
    })
    .catch(() => {});
}

module.exports = async (client, message) => {
  checkMessage(client, message).catch(() => {});

  if (client?.user?.id && message?.author?.id === client.user.id) return;
  if (message?.author?.bot) {
    checkTagMessage(client, message).catch(() => {});
    return;
  }

  if (!message?.channel || (!message.content && !message.attachments?.size) || message.author.bot) return;
  const MVC = client.manageVC.get(message.author.id); 
  const replyChannelId = message.channelId ?? message.channel?.id;
  if (MVC && (message.channel.type >= 1 || (MVC.inChannel && replyChannelId === MVC.channelId))) return await manageVC(client, message)
  if (message.channel.type === 1) return await handleFormDM(client, message);

  // const channel = message.channel;
  // const chanPerms = me && channel ? me.permissionsIn(channel) : null;

  let member = message.guild.members.get(message.author.id) ?? await message.guild.fetchMember(message.author.id);
  const isMention = new RegExp(`^(<@!?${client.user.id}>)`).test(message.content);
  const db = await client.database.getGuild(message?.guildId, true);
  if (!db) return;

  if (await checkMediaChannel(client, message, db)) return;

  const activeCollector = client.messageCollector.get(message.author.id);
  if (
    activeCollector?.custom &&
    activeCollector.stage === 'roles' &&
    activeCollector.channelId === message.channelId &&
    !message.content.startsWith(db.prefix)
  ) {
    return await handleCustomRoleReply(client, message, db);
  }

  if (!activeCollector?.custom && activeCollector && activeCollector.channelId === message.channelId && !activeCollector.messageId)
    return await Collector(client, message, db);

  if (client.messageEdit.has(message.author.id) && client.messageEdit.get(message.author.id).channelId === message.channelId && !client.messageEdit.get(message.author.id).messageId)
    return await EditCollector(client, message, db);

  if (client.scheduleCollector.has(message.author.id) && client.scheduleCollector.get(message.author.id).channelId === message.channelId && client.scheduleCollector.get(message.author.id)?.editMode !== "menu")
    return await ScheduleCollector(client, message, db);

  const stickySession = client.stickyCollector.get(message.author.id);
  if (stickySession && stickySession.channelId === message.channelId && stickySession.waitingFor)
    return await StickyCollector(client, message, db);

  const channelSticky = db.stickies?.find(
    (sticky) => sticky.channelId === message.channelId && sticky.enabled
  );
  if (channelSticky) {
    scheduleSticky(
      client,
      message.guildId,
      message.channelId,
      message,
      channelSticky.repostDelayMs
    );
  }

  let prefixLength = db.prefix.length;
  if (db.timezoneConvert) {
    const userData = await client.database.getUser(message.author.id, false);
    if (userData?.timezone && parseTime(message.content)) {
      message.react("⌚").catch(() => {});
    }
  }

  if (!isMention && !message.content.startsWith(db.prefix)) {
    await checkTagMessage(client, message, db).catch(() => {});
    return;
  }
  const mentionMatch = isMention && message.content.match(new RegExp(`^(<@!?${client.user.id}>)`));
  const rawPrefixLength = isMention ? mentionMatch[0].length : db.prefix.length;
  const afterPrefix = message.content.slice(rawPrefixLength);
  prefixLength = afterPrefix.startsWith(' ') ? rawPrefixLength + 1 : rawPrefixLength;

  if (isMention && !afterPrefix.trim()) {
    const mention = new EmbedBuilder()
      .setColor(db.theme)
      .setTitle(client.user.username)
      .setDescription(`${client.translate.get(db.language, "Events.messageCreate.prefix", { prefix: `\`${db.prefix}\`` })}\n${client.translate.get(db.language, "Events.messageCreate.prefix2", { cmd: `\`${db.prefix}help\`` })}`);

    return message.reply({ embeds: [mention] }, false).catch(() => {});
  }

  const args = message.content.slice(prefixLength).trim().split(/ +/g);
  const cmd = args.shift()?.toLowerCase();
  if (!cmd) return;

  const commandfile =
    client.commands.get(cmd) || client.commands.get(client.aliases.get(cmd));
  if (!commandfile) return;

  // Turn off permission checking for the bot as Fluxer has lots of issues with it currently and I'd rather have the bot error than not respond when it should.
  // if (!me?.permissions.has(PermissionFlags.SendMessages)) {
  //   if (chanPerms && !chanPerms.has(PermissionFlags.SendMessages)) {
  //     return await message.react("❌").catch(() => {});
  //   }

  //   if (chanPerms && !chanPerms.has(PermissionFlags.AddReactions)) {
  //     return message
  //       .reply(
  //         `${client.translate.get(db.language, "Events.messageCreate.noPerms")}. ${client.translate.get(db.language, "Events.messageCreate.contact")}.`,
  //         false,
  //       )
  //       .catch(() => {});
  //   }
  // }

  if (
    !commandfile.config.available &&
    commandfile.config.available !== "Owner" &&
    !client.config.owners.includes(message.author.id)
  ) {
    return message
      .reply(
        {
          embeds: [
            new EmbedBuilder()
              .setColor("#FF0000")
              .setDescription(
                client.translate.get(
                  db.language,
                  "Events.messageCreate.unavail",
                ),
              ),
          ],
        },
        false,
      )
      .catch(() => {});
  }

  const commandPolicy = (
    Array.isArray(db.commandSettings) ? db.commandSettings : []
  ).find((policy) => policy?.name === commandfile.config.name);
  const policyChannelId = message.channelId ?? message.channel?.id;

  if (commandPolicy) {
    if (commandPolicy.enabled === false) {
      return sendPolicyError(client, message, db, "commandDisabled");
    }

    if (
      commandPolicy.allowedChannels?.length &&
      !commandPolicy.allowedChannels.includes(policyChannelId)
    ) {
      return sendPolicyError(client, message, db, "commandChannels", {
        channels: commandPolicy.allowedChannels
          .map((id) => `<#${id}>`)
          .join(", "),
      });
    }

    if (
      commandPolicy.allowedRoles?.length &&
      !memberHasAnyRole(member, commandPolicy.allowedRoles)
    ) {
      return sendPolicyError(client, message, db, "commandRoles", {
        roles: commandPolicy.allowedRoles
          .map((id) => `<@&${id}>`)
          .join(", "),
      });
    }
  }

  let bypass = false;
  if (db.bypassRoles.length > 0 && commandfile.config.permissions?.bitField) {
    const bypasses = [];
    for (let i = 0; db.bypassRoles.length > i; i++) {
      if (member.roles.has(db.bypassRoles[i].role)) bypasses.push(...db.bypassRoles[i].commands);
    }

    if (bypasses.includes("all")) bypass = true;
    else if (bypasses.includes(commandfile.config.name)) bypass = true;
  }

  if (commandfile.config.permissions?.name && !member?.permissions.has(commandfile.config.permissions.bitField) && !client.config.owners.includes(message.author.id) && !bypass) {
    const permCooldownKey = `${message.author.id}-perms`;
    if (client.timeout.has(permCooldownKey)) return;

    try {
      const freshMember = await message.guild.fetchMember(message.author.id);
      if (freshMember?.permissions.has(commandfile.config.permissions.bitField)) {
        member = freshMember;
        message.guild.members.set(freshMember.id, freshMember);
      } else {
        client.timeout.set(permCooldownKey, true);
        setTimeout(() => client.timeout.delete(permCooldownKey), 2500);

        return message
          .reply({
            embeds: [
              new EmbedBuilder()
                  .setColor("#FF0000")
                  .setDescription(
                    `${client.translate.get(db.language, "Events.messageCreate.perms")}.\n${client.translate.get(db.language, "Events.messageCreate.perms2", { permission: String(commandfile.config.permissions.name) })}\n\n${client.translate.get(db.language, "Events.messageCreate.perms3")}`,
                  ),
              ],
            },
          )
          .catch(() => {});
      }
    } catch {
      client.timeout.set(permCooldownKey, true);
      setTimeout(() => client.timeout.delete(permCooldownKey), 2500);

      return message
        .reply(
          {
            embeds: [
              new EmbedBuilder()
                .setColor("#FF0000")
                .setDescription(
                  `${client.translate.get(db.language, "Events.messageCreate.perms")}.\n${client.translate.get(db.language, "Events.messageCreate.perms2", { permission: String(commandfile.config.permissions.name) })}\n\n${client.translate.get(db.language, "Events.messageCreate.perms3")}`,
                ),
            ],
          },
        )
        .catch(() => {});
    }
  }

  const usedKey = `${message.author.id}-${commandfile.config.name}`;
  const globalCooldown = Math.max(0, Number(commandfile.config.cooldown) || 0);
  const cooldown =
    commandPolicy && Number.isFinite(commandPolicy.cooldownMs)
      ? Math.max(globalCooldown, commandPolicy.cooldownMs)
      : globalCooldown;

  if (cooldown > 0) {
    const now = Date.now();
    const expiresAt = client.used.get(usedKey);

    if (Number.isFinite(expiresAt) && expiresAt > now) {
      if (client.timeout.get(usedKey)) return;
      client.timeout.set(usedKey, true);
      setTimeout(() => client.timeout.delete(usedKey), 2500);

      const remaining = expiresAt - now;
      const uremaining = client.functions.get("fetchTime")(
        Math.max(1000, remaining),
        client,
        db.language,
        false,
        true
      );

      const embed = new EmbedBuilder()
        .setColor(db.theme)
        .setDescription(
          `<@${message.author.id}>, ${client.translate.get(db.language, "Events.messageCreate.wait", { "time": `\`${uremaining}\``, "cmd": `\`${cmd}\`` })}`,
        );

      return message
        .reply({ embeds: [embed] })
        .then((m) => setTimeout(() => m.delete().catch(() => {}), remaining))
        .catch(() => {});
    }

    const nextExpiry = now + cooldown;
    client.used.set(usedKey, nextExpiry);
    setTimeout(() => {
      if (client.used.get(usedKey) === nextExpiry) client.used.delete(usedKey);
    }, cooldown);
  }

  Promise.allSettled([
    client.vanta.identify({
      userId: message.author.id,
      name: message.author.username,
      discriminator: message.author.discriminator,
    }),
    client.vanta.track({
      event: "command.used",
      userId: message.author.id,
      groupId: message?.guildId ?? "Unknown Guild",
      data: { command: cmd },
    }),
  ]);

  try {
    return await commandfile.run(
      client,
      message,
      message.content
        .slice(prefixLength)
        .slice(cmd.length)
        .trim()
        .split(/ +/g),
      db,
    );
  } catch (error) {
    console.error(error);
    await errorHandler({
      type: "command",
      message,
      error,
      config: {}
    });
  } finally {
    if (commandPolicy?.deleteInvocation) {
      message.delete().catch(() => {});
    }
  }
};