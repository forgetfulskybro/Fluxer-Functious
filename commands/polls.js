const { EmbedBuilder, MessageFlags } = require("@erinjs/core");
const Polls = require(`../functions/poll`)
const dhms = require(`../functions/dhms`);
const PollDB = require("../models/polls");
const Paginator = require(`../functions/pagination`);

async function endPollEarly(client, poll, db) {
  try {
    const channel = await client.channels.resolve(poll.channelId);
    if (!channel) return;

    const msg = await channel.messages?.fetch(poll.messageId).catch(() => null);
    if (!msg) return;

    await PollDB.findOneAndUpdate({ messageId: poll.messageId }, { ended: true });
    await client.polls.get(poll.messageId).poll.update();

    let tooMuch = [];
    if (poll.desc?.length > 80)
      tooMuch.push(`**Title**: ${poll.desc}`);
    poll.options?.name?.filter((e) => e).forEach((e, i) => {
        i++;
        if (e.length > 70) {
          tooMuch.push(`**${i}.** ${e}`);
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
          .setColor(`#A52F05`),
      ],
    });

    await msg.removeAllReactions().catch(() => { });
    client.polls.delete(poll.messageId);
  } catch(e) {console.log(e)}
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
            .setColor(`#A52F05`);

          chunk.forEach((poll, index) => {
            embed.addFields({
              name: `#${pageIndex * chunkSize + index + 1}: ${poll.desc.slice(0, 75)}`,
              value: `${client.translate.get(db.language, "Commands.polls.message")}: [msg](https://fluxer.app/channels/${poll.serverId}/${poll.channelId}/${poll.messageId})`,
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

        await endPollEarly(client, poll, db);
        return message.reply({
          embeds: [new EmbedBuilder()
            .setDescription(client.translate.get(db.language, "Commands.polls.deleted", { pollNumber }))
            .setColor(`#A52F05`)]
        });
      }

      const check = await PollDB.find({ owner: message.author.id, ended: false })
      if (check.length === 5) return message.reply({ embeds: [new EmbedBuilder().setDescription(client.translate.get(db.language, "Commands.polls.tooMany")).setColor(`#FF0000`)] });
      const options = args.join(` `).split(`|`).map(x => x.trim()).filter(x => x);
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
        owner: message.author.id, lang: db.language
      })
      await poll.update();

      let tooMuch = [];
      if (options[1].length > 75) tooMuch.push(`**${client.translate.get(db.language, "Commands.polls.title")}**: ${options[1]}`)
      names.filter(e => e).forEach((e, i) => {
        i++
        if (e.length > 70) {
          tooMuch.push(`**${i}.** ${e}`)
        }
      });
      
      await message.channel.send({
        embeds: [new EmbedBuilder().setDescription(`${client.translate.get(db.language, "Commands.polls.loading")}...`).setColor(`#A52F05`)],
      }).then(async (msg) => {
        for (const reaction of reactions) {
          await msg.react(reaction).catch(() => {});
        }

        msg.guildId = message.guildId
        await poll.start(msg, poll, { tooMuch, pollNumber: nextPollNumber });
        await message.delete().catch(() => { });
        });
    },
};
