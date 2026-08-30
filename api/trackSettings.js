const FIELD_META = {
  prefix: { category: 'configuration', label: 'Command Prefix' },
  language: { category: 'configuration', label: 'Language' },
  dm: { category: 'configuration', label: 'DM on Join' },
  timezoneConvert: { category: 'configuration', label: 'Timezone Convert' },
  pollPerm: { category: 'polls', label: 'Poll Permission' },
  stickyRolesEnabled: { category: 'roles', label: 'Sticky Roles' },
  joinRoles: { category: 'roles', label: 'Join Roles' },
  timedRoles: { category: 'roles', label: 'Timed Roles' },
  stickyRoles: { category: 'roles', label: 'Sticky Roles' },
  bypassRoles: { category: 'roles', label: 'Bypass Roles' },
  config: { category: 'configuration', label: 'Guild Config' },
  parentChannel: { category: 'tempchannels', label: 'Parent Channel' },
  childChannel: { category: 'tempchannels', label: 'Child Channel' },
  tempChannels: { category: 'tempchannels', label: 'Temp Channels' },
  scheduledMessages: { category: 'scheduling', label: 'Scheduled Messages' },
  tags: { category: 'tags', label: 'Tags' },
  roles: { category: 'reactionroles', label: 'Reaction Roles' },
};

const COLLECTION_META = {
  tags: {
    category: 'tags',
    singular: 'Tag',
    idOf: (t) => String(t?.id ?? t?.name ?? '').toLowerCase(),
    snapshot: (t) =>
      t
        ? {
            name: t.name ?? null,
            description: t.description ?? t.content ?? null,
            type: t.type ?? null,
          }
        : null,
  },
  roles: {
    category: 'reactionroles',
    singular: 'Reaction Role Panel',
    idOf: (r) => String(r?.id ?? r?.msgId ?? r?.messageId ?? r?.name ?? ''),
    snapshot: (r) =>
      r
        ? {
            id: r.id ?? r.msgId ?? r.messageId ?? null,
            type: r.type ?? null,
            exclusive: r.exclusive ?? null,
            reactions: r.reactions ?? r.roles ?? r.emoji ?? null,
            channelId: r.chanId ?? r.channelId ?? null,
          }
        : null,
  },
  scheduledMessages: {
    category: 'scheduling',
    singular: 'Scheduled Message',
    idOf: (m) => String(m?.id ?? m?.messageId ?? ''),
    snapshot: (m) =>
      m
        ? {
            id: m.id ?? m.messageId ?? null,
            type: m.type ?? null,
            channelId: m.channelId ?? null,
          }
        : null,
  },
  joinRoles: {
    category: 'roles',
    singular: 'Join Role',
    idOf: (r) =>
      String(typeof r === 'string' || typeof r === 'number' ? r : r?.id ?? r?.roleId ?? ''),
    snapshot: (r) =>
      r == null
        ? null
        : typeof r === 'string' || typeof r === 'number'
          ? { id: String(r) }
          : { id: r.id ?? r.roleId ?? null, ...(typeof r === 'object' ? r : {}) },
  },
  stickyRoles: {
    category: 'roles',
    singular: 'Sticky Role',
    idOf: (r) =>
      String(typeof r === 'string' || typeof r === 'number' ? r : r?.id ?? r?.roleId ?? ''),
    snapshot: (r) =>
      r == null
        ? null
        : typeof r === 'string' || typeof r === 'number'
          ? { id: String(r) }
          : { id: r.id ?? r.roleId ?? null, ...(typeof r === 'object' ? r : {}) },
  },
  bypassRoles: {
    category: 'roles',
    singular: 'Bypass Role',
    idOf: (r) =>
      String(
        typeof r === 'string' || typeof r === 'number'
          ? r
          : r?.role ?? r?.id ?? r?.roleId ?? ''
      ),
    snapshot: (r) =>
      r == null
        ? null
        : typeof r === 'string' || typeof r === 'number'
          ? { role: String(r), commands: [] }
          : {
              role: r.role ?? r.id ?? r.roleId ?? null,
              commands: Array.isArray(r.commands) ? [...r.commands] : [],
            },
  },
  timedRoles: {
    category: 'roles',
    singular: 'Timed Role',
    idOf: (r) => String(r?.id ?? r?.roleId ?? r?.name ?? ''),
    snapshot: (r) =>
      r
        ? {
            id: r.id ?? r.roleId ?? null,
            roleId: r.roleId ?? r.id ?? null,
            time: r.time ?? r.duration ?? null,
          }
        : null,
  },
  tempChannels: {
    category: 'tempchannels',
    singular: 'Temp Channel',
    idOf: (c) =>
      String(typeof c === 'string' || typeof c === 'number' ? c : c?.id ?? c?.channelId ?? ''),
    snapshot: (c) =>
      c == null
        ? null
        : typeof c === 'string' || typeof c === 'number'
          ? { id: String(c) }
          : { id: c.id ?? c.channelId ?? null, ...(typeof c === 'object' ? c : {}) },
  },
};

