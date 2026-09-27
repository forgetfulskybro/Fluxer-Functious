const PollDB = require("../models/polls");
const Giveaways = require("../models/giveaways");
const GuildDB = require("../models/guilds");
const { trackResource, trackGuildUpdates } = require('../api/trackSettings');
const { filter, and, timeRange } = require('@vanta-dev/node');
const UNKNOWN = "Unknown (Deleted manually)";

const AUDIT_SEARCH_WINDOW_MS = 400 * 24 * 60 * 60 * 1000;
const AUDIT_SEARCH_MAX_PAGES = 5;
const AUDIT_SEARCH_PAGE_SIZE = 100;

function unwrapAuditEvents(res) {
  if (Array.isArray(res)) return res;
  if (res && typeof res === 'object') {
    if (Array.isArray(res.data)) return res.data;
    if (Array.isArray(res.events)) return res.events;
    if (Array.isArray(res.results)) return res.results;
    if (Array.isArray(res.items)) return res.items;
  }
  return [];
}

function eventReferencesMessage(event, msgId) {
  const data = event?.data;
  if (!data || typeof data !== 'object') return false;
  try {
    return JSON.stringify(data).includes(msgId);
  } catch {
    return false;
  }
}

async function messageTrackedInAuditLog(client, guildId, msgId) {
  if (!client?.vanta?.queryEvents) return false;
  try {
    const start = new Date(Date.now() - AUDIT_SEARCH_WINDOW_MS).toISOString();
    const end = new Date().toISOString();
    let cursor = null;

    for (let page = 0; page < AUDIT_SEARCH_MAX_PAGES; page += 1) {
      const result = await client.vanta.queryEvents({
        filters: and(
          filter('type', 'equals', 'setting.updated'),
          filter('groupId', 'equals', guildId)
        ),
        time: timeRange(start, end),
        sort: [{ field: 'timestamp', direction: 'desc' }],
        pagination: { limit: AUDIT_SEARCH_PAGE_SIZE, ...(cursor ? { cursor } : {}) },
      });

      if (unwrapAuditEvents(result).some((ev) => eventReferencesMessage(ev, msgId))) {
        return true;
      }

      const hasMore = result?.pagination?.hasMore;
      cursor = result?.pagination?.nextCursor ?? null;
      if (!hasMore || !cursor) return false;
    }
    return false;
  } catch {
    return false;
  }
}

module.exports = async (client, msg) => {
  const authorId = msg.author?.id;
  const msgId = msg.id;

  if (authorId && client.paginate?.has(authorId)) {
    client.paginate.delete(authorId);
  }

  if (client.polls?.has(msgId)) {
    client.polls.delete(msgId);
    const pollRecord = await PollDB.findOneAndUpdate({ messageId: msgId }, { ended: true }).catch(() => null);
    if (!(await messageTrackedInAuditLog(client, msg.guildId, msgId))) {
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
        if (!(await messageTrackedInAuditLog(client, msg.guildId, msgId))) {
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
      }
    })(),

    (async () => {
      const guild = await GuildDB.findOne({
        roles: { $elemMatch: { msgId } },
      }).catch(() => null);

      if (guild) {
        const roles = guild.roles.find((r) => r.msgId === msgId);
        if (!(await messageTrackedInAuditLog(client, guild.id, msgId))) {
          await trackResource(client, {
            userId: UNKNOWN,
            groupId: guild.id,
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
        }

        guild.roles = guild.roles.filter((r) => r.msgId !== msgId);
        await guild.save().catch(() => null);
      }
    })(),
  ]);
};
