const Giveaways = require("../models/giveaways");
const { EmbedBuilder } = require('@fluxerjs/core');
async function giveawaysEnd(client) {
  setInterval(async () => {
    let giveaways = await Giveaways.find({ ended: false });
    if (giveaways.length === 0) return;
    giveaways.map(async db => {
      let set = db.now;
      let timeout = db.time;
      let endDate = Date.now();
      if (set - (Date.now() - timeout) <= 60000) {
        setTimeout(async () => {
          if (db.users.length === 0) {
              const noUsers = new EmbedBuilder()
                .setColor("#A52F05")
                .setTitle(db.prize)
                .setDescription(`${client.translate.get(db.lang, "Functions.giveawaysEnd.noUsers")}!\n\n${client.translate.get(db.lang, "Functions.giveawaysEnd.ended")}: <t:${Math.floor((endDate) / 1000)}:R>\n${client.translate.get(db.language, "Commands.giveaway.hosted")}: <@${db.owner}>\n${client.translate.get(db.lang, "Functions.giveawaysEnd.winnersNone")}${db.requirement ? `\n\n${client.translate.get(db.lang, "Functions.giveawaysEnd.reqs")}:\n${db.requirement}` : ``}`)

              await db.updateOne({ ended: true, endDate: endDate })
              await db.save();
                        
              (await client.channels.resolve(db.channelId))?.send({ content: `${client.translate.get(db.lang, "Functions.giveawaysEnd.noOne")} **${db.prize}**\nhttps://fluxer.app/channels/${db.serverId}/${db.channelId}/${db.messageId}` })
              const foundMsg = await (await client.channels.resolve(db.channelId))?.messages?.fetch(db.messageId);
              return foundMsg?.edit({ embeds: [noUsers] }).catch(() => {
                console.warn(`[Channel Edit] Unable to edit message ${db.messageId} in channel ${db.channelId}`)
              });
            }

            for (let i = 0; i < db.winners; i++) {
              let winner = db.picking[Math.floor(Math.random() * db.picking.length)];
                if (winner) {
                    const filtered = db.picking.filter(object => object.userID != winner.userID)
                    db.picking = filtered;
                    db.pickedWinners.push({ id: winner.userID })
                    await db.updateOne({ ended: true, endDate: endDate })
                    await db.save();
                }
            }

          const embed = new EmbedBuilder()
            .setColor("#A52F05")
            .setTitle(db.prize)
            .setDescription(`${client.translate.get(db.lang, "Functions.giveawaysEnd.ended")}: <t:${Math.floor((endDate) / 1000)}:R>\n${client.translate.get(db.language, "Commands.giveaway.hosted")}: <@${db.owner}>\n${client.translate.get(db.lang, "Functions.giveawaysEnd.partici")}: ${db.users.length}\n${client.translate.get(db.lang, "Functions.giveawaysEnd.winners")}: ${db.pickedWinners.map(w => `<@${w.id}>`).join(", ")}${db.requirement ? `\n\n${client.translate.get(db.lang, "Functions.giveawaysEnd.reqs")}:\n${db.requirement}` : ``}`)
                    
          const foundChannel = await client.channels.resolve(db.channelId);
            foundChannel?.send({ content: `${client.translate.get(db.lang, "Functions.giveawaysEnd.congrats")} ${db.pickedWinners.map(w => `<@${w.id}>`).join(", ")}! ${client.translate.get(db.lang, "Functions.giveawaysEnd.youWon")} **${db.prize}**\nhttps://fluxer.app/channels/${db.serverId}/${db.channelId}/${db.messageId}` }).catch(() => { console.warn(`[Channel Post] Unable to post to channel ${db.channelId}`) });
            const foundMsg = await foundChannel?.messages?.fetch(db.messageId);
              foundMsg?.edit({ embeds: [embed] }).catch(() => {
                console.warn(`[Channel Edit] Unable to edit message ${db.messageId} in channel ${db.channelId}`)
              });
        }, set - (Date.now() - timeout));
      }
    });
  }, 60000);
}

module.exports = giveawaysEnd;