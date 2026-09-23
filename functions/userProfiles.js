const CACHE_TTL_MS = 60 * 60 * 1000;
const NEGATIVE_TTL_MS = 15 * 60 * 1000;
const FETCH_DELAY_MS = 250;
const QUEUE_MAX = 500;
const SWEEP_INTERVAL_MS = 10 * 60 * 1000;

const cache = new Map();
const failed = new Map();
const queue = [];
const queued = new Set();
let processing = false;
let sweepStarted = false;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function snapshotUser(user, userId) {
  let avatarUrl = null;
  try {
    avatarUrl = typeof user?.displayAvatarURL === 'function'
      ? user.displayAvatarURL({ size: 128 })
      : null;
  } catch {
    avatarUrl = null;
  }
  return {
    id: String(user?.id ?? userId),
    username: user?.username ?? null,
    globalName: user?.globalName ?? null,
    avatar: user?.avatar ?? null,
    avatarUrl,
  };
}

function getCached(userId) {
  const entry = cache.get(userId);
  if (!entry) return null;
  if (Date.now() - entry.fetchedAt > CACHE_TTL_MS) {
    cache.delete(userId);
    return null;
  }
  return entry.profile;
}

function isFailed(userId) {
  const ts = failed.get(userId);
  return ts != null && Date.now() - ts < NEGATIVE_TTL_MS;
}

function ensureSweeper() {
  if (sweepStarted) return;
  sweepStarted = true;
  const interval = setInterval(() => {
    const now = Date.now();
    for (const [id, entry] of cache) {
      if (now - entry.fetchedAt > CACHE_TTL_MS) cache.delete(id);
    }
    for (const [id, ts] of failed) {
      if (now - ts > NEGATIVE_TTL_MS) failed.delete(id);
    }
  }, SWEEP_INTERVAL_MS);
  if (typeof interval.unref === 'function') interval.unref();
}

async function processQueue(client) {
  if (processing) return;
  processing = true;
  try {
    while (queue.length > 0) {
      const userId = queue.shift();
      queued.delete(userId);
      if (getCached(userId) || isFailed(userId)) continue;

      try {
        const user = await client.users.resolve(userId);
        if (user) {
          cache.set(userId, { profile: snapshotUser(user, userId), fetchedAt: Date.now() });
          failed.delete(userId);
        } else {
          failed.set(userId, Date.now());
        }
      } catch (err) {
        console.error('[userProfiles] fetch failed for', userId, ':', err?.message ?? err);
        if (err?.retryAfter != null) {
          await sleep(Number(err.retryAfter) * 1000);
        } else {
          failed.set(userId, Date.now());
        }
      }

      if (queue.length > 0 && FETCH_DELAY_MS > 0) await sleep(FETCH_DELAY_MS);
    }
  } finally {
    processing = false;
  }
}

function enqueue(client, userId) {
  if (getCached(userId) || queued.has(userId) || isFailed(userId)) return;
  if (queue.length >= QUEUE_MAX) return;
  queue.push(userId);
  queued.add(userId);
  ensureSweeper();
  void processQueue(client);
}

function getUserProfile(client, userId) {
  const cached = getCached(userId);
  if (cached) return cached;
  enqueue(client, userId);
  return { id: String(userId), pending: true };
}

async function getUserProfiles(client, ids) {
  const profiles = {};
  for (const id of ids) {
    const cached = getCached(id);
    if (cached) {
      profiles[id] = cached;
    } else {
      enqueue(client, id);
      profiles[id] = { id: String(id), pending: true };
    }
  }
  return profiles;
}

module.exports = { getUserProfile, getUserProfiles };