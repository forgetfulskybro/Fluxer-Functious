const { EmbedBuilder, PermissionFlags } = require("@fluxerjs/core");

function isValid(tz) {
  if (!Intl || !Intl.DateTimeFormat().resolvedOptions().timeZone) {
    return false;
  }

  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch (err) {
    return false;
  }
}

function dateType(tz) {
  if (!tz.includes("/")) return false;
  const text = tz.split("/");

  if (text.length === 2) return true;
  return false;
}

async function findMember(guild, query) {
  if (!query) return null;
  
  const isIdQuery = /^\d{17,19}$/.test(query);
  const mentionMatch = query.match(/^<@!?(\d+)>$/);
  const targetId = mentionMatch ? mentionMatch[1] : isIdQuery ? query : null;
  
  if (targetId) {
    const cachedMember = guild.members.get(targetId);
    if (cachedMember) return cachedMember;
  }
  
  const byDisplayName = guild.members.find(m => m.displayName?.toLowerCase() === query.toLowerCase());
  if (byDisplayName) return byDisplayName;
  
  const byUsername = guild.members.find(m => m.user?.username?.toLowerCase() === query.toLowerCase());
  if (byUsername) return byUsername;
  
  const partialDisplay = guild.members.find(m => m.displayName?.toLowerCase().includes(query.toLowerCase()));
  if (partialDisplay) return partialDisplay;
  
  const partialUsername = guild.members.find(m => m.user?.username?.toLowerCase().includes(query.toLowerCase()));
  if (partialUsername) return partialUsername;
  
  if (targetId) {
    const fetchedMember = await guild.fetchMember(targetId).catch(() => null);
    if (fetchedMember) return fetchedMember;
    
    const fetchedUser = await guild.client.users.fetch(targetId).catch(() => null);
    if (fetchedUser) return { user: fetchedUser, id: fetchedUser.id, displayName: fetchedUser.username, userNotInGuild: true };
  }
  
  return null;
}

function getGMTOffset(timezone) {
  const now = new Date();
  const tzDate = new Date(now.toLocaleString("en-US", { timeZone: timezone }));
  const utcDate = new Date(now.toLocaleString("en-US", { timeZone: "UTC" }));
  const offset = (tzDate - utcDate) / (1000 * 60 * 60);
  const sign = offset >= 0 ? "+" : "";
  return `GMT${sign}${offset}`;
}

function getCurrentTimeInTimezone(timezone) {
  return new Date().toLocaleString("en-US", {
    timeZone: timezone,
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true
  });
}

