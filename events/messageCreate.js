import { EmbedBuilder, PermissionFlags } from "@fluxerjs/core";
import Collector from "../functions/messageCollector";
import EditCollector from "../functions/messageEdit";
import parseTime from "../functions/parseTime";
import color from "../functions/colorCodes";

export default async (client, message) => {
  if (
    !message?.channel ||
    message.channel.type === 1 ||
    !message.content ||
    message.author.bot
  )
    return;

  const me = message.guild
    ? (message.guild.members.me ??
      (await message.guild.members.fetchMe().catch(() => null)))
    : null;

  const channel = message.channel;
  const chanPerms = me && channel ? me.permissionsIn(channel) : null;
  const db = await client.database.getGuild(message.guildId, true);

  if (new RegExp(`^(<@!?${client.user.id}>)`).test(message.content)) {
    const mention = new EmbedBuilder()
      .setColor("#A52F05")
      .setTitle(client.user.username)
      .setDescription(`${client.translate.get(db.language, "Events.messageCreate.prefix")} \`${db.prefix}\`\n${client.translate.get(db.language, "Events.messageCreate.prefix2")} \`${db.prefix}help\``);

    return message.reply({ embeds: [mention] }, false).catch(() => {});
  }

  if (client.messageCollector.has(message.author.id) && client.messageCollector.get(message.author.id).channelId === message.channelId && !client.messageCollector.get(message.author.id).messageId)
    return await Collector(client, message, db);

  if (client.messageEdit.has(message.author.id) && client.messageEdit.get(message.author.id).channelId === message.channelId && !client.messageEdit.get(message.author.id).messageId)
    return await EditCollector(client, message, db);

  if (parseTime(message.content) && db.timezoneConvert && db.userTimezones.find((u) => u.userId === message.author.id)) {
    try {
    await message.react("⌚");
    } catch {
    client.database.updateGuild(message.guildId, { timezoneConvert: false });
    }
  }


  if (!message.content.startsWith(db.prefix)) return;
  const args = message.content.slice(db.prefix.length).trim().split(/ +/g);
  const cmd = args.shift()?.toLowerCase();
  if (!cmd) return;

  const commandfile =
    client.commands.get(cmd) || client.commands.get(client.aliases.get(cmd));
  if (!commandfile) return;

  let member = message.guild.members.get(message.author.id);
  if (!member)
    member = await message.guild
      .fetchMember(message.author.id)
      .catch(() => null);

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
    return message
      .reply(
        {
          embeds: [
            new EmbedBuilder()
              .setColor("#FF0000")
              .setDescription(
                `${client.translate.get(db.language, "Events.messageCreate.perms")}.\n${client.translate.get(db.language, "Events.messageCreate.perms2")}: [${String(commandfile.config.permissions.name)}]`,
              ),
          ],
        },
      )
      .catch(() => {});
  }

  const usedKey = `${message.author.id}-${cmd}`;
  const used = client.used.get(usedKey);
  if (used) {
    if (client.timeout.get(usedKey)) return;
    client.timeout.set(usedKey, used);
    setTimeout(() => client.timeout.delete(usedKey), used);

    const uremaining = client.functions.get("fetchTime")(
      used,
      client,
      db.language,
    );
    
    const embed = new EmbedBuilder()
      .setColor("#A52F05")
      .setDescription(
        `<@${message.author.id}>, ${client.translate.get(db.language, "Events.messageCreate.wait", { "time": `\`${uremaining}\``, "cmd": `\`${cmd}\`` })}`,
      );

    return message
      .reply({ embeds: [embed] })
      .then((m) => setTimeout(() => m.delete().catch(() => {}), used))
      .catch(() => {});
  }

  const cooldown = commandfile.config.cooldown;
  client.used.set(usedKey, cooldown);
  setTimeout(() => client.used.delete(usedKey), cooldown);

  return commandfile.run(
    client,
    message,
    message.content
      .slice(db.prefix.length)
      .slice(cmd.length)
      .trim()
      .split(/ +/g),
    db,
  );
};
