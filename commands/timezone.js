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
        message.reply({ embeds: [new EmbedBuilder().setTitle(client.translate.get(db.language, "Commands.timezone.viewingHelp")).setDescription(`${client.translate.get(db.language, "Commands.timezone.explanation")}\n\n**${client.translate.get(db.language, "Commands.timezone.exampleMsg")}**: ${client.translate.get(db.language, "Commands.timezone.formatText", { "time": "19:00" })}\n**${client.translate.get(db.language, "Commands.timezone.timestampMsg")}**: ${time}\n\n${client.translate.get(db.language, "Commands.timezone.toggle")}\n\`${db.prefix}timezone toggle\`\n\n${client.translate.get(db.language, "Commands.timezone.userTimezone")} [${client.translate.get(db.language, "Commands.timezone.timeZonePicker")}](https://zones.arilyn.cc/)\n\`${db.prefix}timezone set [${client.translate.get(db.language, "Commands.timezone.timezone")}, e.g. America/New_York]\`\n\n${client.translate.get(db.language, "Commands.timezone.userTimezoneRemove")}\n\`${db.prefix}timezone remove\``)] })
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