module.exports = {
    config: {
        name: "timezone",
        usage: true,
        cooldown: 2000,
        available: true,
        permissions: {},
        aliases: ["tz"]
    },
  run: async (client, message, args, db) => {
    const time = client.functions.get("parseTime")(client.translate.get(db.language, "Commands.timezone.formatText", { "time": "19:00" })).message;
    switch (args[0]) {
      default: "help";
      case "help":
        message.reply({ embeds: [new EmbedBuilder().setColor(`#A52F05`).setTitle(client.translate.get(db.language, "Commands.timezone.viewingHelp")).setDescription(`${client.translate.get(db.language, "Commands.timezone.explanation")}\n\n**${client.translate.get(db.language, "Commands.timezone.exampleMsg")}**: ${client.translate.get(db.language, "Commands.timezone.formatText", { "time": "19:00" })}\n**${client.translate.get(db.language, "Commands.timezone.timestampMsg")}**: ${time}\n\n${client.translate.get(db.language, "Commands.timezone.toggle")}\n\`${db.prefix}timezone toggle\`\n\n${client.translate.get(db.language, "Commands.timezone.userTimezone")} [${client.translate.get(db.language, "Commands.timezone.timeZonePicker")}](https://zones.arilyn.cc/)\n\`${db.prefix}timezone set [${client.translate.get(db.language, "Commands.timezone.timezone")}, e.g. America/New_York]\`\n\n${client.translate.get(db.language, "Commands.timezone.userTimezoneRemove")}\n\`${db.prefix}timezone remove\`\n\n${client.translate.get(db.language, "Commands.timezone.viewCmd")}\n\`${db.prefix}timezone view [${client.translate.get(db.language, "Commands.timezone.optionalUser")}]\``)] })
        break;

      case "view":
        {
          const query = args[1];
          let isTimezoneQuery = false;
          let timezone = null;
          
          if (query) {
            if (isValid(query) && dateType(query)) {
              isTimezoneQuery = true;
              timezone = query;
            }
          }
          
          if (isTimezoneQuery) {
            const gmtOffset = getGMTOffset(timezone);
            const currentTime = getCurrentTimeInTimezone(timezone);
            
            const usersWithTimezone = [];
            for (const tzData of db.userTimezones) {
              if (tzData.timezone.toLowerCase() === timezone.toLowerCase()) {
                const member = message.guild.members.get(tzData.userId);
                if (member) {
                  usersWithTimezone.push(member);
                } 
              }
            }
            
            let usersList = "";
            if (usersWithTimezone.length > 0) {
              usersList = usersWithTimezone.map(m => `<@${m.id}> ${m.displayName ?? m.user?.username ? `(${m.displayName || m.user?.username})` : ``}`).join("\n");
            } else {
              usersList = client.translate.get(db.language, "Commands.timezone.noUsers");
            }
            
            const embed = new EmbedBuilder()
              .setColor("#A52F05")
              .setTitle(`${client.translate.get(db.language, "Commands.timezone.infoTimezone")}: ${timezone}`)
              .addFields(
                { name: client.translate.get(db.language, "Commands.timezone.timezoneField"), value: `\`${timezone}\``, inline: true },
                { name: client.translate.get(db.language, "Commands.timezone.gmtField"), value: `\`${gmtOffset}\``, inline: true },
                { name: client.translate.get(db.language, "Commands.timezone.currentTimeField"), value: `\`${currentTime}\``, inline: false },
                { name: `${client.translate.get(db.language, "Commands.timezone.usersInTimezone")} (${usersWithTimezone.length})`, value: usersList.substring(0, 1024) || client.translate.get(db.language, "Commands.timezone.none"), inline: false }
              );
            
            message.reply({ embeds: [embed] });
            break;
          }
          
          let targetMember;
          let targetUserId = message.author.id;
          
          if (query) {
            targetMember = await findMember(message.guild, query);
            if (!targetMember) {
              return message.reply({
                embeds: [
                  new EmbedBuilder()
                    .setColor("#FF0000")
                    .setDescription(client.translate.get(db.language, "Commands.timezone.memberNotFound"))
                ]
              });
            }
            targetUserId = targetMember.id;
          } else {
            targetMember = await findMember(message.guild, message.author.id);
          }
          
          const userTzData = db.userTimezones.find((u) => u.userId === targetUserId);
          
          if (!userTzData) {
            const isSelf = targetUserId === message.author.id;
            return message.reply({
              embeds: [
                new EmbedBuilder()
                  .setColor("#FF0000")
                  .setDescription(isSelf 
                    ? `${client.translate.get(db.language, "Commands.timezone.noTimeSelf", { "timezonepicker": `[${client.translate.get(db.language, "Commands.timezone.timeZonePicker")}](https://zones.arilyn.cc/)` })}:\n\`${db.prefix}timezone set [${client.translate.get(db.language, "Commands.timezone.timezone")}, e.g. America/New_York]\``
                    : client.translate.get(db.language, "Commands.timezone.noTimeOther", { "user": targetMember?.displayName || targetMember?.user?.username || targetUserId })
                  )
              ]
            });
          }
          
          timezone = userTzData.timezone;
          const gmtOffset = getGMTOffset(timezone);
          const currentTime = getCurrentTimeInTimezone(timezone);
          
          const embed = new EmbedBuilder()
            .setColor("#A52F05")
            .setTitle(client.translate.get(db.language, "Commands.timezone.timezoneInfo", { "user": targetMember?.displayName || targetMember?.user?.username || "User" }))
            .addFields(
              { name: client.translate.get(db.language, "Commands.timezone.timezoneField"), value: `\`${timezone}\``, inline: true },
              { name: client.translate.get(db.language, "Commands.timezone.gmtField"), value: `\`${gmtOffset}\``, inline: true },
              { name: client.translate.get(db.language, "Commands.timezone.currentTimeField"), value: `\`${currentTime}\``, inline: false }
            );
          
          message.reply({ embeds: [embed] });
        }
        break;

      case "toggle":
      let member = message.guild.members.get(message.author.id);
      if (!member)
        member = await message.guild
          .fetchMember(message.author.id)
          .catch(() => null);
        
        let bypass = false;
        const bypasses = [];
        for (let i = 0; db.bypassRoles.length > i; i++) {
          if (member.roles.has(db.bypassRoles[i].role)) bypasses.push(...db.bypassRoles[i].commands);
        }
    
        if (bypasses.includes("all")) bypass = true;
        else if (bypasses.includes("timezone")) bypass = true;
        
        if (!member?.permissions.has(PermissionFlags.ManageGuild) && !client.config.owners.includes(message.author.id) && !bypass) return message.reply({
          embeds: [
            new EmbedBuilder()
              .setColor("#FF0000")
              .setDescription(`${client.translate.get(db.language, "Events.messageCreate.perms")}.\n${client.translate.get(db.language, "Events.messageCreate.perms2")}: [Manage Guild]`)]
        });
        
        const toggle = db.timezoneConvert;
        await client.database.updateGuild(message.guildId, { timezoneConvert: !toggle });
        message.reply({ embeds: [new EmbedBuilder().setDescription(`${client.translate.get(db.language, "Commands.timezone.success")} **${toggle ? client.translate.get(db.language, "Commands.roles.off") : client.translate.get(db.language, "Commands.roles.on")}**`).setColor(`#A52F05`)] });
        break;
      
      case "set":
        if (!args[1] || !isValid(args[1]) || !dateType(args[1])) return message.reply({
          embeds: [
            new EmbedBuilder()
              .setColor("#FF0000")
              .setDescription(`${client.translate.get(db.language, "Commands.timezone.validTime", { "timezone": "`America/New_York`" })} [${client.translate.get(db.language, "Commands.timezone.timeZonePicker")}](https://zones.arilyn.cc/).\n\n${client.translate.get(db.language, "Commands.timezone.validTime2")}: \`${db.prefix}timezone set America/New_York\``)]
        });
      
        const userTimezone = db.userTimezones.find((u) => u.userId === message.author.id);
        if (userTimezone?.timezone.toLowerCase() === args[1]?.toLowerCase()) return message.reply({
          embeds: [
            new EmbedBuilder()
              .setColor("#FF0000")
              .setDescription(`${client.translate.get(db.language, "Commands.timezone.sameTime")} [${client.translate.get(db.language, "Commands.timezone.timeZonePicker")}](https://zones.arilyn.cc/)`)]
        });
        
        let timezones;
        if (userTimezone) timezones = db.userTimezones.filter((u) => u.userId !== message.author.id);
        else timezones = db.userTimezones;
        await client.database.updateGuild(message.guild.id, { userTimezones: [...timezones, { userId: message.author.id, timezone: args[1] }] });
        message.reply({ embeds: [new EmbedBuilder().setDescription(client.translate.get(db.language, "Commands.timezone.successSet", { "timezone": `\`${args[1]}\`` })).setColor(`#A52F05`)] });
        break;
      
      case "remove":
        if (!db.userTimezones.find((u) => u.userId === message.author.id)) return message.reply({
          embeds: [
          new EmbedBuilder()
            .setColor("#FF0000")
            .setDescription(`${client.translate.get(db.language, "Commands.timezone.noTime", { "timezonepicker": `[${client.translate.get(db.language, "Commands.timezone.timeZonePicker")}](https://zones.arilyn.cc/)` })}:\n\`${db.prefix}timezone set [${client.translate.get(db.language, "Commands.timezone.timezone")}, e.g. America/New_York]\``)]
        });
        
        const timezone = db.userTimezones.filter((u) => u.userId !== message.author.id);
        await client.database.updateGuild(message.guild.id, { userTimezones: timezone });
        message.reply({ embeds: [new EmbedBuilder().setDescription(client.translate.get(db.language, "Commands.timezone.successRemove")).setColor(`#A52F05`)] });
        break;
    }
    },
};
