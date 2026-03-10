const { EmbedBuilder, PermissionFlags } = require("@fluxerjs/core");
const Collector = require("../functions/messageCollector");
const EditCollector = require("../functions/messageEdit");
const color = require("../functions/colorCodes")
module.exports = async (client, message) => {
  if (!message || !message.channel || message.channel.type === 1 || !message.content || message.author.bot) return;
  
  const me = message.guild?.members.me ??(message.guild ? await message.guild.members.fetchMe() : null);
  const channel = await client.channels.resolve(message.channel.id).catch(() => {});
  const chanPerms = me.permissionsIn(channel);
  const db = await client.database.getGuild(message.guildId, true);
  let args = message.content.slice(db.prefix.length).trim().split(/ +/g);
  let cmd = args.shift().toLowerCase();

  if (
    message.content &&
    new RegExp(`^(<@!?${client.user.id}>)`).test(message.content)
  ) {
    const mention = new EmbedBuilder()
      .setColor("#A52F05")
      .setTitle(client.user.username)
      .setDescription(
        `${client.translate.get(db.language, "Events.messageCreate.prefix")} \`${db.prefix}\`\n${client.translate.get(db.language, "Events.messageCreate.prefix2")} \`${db.prefix}help\``,
      );

    return message
      .reply(
        {
          embeds: [mention],
        },
        false,
      )
      .catch(() => {
        return;
      });
  }

  if (
    client.messageCollector.has(message.author.id) &&
    client.messageCollector.get(message.author.id).channelId ===
      message.channelId &&
    !client.messageCollector.get(message.author.id).messageId
  )
    return await Collector(client, message, db);
  if (
    client.messageEdit.has(message.author.id) &&
    client.messageEdit.get(message.author.id).channelId === message.channelId &&
    !client.messageEdit.get(message.author.id).messageId
  )
    return await EditCollector(client, message, db);

  let commandfile =
    client.commands.get(cmd) || client.commands.get(client.aliases.get(cmd));
  if (commandfile) {
    if (!message.content.startsWith(db.prefix)) return;
    const member = message.guild.members.get(message.author.id) ?? (await message.guild.fetchMember(message.author.id));
    
    if (!chanPerms?.has(PermissionFlags.SendMessages)) {
      return await message.react("❌").catch(() => { });
      // return member.user.createDM().then((dm) => {
      //     dm.send(`${client.translate.get(db.language, "Events.messageCreate.unable")} <#${message.channelId}>. ${client.translate.get(db.language, "Events.messageCreate.contact")}.`).catch(() => {});
      //   }).catch(() => {});
    }
      
    if (!chanPerms?.has(PermissionFlags.AddReactions))
      return message
        .reply(
          `${client.translate.get(db.language, "Events.messageCreate.noPerms")}. ${client.translate.get(db.language, "Events.messageCreate.contact")}.`,
          false,
        )
        .catch(() => {
          return;
        });

    if (
      !commandfile.config.available &&
      commandfile.config.available !== "Owner" &&
      !client.config.owners.includes(message.author.id)
    )
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
        .catch(() => {
          return;
        });
    if (
      commandfile.config.permissions?.name &&
      !member?.permissions.has(commandfile.config.permissions.bitField) &&
      !client.config.owners.includes(message.author.id)
    )
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
          false,
        )
        .catch(() => {
          return;
        });

    const used = client.used.get(`${message.author.id}-${cmd.toLowerCase()}`);
    if (used) {
      if (client.timeout.get(`${message.author.id}-${cmd.toLowerCase()}`))
        return;

      client.timeout.set(`${message.author.id}-${cmd.toLowerCase()}`, used);
      setTimeout(
        () =>
          client.timeout.delete(`${message.author.id}-${cmd.toLowerCase()}`),
        used,
      );

      const uremaining = client.functions.get("fetchTime")(
        used,
        client,
        db.language,
      );
      const embed = new EmbedBuilder()
        .setColor("#A52F05")
        .setDescription(
          `<@${message.author.id}>, ${client.translate.get(db.language, "Events.messageCreate.wait")} \`${uremaining}\` ${client.translate.get(db.language, "Events.messageCreate.wait2")} \`${cmd.toLowerCase()}\` ${client.translate.get(db.language, "Events.messageCreate.wait3")}.`,
        );

      return message
        .reply({ embeds: [embed] })
        .then((m) => {
          setTimeout(async () => {
            await m.delete();
          }, used);
        })
        .catch(() => {});
    } else {
      let cooldown = commandfile.config.cooldown;
      client.used.set(`${message.author.id}-${cmd.toLowerCase()}`, cooldown);
      setTimeout(
        () => client.used.delete(`${message.author.id}-${cmd.toLowerCase()}`),
        cooldown,
      );

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
    }
  }
};