function stableStringify(value) {
  if (value === undefined) return undefined;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function valuesEqual(a, b) {
  if (a === b) return true;
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  if (typeof a !== 'object' || typeof b !== 'object') return a === b;
  return stableStringify(a) === stableStringify(b);
}

function isEmptyValue(value) {
  if (value === undefined || value === null) return true;
  if (typeof value === 'string' && value.trim() === '') return true;
  if (Array.isArray(value) && value.length === 0) return true;
  return false;
}

function inferAction(previous, next) {
  const prevEmpty = isEmptyValue(previous);
  const nextEmpty = isEmptyValue(next);
  if (prevEmpty && !nextEmpty) return 'create';
  if (!prevEmpty && nextEmpty) return 'delete';
  return 'update';
}

function summarizeValue(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (Array.isArray(value)) {
    return { count: value.length, items: value.slice(0, 20) };
  }
  if (typeof value === 'object') return value;
  return String(value);
}

function indexById(list, idOf) {
  const map = new Map();
  for (const item of list ?? []) {
    const id = idOf(item);
    if (id) map.set(id, item);
  }
  return map;
}

async function trackSetting(client, payload) {
  if (!client?.vanta?.track) return;
  const {
    userId = null,
    groupId,
    category = 'configuration',
    key,
    label,
    value = null,
    previous = null,
    action = undefined,
  } = payload;

  try {
    await client.vanta.track({
      event: 'setting.updated',
      userId,
      groupId,
      data: {
        category,
        key,
        ...(action ? { action } : {}),
        label,
        value,
        previous,
      },
    });
  } catch (err) {
    console.error('[trackSettings] track failed:', err);
  }
}

function trackCollectionDiff(tasks, client, { key, previousValue, nextValue, userId, groupId }) {
  const meta = COLLECTION_META[key];
  if (!meta) return false;
  if (!Array.isArray(previousValue) && !Array.isArray(nextValue)) return false;

  const prev = Array.isArray(previousValue) ? previousValue : [];
  const next = Array.isArray(nextValue) ? nextValue : [];
  const prevMap = indexById(prev, meta.idOf);
  const nextMap = indexById(next, meta.idOf);

  const push = (action, value, previous) => {
    tasks.push(
      trackSetting(client, {
        userId,
        groupId,
        category: meta.category,
        key,
        action,
        label: meta.singular,
        value: value ? meta.snapshot(value) : null,
        previous: previous ? meta.snapshot(previous) : null,
      })
    );
  };

  for (const [id, item] of nextMap) {
    const old = prevMap.get(id);
    if (!old) push('create', item, null);
    else if (!valuesEqual(old, item)) push('update', item, old);
  }
  for (const [id, item] of prevMap) {
    if (!nextMap.has(id)) push('delete', null, item);
  }

  return true;
}

async function trackGuildUpdates(client, { guildId, userId, existing, updates }) {
  if (!client?.vanta?.track) return;

  const tasks = [];

  for (const [key, nextValue] of Object.entries(updates)) {
    const previousValue = existing?.[key];
    if (valuesEqual(previousValue, nextValue)) continue;

    if (
      trackCollectionDiff(tasks, client, {
        key,
        previousValue,
        nextValue,
        userId,
        groupId: guildId,
      })
    ) {
      continue;
    }

    const meta = FIELD_META[key] ?? { category: 'configuration', label: key };
    const action = inferAction(previousValue, nextValue);

    tasks.push(
      trackSetting(client, {
        userId,
        groupId: guildId,
        category: meta.category,
        key,
        action,
        label: meta.label,
        value: summarizeValue(nextValue),
        previous: summarizeValue(previousValue),
      })
    );
  }

  if (tasks.length === 0) return;
  await Promise.allSettled(tasks);
}

async function trackResource(client, {
  userId = null,
  groupId,
  category,
  key,
  action,
  label,
  value = null,
  previous = null,
}) {
  const resolvedAction = action || inferAction(previous, value);
  const resolvedLabel =
    label || (FIELD_META[key] && FIELD_META[key].label) || key;

  return trackSetting(client, {
    userId,
    groupId,
    category,
    key,
    action: resolvedAction,
    label: resolvedLabel,
    value,
    previous,
  });
}

function actorFromReq(req) {
  return (
    req.headers['x-user-id'] ||
    null
  );
}

module.exports = {
  FIELD_META,
  COLLECTION_META,
  trackSetting,
  trackGuildUpdates,
  trackResource,
  trackCollectionDiff,
  actorFromReq,
  valuesEqual,
  summarizeValue,
  inferAction,
};