const { EmbedBuilder } = require("@fluxerjs/core");
const Giveaway = require("../models/giveaways");
const Polls = require("../models/polls");
const { dependencies } = require("../package.json");
const Pings = require("../functions/pings");

module.exports = {
  config: {
    name: "info",
    usage: false,
    cooldown: 15000,
    available: true,
    permissions: {},
    aliases: ["stats", "botinfo", "bi"],
  },
  run: async (client, message, args, db) => {
    const { gatewayPing, dbPing, pollCount, memory } = await Pings(client);
    const giveawayCount = await Giveaway.countDocuments();

    const unixstamp = client.functions.get("fetchTime")(
      Math.floor(process.uptime() * 1000),
      client,
      db.language,
      true
    );

    const embed = new EmbedBuilder()
      .setAuthor({
        name: `${client.user.username} • ${client.translate.get(db.language, "Commands.info.start")}`,
        iconURL: client.user.displayAvatarURL({ dynamic: true, size: 256 })
      })
      .setColor("#A52F05")
      .addFields(
        {
          name: `📊 **${client.translate.get(db.language, "Commands.info.stats")}**`,
          value: [
            `> **${client.translate.get(db.language, "Commands.info.servers")}**: \`${client.guilds.size.toLocaleString()}\``,
            `> **${client.translate.get(db.language, "Commands.info.giveaways")}**: \`${giveawayCount.toLocaleString()}\``,
            `> **${client.translate.get(db.language, "Commands.info.polls")}**: \`${pollCount.toLocaleString()}\``,
            `> **${client.translate.get(db.language, "Commands.info.library")}**: [Fluxer.js](https://fluxer.js.org) \`${dependencies["@fluxerjs/core"]}\``,
          ].join("\n"),
          inline: true
        },
        {
          name: `⚙️ **${client.translate.get(db.language, "Commands.info.system")}**`,
          value: [
            `> **${client.translate.get(db.language, "Commands.info.uptime")}**: \`${unixstamp}\``,
            `> **${client.translate.get(db.language, "Commands.info.ping")}**: \`${gatewayPing}ms\``,
            `> **${client.translate.get(db.language, "Commands.info.memory")}**: \`${memory} MB\``,
            `> **${client.translate.get(db.language, "Commands.info.database")}**: \`${dbPing}ms\``,
          ].join("\n"),
          inline: true
        }
      )
      .addFields({
        name: `🔗 **${client.translate.get(db.language, "Commands.info.links")}**`,
        value: [
          `[${client.translate.get(db.language, "Commands.info.links4")}](https://functious.vercel.app)`,
          `[${client.translate.get(db.language, "Commands.info.links2")}](https://web.fluxer.app/oauth2/authorize?client_id=1475548817821799084&scope=bot&permissions=13510799704222800)`,
          `[${client.translate.get(db.language, "Commands.info.links3")}](https://fluxer.gg/YnINU09E)`,
          `[GitHub](https://github.com/forgetfulskybro/Fluxer-Functious)`,
          `[Crowdin](https://crowdin.com/project/functious)`,
          `[Ko-Fi](https://ko-fi.com/forgetfulskybro)`
        ].join(" • "),
        inline: false
      })
      .setTimestamp();

    message.reply({ embeds: [embed], mentions: false });
  },
};