const { EmbedBuilder } = require("@fluxerjs/core");
const SavedPolls = require("../models/savedPolls");
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
      await SavedPolls.find();
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

    const start = Date.now();
    message.reply({ embeds: [
      new EmbedBuilder()
        .setColor("#A52F05")
        .setTitle("Flux Pong")
        .addFields(
          {
            name: "**Gateway**",
            value: `\`${!isNaN(await botPing()) ? `${await botPing()}ms` : "502 bad Gateway"}\``,
            inline: true,
          },
          {
            name: "**Database**",
            value: `\`${await Database()}ms\``,
            inline: true,
          },
          {
            name: "**Round-trip**",
            value: `\`...\``,
            inline: true,
          },
        ),
    ], }).then(async (msg) => {
      await msg.edit({
        embeds: [
          new EmbedBuilder()
            .setColor("#A52F05")
            .setTitle("Flux Pong")
            .addFields(
              {
                name: "**Gateway**",
                value: `\`${!isNaN(await botPing()) ? `${await botPing()}ms` : "502 bad Gateway"}\``,
                inline: true,
              },
              {
                name: "**Database**",
                value: `\`${await Database()}ms\``,
                inline: true,
              },
              {
                name: "**Round-trip**",
                value: `\`${Date.now() - start}ms\``,
                inline: true,
              },
            ),
        ],
      });
    });
  },
};
