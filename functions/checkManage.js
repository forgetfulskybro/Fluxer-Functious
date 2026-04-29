const db = require("../models/guilds");

async function checkManage(client) {
  let guilds;
  try {
    guilds = await db.find({
      $and: [
        { "config.manageMessage": { $type: "string" } },
        { "config.manage": { $type: "string" } }
      ]
    });
  } catch {
    return;
  }
  if (!guilds || guilds.length === 0) return;

  for (const guild of guilds) {
    const messageId = guild.config?.manageMessage;
    const channelId = guild.config?.manage;

    if (!messageId || !channelId) continue;

    try {
      const channel = await client.channels.resolve(channelId);
      if (!channel) continue;

      await channel.messages?.fetch(messageId).catch(() => {});
    } catch {}
  }
}

module.exports = checkManage;
