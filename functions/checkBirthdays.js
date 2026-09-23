const mongoose = require("mongoose");
const UserDB = require("../models/users");
const GuildDB = require("../models/guilds");
const { buildBirthdayAnnouncement } = require("./birthdayHelpers");

let clientRef = null;
const birthdayQueue = new Map();
const removalTimers = new Map();

const MAX_SINGLE_TIMEOUT_MS = 2 ** 31 - 1;
const REMOVAL_WINDOW_MS = 10 * 60 * 60 * 1000;
const REMOVAL_SCAN_INTERVAL_MS = 60 * 60 * 1000;

function nextBirthdayMidnight(month, day, timezone) {
  const tz = timezone || "UTC";
  const now = new Date();

  for (let yearOffset = 0; yearOffset <= 1; yearOffset++) {
    const year = now.getFullYear() + yearOffset;
    try {
      const localNow = new Date(now.toLocaleString("en-US", { timeZone: tz }));
      const birthdayLocal = new Date(year, month - 1, day, 0, 0, 0, 0);
      const offsetMs = now.getTime() - localNow.getTime();
      const birthdayUTC = new Date(birthdayLocal.getTime() + offsetMs);

      if (birthdayUTC.getTime() > now.getTime()) {
        return birthdayUTC.getTime();
      }
    } catch {
      const bd = new Date(Date.UTC(year, month - 1, day, 0, 0, 0));
      if (bd.getTime() > now.getTime()) return bd.getTime();
    }
  }

  const bd = new Date(Date.UTC(now.getFullYear() + 1, month - 1, day, 0, 0, 0));
  return bd.getTime();
}

async function removeBirthdayRole(guildId, userId, roleId) {
  const timerKey = `${userId}:${guildId}`;
  const scheduled = removalTimers.get(timerKey);
  if (scheduled?.timer) clearTimeout(scheduled.timer);
  removalTimers.delete(timerKey);

  try {
    const guild = clientRef.guilds?.get(guildId);
    if (!guild) return;

    const member = guild.members?.get(userId)
      ?? await guild.fetchMember?.(userId).catch(() => null);
    if (member) {
      await member.roles.remove?.(roleId).catch(() => {});
    }

    const guildData = await clientRef.database.getGuild(guildId, false);
    if (guildData?.birthdayPendingRemovals?.length) {
      const updated = guildData.birthdayPendingRemovals.filter(
        p => !(p.userId === userId && p.roleId === roleId)
      );
      await clientRef.database.updateGuild(guildId, { birthdayPendingRemovals: updated });
    }
  } catch (err) {
    console.error(`[checkBirthdays] Failed to remove role for ${userId} in ${guildId}:`, err);
  }
}

function scheduleRemovalTimer(guildId, userId, roleId, removeAt) {
  const key = `${userId}:${guildId}`;

  const existing = removalTimers.get(key);
  if (existing?.timer) clearTimeout(existing.timer);

  const entry = { guildId, userId, roleId, removeAt };
  removalTimers.set(key, entry);

  const arm = () => {
    const remaining = removeAt - Date.now();

    if (remaining <= 0) {
      removalTimers.delete(key);
      removeBirthdayRole(guildId, userId, roleId);
      return;
    }

    let delay;
    let onFire;
    if (remaining <= REMOVAL_WINDOW_MS) {
      delay = remaining;
      onFire = () => {
        removalTimers.delete(key);
        removeBirthdayRole(guildId, userId, roleId);
      };
    } else {
      delay = Math.min(remaining - REMOVAL_WINDOW_MS, MAX_SINGLE_TIMEOUT_MS);
      onFire = arm;
    }

    entry.timer = setTimeout(onFire, delay);
  };

  arm();
}

async function scheduleRoleRemoval(guildId, userId, roleId, removeAt, guildData) {
  if (removeAt <= Date.now()) {
    await removeBirthdayRole(guildId, userId, roleId);
    return;
  }

  const pending = guildData.birthdayPendingRemovals ?? [];
  if (!pending.some(p => p.userId === userId && p.roleId === roleId)) {
    pending.push({ userId, roleId, removeAt });
    await clientRef.database.updateGuild(guildId, { birthdayPendingRemovals: pending });
  }

  scheduleRemovalTimer(guildId, userId, roleId, removeAt);
}

