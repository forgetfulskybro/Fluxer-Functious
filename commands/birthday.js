const { PermissionFlags } = require("@fluxerjs/core");
const { EmbedBuilder } = require("../functions/birthdayHelpers");
const {
  getMonthName,
  ordinal,
  validDay,
  nextBirthdayTimestamp,
  buildBirthdayAnnouncement,
} = require("../functions/birthdayHelpers");
const UserDB = require("../models/users");
const Paginator = require("../functions/pagination");
const getRoles = require("../functions/getRoles");

function resolveMonth(str, client, lang) {
  const n = parseInt(str, 10);
  if (!isNaN(n) && n >= 1 && n <= 12) return n;
  const s = str.toLowerCase().slice(0, 3);
  const months = Array.from({ length: 12 }, (_, i) => getMonthName(i, client, lang));
  const idx = months.findIndex((m) => m.toLowerCase().startsWith(s));
  return idx !== -1 ? idx + 1 : null;
}

function parseDate(input, client, lang) {
  if (!input) return null;

  const ord = ["th", "st", "nd", "rd"].map((k) => client.translate.get(lang, `Commands.birthday.ordinals.${k}`));
  const the = client.translate.get(lang, "Commands.birthday.parseThe");
  const of = client.translate.get(lang, "Commands.birthday.parseOf");

  input = input.trim()
    .replace(new RegExp(`(\\d+)(?:${ord.join("|")})\\b`, "gi"), "$1")
    .replace(new RegExp(`\\b${the}\\b`, "gi"), "")
    .replace(new RegExp(`\\b${of}\\b`, "gi"), "")
    .replace(/\s+/g, " ")
    .trim();

  const numRe = /^(\d{1,2})[\/\-\.](\d{1,2})$/;
  const numMatch = input.match(numRe);
  if (numMatch) {
    const a = parseInt(numMatch[1], 10);
    const b = parseInt(numMatch[2], 10);
    const naOk = a >= 1 && a <= 12 && validDay(a, b);
    const euOk = b >= 1 && b <= 12 && validDay(b, a);

    if (naOk && euOk && a !== b) {
      return { month: a, day: b, ambiguous: true };
    }
    if (naOk) return { month: a, day: b };
    if (euOk) return { month: b, day: a };
    return null;
  }

  const parts = input.split(/\s+/).filter(Boolean);
  if (parts.length === 2) {
    for (const [p0, p1] of [[parts[0], parts[1]], [parts[1], parts[0]]]) {
      const month = resolveMonth(p0, client, lang);
      const day = parseInt(p1, 10);
      if (month && !isNaN(day) && validDay(month, day)) {
        return { month, day };
      }
    }
  }

  return null;
}

function buildViewEmbed(client, db, userData) {
  const lang = db.language;
  const bday = userData.birthday;
  const tz = userData.timezone || "UTC";
  const nextTs = nextBirthdayTimestamp(bday.month, bday.day, tz);
  const dateStr = `${ordinal(bday.day, client, lang)} ${getMonthName(bday.month - 1, client, lang)}`;

  const embed = new EmbedBuilder()
    .setColor(db.theme)
    .setTitle(client.translate.get(lang, "Commands.birthday.viewTitle"))
    .addFields(
      { name: client.translate.get(lang, "Commands.birthday.date"), value: dateStr, inline: true },
      { name: client.translate.get(lang, "Commands.birthday.timeZone"), value: tz, inline: true }
    );

  if (bday.age != null) {
    embed.addFields({ name: client.translate.get(lang, "Commands.birthday.turning"), value: String(bday.age + 1), inline: true });
  }

  embed.addFields({ name: client.translate.get(lang, "Commands.birthday.countdown"), value: `<t:${nextTs}:R> (<t:${nextTs}:f>)`, inline: false });

  let footerText = bday.ping
    ? client.translate.get(lang, "Commands.birthday.pingTrue")
    : client.translate.get(lang, "Commands.birthday.pingFalse");

  if (tz === "UTC") {
    footerText += client.translate.get(lang, "Commands.birthday.utcHint", { cmdTimezone: `\`${db.prefix}timezone set <IANA timezone>\`` });
  }

  embed.setFooter({ text: footerText });
  return embed;
}

