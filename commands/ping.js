const { EmbedBuilder } = require("@fluxerjs/core");
const Pings = require("../functions/pings");

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
    const { gatewayPing, dbPing } = await Pings(client);    
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

    await client.vanta.measure({
      name: "ping.round-trip",
      value: Date.now() - start,
      unit: "ms",
      tags: { type: "roundtrip" }
    });
    
  },
};