async function announceBirthday(userData, guildId, announceAt) {
  const currentYear = new Date().getFullYear();
  if (userData.birthday?.lastBirthday === currentYear) return;

  const key = `${userData.userId}:${guildId}`;
  birthdayQueue.delete(key);

  try {
    const guild = clientRef.guilds?.get(guildId);
    if (!guild) return;

    const guildData = await clientRef.database.getGuild(guildId, false);
    if (!guildData?.birthdayChannel) return;
    if ((guildData.birthdayBlacklist ?? []).includes(userData.userId)) return;

    const channel = await clientRef.channels.resolve(guildData.birthdayChannel).catch(() => null);
    if (!channel) return;

    const member = guild.members?.get(userData.userId)
      ?? await guild.fetchMember?.(userData.userId).catch(() => null);
    if (!member) return;

    const bday = userData.birthday;
    const result = buildBirthdayAnnouncement(
      clientRef,
      guildData,
      member,
      userData,
      guild.name,
    );

    const pingUser = (guildData.birthdayPing ?? true) && (bday.ping ?? true);

    const content = pingUser ? `<@${userData.userId}>` : undefined;
    await channel.send({ content, embeds: [result.embed] });

    await clientRef.database.updateUser(userData.userId, {
      birthday: { ...userData.birthday, lastBirthday: currentYear },
    }, true);

    if (guildData.birthdayRole) {
      const added = await member.roles.add?.(guildData.birthdayRole)
        .then(() => true)
        .catch(() => false);

      if (added) {
        const removeAt = announceAt + 24 * 60 * 60 * 1000;
        await scheduleRoleRemoval(guildId, userData.userId, guildData.birthdayRole, removeAt, guildData);
      }
    }
  } catch (err) {
    console.error(`[checkBirthdays] Failed to announce for ${userData.userId} in ${guildId}:`, err);
  }
}

function scheduleBirthday(userData, guildId) {
  const bday = userData.birthday;
  if (!bday?.day) return;

  const tz = userData.timezone || "UTC";
  const announceAt = nextBirthdayMidnight(bday.month, bday.day, tz);
  const key = `${userData.userId}:${guildId}`;

  const existing = birthdayQueue.get(key);
  if (existing?.timeout) clearTimeout(existing.timeout);
  const entry = existing ?? {};
  birthdayQueue.set(key, entry);

  const arm = () => {
    const remaining = announceAt - Date.now();

    if (remaining <= 0) {
      announceBirthday(userData, guildId, announceAt);
      return;
    }

    entry.timeout = setTimeout(() => {
      if (remaining <= MAX_SINGLE_TIMEOUT_MS) {
        announceBirthday(userData, guildId, announceAt);
      } else {
        arm();
      }
    }, Math.min(remaining, MAX_SINGLE_TIMEOUT_MS));
  };

  arm();
}

async function loadBirthdaysIntoQueue() {
  if (!clientRef) return;

  for (const [, value] of birthdayQueue) {
    if (value.timeout) clearTimeout(value.timeout);
  }
  birthdayQueue.clear();

  try {
    const users = await UserDB.find({
      "birthday.day": { $ne: null },
      "birthday.enabledGuilds.0": { $exists: true },
    }).lean();

    for (const userData of users) {
      for (const guildId of userData.birthday.enabledGuilds) {
        scheduleBirthday(userData, guildId);
      }
    }
  } catch (err) {
    console.error("[checkBirthdays] Failed to load birthdays into queue:", err);
  }
}

async function restorePendingRemovals() {
  if (!clientRef) return;

  try {
    const guildIds = await GuildDB.distinct("id", {
      "birthdayPendingRemovals.0": { $exists: true },
    });

    for (const guildId of guildIds) {
      if (!clientRef.guilds.has(guildId)) continue;

      const guildData = await clientRef.database.getGuild(guildId, false);
      if (!guildData?.birthdayPendingRemovals?.length) continue;

      const now = Date.now();
      const stillPending = [];

      for (const entry of guildData.birthdayPendingRemovals) {
        const past = entry.removeAt <= now;
        const stale = !past && entry.removeAt > now + 48 * 60 * 60 * 1000;
        const remove = past || stale;

        if (remove) {
          await removeBirthdayRole(guildId, entry.userId, entry.roleId);
        } else {
          stillPending.push(entry);
          scheduleRemovalTimer(guildId, entry.userId, entry.roleId, entry.removeAt);
        }
      }

      if (stillPending.length !== guildData.birthdayPendingRemovals.length) {
        await clientRef.database.updateGuild(guildId, { birthdayPendingRemovals: stillPending });
      }
    }
  } catch (err) {
    console.error("[checkBirthdays] Error restoring pending role removals:", err);
  }
}

function whenDatabaseReady() {
  return new Promise((resolve) => {
    if (mongoose.connection.readyState === 1) return resolve();
    mongoose.connection.once("connected", resolve);
  });
}

function startBirthdayCheck(client) {
  clientRef = client;

  (async () => {
    await whenDatabaseReady();
    await restorePendingRemovals();
    loadBirthdaysIntoQueue();
  })();

  setInterval(loadBirthdaysIntoQueue, 12 * 60 * 60 * 1000);
  setInterval(restorePendingRemovals, REMOVAL_SCAN_INTERVAL_MS);
}

function stopBirthdayCheck() {
  for (const [, value] of birthdayQueue) {
    if (value.timeout) clearTimeout(value.timeout);
  }
  birthdayQueue.clear();

  for (const [, entry] of removalTimers) {
    if (entry.timer) clearTimeout(entry.timer);
  }
  removalTimers.clear();

  clientRef = null;
}

module.exports = { startBirthdayCheck, stopBirthdayCheck };