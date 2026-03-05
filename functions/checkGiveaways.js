const db = require("../models/giveaways");
async function checkGiveaways(client) {
  let giveaways = await db.find({ ended: false });
  if (!giveaways) return;
  let i = 0;
  for (let gw of giveaways) {
    i++;
    setTimeout(async () => {
      (await client.channels.resolve(gw.channelId))?.messages
        ?.fetch(gw.messageId)
        .catch(() => {});
    }, i * 500);
  }
}

module.exports = checkGiveaways;