function cmdTag(prefix, syntax) {
  return `\`${prefix}bday ${syntax}\``;
}

function buildHelpEmbed(client, db, prefix, isAdmin) {
  const lang = db.language;
  const t = (key, vars) => client.translate.get(lang, `Commands.birthday.${key}`, vars);
  const line = (syntax, desc) => `${cmdTag(prefix, syntax)} - ${desc}`;

  const lines = [
    t("helpPersonal"),
    line("set <date>", t("helpSet")),
    line("edit <date>", t("helpEdit")),
    line("age <number|remove>", t("helpAge")),
    line("view", t("helpView")),
    line("remove", t("helpRemove")),
    line("preview", t("helpPreview")),
    line("ping", t("helpPing")),
    line("enable", t("helpEnable")),
    line("disable", t("helpDisable")),
    line("servers", t("helpServers")),
    line("settings", t("helpSettings")),
    ``,
    t("helpFormats"),
    t("helpFormatsText"),
    t("helpFormatsNumbers"),
  ];

  if (isAdmin) {
    lines.push(
      ``,
      t("helpServer"),
      line("channel <#channel>", t("helpChannel")),
      line("role <@role>", t("helpRole")),
      line("annping", t("helpAnnPing")),
      line("list", t("helpList")),
      line("force <@user>", t("helpForce")),
      line("blacklist [@user | remove @user | clear]", t("helpBlacklist")),
      line("message [withage <text> | noage <text> | reset]", t("helpMessage"))
    );
  }

  return new EmbedBuilder()
    .setColor(db.theme)
    .setTitle(t("helpTitle"))
    .setDescription(lines.join("\n"));
}

async function getUserData(userId, client) {
  return client.database.getUser(userId, true);
}

