const Giveaways = require("../models/giveaways");
const Polls = require("../models/polls");
const { stickyTimers } = require("../commands/mediachannels");
const { trackGuildUpdates, trackResource } = require('../api/trackSettings');

const UNKNOWN = "Unknown (Deleted manually)";

module.exports = async (client, channel) => {
  const guildId = channel.guildId;
  const db = await client.database.getGuild(guildId);
  if (!db) return;

  const parentChannelId = db.config?.customParent || db.parentChannel;
  if (channel.id === parentChannelId || channel.id === db.childChannel) {
    const updates = {
      parentChannel: null,
      childChannel: null,
      tempChannels: [],
      config: null,
    };
    await client.database.updateGuild(guildId, updates);
    await trackGuildUpdates(client, {
      guildId,
      userId: UNKNOWN,
      existing: db,
      updates,
    });
  }

  const rolesInChannel = db.roles.filter(r => r.chanId === channel.id);
  if (rolesInChannel.length > 0) {
    const updatedRoles = db.roles.filter(r => r.chanId !== channel.id);
    await client.database.updateGuild(guildId, { roles: updatedRoles });

    for (const panel of rolesInChannel) {
      await trackResource(client, {
        userId: UNKNOWN,
        groupId: guildId,
        category: 'reactionroles',
        key: 'roles',
        action: 'delete',
        label: 'Reaction Role Panel',
        value: null,
        previous: {
          msgId: panel.msgId,
          chanId: panel.chanId,
          exclusive: panel.exclusive ?? null,
          roles: panel.roles,
        },
      });
    }
  }

  const mediaChannels = db.mediaChannels ?? [];
  const removedMc = mediaChannels.find((mc) => mc.channelId === channel.id);
  if (removedMc) {
    if (stickyTimers.has(channel.id)) {
      clearTimeout(stickyTimers.get(channel.id));
      stickyTimers.delete(channel.id);
    }

    const updatedMedia = mediaChannels.filter((mc) => mc.channelId !== channel.id);
    await client.database.updateGuild(guildId, { mediaChannels: updatedMedia });
    await trackGuildUpdates(client, {
      guildId,
      userId: UNKNOWN,
      existing: db,
      updates: { mediaChannels: updatedMedia },
    });
  }

  // if (db.config?.manage === channel.id) {
  //   try {
  //     await client.database.updateGuild(guildId, {
  //       'config.manage': null,
  //       'config.manageMessage': null,
  //     });
  //   } catch { }
  // }

  const channelGiveaways = await Giveaways.find({ serverId: guildId, channelId: channel.id }).catch(() => []);
  if (channelGiveaways.length > 0) {
    await Giveaways.deleteMany({ serverId: guildId, channelId: channel.id });
    await Promise.allSettled(channelGiveaways.map((g) =>
      trackResource(client, {
        userId: UNKNOWN,
        groupId: guildId,
        category: 'giveaways',
        key: 'giveaway',
        action: 'delete',
        label: 'Giveaway',
        value: null,
        previous: {
          messageId: g.messageId,
          channelId: g.channelId,
          prize: g.prize ?? null,
          winners: g.winners ?? null,
          owner: g.owner ?? null,
        },
      })
    ));
  }

  const channelPolls = await Polls.find({ serverId: guildId, channelId: channel.id }).catch(() => []);
  if (channelPolls.length > 0) {
    await Polls.deleteMany({ serverId: guildId, channelId: channel.id });
    await Promise.allSettled(channelPolls.map((p) =>
      trackResource(client, {
        userId: UNKNOWN,
        groupId: guildId,
        category: 'polls',
        key: 'poll',
        action: 'delete',
        label: 'Poll',
        value: null,
        previous: {
          messageId: p.messageId,
          channelId: p.channelId,
          question: p.desc ?? null,
          owner: p.owner ?? null,
        },
      })
    ));
  }
};