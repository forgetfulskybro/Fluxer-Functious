const db = require("../models/giveaways");
async function checkGiveaways(client) {
  let giveaways = await db.find({ ended: false });
  if (!giveaways) return;
  let i = 0;
  for (let gw of giveaways) {
    i++;
    setTimeout(async () => {
      let givChannel;
      try {
        givChannel = await client.channels.resolve(gw.channelId);
        await givChannel?.messages?.fetch(gw.messageId);
      } catch {
        //await db.findOneAndDelete({ serverId: gw.serverId });
      }
    }, i * 500);
  }
}

module.exports = checkGiveaways;
