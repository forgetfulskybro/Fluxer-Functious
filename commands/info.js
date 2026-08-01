const { EmbedBuilder } = require("@fluxerjs/core");
const Giveaway = require("../models/giveaways");
const Polls = require("../models/polls");
const { dependencies } = require("../package.json");

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
    const memory = () => {
      const used = process.memoryUsage().heapUsed;
      return Number((used / 1048576).toFixed(2));
    };

    const unixstamp = client.functions.get("fetchTime")(
      Math.floor(process.uptime() * 1000),
      client,
      db.language,
      true
    );

    const dbPing = await (async () => {
      const before = Date.now();
      const pollCount = await Polls.countDocuments();
      return { ping: Date.now() - before, pollCount };
    })();

    const gatewayPing = await (async () => {
      try {
        const start = Date.now();
        await client.rest.get("/gateway/bot");
        return Date.now() - start;
      } catch {
        return "502";
      }
    })();

    const giveawayCount = await Giveaway.countDocuments();

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
            `> **${client.translate.get(db.language, "Commands.info.polls")}**: \`${dbPing.pollCount.toLocaleString()}\``,
            `> **${client.translate.get(db.language, "Commands.info.library")}**: [Fluxer.js](https://fluxer.js.org) \`${dependencies["@fluxerjs/core"]}\``,
          ].join("\n"),
          inline: true
        },
        {
          name: `⚙️ **${client.translate.get(db.language, "Commands.info.system")}**`,
          value: [
            `> **${client.translate.get(db.language, "Commands.info.uptime")}**: \`${unixstamp}\``,
            `> **${client.translate.get(db.language, "Commands.info.ping")}**: \`${gatewayPing}ms\``,
            `> **${client.translate.get(db.language, "Commands.info.memory")}**: \`${memory()} MB\``,
            `> **${client.translate.get(db.language, "Commands.info.database")}**: \`${dbPing.ping}ms\``,
          ].join("\n"),
          inline: true
        }
      )
      .addFields({
        name: `🔗 **${client.translate.get(db.language, "Commands.info.links")}**`,
        value: [
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