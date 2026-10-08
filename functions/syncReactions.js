function reactionKey(emoji) {
  const value = String(emoji ?? '').trim();
  const angled = /^<(a?):([^:<>]+):(\d+)>$/.exec(value);
  if (angled) return `${angled[2]}:${angled[3]}`;
  const bare = /^(?:a:)?([A-Za-z0-9_+-]+):(\d{17,20})$/.exec(value);
  if (bare) return `${bare[1]}:${bare[2]}`;
  return value;
}

function isRetryable(err) {
  const status = err?.statusCode;
  if (status === undefined || status === null) return true;
  return status === 429 || status >= 500;
}

async function attempt(fn) {
  try {
    await Promise.resolve().then(fn);
    return null;
  } catch (err) {
    return err || new Error('failed');
  }
}

async function syncReactions(msg, emojis) {
  const desired = new Map();
  for (const emoji of emojis ?? []) {
    const value = String(emoji ?? '').trim();
    if (value) desired.set(reactionKey(value), value);
  }

  const present = new Map();
  for (const reaction of msg?.reactions ?? []) {
    const identifier = reaction?.emojiIdentifier;
    if (identifier) present.set(reactionKey(identifier), identifier);
  }

  const removed = [];
  for (const [key, identifier] of present) {
    if (desired.has(key)) continue;
    if (!(await attempt(() => msg.removeReactionEmoji(identifier)))) {
      removed.push(identifier);
    }
  }

  const added = [];
  const failed = [];

  for (const [key, emoji] of desired) {
    if (present.has(key)) continue;

    let err = await attempt(() => msg.react(emoji));
    for (let retry = 1; err && retry < 3 && isRetryable(err); retry++) {
      await new Promise((resolve) => setTimeout(resolve, 250 * retry));
      err = await attempt(() => msg.react(emoji));
    }

    if (err) failed.push(emoji);
    else added.push(emoji);
  }

  return { added, removed, failed };
}

module.exports = { syncReactions, reactionKey };
