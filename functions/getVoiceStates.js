const { getVoiceManager } = require("@fluxerjs/voice");
const { Events, GatewayDispatchEvents } = require("@fluxerjs/core");
const color = require("../functions/colorCodes");

async function getVoiceStates(client) {
  let totalSeeded = 0;
  const processedGuilds = new Set();

  const processVoiceState = (guildId, userId, channelId, isBot) => {
    if (!channelId) return;
    const target = isBot ? client.observedVoiceBots : client.observedVoiceUsers;
    target.set(userId, { channelId, guildId });
  };

  const attachToShard = (shard) => {
    try {
      const ws = shard?.ws;
      if (!ws) return;

      const handleRaw = (data) => {
        try {
          const payload = typeof data === "string" ? JSON.parse(data) : data;
          if (payload?.op !== 0) return;

          if (
            payload.t === GatewayDispatchEvents.GuildCreate ||
            payload.t === "GUILD_CREATE"
          ) {
            const d = payload.d;
            const gId = d?.id;
            const voiceStates = d?.voice_states;

            if (
              gId &&
              !processedGuilds.has(gId) &&
              Array.isArray(voiceStates)
            ) {
              processedGuilds.add(gId);
              let seeded = 0;
              for (const state of voiceStates) {
                const userId = state.user_id;
                const channelId = state.channel_id;
                if (userId && channelId) {
                  processVoiceState(
                    gId,
                    userId,
                    channelId,
                    state.member?.user?.bot ?? false,
                  );
                  seeded++;
                }
              }
              totalSeeded += seeded;
            }
          }
        } catch (e) {}
      };

      if (typeof ws.addEventListener === "function") {
        ws.addEventListener("message", (event) => handleRaw(event.data));
      } else if (typeof ws.on === "function") {
        ws.on("message", handleRaw);
      }
    } catch (e) {}
  };

  if (client.isReady?.() && client.ws?.shards) {
    for (const [, shard] of client.ws.shards) attachToShard(shard);
  }

  client.on(Events.ShardReady || "shardReady", attachToShard);
  client.on(Events.ShardConnect || "shardConnect", attachToShard);

  let voiceManager;
  try {
    voiceManager = getVoiceManager(client);
  } catch (e) {}

  const fallbackScan = async () => {
    for (const [gId, guild] of client.guilds.cache) {
      if (processedGuilds.has(gId)) continue;

      const db = await client.database?.getGuild?.(gId).catch(() => null);
      const tempChannelIds = new Set(db?.tempChannels?.map((t) => t.channelId) || []);

      let seeded = 0;

      if (voiceManager?.voiceStates?.has(gId)) {
        const guildMap = voiceManager.voiceStates.get(gId);
        for (const [userId, channelId] of guildMap) {
          if (!channelId || !tempChannelIds.has(channelId)) continue;
          const guild = client.guilds.cache.get(gId);
          const member = guild?.members?.cache?.get(userId);
          processVoiceState(gId, userId, channelId, member?.user?.bot ?? false);
          seeded++;
        }
      }

      const voiceStates = guild.voice_states || guild.raw?.voice_states;
      if (Array.isArray(voiceStates)) {
        for (const state of voiceStates) {
          const userId = state.user_id || state.userId;
          const channelId = state.channel_id || state.channelId;
          if (!userId || !channelId || !tempChannelIds.has(channelId)) continue;
          processVoiceState(
            gId,
            userId,
            channelId,
            state.member?.user?.bot ?? false,
          );
          seeded++;
        }
      }

      if (seeded > 0) {
        processedGuilds.add(gId);
        totalSeeded += seeded;
      }
    }

    console.log(color("%", `%5[Voice]%7 :: Voice tracking active. Total seeded: %6${totalSeeded}%7`));
  };

  client.once(Events.Ready, fallbackScan);
}

module.exports = getVoiceStates;
