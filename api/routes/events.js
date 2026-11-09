const { Router } = require('express');
const Events = require('../../models/events');
const EventRsvps = require('../../models/eventRsvps');
const { makeRequireApiKey } = require('../middleware');
const { trackResource, actorFromReq } = require('../trackSettings');
const {
  parseEventWhen,
  parseEventEnd,
  parseColor,
  isHttpUrl,
  getEventCounts,
  buildEventEmbed,
  updateEventMessage,
  addEventReactions,
  getRsvpOptions,
  removeEventAttendeeRoles,
  syncEventAttendeeRoles,
} = require('../../functions/eventHelpers');
const dhms = require('../../functions/dhms');

const MAX_EVENTS = 25;
const MAX_CAPACITY = 1000;
const MAX_DURATION_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_REMINDERS = 10;
const DEFAULT_REMINDERS = [
  { offsetMs: dhms('24h'), sent: false, mode: 'channel' },
  { offsetMs: dhms('1h'), sent: false, mode: 'channel' },
];
const STATUSES = ['scheduled', 'live', 'ended', 'cancelled'];
const EVENT_KEYS = new Set([
  'title',
  'description',
  'footer',
  'channelId',
  'startAt',
  'when',
  'endAt',
  'end',
  'timezone',
  'location',
  'imageUrl',
  'color',
  'capacity',
  'waitlistEnabled',
  'attendeeRoleId',
  'signupCutoffAt',
  'postAt',
  'reminders',
  'pingRoleId',
  'requiredRoleIds',
  'rsvpOptions',
  'recurrence',
  'status',
]);

function isSnowflake(value) {
  return typeof value === 'string' && /^\d{17,20}$/.test(value);
}

function has(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function isObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function validTimezone(value) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

function parseTimestamp(value, timezone, now = Date.now()) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value !== 'string' || !value.trim()) return null;
  const text = value.trim();
  if (/^\d{12,}$/.test(text)) return Number(text);
  return parseEventWhen(text, timezone, now);
}

function parseEndTimestamp(value, timezone, startAt) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value !== 'string' || !value.trim()) return null;
  const text = value.trim();
  if (/^\d{12,}$/.test(text)) return Number(text);
  return parseEventEnd(text, timezone, startAt);
}

function nullableText(value, max, label) {
  if (value == null || value === '') return { value: null };
  if (typeof value !== 'string') {
    return { error: `${label} must be a string or null` };
  }
  return { value: value.trim().slice(0, max) || null };
}

function normalizeRsvpOptions(raw, existing) {
  if (raw != null && !isObject(raw)) {
    return { error: 'rsvpOptions must be an object' };
  }

  const source = raw ?? {};
  const base = existing ?? {};
  const defaults = getRsvpOptions({});
  const readGroup = (key, fallback) => {
    const group = {
      ...(isObject(base[key]) ? base[key] : {}),
      ...(isObject(source[key]) ? source[key] : {}),
    };
    if (!Object.keys(group).length) return fallback;
    return group;
  };

  const going = readGroup('going', defaults.going);
  if (!going) return { error: 'rsvpOptions.going must be an object' };
  const maybe = readGroup('maybe', defaults.maybe);
  if (!maybe) return { error: 'rsvpOptions.maybe must be an object' };
  const declined = readGroup('declined', defaults.declined);
  if (!declined) return { error: 'rsvpOptions.declined must be an object' };

  const emoji = (group, fallback) => {
    const value = group.emoji ?? fallback;
    if (typeof value !== 'string' || !value.trim()) return null;
    return value.trim().slice(0, 100);
  };
  const label = (group, fallback) => {
    const value = group.label ?? fallback;
    if (typeof value !== 'string' || !value.trim()) return null;
    return value.trim().slice(0, 100);
  };

  const goingEmoji = emoji(going, defaults.going.emoji);
  const goingLabel = label(going, defaults.going.label);
  const maybeEmoji = emoji(maybe, defaults.maybe.emoji);
  const maybeLabel = label(maybe, defaults.maybe.label);
  const declinedEmoji = emoji(declined, defaults.declined.emoji);
  const declinedLabel = label(declined, defaults.declined.label);

  if (!goingEmoji || !goingLabel || !maybeLabel || !declinedLabel) {
    return { error: 'rsvpOptions labels and the going emoji cannot be empty' };
  }

  const maybeEnabled = maybe.enabled !== false;
  const declinedEnabled = declined.enabled !== false;
  if (maybeEnabled && !maybeEmoji) {
    return { error: 'rsvpOptions.maybe.emoji is required when maybe is enabled' };
  }
  if (declinedEnabled && !declinedEmoji) {
    return { error: 'rsvpOptions.declined.emoji is required when declined is enabled' };
  }

  return {
    value: {
      going: { emoji: goingEmoji, label: goingLabel },
      maybe: {
        emoji: maybeEnabled ? maybeEmoji : null,
        label: maybeLabel,
        enabled: maybeEnabled,
      },
      declined: {
        emoji: declinedEnabled ? declinedEmoji : null,
        label: declinedLabel,
        enabled: declinedEnabled,
      },
    },
  };
}

