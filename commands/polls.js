const { EmbedBuilder, PermissionFlags } = require("@fluxerjs/core");
const Polls = require(`../functions/poll`)
const { titleFitsImage, optionFitsImage } = Polls;
const dhms = require(`../functions/dhms`);
const PollDB = require("../models/polls");
const { handleNew, handleDelete } = require("../functions/checkPolls");
const Paginator = require(`../functions/pagination`);
const createThread = require(`../functions/createThread`);
const { trackResource } = require('../api/trackSettings');
const { dashboardHelpText } = require('../functions/dashboardHelp');

async function endPollEarly(client, poll, db) {
  try {
    const channel = await client.channels.resolve(poll.channelId);
    if (!channel) return;

    const msg = await channel.messages?.fetch(poll.messageId).catch(() => null);
    if (!msg) return;

    await PollDB.findOneAndUpdate({ messageId: poll.messageId }, { ended: true });
    await client.polls.get(poll.messageId).poll.update();

    let tooMuch = [];
    if (!titleFitsImage(poll.desc, client.polls.get(poll.messageId)?.poll))
      tooMuch.push(`**Title**: ${poll.desc}`);
    poll.options?.name?.forEach((e, i) => {
        if (!e) return;
        if (!optionFitsImage(e, client.polls.get(poll.messageId)?.poll, i)) {
          tooMuch.push(`**${i + 1}.** ${e}`);
        }
      });

    const pollImage = await fetch(`${process.env.CDN}/api/upload`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        apikey: process.env.CDN_KEY,
        image: client.polls.get(poll.messageId).poll.canvas.toDataURL("image/png"),
        timeframe: 60,
        messageId: poll.messageId,
        last: true,
      }),
    }).then((i) => i.json());

    await msg.edit({
      embeds: [
        new EmbedBuilder()
          .setDescription(
            `${client.translate.get(poll.lang, "Functions.poll.end")}${tooMuch.length > 0 ? `\n\n${tooMuch.map((e) => e).join("\n")}` : ""}`,
          )
          .setImage(`${process.env.CDN}${pollImage.url}`)
          .setColor(client.polls.get(poll.messageId)?.poll?.palette?.accent ?? db.theme),
      ],
    });

    await msg.removeAllReactions().catch(() => { });
    client.polls.delete(poll.messageId);
  } catch(e) { }
}

async function hasPollSettingsPermission(client, message, db) {
  let member = message.guild?.members?.get?.(message.author.id);
  if (!member && message.guild?.fetchMember) {
    member = await message.guild.fetchMember(message.author.id).catch(() => null);
  }

  const bypasses = [];
  for (const entry of db.bypassRoles ?? []) {
    if (!entry?.role || !member?.roles?.has?.(entry.role)) continue;
    bypasses.push(...(entry.commands ?? []));
  }

  return Boolean(
    member?.permissions?.has?.(PermissionFlags.ManageGuild) ||
    client.config.owners?.includes?.(message.author.id) ||
    bypasses.includes("all") ||
    bypasses.includes("polls")
  );
}

function pollSettingsPermissionError(client, db) {
  return new EmbedBuilder()
    .setColor("#FF0000")
    .setDescription(
      `${client.translate.get(db.language, "Events.messageCreate.perms")}.\n` +
      `${client.translate.get(db.language, "Events.messageCreate.perms2")}: [Manage Guild]\n\n` +
      `${client.translate.get(db.language, "Events.messageCreate.perms3")}`
    );
}

