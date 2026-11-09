const mongoose = require("mongoose");
const GuildDB = require("../models/guilds");
const {
  normalizeCommunityBirthday,
  nextCommunityBirthdayTimestamp,
  isCommunityBirthdayToday,
  getTimeZoneParts,
  buildCommunityBirthdayPayload,
} = require("./communityBirthday");
const { trackResource } = require("../api/trackSettings");

const MAX_SINGLE_TIMEOUT_MS = 2 ** 31 - 1;
const REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000;

let clientRef = null;
const queue = new Map();

function clearGuildTimer(guildId) {
  const entry = queue.get(guildId);
  if (entry?.timer) clearTimeout(entry.timer);
  queue.delete(guildId);
}

async function resolveGuild(guildId) {
  const cached = clientRef?.guilds?.get?.(guildId);
  if (cached) return cached;
  try {
    return (await clientRef?.guilds?.fetch?.(guildId)) ?? null;
  } catch {
    return null;
  }
}

function currentYearInTimeZone(timezone, now = Date.now()) {
  try {
    return getTimeZoneParts(new Date(now), timezone || "UTC").year;
  } catch {
    return new Date(now).getUTCFullYear();
  }
}

async function announceCommunityBirthday(guildId) {
  if (!clientRef) return false;

  const guild = await resolveGuild(guildId);
  if (!guild) return false;

  const db = await clientRef.database.getGuild(guildId, false, true);
  const raw = db?.communityBirthday;
  const config = normalizeCommunityBirthday(raw);
  if (!config.enabled || !config.month || !config.day) return false;

  const year = currentYearInTimeZone(config.timezone);
  if (config.lastAnnouncedYear === year) return false;

  const channelId = config.channelId || db?.birthdayChannel;
  if (!channelId) {
    console.error(`[CommunityBirthday] No channel configured for guild ${guildId}`);
    return false;
  }

  const channel = await clientRef.channels.resolve(channelId).catch(() => null);
  if (!channel) {
    console.error(`[CommunityBirthday] Channel ${channelId} not found for guild ${guildId}`);
    return false;
  }

  const result = buildCommunityBirthdayPayload(clientRef, db, guild, config);
  if (!result) return false;

  try {
    const sent = await channel.send(result.payload);
    await clientRef.database.updateGuild(guildId, {
      communityBirthday: {
        ...config,
        lastAnnouncedYear: year,
      },
    });

    await trackResource(clientRef, {
      userId: null,
      groupId: guildId,
      category: "birthdays",
      key: "communityBirthdayAnnouncement",
      action: "create",
      label: "Community Birthday Announcement",
      value: {
        channelId: channel.id ?? channelId,
        messageId: sent?.id ?? null,
        year,
        date: { month: config.month, day: config.day },
      },
    });

    return true;
  } catch (err) {
    console.error(`[CommunityBirthday] Failed to announce for guild ${guildId}:`, err);
    return false;
  }
}

function arm(guildId, config, target) {
  const remaining = target - Date.now();

  if (remaining <= 0) {
    announceCommunityBirthday(guildId)
      .catch(() => {})
      .finally(() => refreshGuild(guildId));
    return;
  }

  const delay = Math.min(remaining, MAX_SINGLE_TIMEOUT_MS);
  const timer = setTimeout(() => {
    const entry = queue.get(guildId);
    if (!entry || entry.target !== target) return;

    if (remaining <= MAX_SINGLE_TIMEOUT_MS) {
      queue.delete(guildId);
      announceCommunityBirthday(guildId)
        .catch(() => {})
        .finally(() => refreshGuild(guildId));
    } else {
      arm(guildId, config, target);
    }
  }, delay);

  if (timer.unref) timer.unref();
  queue.set(guildId, { timer, target });
}

function schedule(guildId, rawConfig) {
  clearGuildTimer(guildId);

  const config = normalizeCommunityBirthday(rawConfig);
  if (!config.enabled || !config.month || !config.day) return;

  const target = nextCommunityBirthdayTimestamp(
    config.month,
    config.day,
    config.timezone
  );
  if (!target) return;

  arm(guildId, config, target);
}

async function refreshGuild(guildId) {
  if (!clientRef) return;
  try {
    const db = await clientRef.database.getGuild(guildId, false, true);
    schedule(guildId, db?.communityBirthday);
  } catch (err) {
    console.error(`[CommunityBirthday] Failed to refresh guild ${guildId}:`, err);
  }
}

async function loadCommunityBirthdays() {
  if (!clientRef) return;

  try {
    const guilds = await GuildDB.find({
      "communityBirthday.enabled": true,
      "communityBirthday.month": { $ne: null },
      "communityBirthday.day": { $ne: null },
    }).lean();

    const active = new Set();
    for (const guild of guilds) {
      active.add(String(guild.id));
      const config = normalizeCommunityBirthday(guild.communityBirthday);
      const year = currentYearInTimeZone(config.timezone);

      if (
        isCommunityBirthdayToday(config) &&
        config.lastAnnouncedYear !== year
      ) {
        announceCommunityBirthday(guild.id)
          .catch(() => {})
          .finally(() => refreshGuild(guild.id));
      } else {
        schedule(guild.id, config);
      }
    }

    for (const guildId of queue.keys()) {
      if (!active.has(guildId)) clearGuildTimer(guildId);
    }
  } catch (err) {
    console.error("[CommunityBirthday] Failed to load community birthdays:", err);
  }
}

function whenDatabaseReady() {
  return new Promise((resolve) => {
    if (mongoose.connection.readyState === 1) return resolve();
    mongoose.connection.once("connected", resolve);
  });
}

function startCommunityBirthdayCheck(client) {
  clientRef = client;

  (async () => {
    await whenDatabaseReady();
    await loadCommunityBirthdays();
  })();

  const interval = setInterval(loadCommunityBirthdays, REFRESH_INTERVAL_MS);
  if (interval.unref) interval.unref();
}

function stopCommunityBirthdayCheck() {
  for (const guildId of queue.keys()) clearGuildTimer(guildId);
  queue.clear();
  clientRef = null;
}

module.exports = {
  startCommunityBirthdayCheck,
  stopCommunityBirthdayCheck,
  announceCommunityBirthday,
  loadCommunityBirthdays,
};