function normalizeReminders(raw, existing, create) {
  const source = raw === undefined ? (existing ?? (create ? DEFAULT_REMINDERS : [])) : raw;
  if (source == null) return { value: [] };
  if (!Array.isArray(source)) return { error: 'reminders must be an array' };
  if (source.length > MAX_REMINDERS) {
    return { error: `reminders cannot contain more than ${MAX_REMINDERS} entries` };
  }

  const previous = new Map(
    (existing ?? [])
      .filter((reminder) => isObject(reminder))
      .map((reminder) => [Number(reminder.offsetMs), reminder])
  );
  const next = [];
  const seen = new Set();
  for (let index = 0; index < source.length; index += 1) {
    const rawReminder = source[index];
    if (!isObject(rawReminder)) {
      return { error: `reminders[${index}] must be an object` };
    }
    const offsetMs = Number(rawReminder.offsetMs);
    if (!Number.isInteger(offsetMs) || offsetMs < 60000) {
      return { error: `reminders[${index}].offsetMs must be at least 60000` };
    }
    const mode = ['channel', 'dm', 'both'].includes(rawReminder.mode)
      ? rawReminder.mode
      : 'channel';
    if (seen.has(offsetMs)) continue;
    seen.add(offsetMs);
    const old = previous.get(offsetMs);
    const messageRaw = has(rawReminder, 'message') ? rawReminder.message : old?.message;
    let message = null;
    if (messageRaw != null && messageRaw !== '') {
      if (typeof messageRaw !== 'string') {
        return { error: `reminders[${index}].message must be a string or null` };
      }
      message = messageRaw.trim().slice(0, 500) || null;
    }
    next.push({ offsetMs, mode, sent: old?.sent === true, message });
  }

  return { value: next };
}

function normalizeRecurrence(raw, existing, startAt, endAt, timezone) {
  const source = raw === undefined ? existing : raw;
  if (source == null) return { value: null };
  if (!isObject(source)) return { error: 'recurrence must be an object or null' };

  const frequency = String(source.frequency ?? '').toLowerCase();
  if (!['daily', 'weekly', 'monthly'].includes(frequency)) {
    return { error: 'recurrence.frequency must be daily, weekly, or monthly' };
  }
  if (!endAt) return { error: 'recurrence requires endAt' };

  let until = null;
  if (source.until != null && source.until !== '') {
    if (typeof source.until === 'number') {
      until = source.until;
    } else if (typeof source.until === 'string') {
      until = parseEventWhen(source.until.trim(), timezone);
    }
    if (!Number.isFinite(until) || until <= startAt) {
      return { error: 'recurrence.until must be after startAt' };
    }
  }

  const previous = isObject(existing) ? existing : {};
  return {
    value: {
      frequency,
      until,
      ...(previous.spawnedAt ? { spawnedAt: previous.spawnedAt } : {}),
      ...(previous.completed ? { completed: true } : {}),
    },
  };
}

