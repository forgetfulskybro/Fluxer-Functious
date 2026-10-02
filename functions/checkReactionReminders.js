const db = require("../models/users");
const color = require("./colorCodes");
const { EmbedBuilder } = require("@fluxerjs/core");
const { trackResource } = require("../api/trackSettings");
const {
  SIMILARITY_THRESHOLD,
  createProfile,
  sharesSignal,
  scoreProfiles,
  buildFingerprint,
  attachNames,
} = require("./messageSimilarity");

const WATCH_EMOJI = "⏰";
const MAX_CANDIDATES = 200;
const MAX_WATCHERS = 5;
const SUPPRESS_TTL_MS = 10 * 60 * 1000;
const channelIndex = new Map();
const userIndex = new Map();
const userLocks = new Map();
const suppressedMessages = new Set();
let pendingSelfSends = 0;
const selfSendWaiters = [];

function suppressMessage(messageId) {
  if (!messageId) return;
  const key = String(messageId);
  suppressedMessages.add(key);
  const timer = setTimeout(() => suppressedMessages.delete(key), SUPPRESS_TTL_MS);
  if (typeof timer.unref === "function") timer.unref();
}

function isSuppressed(messageId) {
  return Boolean(messageId) && suppressedMessages.has(String(messageId));
}

function beginSelfSend() {
  pendingSelfSends += 1;
}

function endSelfSend(messageId) {
  if (messageId) suppressMessage(messageId);
  pendingSelfSends = Math.max(0, pendingSelfSends - 1);
  if (pendingSelfSends === 0 && selfSendWaiters.length > 0) {
    const waiters = selfSendWaiters.splice(0);
    for (const resolve of waiters) resolve();
  }
}

function waitForSelfSends() {
  if (pendingSelfSends === 0) return Promise.resolve();
  return new Promise((resolve) => selfSendWaiters.push(resolve));
}

function channelKey(guildId, channelId) {
  return `${guildId}:${channelId}`;
}

function channelLabel(channelId) {
  return `<#${channelId}>`;
}

function channelDisplay(channelId, channelName) {
  const id = channelId ? String(channelId) : "";
  if (channelName) return `#${channelName} (${id})`;
  return id ? `#${id}` : "unknown channel";
}

