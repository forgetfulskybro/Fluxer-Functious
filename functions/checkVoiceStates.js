import db from "../models/guilds";

async function checkVoiceStates(client) {
  const guilds = await db.find({
    tempChannels: { $exists: true, $type: "array" },
    $expr: { $gt: [{ $size: "$tempChannels" }, 0] },
  });

  const observed = client.observedVoiceUsers;
  
  for (const g of guilds) {
    const guildId = g.id;
    if (!guildId) continue;
    
    const deletedChannels = [];
    for (const temp of g.tempChannels) {
      const channelId = temp?.channelId;
      if (!channelId) continue;

      const hasUsers = [...observed.values()].some(
        (v) => v?.guildId === guildId && v?.channelId === channelId,
      );

      if (hasUsers) continue;

      try {
        const channel = await client.channels.resolve(channelId).catch(() => null);
        await channel?.delete?.().catch(() => {});
      } catch (e) {}

      
      deletedChannels.push(channelId);
    }

    if (deletedChannels.length > 0) {
      const filter = g.tempChannels.filter((t) => !deletedChannels.includes(t.channelId));
      client.database.updateGuild(guildId, { tempChannels: [...filter] });
    }
  }
}

export default checkVoiceStates;