module.exports = {
  config: {
    name: "birthday",
    usage: "help",
    cooldown: 3000,
    available: true,
    permissions: {},
    aliases: ["bday", "bd"],
  },

  run: async (client, message, args, db) => {
    const sub = args[0]?.toLowerCase();
    const prefix = db.prefix;

    const err = (text) => message.reply({ embeds: [new EmbedBuilder().setColor("#FF0000").setDescription(text)] });
    const ok = (text) => message.reply({ embeds: [new EmbedBuilder().setColor(db.theme).setDescription(text)] });

    const member = message.guild?.members?.get(message.author.id);
    const isAdmin = member?.permissions.has(PermissionFlags.ManageGuild) || client.config.owners.includes(message.author.id);

    if (!sub || sub === "help") {
      return message.reply({ embeds: [buildHelpEmbed(client, db, prefix, isAdmin)] });
    }

    if (sub === "set" || sub === "edit") {
      const dateInput = args.slice(1).join(" ");
      if (!dateInput) {
        return err(
          client.translate.get(db.language, "Commands.birthday.provideDate", { prefix, sub })
        );
      }

      const parsed = parseDate(dateInput, client, db.language);
      if (!parsed) {
        return err(
          client.translate.get(db.language, "Commands.birthday.invalidDate")
        );
      }

      const userData = await getUserData(message.author.id, client);

      if (sub === "set" && userData.birthday?.day) {
        return err(client.translate.get(db.language, "Commands.birthday.alreadySet", { cmdEdit: cmdTag(prefix, "edit") }));
      }

      await client.database.updateUser(message.author.id, {
        birthday: {
          day: parsed.day,
          month: parsed.month,
          age: userData.birthday?.age ?? null,
          lastBirthday: null,
          ping: userData.birthday?.ping ?? true,
          enabledGuilds: userData.birthday?.enabledGuilds ?? [],
        },
      }, true);

      const tz = userData.timezone || "UTC";
      const nextTs = nextBirthdayTimestamp(parsed.month, parsed.day, tz);
      const dateStr = `${ordinal(parsed.day, client, db.language)} ${getMonthName(parsed.month - 1, client, db.language)}`;
      const ambiguousNote = parsed.ambiguous
        ? client.translate.get(db.language, "Commands.birthday.ambiguous", { date: dateStr, cmdEdit: cmdTag(prefix, "edit") })
        : "";

      let tzNote = "";
      if (tz === "UTC") {
        tzNote = client.translate.get(db.language, "Commands.birthday.tzNote", { cmdTimezone: `\`${prefix}timezone set <IANA timezone>\`` });
      }

      const optedIn = (userData.birthday?.enabledGuilds ?? []).includes(message.guildId);
      const successKey = sub === "edit"
        ? (optedIn ? "Commands.birthday.successEditOptedIn" : "Commands.birthday.successEdit")
        : (optedIn ? "Commands.birthday.successSetOptedIn" : "Commands.birthday.successSet");

      return ok(
        client.translate.get(db.language, successKey, {
          date: dateStr,
          countdown: `<t:${nextTs}:R>`,
          ambiguous: ambiguousNote,
          cmdEnable: cmdTag(prefix, "enable"),
          tzNote,
        })
      );
    }

    if (sub === "age") {
      const userData = await getUserData(message.author.id, client);
      if (!userData.birthday?.day) return err(client.translate.get(db.language, "Commands.birthday.setFirst", { cmdSet: cmdTag(prefix, "set <date>") }));

      const ageArg = args[1]?.toLowerCase();
      if (!ageArg) {
        const current = userData.birthday.age;
        return ok(current != null
          ? client.translate.get(db.language, "Commands.birthday.ageCurrent", { age: current, next: current + 1, cmdAge: cmdTag(prefix, "age <number>"), cmdAgeRemove: cmdTag(prefix, "age remove") })
          : client.translate.get(db.language, "Commands.birthday.ageNone", { cmdAge: cmdTag(prefix, "age <number>") })
        );
      }

      if (ageArg === "remove" || ageArg === "clear" || ageArg === "reset") {
        await client.database.updateUser(message.author.id, {
          birthday: { ...userData.birthday, age: null },
        }, true);
        return ok(client.translate.get(db.language, "Commands.birthday.ageRemoved"));
      }

      const age = parseInt(ageArg, 10);
      if (isNaN(age) || age < 1 || age > 150) {
        return err(client.translate.get(db.language, "Commands.birthday.ageInvalid"));
      }

      await client.database.updateUser(message.author.id, {
        birthday: { ...userData.birthday, age },
      }, true);
      return ok(client.translate.get(db.language, "Commands.birthday.ageSet", { age, next: age + 1 }));
    }

    if (sub === "view") {
      const userData = await getUserData(message.author.id, client);
      if (!userData.birthday?.day) return err(client.translate.get(db.language, "Commands.birthday.notSetYet", { cmdSet: cmdTag(prefix, "set <date>") }));
      return message.reply({ embeds: [buildViewEmbed(client, db, userData)] });
    }

    if (sub === "remove") {
      const userData = await getUserData(message.author.id, client);
      if (!userData.birthday?.day) return err(client.translate.get(db.language, "Commands.birthday.noBirthday"));
      await client.database.updateUser(message.author.id, {
        birthday: { day: null, month: null, age: null, ping: true, enabledGuilds: [] },
      }, true);
      return ok(client.translate.get(db.language, "Commands.birthday.removed"));
    }

    if (sub === "preview") {
      const userData = await getUserData(message.author.id, client);
      if (!userData.birthday?.day) return err(client.translate.get(db.language, "Commands.birthday.setFirst", { cmdSet: cmdTag(prefix, "set <date>") }));
      const member = message.guild?.members?.get(message.author.id)
        ?? { id: message.author.id, user: message.author, guild: message.guild };

      const result = buildBirthdayAnnouncement(client, db, member, userData, message.guild?.name);
      const pingUser = userData.birthday?.ping ?? true;
      const previewNote = `${client.translate.get(db.language, "Commands.birthday.preview")}\n\n${pingUser ? `<@${message.author.id}>` : ""}`;

      return message.reply({ content: previewNote, embeds: [result.embed] });
    }

    if (sub === "ping") {
      const userData = await getUserData(message.author.id, client);
      if (!userData.birthday?.day) return err(client.translate.get(db.language, "Commands.birthday.setFirst", { cmdSet: cmdTag(prefix, "set <date>") }));
      const newPing = !(userData.birthday?.ping ?? true);
      await client.database.updateUser(message.author.id, {
        birthday: { ...userData.birthday, ping: newPing },
      }, true);
      return ok(client.translate.get(db.language, "Commands.birthday.pingToggled", {
        status: newPing ? client.translate.get(db.language, "Commands.birthday.on") : client.translate.get(db.language, "Commands.birthday.off"),
      }));
    }

    if (sub === "enable" || sub === "disable") {
      const userData = await getUserData(message.author.id, client);
      if (!userData.birthday?.day) return err(client.translate.get(db.language, "Commands.birthday.setFirst", { cmdSet: cmdTag(prefix, "set <date>") }));

      const guildId = message.guildId;
      const current = userData.birthday.enabledGuilds ?? [];
      const isEnabled = current.includes(guildId);
      const blacklist = db.birthdayBlacklist ?? [];

      if (sub === "enable") {
        if (blacklist.includes(message.author.id)) {
          return err(client.translate.get(db.language, "Commands.birthday.blacklisted"));
        }
        if (isEnabled) return ok(client.translate.get(db.language, "Commands.birthday.alreadyEnabled"));
      }
      if (sub === "disable" && !isEnabled) return ok(client.translate.get(db.language, "Commands.birthday.alreadyDisabled"));

      const updated = sub === "enable"
        ? [...current, guildId]
        : current.filter(id => id !== guildId);

      await client.database.updateUser(message.author.id, {
        birthday: { ...userData.birthday, enabledGuilds: updated },
      }, true);

      return ok(sub === "enable"
        ? client.translate.get(db.language, "Commands.birthday.enabledSuccess", { guild: message.guild?.name || "" })
        : client.translate.get(db.language, "Commands.birthday.disabledSuccess", { guild: message.guild?.name || "" })
      );
    }

    if (sub === "servers") {
      const userData = await getUserData(message.author.id, client);
      const guilds = userData.birthday?.enabledGuilds ?? [];
      if (guilds.length === 0) return ok(client.translate.get(db.language, "Commands.birthday.noServers"));

      const perPage = 10;
      const pages = [];

      for (let i = 0; i < guilds.length; i += perPage) {
        const chunk = guilds.slice(i, i + perPage);
        const lines = chunk.map((id, idx) => {
          const g = client.guilds?.get(id);
          return `${i + idx + 1}. ${g ? `**${g.name}**` : client.translate.get(db.language, "Commands.birthday.unknownServer", { id })}`;
        });

        pages.push(
          new EmbedBuilder()
            .setColor(db.theme)
            .setTitle(client.translate.get(db.language, "Commands.birthday.serversTitle"))
            .setDescription(lines.join("\n"))
            .setFooter({ text: client.translate.get(db.language, "Commands.birthday.serverCount", { count: guilds.length }) })
        );
      }

      const paginator = new Paginator({
        user: message.author.id,
        client,
        timeout: 60000,
      });

      paginator.add(pages);
      return paginator.start(message.channel);
    }

    if (sub === "settings") {
      const blacklist = db.birthdayBlacklist ?? [];
      const usersWithBirthday = await UserDB.find({
        "birthday.day": { $ne: null },
        "birthday.enabledGuilds": message.guildId,
        userId: { $nin: blacklist },
      }).lean();

      const total = usersWithBirthday.length;
      const currentMonth = new Date().getMonth() + 1;
      const monthCount = usersWithBirthday.filter(u => u.birthday.month === currentMonth).length;

      let nextBirthdayText = client.translate.get(db.language, "Commands.birthday.none");
      if (usersWithBirthday.length > 0) {
        const sorted = usersWithBirthday
          .map(u => ({
            userId: u.userId,
            month: u.birthday.month,
            day: u.birthday.day,
            nextTs: nextBirthdayTimestamp(u.birthday.month, u.birthday.day, u.timezone || "UTC"),
          }))
          .sort((a, b) => a.nextTs - b.nextTs);

        const next = sorted[0];
        nextBirthdayText = client.translate.get(db.language, "Commands.birthday.settingsNext", {
          user: `<@${next.userId}>`,
          date: `${ordinal(next.day, client, db.language)} ${getMonthName(next.month - 1, client, db.language)}`,
          relative: `<t:${next.nextTs}:R>`,
        });
      }

      const channelText = db.birthdayChannel ? `<#${db.birthdayChannel}>` : client.translate.get(db.language, "Commands.birthday.notSet");
      const roleText = db.birthdayRole ? `<@&${db.birthdayRole}>` : client.translate.get(db.language, "Commands.birthday.notSet");
      const pingText = (db.birthdayPing ?? true) ? client.translate.get(db.language, "Commands.birthday.enabled") : client.translate.get(db.language, "Commands.birthday.disabled");

      const embed = new EmbedBuilder()
        .setColor(db.theme)
        .setTitle(client.translate.get(db.language, "Commands.birthday.settingsTitle", { guild: message.guild?.name || client.translate.get(db.language, "Commands.birthday.server") }))
        .addFields(
          { name: client.translate.get(db.language, "Commands.birthday.totalBirthdays"), value: String(total), inline: true },
          { name: client.translate.get(db.language, "Commands.birthday.monthBirthdays", { month: getMonthName(currentMonth - 1, client, db.language) }), value: String(monthCount), inline: true },
          { name: client.translate.get(db.language, "Commands.birthday.announcementPing"), value: pingText, inline: true },
          { name: client.translate.get(db.language, "Commands.birthday.announcementChannel"), value: channelText, inline: true },
          { name: client.translate.get(db.language, "Commands.birthday.birthdayRole"), value: roleText, inline: true },
          { name: "\u200b", value: "\u200b", inline: true },
          { name: client.translate.get(db.language, "Commands.birthday.nextBirthday"), value: nextBirthdayText, inline: false }
        )

      return message.reply({ embeds: [embed] });
    }

    if (sub === "list") {
      const blacklist = db.birthdayBlacklist ?? [];
      const usersWithBirthday = await UserDB.find({
        "birthday.day": { $ne: null },
        "birthday.enabledGuilds": message.guildId,
        userId: { $nin: blacklist },
      }).lean();

      if (usersWithBirthday.length === 0) {
        return ok(client.translate.get(db.language, "Commands.birthday.listNone"));
      }

      const sorted = usersWithBirthday
        .map(u => ({
          userId: u.userId,
          month: u.birthday.month,
          day: u.birthday.day,
          nextTs: nextBirthdayTimestamp(u.birthday.month, u.birthday.day, u.timezone || "UTC"),
        }))
        .sort((a, b) => a.nextTs - b.nextTs);

      const perPage = 10;
      const pages = [];

      for (let i = 0; i < sorted.length; i += perPage) {
        const chunk = sorted.slice(i, i + perPage);
        const lines = chunk.map((u, idx) =>
          `${i + idx + 1}. <@${u.userId}> - **${ordinal(u.day, client, db.language)} ${getMonthName(u.month - 1, client, db.language)}** (<t:${u.nextTs}:R>)`
        );

        pages.push(
          new EmbedBuilder()
            .setColor(db.theme)
            .setTitle(client.translate.get(db.language, "Commands.birthday.listTitle", { guild: message.guild?.name || "" }))
            .setDescription(lines.join("\n"))
            .setFooter({ text: client.translate.get(db.language, "Commands.birthday.listFooter", { count: sorted.length }) })
        );
      }

      const paginator = new Paginator({
        user: message.author.id,
        client,
        timeout: 60000,
      });

      paginator.add(pages);
      return paginator.start(message.channel);
    }

    if (sub === "channel") {
      if (!isAdmin) {
        return err(client.translate.get(db.language, "Commands.birthday.channelPerms"));
      }
      const mention = args[1];
      if (!mention) {
        return ok(client.translate.get(db.language, "Commands.birthday.channelStatus", {
          channel: db.birthdayChannel ? `<#${db.birthdayChannel}>` : client.translate.get(db.language, "Commands.birthday.notSet"),
          cmdChannel: cmdTag(prefix, "channel #channel"),
        }));
      }
      const channelId = mention.replace(/[<#>]/g, "");
      const channel = await client.channels.resolve(channelId).catch(() => null);
      if (!channel || channel.type !== 0) return err(client.translate.get(db.language, "Commands.birthday.invalidChannel"));
      await client.database.updateGuild(message.guildId, { birthdayChannel: channel.id });
      return ok(client.translate.get(db.language, "Commands.birthday.channelSet", { channel: `<#${channel.id}>` }));
    }

    if (sub === "role") {
      if (!isAdmin) {
        return err(client.translate.get(db.language, "Commands.birthday.rolePerms"));
      }

      const mention = args[1];
      if (!mention) {
        return ok(client.translate.get(db.language, "Commands.birthday.roleStatus", {
          role: db.birthdayRole ? `<@&${db.birthdayRole}>` : client.translate.get(db.language, "Commands.birthday.notSet"),
          cmdRole: cmdTag(prefix, "role @role"),
        }));
      }

      const roleIds = await getRoles([mention], message, client, db, true, true, false);
      if (!roleIds || !roleIds.length) return;

      const role = roleIds[0];
      await client.database.updateGuild(message.guildId, { birthdayRole: role.id });
      return ok(client.translate.get(db.language, "Commands.birthday.roleSet", { role: `<@&${role.id}>` }));
    }

    if (sub === "annping") {
      if (!isAdmin) {
        return err(client.translate.get(db.language, "Commands.birthday.annPingPerms"));
      }
      const newPing = !(db.birthdayPing ?? true);
      await client.database.updateGuild(message.guildId, { birthdayPing: newPing });
      return ok(client.translate.get(db.language, "Commands.birthday.annPingSet", {
        status: newPing ? client.translate.get(db.language, "Commands.birthday.on") : client.translate.get(db.language, "Commands.birthday.off"),
      }));
    }

    if (sub === "message" || sub === "msg") {
      if (!isAdmin) {
        return err(client.translate.get(db.language, "Commands.birthday.messagePerms"));
      }

      const lang = db.language;
      const action = args[1]?.toLowerCase();
      const t = (key, vars) => client.translate.get(lang, `Commands.birthday.${key}`, vars);

      const withAgeLabel = t("messageTypeWithAge");
      const noAgeLabel = t("messageTypeNoAge");
      const defaultText = t("messageNull");
      const msgUsageVars = {
        cmdWithAge: cmdTag(prefix, "message withage <text>"),
        cmdNoAge: cmdTag(prefix, "message noage <text>"),
        cmdReset: cmdTag(prefix, "message reset [withage|noage]"),
      };

      const renderValue = (value) =>
        value && value.trim()
          ? `> ${value.trim().replace(/\n/g, "\n> ")}`
          : defaultText;

      if (!action || action === "view") {
        return message.reply({
          embeds: [
            new EmbedBuilder()
              .setColor(db.theme)
              .setTitle(t("messageTitle"))
              .addFields(
                { name: withAgeLabel, value: renderValue(db.birthdayMessageWithAge), inline: false },
                { name: noAgeLabel, value: renderValue(db.birthdayMessageNoAge), inline: false }
              )
              .setDescription(t("messagePlaceholders") + "\n\n" + t("messageUsage", msgUsageVars)),
          ],
        });
      }

      if (action === "reset") {
        const target = args[2]?.toLowerCase();
        if (!target) {
          await client.database.updateGuild(message.guildId, {
            birthdayMessageWithAge: null,
            birthdayMessageNoAge: null,
          });
          return ok(t("messageReset"));
        }
        if (target === "withage") {
          await client.database.updateGuild(message.guildId, { birthdayMessageWithAge: null });
          return ok(t("messageResetWithAge"));
        }
        if (target === "noage") {
          await client.database.updateGuild(message.guildId, { birthdayMessageNoAge: null });
          return ok(t("messageResetNoAge"));
        }
        return err(t("messageUsage", msgUsageVars));
      }

      if (action === "withage" || action === "noage") {
        const text = args.slice(2).join(" ").trim();
        if (!text) return err(t("messageNoText") + "\n\n" + t("messageUsage", msgUsageVars));
        if (text.length > 1000) return err(t("messageTooLong"));

        const field = action === "withage" ? "birthdayMessageWithAge" : "birthdayMessageNoAge";
        await client.database.updateGuild(message.guildId, { [field]: text });
        return ok(t("messageSet", {
          type: action === "withage" ? withAgeLabel : noAgeLabel,
          text: `\n> ${text.replace(/\n/g, "\n> ")}`,
        }));
      }

      return err(t("messageUsage", msgUsageVars));
    }

    if (sub === "blacklist") {
      if (!isAdmin) {
        return err(client.translate.get(db.language, "Commands.birthday.blacklistPerms"));
      }

      const action = args[1]?.toLowerCase();
      const blacklist = db.birthdayBlacklist ?? [];

      if (!action) {
        if (blacklist.length === 0) {
          return ok(client.translate.get(db.language, "Commands.birthday.blacklistListEmpty"));
        }

        const perPage = 10;
        const pages = [];

        for (let i = 0; i < blacklist.length; i += perPage) {
          const chunk = blacklist.slice(i, i + perPage);
          const lines = chunk.map((id, idx) => {
            const m = message.guild?.members?.get(id);
            return `${i + idx + 1}. ${m ? `**${m.user?.username ?? id}**` : `<@${id}>`}`;
          });

          pages.push(
            new EmbedBuilder()
              .setColor(db.theme)
              .setTitle(client.translate.get(db.language, "Commands.birthday.blacklistListTitle", { guild: message.guild?.name || "" }))
              .setDescription(lines.join("\n"))
              .setFooter({ text: client.translate.get(db.language, "Commands.birthday.blacklistListFooter", { count: blacklist.length }) })
          );
        }

        const paginator = new Paginator({
          user: message.author.id,
          client,
          timeout: 60000,
        });

        paginator.add(pages);
        return paginator.start(message.channel);
      }

      if (action === "clear") {
        if (blacklist.length === 0) {
          return ok(client.translate.get(db.language, "Commands.birthday.blacklistClearEmpty"));
        }
        await client.database.updateGuild(message.guildId, { birthdayBlacklist: [] });
        return ok(client.translate.get(db.language, "Commands.birthday.blacklistCleared", { count: blacklist.length }));
      }

      if (action === "remove") {
        const targetArg = args[2];
        if (!targetArg) {
          return err(client.translate.get(db.language, "Commands.birthday.blacklistRemoveUsage", { cmdBlacklistRemove: cmdTag(prefix, "blacklist remove @user") }));
        }
        const targetId = targetArg.replace(/[<@!>]/g, "");
        if (!blacklist.includes(targetId)) {
          return err(client.translate.get(db.language, "Commands.birthday.blacklistNotFound", { user: `<@${targetId}>` }));
        }
        const updatedBlacklist = blacklist.filter(id => id !== targetId);
        await client.database.updateGuild(message.guildId, { birthdayBlacklist: updatedBlacklist });
        return ok(client.translate.get(db.language, "Commands.birthday.blacklistRemoved", { user: `<@${targetId}>`, cmdEnable: cmdTag(prefix, "enable") }));
      }

      const mentionArg = args[1];
      const targetId = mentionArg.replace(/[<@!>]/g, "");
      const targetMember = message.guild?.members?.get(targetId)
        ?? await message.guild?.fetchMember?.(targetId).catch(() => null);
      if (!targetMember) return err(client.translate.get(db.language, "Commands.birthday.userNotFound"));

      if (blacklist.includes(targetId)) {
        return ok(client.translate.get(db.language, "Commands.birthday.blacklistAlready", { user: `<@${targetId}>` }));
      }

      const updatedBlacklist = [...blacklist, targetId];
      await client.database.updateGuild(message.guildId, { birthdayBlacklist: updatedBlacklist });

      const targetUserData = await getUserData(targetId, client);
      if (targetUserData.birthday?.enabledGuilds?.includes(message.guildId)) {
        const updatedGuilds = (targetUserData.birthday.enabledGuilds ?? []).filter(id => id !== message.guildId);
        await client.database.updateUser(targetId, {
          birthday: { ...targetUserData.birthday, enabledGuilds: updatedGuilds },
        }, true);
      }

      return ok(client.translate.get(db.language, "Commands.birthday.blacklistSuccess", { user: `<@${targetId}>` }));
    }

    if (sub === "force") {
      if (!isAdmin) {
        return err(client.translate.get(db.language, "Commands.birthday.forcePerms"));
      }
      const mentionArg = args[1];
      if (!mentionArg) return err(client.translate.get(db.language, "Commands.birthday.forceUsage", { prefix, sub }));

      const targetId = mentionArg.replace(/[<@!>]/g, "");
      const targetMember = message.guild?.members?.get(targetId)
        ?? await message.guild?.fetchMember?.(targetId).catch(() => null);
      if (!targetMember) return err(client.translate.get(db.language, "Commands.birthday.userNotFound"));

      const targetUserData = await getUserData(targetId, client);
      if (!targetUserData.birthday?.day) return err(client.translate.get(db.language, "Commands.birthday.userNoBirthday"));

      const channelId = db.birthdayChannel;
      const announceChannel = channelId
        ? await client.channels.resolve(channelId).catch(() => null)
        : message.channel;
      if (!announceChannel) return err(client.translate.get(db.language, "Commands.birthday.noChannel", { cmdChannel: cmdTag(prefix, "channel #channel") }));

      const result = buildBirthdayAnnouncement(client, db, targetMember, targetUserData, message.guild?.name);
      const pingUser = (db.birthdayPing ?? true) && (targetUserData.birthday.ping ?? true);

      if (db.birthdayRole) {
        await targetMember.addRole?.(db.birthdayRole).catch(() => {});
      }

      await announceChannel.send({ content: pingUser ? `<@${targetId}>` : undefined, embeds: [result.embed] });

      client.database.updateUser(targetId, {
        birthday: { ...targetUserData.birthday, lastBirthday: new Date().getFullYear() },
      }, true).catch(() => {});

      if (announceChannel.id !== message.channel.id) {
        return ok(client.translate.get(db.language, "Commands.birthday.announced", { channel: `<#${announceChannel.id}>` }));
      }
      return;
    }

    return message.reply({ embeds: [buildHelpEmbed(client, db, prefix, isAdmin)] });
  },
};