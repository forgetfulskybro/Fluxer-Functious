const PollDB = require("../models/polls");
const Giveaways = require("../models/giveaways");
const GuildDB = require("../models/guilds");
const { trackResource } = require('../api/trackSettings');

module.exports = async (client, msg) => {
  const authorId = msg.author?.id;
  const msgId = msg.id;

  if (authorId && client.paginate?.has(authorId)) {
    client.paginate.delete(authorId);
  }

  if (client.polls?.has(msgId)) {
    client.polls.delete(msgId);
    await PollDB.findOneAndUpdate({ messageId: msgId }, { ended: true }).catch(() => null);
  }

  const db = await client.database.getGuild(msg.guildId);
  if (db && db.config?.manageMessage === msgId) {
    await client.database.updateGuild(msg.guildId, {
      'config.manage': null,
      'config.manageMessage': null,
    });
  }

  await Promise.all([
    Giveaways.findOneAndDelete({ messageId: msgId }).catch(() => null),
    (async () => {
      const guild = await GuildDB.findOne({
        roles: { $elemMatch: { msgId } },
      }).catch(() => null);

      if (guild) {
        const roles = guild.roles.find((r) => r.msgId === msgId);
        await trackResource(client, {
          userId: "Unknown (Manually deleted)",
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
