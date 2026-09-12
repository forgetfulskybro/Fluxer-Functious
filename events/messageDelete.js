const PollDB = require("../models/polls");
const Giveaways = require("../models/giveaways");
const GuildDB = require("../models/guilds");
const { trackResource, trackGuildUpdates } = require('../api/trackSettings');
const { scheduleSticky } = require('../functions/checkMediaChannel');
const UNKNOWN = "Unknown (Deleted manually)";

module.exports = async (client, msg) => {
  const authorId = msg.author?.id;
  const msgId = msg.id;

  if (authorId && client.paginate?.has(authorId)) {
    client.paginate.delete(authorId);
  }

  if (client.polls?.has(msgId)) {
    client.polls.delete(msgId);
    const pollRecord = await PollDB.findOneAndUpdate({ messageId: msgId }, { ended: true }).catch(() => null);
    await trackResource(client, {
      userId: UNKNOWN,
      groupId: msg.guildId,
      category: 'polls',
      key: 'poll',
      action: 'delete',
      label: 'Poll',
      value: null,
      previous: {
        messageId: msgId,
        channelId: pollRecord?.channelId ?? null,
        question: pollRecord?.desc ?? null,
        owner: pollRecord?.owner ?? null,
      },
    });
  }

  const db = await client.database.getGuild(msg.guildId);

  if (db && db.config?.manageMessage === msgId) {
    const updates = { 'config.manage': null, 'config.manageMessage': null };
    await client.database.updateGuild(msg.guildId, updates);
    await trackGuildUpdates(client, {
      guildId: msg.guildId,
      userId: UNKNOWN,
      existing: db,
      updates,
    });
  }

  await Promise.all([
    (async () => {
      const giveaway = await Giveaways.findOneAndDelete({ messageId: msgId }).catch(() => null);
      if (giveaway) {
        await trackResource(client, {
          userId: UNKNOWN,
          groupId: msg.guildId,
          category: 'giveaways',
          key: 'giveaway',
          action: 'delete',
          label: 'Giveaway',
          value: null,
          previous: {
            messageId: msgId,
            channelId: giveaway.channelId ?? null,
            prize: giveaway.prize ?? null,
          },
        });
      }
    })(),

    (async () => {
      const guild = await GuildDB.findOne({
        roles: { $elemMatch: { msgId } },
      }).catch(() => null);

      if (guild) {
        const roles = guild.roles.find((r) => r.msgId === msgId);
        await trackResource(client, {
          userId: UNKNOWN,
          groupId: msg.guildId,
          category: 'reactionroles',
          key: 'roles',
          action: 'delete',
          label: 'Reaction Role Panel',
          value: null,
          previous: {
            msgId: msgId,
            chanId: roles.chanId,
            exclusive: roles.exclusive ?? null,
            roles: roles.roles,
          },
        });

        guild.roles = guild.roles.filter((r) => r.msgId !== msgId);
        await guild.save().catch(() => null);
      }
    })(),
  ]);
};