function shorten(text, max = 120) {
  const flat = String(text || "").replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

function normalizeWatcher(watcher) {
  if (!watcher) return null;
  const value = watcher.toObject ? watcher.toObject() : watcher;
  if (!value || !value.id || !value.guildId || !value.channelId) return null;
  return {
    ...value,
    guildName: value.guildName || "",
    channelName: value.channelName || "",
    attachmentNames: Array.isArray(value.attachmentNames) ? value.attachmentNames : [],
    language: value.language || "en_EN",
  };
}

function insertEntry(index, key, entry) {
  const list = index.get(key);
  if (list) {
    list.push(entry);
    return;
  }
  index.set(key, [entry]);
}

function dropEntry(index, key, entry) {
  const list = index.get(key);
  if (!list) return;
  const next = list.filter((item) => item.watcher.id !== entry.watcher.id);
  if (next.length === 0) index.delete(key);
  else index.set(key, next);
}

function makeEntry(userId, watcher) {
  return {
    userId,
    watcher,
    profile: createProfile(watcher.fingerprint, watcher.attachmentNames),
  };
}

function withLock(key, task) {
  const previous = userLocks.get(key) || Promise.resolve();
  const current = previous.then(task, task);

  userLocks.set(key, current);

  const release = () => {
    if (userLocks.get(key) === current) userLocks.delete(key);
  };

  return current.then(
    (value) => {
      release();
      return value;
    },
    (err) => {
      release();
      throw err;
    },
  );
}

function watcherCount() {
  return userIndex.size === 0
    ? 0
    : [...userIndex.values()].reduce((total, list) => total + list.length, 0);
}

async function addWatcher(client, userId, watcher) {
  const entry = makeEntry(userId, watcher);
  insertEntry(channelIndex, channelKey(watcher.guildId, watcher.channelId), entry);
  insertEntry(userIndex, userId, entry);
  return entry;
}

async function findBestWatcher(profile, guildId, channelId) {
  if (!guildId || !channelId) return null;

  const list = channelIndex.get(channelKey(guildId, channelId));
  if (!list || list.length === 0) return null;
  if (!profile.fingerprint && profile.attachmentNames.length === 0) return null;

  let best = null;
  let bestScore = 0;
  const limit = Math.min(list.length, MAX_CANDIDATES);

  for (let i = 0; i < limit; i++) {
    const entry = list[i];
    if (!sharesSignal(entry.profile, profile)) continue;
    const score = scoreProfiles(entry.profile, profile);
    if (score < SIMILARITY_THRESHOLD || score <= bestScore) continue;
    best = entry;
    bestScore = score;
  }

  if (!best) return null;
  return { userId: best.userId, watcher: best.watcher, score: bestScore };
}

async function findUserWatcher(userId, profile, guildId, channelId) {
  const list = userIndex.get(userId);
  if (!list || list.length === 0) return null;
  if (!profile.fingerprint && profile.attachmentNames.length === 0) return null;

  let best = null;
  let bestScore = 0;

  for (const entry of list) {
    if (entry.watcher.guildId !== guildId) continue;
    if (entry.watcher.channelId !== channelId) continue;
    if (!sharesSignal(entry.profile, profile)) continue;
    const score = scoreProfiles(entry.profile, profile);
    if (score < SIMILARITY_THRESHOLD || score <= bestScore) continue;
    best = entry;
    bestScore = score;
  }

  if (!best) return null;
  return { userId, watcher: best.watcher, score: bestScore };
}

async function collectEntries(filter) {
  const results = [];
  let query = db.find(filter).limit(MAX_CANDIDATES);

  for (;;) {
    const docs = await query.exec();
    for (const doc of docs) {
      for (const watcher of doc.reactionReminders || []) {
        const value = normalizeWatcher(watcher);
        if (value) results.push({ userId: doc.userId, watcher: value });
      }
    }

    if (docs.length < MAX_CANDIDATES) break;
    const next = query.nextQuery();
    if (!next) break;
    query = next.limit(MAX_CANDIDATES);
  }

  return results;
}

function insertEntrySync(userId, watcher) {
  const entry = makeEntry(userId, watcher);
  insertEntry(channelIndex, channelKey(watcher.guildId, watcher.channelId), entry);
  insertEntry(userIndex, userId, entry);
  return entry;
}

async function sendRemovalDms(client, notifications) {
  const perUser = new Map();
  for (const notification of notifications) {
    if (!perUser.has(notification.userId)) perUser.set(notification.userId, []);
    perUser.get(notification.userId).push(notification);
  }

  for (const [userId, items] of perUser) {
    const user = await client.users.fetch(userId).catch(() => null);
    if (!user) continue;
    const first = items[0];
    const language = first.language || "en_EN";
    const header = client.translate.get(language, "Commands.remind.watcherRemoved", {
      "reason": client.translate.get(language, first.reasonKey, { "target": first.target }),
      "target": first.target,
    });
    const lines = items
      .map((item) => client.translate.get(language, "Commands.remind.removedWatcherLine", {
        "channel": item.channel,
        "message": item.message,
      }))
      .join("\n");
    const extra = items.length > 1
      ? `\n\n${client.translate.get(language, "Commands.remind.watcherRemovedExtra", { "numbers": items.length })}`
      : "";
    const description = `${header}\n\n${lines}${extra}`;
    await Promise.allSettled([
      user.createDM().then((dm) => dm.send({
        embeds: [new EmbedBuilder().setColor("#FF0000").setDescription(description)],
      })),
    ]);
  }
}

async function removeWatchers(client, userId, predicate, options = {}) {
  const reasonKey = options.reasonKey || null;
  const target = options.target || null;
  const notify = options.notify !== false && Boolean(reasonKey);

  return withLock(userId, async () => {
    let userData = await client.database.getUser(userId, false);
    if (!userData) userData = await client.database.getUser(userId, true);

    const watchers = (userData?.reactionReminders || [])
      .map(normalizeWatcher)
      .filter(Boolean);
    const removed = watchers.filter(predicate);
    if (removed.length === 0) return [];

    const removedIds = new Set(removed.map((watcher) => watcher.id));
    const kept = watchers.filter((watcher) => !removedIds.has(watcher.id));

    await client.database.updateUser(userId, { reactionReminders: kept }, true);

    for (const watcher of removed) {
      dropEntry(channelIndex, channelKey(watcher.guildId, watcher.channelId), { watcher });
      dropEntry(userIndex, userId, { watcher });

      await trackResource(client, {
        userId,
        groupId: watcher.guildId,
        category: "reminders",
        key: "reactionReminder",
        action: "delete",
        label: "Reminder Watcher",
        value: null,
        previous: {
          id: watcher.id,
          guildId: watcher.guildId,
          channelId: watcher.channelId,
          sourceMessageId: watcher.sourceMessageId,
          durationSeconds: watcher.durationSeconds,
          createdAt: watcher.createdAt,
        },
      }).catch(() => {});
    }

    if (notify) {
      const language = removed[0].language || "en_EN";
      await Promise.allSettled([
        sendRemovalDms(client, removed.map((watcher) => ({
          userId,
          language,
          reasonKey,
          target: target || channelDisplay(watcher.channelId, options.channelName || watcher.channelName),
          channel: channelDisplay(watcher.channelId, options.channelName || watcher.channelName),
          message: shorten(watcher.sample || watcher.reminderMessage || watcher.fingerprint),
        }))),
      ]);
    }

    return removed;
  });
}

async function updateWatcher(client, userId, watcherId, updates) {
  return withLock(userId, async () => {
    let userData = await client.database.getUser(userId, false);
    if (!userData) userData = await client.database.getUser(userId, true);

    const watchers = (userData?.reactionReminders || [])
      .map(normalizeWatcher)
      .filter(Boolean);
    const existing = watchers.find((watcher) => watcher.id === watcherId);
    if (!existing) return null;

    const updated = normalizeWatcher({ ...existing, ...updates });
    if (!updated) return null;

    const next = watchers.map((watcher) => (watcher.id === watcherId ? updated : watcher));
    await client.database.updateUser(userId, { reactionReminders: next }, false);

    dropEntry(channelIndex, channelKey(existing.guildId, existing.channelId), { watcher: existing });
    dropEntry(userIndex, userId, { watcher: existing });
    insertEntrySync(userId, updated);

    await trackResource(client, {
      userId,
      groupId: updated.guildId,
      category: "reminders",
      key: "reactionReminder",
      action: "update",
      label: "Reminder Watcher",
      value: {
        id: updated.id,
        durationSeconds: updated.durationSeconds,
        reminderMessage: updated.reminderMessage,
      },
      previous: {
        id: existing.id,
        durationSeconds: existing.durationSeconds,
        reminderMessage: existing.reminderMessage,
      },
    }).catch(() => {});

    return updated;
  });
}

async function removeChannel(client, guildId, channelId, channelName) {
  const affected = await collectEntries({ "reactionReminders.channelId": channelId });
  if (affected.length === 0) return 0;

  let removed = 0;
  for (const entry of affected) {
    const result = await removeWatchers(
      client,
      entry.userId,
      (watcher) => watcher.guildId === guildId && watcher.channelId === channelId,
      { reasonKey: "Commands.remind.reasonChannelDeleted", channelName }
    );
    removed += result.length;
  }
  return removed;
}

async function removeGuild(client, guildId, guildName) {
  const affected = await collectEntries({ "reactionReminders.guildId": guildId });
  if (affected.length === 0) return 0;

  let removed = 0;
  for (const entry of affected) {
    const result = await removeWatchers(
      client,
      entry.userId,
      (watcher) => watcher.guildId === guildId,
      { reasonKey: "Commands.remind.reasonGuildDeleted", target: guildName || guildId }
    );
    removed += result.length;
  }
  return removed;
}

async function checkMessage(client, message) {
  if (!message) return false;
  if (isSuppressed(message.id)) return false;
  if (!message.guildId || !message.channelId) return false;
  if (message.channel?.type === 1) return false;

  if (client?.user?.id && message.author?.id === client.user.id && pendingSelfSends > 0) {
    await waitForSelfSends();
    if (isSuppressed(message.id)) return false;
  }

  const profile = createProfile(buildFingerprint(message), attachNames(message));
  if (!profile.fingerprint && profile.attachmentNames.length === 0) return false;

  const match = await findBestWatcher(profile, message.guildId, message.channelId);
  if (!match) return null;

  await message.react?.(WATCH_EMOJI).catch(() => {});

  try {
    const user = await client.database.getUser(match.userId, true);
    const watchers = user?.reactionReminders || [];
    const watcher = watchers.find((item) => item.id === match.watcher.id);
    if (watcher) {
      await client.database.updateUser(
        match.userId,
        { reactionReminders: watchers.map((item) => (item.id === watcher.id ? { ...item, matches: (item.matches || 0) + 1 } : item)) },
        true
      );
    }
  } catch (err) {
    trackResource(client, {
      userId: match.userId,
      groupId: match.watcher.guildId,
      category: "reminders",
      type: "reaction",
      id: match.watcher.id,
      channelId: match.watcher.channelId,
      sourceMessageId: match.watcher.sourceMessageId,
      durationSeconds: match.watcher.durationSeconds,
      createdAt: match.watcher.createdAt,
    }).catch(() => {});
  }

  return true;
}

async function loadIndex(client) {
  channelIndex.clear();
  userIndex.clear();

  try {
    const users = await db.find({ "reactionReminders.0": { $exists: true } });
    let count = 0;
    for (const user of users) {
      const userId = user.userId;
      for (const raw of user.reactionReminders || []) {
        const watcher = normalizeWatcher(raw);
        if (!watcher) continue;
        insertEntrySync(userId, watcher);
        count += 1;
      }
    }
    console.log(color("%", `%2[Reminders]%7 :: Loaded ${count} reaction watcher(s)`));
  } catch (err) {
    console.log(color("%", `%4[Reminders]%7 :: Failed to load reaction watchers :: ${err}`));
  }
}

module.exports = {
  WATCH_EMOJI,
  MAX_WATCHERS,
  suppressMessage,
  isSuppressed,
  beginSelfSend,
  endSelfSend,
  waitForSelfSends,
  addWatcher,
  updateWatcher,
  findBestWatcher,
  findUserWatcher,
  checkMessage,
  watcherCount,
  removeWatchers,
  removeChannel,
  removeGuild,
  loadIndex,
};
