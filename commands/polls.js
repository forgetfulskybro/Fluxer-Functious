const { EmbedBuilder, MessageFlags } = require("@fluxerjs/core");
const Polls = require(`../functions/poll`)
const dhms = require(`../functions/dhms`);
const PollDB = require("../models/polls");
const SavedPolls = require(`../models/savedPolls`)

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
      const check = await PollDB.find({ owner: message.author.id })
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
          poll.start(msg, poll, { tooMuch });
        });

      await (new SavedPolls({
        owner: message.author.id,
        desc: options[1],
        options: { name: names }
      }).save());
    },
};
