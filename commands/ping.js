const { EmbedBuilder } = require("@fluxerjs/core");
const Polls = require("../models/polls");
module.exports = {
  config: {
    name: "ping",
    usage: false,
    cooldown: 4500,
    available: true,
    permissions: {},
    aliases: ["p"],
  },
  run: async (client, message, args, db) => {
    async function Database() {
      let beforeCall = Date.now();
      await Polls.countDocuments();
      return Date.now() - beforeCall;
    }

    async function botPing() {
      try {
        const start = Date.now();
        await client.rest.get("/gateway/bot");
        return Date.now() - start;
      } catch {
        return "502 bad Gateway";
      }
    }

    const [gatewayPing, dbPing] = await Promise.all([botPing(), Database()]);
    const gatewayStr = !isNaN(gatewayPing) ? `${gatewayPing}ms` : "502 bad Gateway";

    const start = Date.now();
    const reply = await message.reply({ embeds: [
      new EmbedBuilder()
        .setColor("#A52F05")
        .setTitle("Flux Pong")
        .addFields(
          { name: "**Gateway**", value: `\`${gatewayStr}\``, inline: true },
          { name: "**Database**", value: `\`${dbPing}ms\``, inline: true },
          { name: "**Round-trip**", value: "`...`", inline: true },
        ),
    ]});

    await reply.edit({
      embeds: [
        new EmbedBuilder()
          .setColor("#A52F05")
          .setTitle("Flux Pong")
          .addFields(
            { name: "**Gateway**", value: `\`${gatewayStr}\``, inline: true },
            { name: "**Database**", value: `\`${dbPing}ms\``, inline: true },
            { name: "**Round-trip**", value: `\`${Date.now() - start}ms\``, inline: true },
          ),
      ],
    });
  },
};
