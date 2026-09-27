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

function snapshotChannel(channel, channelId) {
  return {
    id: String(channel?.id ?? channelId),
    name: channel?.name ?? null,
    type: channel?.type ?? null,
  };
}

function getCached(channelId) {
  const entry = cache.get(channelId);
  if (!entry) return null;
  if (Date.now() - entry.fetchedAt > CACHE_TTL_MS) {
    cache.delete(channelId);
    return null;
  }
  return entry.profile;
}

function isFailed(channelId) {
  const ts = failed.get(channelId);
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
      const channelId = queue.shift();
      queued.delete(channelId);
      if (getCached(channelId) || isFailed(channelId)) continue;

      try {
        const channel = await client.channels.resolve(channelId);
        if (channel) {
          cache.set(channelId, { profile: snapshotChannel(channel, channelId), fetchedAt: Date.now() });
          failed.delete(channelId);
        } else {
          failed.set(channelId, Date.now());
        }
      } catch (err) {
        console.error('[channelProfiles] fetch failed for', channelId, ':', err?.message ?? err);
        if (err?.retryAfter != null) {
          await sleep(Number(err.retryAfter) * 1000);
        } else {
          failed.set(channelId, Date.now());
        }
      }

      if (queue.length > 0 && FETCH_DELAY_MS > 0) await sleep(FETCH_DELAY_MS);
    }
  } finally {
    processing = false;
  }
}

function enqueue(client, channelId) {
  if (getCached(channelId) || queued.has(channelId) || isFailed(channelId)) return;
  if (queue.length >= QUEUE_MAX) return;
  queue.push(channelId);
  queued.add(channelId);
  ensureSweeper();
  void processQueue(client);
}

function getChannelProfile(client, channelId) {
  const cached = getCached(channelId);
  if (cached) return cached;
  enqueue(client, channelId);
  return { id: String(channelId), pending: true };
}

async function getChannelProfiles(client, ids) {
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

module.exports = { getChannelProfile, getChannelProfiles };