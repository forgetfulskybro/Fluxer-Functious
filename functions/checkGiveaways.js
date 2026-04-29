const db = require("../models/giveaways");

async function checkGiveaways(client) {
  let giveaways;
  try {
    giveaways = await db.find({ ended: false });
  } catch {
    return;
  }
  if (!giveaways || giveaways.length === 0) return;

  for (const gw of giveaways) {
    try {
      const givChannel = await client.channels.resolve(gw.channelId);
      if (!givChannel) continue;

      await givChannel.messages?.fetch(gw.messageId).catch(() => {});
    } catch {}
  }
}

module.exports = checkGiveaways;