function normalizeEventInput(raw, existing, { create = false } = {}) {
  if (!isObject(raw)) return { error: 'Event payload must be an object' };

  const source = raw;
  const base = existing?.toObject?.() ?? existing ?? {};
  const pick = (key, fallback) =>
    has(source, key) ? source[key] : fallback;
  const baseMessageId = String(base.messageId ?? '');
  const hasBeenPosted = base.postedAt != null ||
    (baseMessageId && !/^(pending|posting):/.test(baseMessageId));

  const timezoneRaw = pick('timezone', base.timezone ?? 'UTC');
  if (typeof timezoneRaw !== 'string' || !timezoneRaw.trim()) {
    return { error: 'timezone must be a valid IANA timezone' };
  }
  const timezone = timezoneRaw.trim();
  if (!validTimezone(timezone)) {
    return { error: 'timezone must be a valid IANA timezone' };
  }

  const startProvided = has(source, 'startAt') || has(source, 'when');
  const startInput = has(source, 'startAt') ? source.startAt : source.when;
  let startAt = base.startAt ?? null;
  if (startProvided) {
    startAt = parseTimestamp(startInput, timezone);
    if (startAt == null) return { error: 'startAt must be a timestamp or a valid date/time' };
  }
  if (!Number.isFinite(startAt)) return { error: 'startAt is required' };
  if (create && startAt <= Date.now()) {
    return { error: 'startAt must be in the future' };
  }

  const endProvided = has(source, 'endAt') || has(source, 'end');
  const endInput = has(source, 'endAt') ? source.endAt : source.end;
  let endAt = base.endAt ?? null;
  if (endProvided) {
    if (endInput == null || endInput === '') {
      endAt = null;
    } else {
      endAt = parseEndTimestamp(endInput, timezone, startAt);
      if (endAt == null) return { error: 'endAt must be a timestamp or a valid date/time' };
    }
  }
  if (endAt != null && endAt <= startAt) {
    return { error: 'endAt must be after startAt' };
  }
  if (endAt != null && endAt - startAt > MAX_DURATION_MS) {
    return { error: 'Event duration cannot exceed 30 days' };
  }

  let recurrence = base.recurrence ?? null;
  if (has(source, 'recurrence')) {
    const result = normalizeRecurrence(
      source.recurrence,
      base.recurrence,
      startAt,
      endAt,
      timezone
    );
    if (result.error) return result;
    recurrence = result.value;
  } else if (recurrence) {
    const result = normalizeRecurrence(recurrence, base.recurrence, startAt, endAt, timezone);
    if (result.error) return result;
    recurrence = result.value;
  }

  const titleRaw = pick('title', base.title);
  if (typeof titleRaw !== 'string' || !titleRaw.trim()) {
    return { error: 'title is required' };
  }
  const title = titleRaw.trim().slice(0, 256);

  const description = nullableText(
    pick('description', base.description),
    4096,
    'description'
  );
  if (description.error) return description;
  const footer = nullableText(pick('footer', base.footer), 2048, 'footer');
  if (footer.error) return footer;
  const location = nullableText(pick('location', base.location), 1024, 'location');
  if (location.error) return location;

  const imageRaw = pick('imageUrl', base.imageUrl);
  let imageUrl = null;
  if (imageRaw != null && imageRaw !== '') {
    if (typeof imageRaw !== 'string' || !isHttpUrl(imageRaw)) {
      return { error: 'imageUrl must be a valid http(s) URL or null' };
    }
    imageUrl = imageRaw;
  }

  const colorRaw = pick('color', base.color);
  let color = null;
  if (colorRaw != null && colorRaw !== '') {
    color = parseColor(colorRaw);
    if (!color) return { error: 'color must be a 6-digit hex color or null' };
  }

  const capacityRaw = pick('capacity', base.capacity);
  let capacity = null;
  if (capacityRaw != null && capacityRaw !== '') {
    capacity = Number(capacityRaw);
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > MAX_CAPACITY) {
      return { error: `capacity must be between 1 and ${MAX_CAPACITY} or null` };
    }
  }

  const channelId = pick('channelId', base.channelId);
  if (!isSnowflake(channelId)) {
    return { error: 'channelId must be a valid channel ID' };
  }

  const pingRoleId = pick('pingRoleId', base.pingRoleId);
  if (pingRoleId != null && !isSnowflake(pingRoleId)) {
    return { error: 'pingRoleId must be a valid role ID or null' };
  }

  const requiredRoleIdsRaw = pick('requiredRoleIds', base.requiredRoleIds ?? []);
  if (!Array.isArray(requiredRoleIdsRaw) || !requiredRoleIdsRaw.every(isSnowflake)) {
    return { error: 'requiredRoleIds must be an array of valid role IDs' };
  }
  const requiredRoleIds = [...new Set(requiredRoleIdsRaw)];

  const attendeeRoleRaw = pick('attendeeRoleId', base.attendeeRoleId ?? null);
  if (attendeeRoleRaw != null && attendeeRoleRaw !== '' && !isSnowflake(attendeeRoleRaw)) {
    return { error: 'attendeeRoleId must be a valid role ID or null' };
  }
  const attendeeRoleId = attendeeRoleRaw || null;

  const signupCutoffRaw = pick('signupCutoffAt', base.signupCutoffAt ?? null);
  let signupCutoffAt = null;
  if (signupCutoffRaw != null && signupCutoffRaw !== '') {
    signupCutoffAt = parseTimestamp(signupCutoffRaw, timezone);
    if (signupCutoffAt == null) {
      return { error: 'signupCutoffAt must be a timestamp or a valid date/time or null' };
    }
  }

  const postAtRaw = pick('postAt', base.postAt ?? null);
  let postAt = null;
  if (postAtRaw != null && postAtRaw !== '') {
    postAt = parseTimestamp(postAtRaw, timezone);
    if (postAt == null) {
      return { error: 'postAt must be a timestamp or a valid date/time or null' };
    }
  }
  if (hasBeenPosted) {
    postAt = base.postAt ?? null;
  } else if (create) {
    if (postAt != null && postAt <= Date.now()) {
      return { error: 'postAt must be in the future' };
    }
    if (postAt != null && postAt >= startAt) {
      return { error: 'postAt must be before startAt' };
    }
  } else if (base.postAt != null) {
    if (postAt == null) {
      return { error: 'postAt is required for a scheduled post' };
    }
    if (postAt <= Date.now()) {
      return { error: 'postAt must be in the future' };
    }
    if (postAt >= startAt) {
      return { error: 'postAt must be before startAt' };
    }
  }

  const reminders = normalizeReminders(
    has(source, 'reminders') ? source.reminders : undefined,
    base.reminders,
    create
  );
  if (reminders.error) return reminders;

  const rsvpOptions = normalizeRsvpOptions(
    has(source, 'rsvpOptions') ? source.rsvpOptions : undefined,
    base.rsvpOptions
  );
  if (rsvpOptions.error) return rsvpOptions;

  const waitlistEnabled =
    has(source, 'waitlistEnabled')
      ? source.waitlistEnabled
      : base.waitlistEnabled !== false;
  if (typeof waitlistEnabled !== 'boolean') {
    return { error: 'waitlistEnabled must be a boolean' };
  }

  let status = has(source, 'status') ? source.status : base.status ?? 'scheduled';
  if (!STATUSES.includes(status)) {
    return { error: `status must be one of: ${STATUSES.join(', ')}` };
  }
  if (create) status = 'scheduled';

  return {
    value: {
      title,
      description: description.value,
      footer: footer.value,
      channelId,
      startAt,
      endAt,
      timezone,
      location: location.value,
      imageUrl,
      color,
      capacity,
      waitlistEnabled,
      attendeeRoleId,
      signupCutoffAt,
      postAt,
      reminders: reminders.value,
      pingRoleId: pingRoleId ?? null,
      requiredRoleIds,
      rsvpOptions: rsvpOptions.value,
      recurrence,
      status,
    },
  };
}