module.exports = {
    config: {
        name: `polls`,
        usage: true,
        cooldown: 7000,
        available: true,
        permissions: [],
        aliases: ["poll"]
    },
    run: async (client, message, args, db) => {
      const subcommand = args[0]?.toLowerCase();
      const tr = (key, vars) => client.translate.get(db.language, `Commands.polls.${key}`, vars);
      const themeChoices = Object.values(Polls.THEMES).map((theme) => theme.name).join(", ");
      const layoutChoices = Object.values(Polls.LAYOUTS).map((layout) => layout.name).join(", ");

      if (subcommand === "help") {
        const helpText = [
          `**${tr("usageTitle")}**`,
          `\`${db.prefix}poll <time> | <question> | <option> | <option>\``,
          ``,
          `**${tr("threadUsageTitle")}**`,
          `\`${db.prefix}poll thread <time> | <question> | <option> | <option>\``,
          tr("threadUsageDesc"),
          ``,
          `**${tr("manageTitle")}**`,
          tr("viewUsage", { prefix: db.prefix }),
          tr("deleteUsage", { prefix: db.prefix }),
          tr("toggleUsage", { prefix: db.prefix }),
          tr("toggleUsageDesc"),
          tr("themeUsage", { prefix: db.prefix }),
          tr("themeChoices", { themes: themeChoices }),
          tr("layoutUsage", { prefix: db.prefix }),
          tr("layoutChoices", { layouts: layoutChoices }),
          tr("appearanceDashboard"),
          "",
          dashboardHelpText(client, db, message.guildId, "polls"),
        ].join("\n");

        return message.reply({ embeds: [new EmbedBuilder().setTitle(tr("polls")).setDescription(helpText).setColor(db.theme)] });
      }

      const threadMode = subcommand === "thread";
      const pollArgs = threadMode ? args.slice(1) : args;

      if (subcommand === "view") {
        const polls = await PollDB.find({ owner: message.author.id, ended: false });
        if (polls.length === 0) {
          return message.reply({
            embeds: [new EmbedBuilder()
              .setDescription(client.translate.get(db.language, "Commands.polls.noUserPolls"))
              .setColor(`#FF0000`)]
          });
        }

        const chunkSize = 3;
        const chunks = [];
        for (let i = 0; i < polls.length; i += chunkSize) {
          chunks.push(polls.slice(i, i + chunkSize));
        }

        const embeds = chunks.map((chunk, pageIndex) => {
          const embed = new EmbedBuilder()
            .setTitle(client.translate.get(db.language, "Commands.polls.polls"))
            .setColor(db.theme);

          chunk.forEach((poll, index) => {
            embed.addFields({
              name: `#${pageIndex * chunkSize + index + 1}: ${poll.desc.slice(0, 75)}`,
              value: `${client.translate.get(db.language, "Commands.polls.message")}: [msg](https://fluxer.com/channels/${poll.serverId}/${poll.channelId}/${poll.messageId})`,
              inline: false
            });
          });

          return embed;
        });

        if (embeds.length === 1) {
          return message.reply({ embeds });
        }

        const paginator = new Paginator({
          user: message.author.id,
          client: client,
          timeout: 60000
        });

        embeds.forEach(embed => paginator.add(embed));
        return paginator.start(message.channel);
      }

      if (subcommand === "toggle") {
        if (!(await hasPollSettingsPermission(client, message, db))) {
          return message.reply({ embeds: [pollSettingsPermissionError(client, db)] });
        }

        const toggle = db.pollPerm;
        await client.database.updateGuild(message.guildId, { pollPerm: !toggle });
        return message.reply({ embeds: [new EmbedBuilder().setDescription(`${client.translate.get(db.language, "Commands.polls.pollPerm")} **${toggle ? client.translate.get(db.language, "Commands.roles.off") : client.translate.get(db.language, "Commands.roles.on")}**`).setColor(db.theme)] });
      }

      if (subcommand === "theme" || subcommand === "layout") {
        if (!(await hasPollSettingsPermission(client, message, db))) {
          return message.reply({ embeds: [pollSettingsPermissionError(client, db)] });
        }

        const isTheme = subcommand === "theme";
        const choices = isTheme ? themeChoices : layoutChoices;
        const value = args[1];

        if (!value) {
          const current = isTheme ? Polls.resolveTheme(db.pollTheme) : Polls.resolveLayout(db.pollLayout);
          return message.reply({
            embeds: [
              new EmbedBuilder()
                .setDescription(tr(isTheme ? "themeCurrent" : "layoutCurrent", {
                  name: current.name,
                  choices,
                }))
                .setColor(db.theme),
            ],
          });
        }

        const resolved = isTheme ? Polls.findTheme(value) : Polls.findLayout(value);
        if (!resolved) {
          return message.reply({
            embeds: [
              new EmbedBuilder()
                .setDescription(tr(isTheme ? "invalidTheme" : "invalidLayout", { value, choices }))
                .setColor("#FF0000"),
            ],
          });
        }

        await client.database.updateGuild(
          message.guildId,
          isTheme ? { pollTheme: resolved.key } : { pollLayout: resolved.key }
        );

        return message.reply({
          embeds: [
            new EmbedBuilder()
              .setDescription(tr(isTheme ? "themeSet" : "layoutSet", { name: resolved.name }))
              .setColor(db.theme),
          ],
        });
      }

      if (subcommand === "delete") {
        const pollNumber = parseInt(args[1]);
        if (!pollNumber || isNaN(pollNumber)) {
          return message.reply({
            embeds: [new EmbedBuilder()
              .setDescription(`${client.translate.get(db.language, "Commands.polls.validNumber")}: f!poll delete 1`)
              .setColor(`#FF0000`)]
          });
        }

        const poll = await PollDB.findOne({ owner: message.author.id, ended: false });
        if (!poll) {
          return message.reply({
            embeds: [new EmbedBuilder()
              .setDescription(client.translate.get(db.language, "Commands.polls.pollNotFound", { pollNumber }))
              .setColor(`#FF0000`)]
          });
        }

        handleDelete(poll.messageId);
        await endPollEarly(client, poll, db);
        return message.reply({
          embeds: [new EmbedBuilder()
            .setDescription(client.translate.get(db.language, "Commands.polls.deleted", { pollNumber }))
            .setColor(db.theme)]
        });
      }

      if (db.pollPerm) {
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
        else if (bypasses.includes("polls")) bypass = true;
      
        if (!member?.permissions.has(PermissionFlags.ManageGuild) && !client.config.owners.includes(message.author.id) && !bypass) return message.reply({
          embeds: [
            new EmbedBuilder()
              .setColor("#FF0000")
              .setDescription(`${client.translate.get(db.language, "Events.messageCreate.perms")}.\n${client.translate.get(db.language, "Events.messageCreate.perms2", { permission: "Manage Guild" })}\n\n${client.translate.get(db.language, "Events.messageCreate.perms3")}`)]
        });
      }

      const check = await PollDB.find({ owner: message.author.id, ended: false })
      if (check.length === 5) return message.reply({ embeds: [new EmbedBuilder().setDescription(client.translate.get(db.language, "Commands.polls.tooMany")).setColor(`#FF0000`)] });
      const pollText = pollArgs.join(` `);
      if (/(?:^|\s)--(?:theme|layout)(?=\s|$|=)/i.test(pollText)) {
        return message.reply({ embeds: [new EmbedBuilder().setDescription(tr("appearanceDashboard")).setColor(`#FF0000`)] });
      }
      const options = pollText.split(`|`).map(x => x.trim()).filter(x => x);
      const pollTheme = Polls.resolveTheme(db.pollTheme);
      const pollLayout = Polls.resolveLayout(db.pollLayout);
      if (!options[0]) return message.reply({ embeds: [new EmbedBuilder().setDescription(`${client.translate.get(db.language, "Commands.polls.validTime")}: \`${db.prefix}polls 5m | ${client.translate.get(db.language, "Commands.polls.example")}\``).setColor(`#FF0000`)] });
      const time = dhms(options[0]);
      if (!time) return message.reply({ embeds: [new EmbedBuilder().setDescription(`${client.translate.get(db.language, "Commands.polls.validTime")}: \`${db.prefix}polls 5m | ${client.translate.get(db.language, "Commands.polls.example")}\``).setColor(`#FF0000`)] });
      if (time === 0) return message.reply({ embeds: [new EmbedBuilder().setDescription(`${client.translate.get(db.language, "Commands.polls.validTime")}: \`${db.prefix}polls 5m | ${client.translate.get(db.language, "Commands.polls.example")}\``).setColor(`#FF0000`)] });
      if (time < 30000) return message.reply({ embeds: [new EmbedBuilder().setDescription(`${client.translate.get(db.language, "Commands.polls.longerThan")} \`${db.prefix}polls 5m | ${client.translate.get(db.language, "Commands.polls.example")}\``).setColor(`#FF0000`)] });
      if (time > 2592000000) return message.reply({ embeds: [new EmbedBuilder().setDescription(`${client.translate.get(db.language, "Commands.polls.shorterThan")}: \`${db.prefix}polls 5m | ${client.translate.get(db.language, "Commands.polls.example")}\``).setColor(`#FF0000`)] });
      if (!options[1]) return message.reply({ embeds: [new EmbedBuilder().setDescription(`${client.translate.get(db.language, "Commands.polls.validQuestion")}: \`${db.prefix}polls 5m | ${client.translate.get(db.language, "Commands.polls.example")}\``).setColor(`#FF0000`)] });
      if (!options[2]) return message.reply({ embeds: [new EmbedBuilder().setDescription(`${client.translate.get(db.language, "Commands.polls.validOption")}: \`${db.prefix}polls 5m | ${client.translate.get(db.language, "Commands.polls.example")}\``).setColor(`#FF0000`)] });
      if (!options[3]) return message.reply({ embeds: [new EmbedBuilder().setDescription(`${client.translate.get(db.language, "Commands.polls.validOption2")}: \`${db.prefix}polls 5m | ${client.translate.get(db.language, "Commands.polls.example")}\``).setColor(`#FF0000`)] });
      if (options.length >= 13) return message.reply({ embeds: [new EmbedBuilder().setDescription(`${client.translate.get(db.language, "Commands.polls.maxOptions")}: \`${db.prefix}polls 5m | ${client.translate.get(db.language, "Commands.polls.example")}\``).setColor(`#FF0000`)] });

      const names = [options[2], options[3], options[4] ? options[4] : null, options[5] ? options[5] : null, options[6] ? options[6] : null, options[7] ? options[7] : null, options[8] ? options[8] : null, options[9] ? options[9] : null, options[10] ? options[10] : null, options[11] ? options[11] : null];
      const reactions = [client.config.emojis.one, client.config.emojis.two, options[4] ? client.config.emojis.three : null, options[5] ? client.config.emojis.four : null, options[6] ? client.config.emojis.five : null, options[7] ? client.config.emojis.six : null, options[8] ? client.config.emojis.seven : null, options[9] ? client.config.emojis.eight : null, options[10] ? client.config.emojis.nine : null, options[11] ? client.config.emojis.ten : null, client.config.emojis.stop];

      const highestPoll = await PollDB.findOne({ owner: message.author.id }).sort({ pollNumber: -1 });
      const nextPollNumber = highestPoll?.pollNumber ? highestPoll.pollNumber + 1 : 1;

      const poll = new Polls({
        time,
        client,
        name: {
          name: client.translate.get(db.language, "Commands.polls.polls"),
          description: options[1]
        },
        options: {
          name: names.filter(a => a)
        },
        owner: message.author.id,
        lang: db.language,
        theme: pollTheme.key,
        layout: pollLayout.key,
      })
      await poll.update();

      let tooMuch = [];
      if (!titleFitsImage(options[1], poll)) tooMuch.push(`**${client.translate.get(db.language, "Commands.polls.title")}**: ${options[1]}`)
      names.forEach((e, i) => {
        if (!e) return
        if (!optionFitsImage(e, poll, i)) {
          tooMuch.push(`**${i + 1}.** ${e}`)
        }
      });
      
      await message.channel.send({
        embeds: [new EmbedBuilder().setDescription(`${client.translate.get(db.language, "Commands.polls.loading")}...`).setColor(pollTheme.accent)],
      }).then(async (msg) => {
        for (const reaction of reactions) {
          await msg.react(reaction).catch(() => {});
        }

        msg.guildId = message.guildId
        const pollData = await poll.start(msg, poll, { tooMuch, pollNumber: nextPollNumber });
        if (pollData) handleNew(pollData);

        if (threadMode) {
          await createThread(msg, {
            name: options[1],
            description: options[1],
            fallbackName: tr("threadName"),
          }).catch(() => {});
        }

        await trackResource(client, {
          userId: message.author.id,
          groupId: message.guildId,
          category: 'polls',
          key: 'poll',
          action: 'create',
          label: 'Poll',
          value: {
            messageId: msg.id,
            channelId: message.channel.id,
            question: pollData.desc,
            options: names,
            durationMs: time,
          },
          previous: null,
        });
        
        await message.delete().catch(() => { });
        });
    },
};
