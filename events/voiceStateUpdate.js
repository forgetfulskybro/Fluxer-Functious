const { PermissionFlags, resolvePermissionsToBitfield } = require('@erinjs/core');
const errorHandler = require("../functions/errorHandler");

module.exports = async (client, oldState, newState) => {
  const state = newState ?? oldState;
  const userId = state?.userId ?? state?.user_id ?? state?.member?.user?.id;
  if (!userId) return;

  const newChannelId = state?.channelId ?? state?.channel_id;
  const guildId = state?.guildId ?? state?.guild_id;
  const isBot = state?.member?.user?.bot ?? false;
  const target = isBot ? client.observedVoiceBots : client.observedVoiceUsers;
  if (target.get(userId)?.channelId === newChannelId) return;

  const guild = client.guilds.get(guildId);
  if (!guild) return;
  //const channels = await guild.fetchChannels();

  //const channel = newChannelId ? await guild.channels.find((c) => c.id === newChannelId) : null;
  const db = await client.database.getGuild(guildId);
  if (!db) return;

  const { parentChannel, childChannel, tempChannels, config } = db;
  const parentChannelId = config?.customParent || parentChannel;

  if (newChannelId && tempChannels.some((c) => c.channelId === newChannelId)) {
    target.set(userId, { channelId: newChannelId, guildId });
  } else if (!newChannelId && client.observedVoiceUsers.get(userId)) {
    const observe = client.observedVoiceUsers.get(userId);
    const wasTemp = tempChannels.find((c) => c.channelId === observe.channelId);

    if (wasTemp) {
      client.observedVoiceUsers.delete(userId);

      if ([...client.observedVoiceUsers.values()]
        .filter(data => data?.channelId === observe.channelId)
        .length === 0) {
        const tempChan = await guild.channels.find((c) => c.id === observe.channelId);
        if (tempChan) await tempChan.delete();

        const updatedTemps = tempChannels.filter(
          (c) => c.channelId !== observe.channelId,
        );
        await client.database.updateGuild(guildId, {
          tempChannels: updatedTemps,
        });
      }
    }
  }

  // && channel?.parentId === parentChannelId
  if (
      parentChannelId &&
      childChannel &&
      newChannelId === childChannel) {
      const member = await guild.fetchMember(userId);
      if (!member) return;
      
    if (!client.observedVoiceUsers.get(userId)) {
      try {
        client.observedVoiceUsers.set(userId, { channelId: newChannelId, guildId });
        const channelNameBase = db.config?.channelName ? db.config.channelName : state.member.nick ? `${state.member.nick}${state.member.nick[state.member.nick.length - 1].toLowerCase() === "s" ? "'" : "'s"} Channel` : state.member?.user?.global_name ? `${state.member.user.global_name}${state.member.user.global_name[state.member.user.global_name.length - 1].toLowerCase() === "s" ? "'" : "'s"} Channel` : `${state.member.user.username}${state.member.user.username[state.member.user.username.length - 1].toLowerCase() === "s" ? "'" : "'s"} Channel`
        const channelName = db?.config?.counting ? `${channelNameBase} (${(db?.tempChannels?.length ?? 0) + 1})` : channelNameBase;
        
        const voiceChannel = await guild.createChannel({
          type: 2,
          name: `${channelName}`,
          parent_id: parentChannelId,
          user_limit: db.config?.channelLimit ? db.config.channelLimit : 0,
          bitrate: 64000,
        });

        // if (db?.config?.manage) {
        //   await voiceChannel.editPermission(userId, {
        //     type: 1,
        //     allow: resolvePermissionsToBitfield([
        //       "Connect",
        //       "Speak",
        //       "MuteMembers",
        //       "DeafenMembers",
        //       "MoveMembers",
        //       "ManageChannels",
        //     ]),
        //   })
        // }
  
        client.observedVoiceUsers.set(userId, {
          channelId: voiceChannel.id,
          guildId,
        });
        
        await member.move(voiceChannel.id).catch(() => { });
  
        await client.database.updateGuild(guildId, {
          tempChannels: [
            ...tempChannels,
            { ownerId: userId, channelId: voiceChannel.id, parentChannel },
          ],
        });
      } catch (error) {
        await errorHandler({
          type: "function",
          message: null,
          error,
          config: { client, userId },
          sendInChannel: false,
        });
      }
      }
    }
};