function serializeEvent(event, counts = null) {
  const value = event?.toObject?.() ?? event ?? {};
  const unposted = value.postAt != null && value.postedAt == null;
  return {
    id: String(value._id ?? value.messageId ?? ''),
    messageId: unposted ? null : value.messageId ?? null,
    guildId: value.guildId ?? null,
    channelId: value.channelId ?? null,
    hostId: value.hostId ?? null,
    title: value.title ?? null,
    description: value.description ?? null,
    footer: value.footer ?? null,
    startAt: value.startAt ?? null,
    endAt: value.endAt ?? null,
    timezone: value.timezone ?? null,
    location: value.location ?? null,
    imageUrl: value.imageUrl ?? null,
    color: value.color ?? null,
    capacity: value.capacity ?? null,
    waitlistEnabled: value.waitlistEnabled !== false,
    attendeeRoleId: value.attendeeRoleId ?? null,
    signupCutoffAt: value.signupCutoffAt ?? null,
    postAt: value.postAt ?? null,
    postedAt: value.postedAt ?? null,
    rsvpOptions: value.rsvpOptions ?? null,
    reminders: value.reminders ?? [],
    pingRoleId: value.pingRoleId ?? null,
    requiredRoleIds: value.requiredRoleIds ?? [],
    status: value.status ?? null,
    recurrence: value.recurrence ?? null,
    createdAt: value.createdAt ?? null,
    updatedAt: value.updatedAt ?? null,
    rsvpCounts: counts,
  };
}

async function findEvent(guildId, eventId) {
  if (!eventId) return null;
  const query = { guildId };
  if (/^[a-f0-9]{24}$/i.test(String(eventId))) {
    const byId = await Events.findById(eventId).catch(() => null);
    if (byId && String(byId.guildId) === String(guildId)) return byId;
  }
  query.messageId = String(eventId);
  return Events.findOne(query).catch(() => null);
}

async function resolveTextChannel(client, guildId, channelId) {
  if (!isSnowflake(channelId)) return null;
  const channel = await client.channels.resolve(channelId).catch(() => null);
  if (!channel || channel.type !== 0) return null;
  const channelGuildId = channel.guildId ?? channel.guild?.id;
  if (channelGuildId && String(channelGuildId) !== String(guildId)) return null;
  return channel;
}

function eventSnapshot(event) {
  const value = event?.toObject?.() ?? event ?? {};
  return {
    messageId: value.messageId,
    channelId: value.channelId,
    title: value.title,
    startAt: value.startAt,
    endAt: value.endAt,
    timezone: value.timezone,
    capacity: value.capacity,
    waitlistEnabled: value.waitlistEnabled,
    attendeeRoleId: value.attendeeRoleId ?? null,
    signupCutoffAt: value.signupCutoffAt ?? null,
    postAt: value.postAt ?? null,
    postedAt: value.postedAt ?? null,
    reminders: value.reminders,
    requiredRoleIds: value.requiredRoleIds,
    status: value.status,
    recurrence: value.recurrence ?? null,
  };
}

function eventsRouter(client, apiKey) {
  const router = Router({ mergeParams: true });
  const requireApiKey = makeRequireApiKey(apiKey);

  router.get('/', requireApiKey, async (req, res) => {
    try {
      const { guildId } = req.params;
      const filter = String(req.query.filter ?? 'upcoming').toLowerCase();
      const query = { guildId };
      let sort = { startAt: 1 };

      if (filter === 'past') {
        query.status = { $in: ['ended', 'cancelled'] };
        sort = { startAt: -1 };
      } else if (filter === 'all') {
        sort = { startAt: -1 };
      } else if (STATUSES.includes(filter)) {
        query.status = filter;
        sort = { startAt: -1 };
      } else {
        query.status = { $in: ['scheduled', 'live'] };
      }

      const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
      const events = await Events.find(query).sort(sort).limit(limit).lean();
      const list = await Promise.all(
        events.map(async (event) =>
          serializeEvent(event, await getEventCounts(event.messageId))
        )
      );

      return res.json({ events: list });
    } catch (err) {
      console.error('[API] GET events:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  });

  router.post('/', requireApiKey, async (req, res) => {
    try {
      const { guildId } = req.params;
      const body = isObject(req.body) ? req.body : {};

      const guild = await client.database.getGuild(guildId, false);
      if (!guild) return res.status(404).json({ error: 'Guild not found' });

      const normalized = normalizeEventInput(body, {}, { create: true });
      if (normalized.error) {
        return res.status(400).json({ error: normalized.error });
      }

      const channel = await resolveTextChannel(
        client,
        guildId,
        normalized.value.channelId
      );
      if (!channel) {
        return res.status(400).json({ error: 'channelId must be a text channel in this guild' });
      }

      const active = await Events.countDocuments({
        guildId,
        status: { $in: ['scheduled', 'live'] },
      });
      if (active >= MAX_EVENTS) {
        return res.status(400).json({ error: `Too many active events (max ${MAX_EVENTS})` });
      }

      const hostId = actorFromReq(req) || client.user?.id;
      if (!hostId) return res.status(400).json({ error: 'A host user ID is required' });

      const now = Date.now();
      const scheduledPost = normalized.value.postAt != null;
      const eventData = {
        ...normalized.value,
        guildId,
        hostId,
        messageId: `pending:${now}:${Math.random().toString(36).slice(2)}`,
        status: 'scheduled',
        postedAt: scheduledPost ? null : now,
        reminders: normalized.value.reminders.map((reminder) => ({ ...reminder, sent: false })),
      };

      let event;
      if (scheduledPost) {
        event = await Events.create(eventData);
      } else {
        const sent = await channel
          .send({
            embeds: [
              buildEventEmbed(client, guild, eventData, {
                going: 0,
                maybe: 0,
                declined: 0,
                waitlist: 0,
              }),
            ],
          })
          .catch(() => null);
        if (!sent) {
          return res.status(502).json({ error: 'Failed to send the event message' });
        }

        eventData.messageId = sent.id;
        event = await Events.create(eventData).catch(async (err) => {
          await sent.delete?.().catch(() => {});
          throw err;
        });
        await addEventReactions(sent, event);
      }

      await trackResource(client, {
        userId: actorFromReq(req),
        groupId: guildId,
        category: 'events',
        key: 'event',
        action: 'create',
        label: 'Event',
        value: eventSnapshot(event),
        previous: null,
      });

      return res.status(201).json({
        ok: true,
        event: serializeEvent(event, {
          going: 0,
          maybe: 0,
          declined: 0,
          waitlist: 0,
        }),
      });
    } catch (err) {
      console.error('[API] POST events:', err);
      return res.status(500).json({ error: 'Failed to create event' });
    }
  });

  router.get('/:eventId', requireApiKey, async (req, res) => {
    try {
      const { guildId, eventId } = req.params;
      const event = await findEvent(guildId, eventId);
      if (!event) return res.status(404).json({ error: 'Event not found' });

      const posted = event.postedAt != null || !event.postAt;
      const [counts, rsvps] = await Promise.all([
        posted
          ? getEventCounts(event.messageId)
          : { going: 0, maybe: 0, declined: 0, waitlist: 0 },
        posted
          ? EventRsvps.find({ eventId: event.messageId }).sort({ createdAt: 1 }).lean()
          : [],
      ]);

      return res.json({
        event: serializeEvent(event, counts),
        rsvps: rsvps.map((rsvp) => ({
          userId: rsvp.userId,
          response: rsvp.response,
          waitlisted: rsvp.waitlisted === true,
          createdAt: rsvp.createdAt,
          updatedAt: rsvp.updatedAt,
        })),
      });
    } catch (err) {
      console.error('[API] GET event:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  });

  router.patch('/:eventId', requireApiKey, async (req, res) => {
    try {
      const { guildId, eventId } = req.params;
      const body = isObject(req.body) ? req.body : {};
      if (!Object.keys(body).some((key) => EVENT_KEYS.has(key))) {
        return res.status(400).json({ error: 'No valid fields to update' });
      }

      const event = await findEvent(guildId, eventId);
      if (!event) return res.status(404).json({ error: 'Event not found' });

      const normalized = normalizeEventInput(body, event);
      if (normalized.error) {
        return res.status(400).json({ error: normalized.error });
      }

      const channel = await resolveTextChannel(
        client,
        guildId,
        normalized.value.channelId
      );
      if (!channel) {
        return res.status(400).json({ error: 'channelId must be a text channel in this guild' });
      }

      const guild = await client.database.getGuild(guildId, false);
      if (!guild) return res.status(404).json({ error: 'Guild not found' });

      const previous = eventSnapshot(event);
      const oldMessageId = event.messageId;
      const oldChannelId = event.channelId;
      const wasPosted = event.postedAt != null || !event.postAt;

      if (!wasPosted) {
        Object.assign(event, normalized.value, { updatedAt: Date.now() });
        await event.save();

        await trackResource(client, {
          userId: actorFromReq(req),
          groupId: guildId,
          category: 'events',
          key: 'event',
          action: 'update',
          label: 'Event',
          value: eventSnapshot(event),
          previous,
        });

        return res.json({
          ok: true,
          event: serializeEvent(event, {
            going: 0,
            maybe: 0,
            declined: 0,
            waitlist: 0,
          }),
        });
      }

      if (channel.id !== oldChannelId) {
        const counts = await getEventCounts(oldMessageId);
        const fresh = {
          ...event.toObject(),
          ...normalized.value,
          channelId: channel.id,
          messageId: 'pending',
        };

        const sent = await channel
          .send({ embeds: [buildEventEmbed(client, guild, fresh, counts)] })
          .catch(() => null);
        if (!sent) {
          return res.status(502).json({ error: 'Failed to send the event message' });
        }

        const updated = await Events.findByIdAndUpdate(
          event._id,
          {
            $set: {
              ...normalized.value,
              channelId: channel.id,
              messageId: sent.id,
              updatedAt: Date.now(),
            },
          },
          { returnDocument: "after" }
        ).catch(async (err) => {
          await sent.delete?.().catch(() => {});
          throw err;
        });
        if (!updated) {
          await sent.delete?.().catch(() => {});
          return res.status(500).json({ error: 'Failed to update event' });
        }

        await EventRsvps.updateMany(
          { eventId: oldMessageId },
          { $set: { eventId: sent.id } }
        );
        await addEventReactions(sent, updated);

        if (previous.attendeeRoleId !== updated.attendeeRoleId) {
          await syncEventAttendeeRoles(client, updated, previous.attendeeRoleId);
        }

        try {
          const oldChannel = await client.channels.resolve(oldChannelId);
          const oldMessage = await oldChannel?.messages?.fetch?.(oldMessageId);
          await oldMessage?.delete?.();
        } catch {}

        await trackResource(client, {
          userId: actorFromReq(req),
          groupId: guildId,
          category: 'events',
          key: 'event',
          action: 'update',
          label: 'Event',
          value: eventSnapshot(updated),
          previous,
        });

        return res.json({
          ok: true,
          event: serializeEvent(updated, await getEventCounts(sent.id)),
        });
      }

      Object.assign(event, normalized.value, { updatedAt: Date.now() });
      await event.save();
      await updateEventMessage(client, event, guild);

      if (previous.attendeeRoleId !== event.attendeeRoleId) {
        await syncEventAttendeeRoles(client, event, previous.attendeeRoleId);
      }

      await trackResource(client, {
        userId: actorFromReq(req),
        groupId: guildId,
        category: 'events',
        key: 'event',
        action: 'update',
        label: 'Event',
        value: eventSnapshot(event),
        previous,
      });

      return res.json({
        ok: true,
        event: serializeEvent(event, await getEventCounts(event.messageId)),
      });
    } catch (err) {
      console.error('[API] PATCH event:', err);
      return res.status(500).json({ error: 'Failed to update event' });
    }
  });

  router.delete('/:eventId', requireApiKey, async (req, res) => {
    try {
      const { guildId, eventId } = req.params;
      const event = await findEvent(guildId, eventId);
      if (!event) return res.status(404).json({ error: 'Event not found' });

      const previous = eventSnapshot(event);
      const posted = event.postedAt != null || !event.postAt;
      if (posted) {
        try {
          const channel = await client.channels.resolve(event.channelId);
          const message = await channel?.messages?.fetch?.(event.messageId);
          await message?.delete?.();
        } catch {}
      }

      await removeEventAttendeeRoles(client, event);
      await EventRsvps.deleteMany({ eventId: event.messageId });
      await Events.deleteOne({ _id: event._id });

      await trackResource(client, {
        userId: actorFromReq(req),
        groupId: guildId,
        category: 'events',
        key: 'event',
        action: 'delete',
        label: 'Event',
        value: null,
        previous,
      });

      return res.json({ ok: true });
    } catch (err) {
      console.error('[API] DELETE event:', err);
      return res.status(500).json({ error: 'Failed to delete event' });
    }
  });

  return router;
}

module.exports = eventsRouter;
