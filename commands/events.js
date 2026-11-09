const { EmbedBuilder, PermissionFlags } = require("@fluxerjs/core");
const Events = require("../models/events");
const EventRsvps = require("../models/eventRsvps");
const Paginator = require("../functions/pagination");
const { trackResource } = require("../api/trackSettings");
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
  buildUsageEmbed,
  removeEventAttendeeRoles,
} = require("../functions/eventHelpers");
const dhms = require("../functions/dhms");

const MAX_EVENTS = 25;
const MAX_CAPACITY = 1000;
const MAX_EVENT_DURATION_MS = 30 * 24 * 60 * 60 * 1000;
const DEFAULT_REMINDERS = ["24h", "1h"];
const RECURRENCE_FREQUENCIES = ["daily", "weekly", "monthly"];

function splitOptions(input) {
  return String(input ?? "")
    .split("|")
    .map((value) => value.trim())
    .filter(Boolean);
}

function parseFlagMap(parts) {
  const flags = {};
  for (const part of parts) {
    const index = part.indexOf(":");
    if (index === -1) {
      flags.text = flags.text ? `${flags.text} ${part}` : part;
      continue;
    }
    const key = part.slice(0, index).trim().toLowerCase();
    const value = part.slice(index + 1).trim();
    if (key) flags[key] = value;
  }
  return flags;
}

function parseBool(value, fallback = false) {
  if (value == null) return fallback;
  return ["yes", "true", "1", "on", "enable", "enabled"].includes(String(value).toLowerCase());
}

function roleId(value) {
  if (!value || /^none$/i.test(value)) return null;
  const match = String(value).match(/(\d{15,25})/);
  return match ? match[1] : null;
}

function uniqueReminders(reminders) {
  const seen = new Set();
  return (reminders ?? []).filter((reminder) => {
    const offsetMs = Number(reminder?.offsetMs);
    if (!Number.isInteger(offsetMs) || seen.has(offsetMs)) return false;
    seen.add(offsetMs);
    return true;
  });
}

function parseReminders(value, mode = "channel", existing = []) {
  if (!value || /^none$/i.test(value)) return [];
  const previous = new Map(
    (existing ?? [])
      .filter((reminder) => reminder?.offsetMs != null)
      .map((reminder) => [Number(reminder.offsetMs), reminder])
  );
  const entries = String(value).split(",").map((entry) => entry.trim()).filter(Boolean);
  const reminders = [];
  const seen = new Set();
  for (const entry of entries) {
    const offsetMs = dhms(entry);
    if (!offsetMs || offsetMs < 60_000) return null;
    if (seen.has(offsetMs)) continue;
    seen.add(offsetMs);
    const old = previous.get(offsetMs);
    reminders.push({
      offsetMs,
      sent: old?.sent === true,
      mode,
      ...(old?.message ? { message: old.message } : {}),
    });
  }
  return reminders;
}

function validateTimezone(value) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

function makeRsvpOptions(flags, client) {
  const defaults = getRsvpOptions({});
  const existing = flags._rsvpOptions ?? {};
  const maybeEnabled = flags.maybe === "off"
    ? false
    : flags.maybe
      ? true
      : existing.maybe?.enabled !== false;
  const declinedEnabled = flags.declined === "off"
    ? false
    : flags.declined
      ? true
      : existing.declined?.enabled !== false;
  return {
    going: {
      emoji: flags.going || existing.going?.emoji || defaults.going.emoji || client.config.emojis.check,
      label: flags.goinglabel || flags["going-label"] || existing.going?.label || defaults.going.label,
    },
    maybe: {
      emoji: maybeEnabled ? flags.maybe || existing.maybe?.emoji || defaults.maybe.emoji : null,
      label: flags.maybelabel || flags["maybe-label"] || existing.maybe?.label || defaults.maybe.label,
      enabled: maybeEnabled,
    },
    declined: {
      emoji: declinedEnabled ? flags.declined || existing.declined?.emoji || defaults.declined.emoji : null,
      label: flags.declinedlabel || flags["declined-label"] || existing.declined?.label || defaults.declined.label,
      enabled: declinedEnabled,
    },
  };
}

function t(client, db, key, vars) {
  return client.translate.get(db.language, `Commands.events.${key}`, vars);
}

function isAdmin(member, client) {
  return member?.permissions?.has?.(PermissionFlags.ManageGuild) === true ||
    client.config.owners.includes(member?.id);
}

async function getMember(message) {
  return message.guild?.members?.get(message.author.id) ??
    await message.guild?.fetchMember?.(message.author.id).catch(() => null);
}

async function resolveChannel(client, message, value) {
  const id = String(value ?? "").replace(/[<#>]/g, "");
  if (!id) return null;
  const channel = await client.channels.resolve(id).catch(() => null);
  if (!channel || channel.type !== 0) return null;
  const channelGuildId = channel.guildId ?? channel.guild?.id;
  if (channelGuildId && channelGuildId !== message.guildId) return null;
  return channel;
}

async function canPost(client, guild, channel) {
  try {
    const me = guild?.members?.me ?? await guild?.members?.fetchMe?.().catch(() => null);
    const permissions = me?.permissionsIn?.(channel);
    if (!permissions) return true;
    const required = [
      PermissionFlags.ViewChannel,
      PermissionFlags.SendMessages,
      PermissionFlags.EmbedLinks,
      PermissionFlags.AddReactions,
    ].filter((flag) => flag !== undefined && flag !== null);
    return required.every((flag) => permissions.has(flag));
  } catch {
    return true;
  }
}

function buildDraft(flags, message, db, userTimezone, now = Date.now(), { allowPast = false } = {}) {
  const timezone = flags.tz || userTimezone || "UTC";
  if (!validateTimezone(timezone)) return { error: "invalidTimezone" };

  const startAt = flags.when || flags.start
    ? parseEventWhen(flags.when || flags.start, timezone, now)
    : flags._startAt ?? null;
  if (!startAt) return { error: "invalidWhen" };
  if (!allowPast && startAt <= now) return { error: "startMustBeFuture" };

  const endAt = flags.end
    ? parseEventEnd(flags.end, timezone, startAt)
    : flags._endAt ?? null;
  if (flags.end && !endAt) return { error: "invalidEnd" };
  if (endAt && endAt <= startAt) return { error: "invalidEnd" };
  if (endAt && endAt - startAt > MAX_EVENT_DURATION_MS) return { error: "durationTooLong" };

  let recurrence = flags._recurrence ?? null;
  if (flags.repeat != null) {
    const frequency = String(flags.repeat).toLowerCase();
    if (["none", "off", "no"].includes(frequency)) {
      recurrence = null;
    } else if (!RECURRENCE_FREQUENCIES.includes(frequency)) {
      return { error: "invalidRepeat" };
    } else {
      recurrence = { frequency, until: recurrence?.until ?? null };
    }
  }
  if (flags.repeatuntil != null) {
    if (!recurrence) return { error: "invalidRepeat" };
    const until = parseEventWhen(flags.repeatuntil, timezone, now);
    if (!until || until <= startAt) return { error: "invalidRepeatUntil" };
    recurrence = { ...recurrence, until };
  }
  if (recurrence && !endAt) return { error: "repeatRequiresEnd" };
  if (recurrence?.until && recurrence.until <= startAt) return { error: "invalidRepeatUntil" };

  const capacity = flags.capacity
    ? Number.parseInt(flags.capacity, 10)
    : flags._capacity ?? null;
  if (capacity != null && (!Number.isInteger(capacity) || capacity < 1 || capacity > MAX_CAPACITY)) {
    return { error: "invalidCapacity" };
  }

  if (flags.color && !parseColor(flags.color)) return { error: "invalidColor" };
  if (flags.ping != null && !roleId(flags.ping)) return { error: "invalidRole" };
  if (flags.require != null && !roleId(flags.require)) return { error: "invalidRole" };

  const mode = parseBool(flags.dm, flags._dm) ? "both" : "channel";
  const reminderInput = flags.remind ?? flags._remind;
  const existingReminders = Array.isArray(flags._reminders) ? flags._reminders : null;
  let reminders;
  if (reminderInput != null) {
    reminders = parseReminders(reminderInput, mode, existingReminders ?? []);
    if (reminders === null) return { error: "invalidReminders" };
  } else if (existingReminders) {
    reminders = uniqueReminders(existingReminders);
  } else {
    reminders = DEFAULT_REMINDERS.map((entry) => ({
      offsetMs: dhms(entry),
      sent: false,
      mode,
    }));
  }

  const rsvpOptions = makeRsvpOptions(flags, flags._client);

  return {
    title: (flags.title || flags._title || "").slice(0, 256),
    description: flags.desc || flags.description || flags._description || null,
    footer: flags.footer || flags._footer || null,
    startAt,
    endAt,
    timezone,
    location: flags.location || flags._location || null,
    imageUrl: flags.image || flags._imageUrl || null,
    color: flags.color ? parseColor(flags.color) : flags._color ?? null,
    capacity,
    waitlistEnabled: flags.waitlist != null
      ? parseBool(flags.waitlist)
      : flags._waitlistEnabled !== false,
    reminders,
    pingRoleId: flags.ping != null ? roleId(flags.ping) : flags._pingRoleId ?? null,
    requiredRoleIds: flags.require != null
      ? (roleId(flags.require) ? [roleId(flags.require)] : [])
      : flags._requiredRoleIds ?? [],
    rsvpOptions,
    recurrence,
    dmReminders: mode === "both",
  };
}

function eventSnapshot(event) {
  return {
    messageId: event.messageId,
    channelId: event.channelId,
    title: event.title,
    startAt: event.startAt,
    endAt: event.endAt,
    timezone: event.timezone,
    capacity: event.capacity,
    waitlistEnabled: event.waitlistEnabled,
    reminders: event.reminders,
    requiredRoleIds: event.requiredRoleIds,
    attendeeRoleId: event.attendeeRoleId ?? null,
    signupCutoffAt: event.signupCutoffAt ?? null,
    postAt: event.postAt ?? null,
    postedAt: event.postedAt ?? null,
    status: event.status,
    recurrence: event.recurrence ?? null,
  };
}

async function findEvent(messageId, guildId) {
  if (!messageId) return null;
  return Events.findOne({ messageId, guildId }).catch(() => null);
}

async function replyError(message, client, db, key, vars) {
  return message.reply({
    embeds: [
      new EmbedBuilder()
        .setColor("#FF0000")
        .setDescription(t(client, db, key, vars)),
    ],
  });
}

function prepareCreate(args, client, message, db, userData, now = Date.now()) {
  const options = splitOptions(args.join(" "));
  if (options.length < 2) return { error: "createUsage" };

  const title = options.shift();
  const when = options.shift();
  const flags = parseFlagMap(options);
  flags._client = client;
  flags._title = title;
  flags.when = when;

  const draft = buildDraft(flags, message, db, userData?.timezone, now);
  return { title, when, flags, draft };
}

async function previewEvent(client, message, args, db) {
  const member = await getMember(message);
  if (!isAdmin(member, client)) return replyError(message, client, db, "adminOnly");

  const userData = await client.database.getUser(message.author.id, false);
  const prepared = prepareCreate(args, client, message, db, userData);
  if (prepared.error) return replyError(message, client, db, prepared.error, { prefix: db.prefix });
  if (prepared.draft.error) return replyError(message, client, db, prepared.draft.error);
  if (prepared.flags.channel) {
    const channel = await resolveChannel(client, message, prepared.flags.channel);
    if (!channel) return replyError(message, client, db, "invalidChannel");
  }

  const eventData = {
    ...prepared.draft,
    title: prepared.draft.title || prepared.title.slice(0, 256),
    hostId: message.author.id,
    status: "scheduled",
    rsvpOptions: prepared.draft.rsvpOptions,
    reminders: prepared.draft.reminders.map((reminder) => ({ ...reminder, sent: false })),
  };

  return message.reply({
    content: t(client, db, "preview"),
    embeds: [buildEventEmbed(client, db, eventData, { going: 0, maybe: 0, declined: 0, waitlist: 0 })],
  });
}

async function createEvent(client, message, args, db) {
  const member = await getMember(message);
  if (!isAdmin(member, client)) {
    return replyError(message, client, db, "adminOnly");
  }

  const userData = await client.database.getUser(message.author.id, false);
  const prepared = prepareCreate(args, client, message, db, userData);
  if (prepared.error) {
    return replyError(message, client, db, prepared.error, { prefix: db.prefix });
  }
  if (prepared.draft.error) {
    return replyError(message, client, db, prepared.draft.error);
  }

  const { flags, draft, title } = prepared;

  const channel = flags.channel
    ? await resolveChannel(client, message, flags.channel)
    : message.channel;
  if (!channel) return replyError(message, client, db, "invalidChannel");
  if (!(await canPost(client, message.guild, channel))) {
    return replyError(message, client, db, "noChannelPerms", { channel: `<#${channel.id}>` });
  }

  if (flags.image && !isHttpUrl(flags.image)) {
    return replyError(message, client, db, "invalidImage");
  }

  const active = await Events.countDocuments({
    guildId: message.guildId,
    status: { $in: ["scheduled", "live"] },
  });
  if (active >= MAX_EVENTS) {
    return replyError(message, client, db, "tooMany", { max: MAX_EVENTS });
  }

  const eventData = {
    ...draft,
    guildId: message.guildId,
    channelId: channel.id,
    messageId: "pending",
    hostId: message.author.id,
    title: draft.title || title.slice(0, 256),
    description: draft.description,
    status: "scheduled",
    postedAt: Date.now(),
    rsvpOptions: draft.rsvpOptions,
    reminders: draft.reminders.map((reminder) => ({ ...reminder, sent: false })),
  };

  const sent = await channel.send({
    embeds: [buildEventEmbed(client, db, eventData, { going: 0, maybe: 0, declined: 0, waitlist: 0 })],
  }).catch(() => null);
  if (!sent) return replyError(message, client, db, "sendFailed");

  eventData.messageId = sent.id;
  const event = await Events.create(eventData);
  await addEventReactions(sent, event);

  await trackResource(client, {
    userId: message.author.id,
    groupId: message.guildId,
    category: "events",
    key: "event",
    action: "create",
    label: "Event",
    value: eventSnapshot(event),
    previous: null,
  });

  return message.reply({
    embeds: [
      new EmbedBuilder()
        .setColor(db.theme)
        .setDescription(t(client, db, "created", { id: sent.id, channel: `<#${channel.id}>` })),
    ],
  });
}

async function listEvents(client, message, args, db) {
  const filter = String(args[1] || "upcoming").toLowerCase();
  const query = { guildId: message.guildId };
  let sort = { startAt: 1 };
  if (filter === "past") {
    query.status = { $in: ["ended", "cancelled"] };
    sort = { startAt: -1 };
  } else if (filter === "all") {
    query.status = { $in: ["scheduled", "live", "ended", "cancelled"] };
    sort = { startAt: -1 };
  } else {
    query.status = { $in: ["scheduled", "live"] };
  }
  const events = await Events.find(query).sort(sort).lean();

  if (!events.length) {
    return message.reply({ embeds: [new EmbedBuilder().setColor(db.theme).setDescription(t(client, db, "listEmpty"))] });
  }

  const paginator = new Paginator({ user: message.author.id, client, timeout: 60000 });
  for (let index = 0; index < events.length; index += 5) {
    const chunk = events.slice(index, index + 5);
    const embed = new EmbedBuilder()
      .setColor(db.theme)
      .setTitle(t(client, db, "listTitle"))
      .setFooter({ text: t(client, db, "listFooter", { count: events.length }) });

    for (const event of chunk) {
      embed.addFields({
        name: `${event.title} · <t:${Math.floor(event.startAt / 1000)}:R>`,
        value: [
          t(client, db, "host") + `: <@${event.hostId}>`,
          event.location ? t(client, db, "location") + `: ${event.location}` : null,
          t(client, db, "id") + `: \`${event.messageId}\``,
        ].filter(Boolean).join("\n"),
        inline: false,
      });
    }
    paginator.add(embed);
  }
  return paginator.start(message.channel);
}

async function viewEvent(client, message, args, db) {
  const event = await findEvent(args[1], message.guildId);
  if (!event) return replyError(message, client, db, "notFound");
  const counts = await getEventCounts(event.messageId);
  return message.reply({ embeds: [buildEventEmbed(client, db, event, counts)] });
}

async function whoEvent(client, message, args, db) {
  const event = await findEvent(args[1], message.guildId);
  if (!event) return replyError(message, client, db, "notFound");
  const rsvps = await EventRsvps.find({ eventId: event.messageId }).sort({ createdAt: 1 }).lean();
  if (!rsvps.length) {
    return message.reply({ embeds: [new EmbedBuilder().setColor(db.theme).setDescription(t(client, db, "whoEmpty"))] });
  }

  const paginator = new Paginator({ user: message.author.id, client, timeout: 60000 });
  for (let index = 0; index < rsvps.length; index += 15) {
    const lines = rsvps.slice(index, index + 15).map((rsvp) => {
      const suffix = rsvp.waitlisted ? ` (**${t(client, db, "waitlisted")}**)` : "";
      return `<@${rsvp.userId}> - **${rsvp.response}**${suffix}`;
    });
    paginator.add(new EmbedBuilder()
      .setColor(db.theme)
      .setTitle(t(client, db, "whoTitle", { title: event.title }))
      .setDescription(lines.join("\n"))
      .setFooter({ text: t(client, db, "whoFooter", { count: rsvps.length }) }));
  }
  return paginator.start(message.channel);
}

async function remindEvent(client, message, args, db) {
  const event = await findEvent(args[1], message.guildId);
  if (!event) return replyError(message, client, db, "notFound");
  const member = await getMember(message);
  if (!isAdmin(member, client) && event.hostId !== message.author.id) {
    return replyError(message, client, db, "hostOnly");
  }
  if (event.status === "ended" || event.status === "cancelled") {
    return replyError(message, client, db, "eventClosed");
  }

  const offset = String(args[2] ?? "").trim();
  if (!offset || /^none$/i.test(offset) || /^clear$/i.test(offset)) {
    if (!offset) {
      return message.reply({ content: event.reminders?.length
        ? event.reminders.map((reminder) => `${Math.round(reminder.offsetMs / 60000)}m (${reminder.mode})`).join("\n")
        : t(client, db, "noReminders") });
    }
    event.reminders = [];
    event.updatedAt = Date.now();
    await event.save();
    return message.reply({ content: t(client, db, "remindersCleared") });
  }

  const offsetMs = dhms(offset);
  if (!offsetMs || offsetMs < 60_000) return replyError(message, client, db, "invalidReminders");
  const mode = String(args[3] || "").toLowerCase() === "dm" ? "both" : "channel";
  event.reminders = [
    ...(event.reminders ?? []).filter((reminder) => reminder.offsetMs !== offsetMs),
    { offsetMs, sent: false, mode },
  ];
  event.updatedAt = Date.now();
  await event.save();
  return message.reply({ content: t(client, db, "reminderAdded", { offset }) });
}

async function editEvent(client, message, args, db) {
  const event = await findEvent(args[1], message.guildId);
  if (!event) return replyError(message, client, db, "notFound");
  const member = await getMember(message);
  if (!isAdmin(member, client) && event.hostId !== message.author.id) {
    return replyError(message, client, db, "hostOnly");
  }
  if (event.status === "ended" || event.status === "cancelled") {
    return replyError(message, client, db, "eventClosed");
  }

  const flags = parseFlagMap(splitOptions(args.slice(2).join(" ")));
  const userData = await client.database.getUser(message.author.id, false);
  const draft = buildDraft({
    ...flags,
    _client: client,
    _title: event.title,
    _startAt: event.startAt,
    _endAt: event.endAt,
    _description: event.description,
    _footer: event.footer,
    _location: event.location,
    _imageUrl: event.imageUrl,
    _color: event.color,
    _capacity: event.capacity,
    _waitlistEnabled: event.waitlistEnabled,
    _reminders: event.reminders,
    _pingRoleId: event.pingRoleId,
    _requiredRoleIds: event.requiredRoleIds,
    _rsvpOptions: event.rsvpOptions,
    _recurrence: event.recurrence,
    _dm: (event.reminders ?? []).some((reminder) => reminder.mode === "both"),
  }, message, db, userData?.timezone || event.timezone, Date.now(), { allowPast: true });
  if (draft.error) return replyError(message, client, db, draft.error);

  if (flags.title) draft.title = flags.title.slice(0, 256);
  if (flags.image && !isHttpUrl(flags.image)) {
    return replyError(message, client, db, "invalidImage");
  }

  const oldMessageId = event.messageId;
  const nextChannel = flags.channel
    ? await resolveChannel(client, message, flags.channel)
    : await client.channels.resolve(event.channelId).catch(() => null);
  if (!nextChannel) return replyError(message, client, db, "invalidChannel");
  if (!(await canPost(client, message.guild, nextChannel))) {
    return replyError(message, client, db, "noChannelPerms", { channel: `<#${nextChannel.id}>` });
  }

  const moved = nextChannel.id !== event.channelId;
  if (moved) {
    const fresh = {
      ...event.toObject(),
      ...draft,
      channelId: nextChannel.id,
      messageId: "pending",
    };
    const sent = await nextChannel.send({
      embeds: [buildEventEmbed(client, db, fresh, await getEventCounts(event.messageId))],
    }).catch(() => null);
    if (!sent) return replyError(message, client, db, "sendFailed");

    await EventRsvps.updateMany(
      { eventId: oldMessageId },
      { $set: { eventId: sent.id } }
    );
    await Events.updateOne(
      { _id: event._id },
      { $set: { ...draft, channelId: nextChannel.id, messageId: sent.id, updatedAt: Date.now() } }
    );
    await addEventReactions(sent, { ...event.toObject(), ...draft, messageId: sent.id });
    try {
      const oldChannel = await client.channels.resolve(event.channelId);
      const oldMessage = await oldChannel?.messages?.fetch?.(oldMessageId);
      await oldMessage?.delete?.();
    } catch {}
    return message.reply({
      embeds: [new EmbedBuilder().setColor(db.theme).setDescription(t(client, db, "edited", { id: sent.id }))],
    });
  }

  Object.assign(event, draft, { updatedAt: Date.now() });
  await event.save();
  await updateEventMessage(client, event, db);
  return message.reply({
    embeds: [new EmbedBuilder().setColor(db.theme).setDescription(t(client, db, "edited", { id: event.messageId }))],
  });
}

async function cancelEvent(client, message, args, db) {
  const event = await findEvent(args[1], message.guildId);
  if (!event) return replyError(message, client, db, "notFound");
  const member = await getMember(message);
  if (!isAdmin(member, client) && event.hostId !== message.author.id) {
    return replyError(message, client, db, "hostOnly");
  }
  if (event.status === "ended" || event.status === "cancelled") {
    return replyError(message, client, db, "eventClosed");
  }

  const reason = args.slice(2).join(" ").trim();
  event.status = "cancelled";
  event.updatedAt = Date.now();
  if (reason) event.description = `${event.description || ""}\n\n${t(client, db, "cancelReason", { reason })}`.trim();
  await event.save();
  await updateEventMessage(client, event, db);
  return message.reply({
    embeds: [new EmbedBuilder().setColor(db.theme).setDescription(t(client, db, "cancelledSuccess"))],
  });
}

async function deleteEvent(client, message, args, db) {
  const event = await findEvent(args[1], message.guildId);
  if (!event) return replyError(message, client, db, "notFound");
  const member = await getMember(message);
  if (!isAdmin(member, client) && event.hostId !== message.author.id) {
    return replyError(message, client, db, "hostOnly");
  }

  try {
    const channel = await client.channels.resolve(event.channelId);
    const eventMessage = await channel?.messages?.fetch?.(event.messageId);
    await eventMessage?.delete?.();
  } catch {}
  await removeEventAttendeeRoles(client, event);
  await EventRsvps.deleteMany({ eventId: event.messageId });
  await Events.deleteOne({ _id: event._id });
  return message.reply({
    embeds: [new EmbedBuilder().setColor(db.theme).setDescription(t(client, db, "deleted"))],
  });
}

async function setupEvent(client, message, db) {
  const member = await getMember(message);
  if (!isAdmin(member, client)) return replyError(message, client, db, "adminOnly");
  if (typeof message.channel?.createMessageCollector !== "function") {
    return replyError(message, client, db, "setupUnavailable");
  }

  const prompts = [
    ["title", t(client, db, "setupTitlePrompt")],
    ["when", t(client, db, "setupWhenPrompt")],
    ["desc", t(client, db, "setupDescPrompt")],
    ["end", t(client, db, "setupEndPrompt")],
    ["location", t(client, db, "setupLocationPrompt")],
    ["capacity", t(client, db, "setupCapacityPrompt")],
    ["remind", t(client, db, "setupRemindPrompt")],
    ["extra", t(client, db, "setupExtraPrompt")],
  ];
  const values = {};
  let index = 0;
  let busy = false;
  let finished = false;

  const finish = async () => {
    if (finished) return;
    finished = true;
    const args = [values.title, "|", values.when];
    const add = (value) => {
      if (value && value.toLowerCase() !== "skip") args.push("|", value);
    };
    add(values.desc ? `desc:${values.desc}` : null);
    add(values.end ? `end:${values.end}` : null);
    add(values.location ? `location:${values.location}` : null);
    add(values.capacity ? `capacity:${values.capacity}` : null);
    add(values.remind ? `remind:${values.remind}` : null);
    if (values.extra && values.extra.toLowerCase() !== "skip") {
      args.push("|", ...values.extra.split(/\s+/).filter(Boolean));
    }

    const userData = await client.database.getUser(message.author.id, false);
    const prepared = prepareCreate(args, client, message, db, userData);
    if (prepared.error || prepared.draft.error) {
      return replyError(message, client, db, prepared.draft?.error || prepared.error);
    }

    const eventData = {
      ...prepared.draft,
      title: prepared.draft.title || prepared.title.slice(0, 256),
      hostId: message.author.id,
      status: "scheduled",
      rsvpOptions: prepared.draft.rsvpOptions,
      reminders: prepared.draft.reminders.map((reminder) => ({ ...reminder, sent: false })),
    };
    const preview = await message.channel.send({
      content: t(client, db, "setupPreview"),
      embeds: [buildEventEmbed(client, db, eventData, { going: 0, maybe: 0, declined: 0, waitlist: 0 })],
    }).catch(() => null);
    if (!preview) return;
    await preview.react(client.config.emojis.check).catch(() => {});
    await preview.react(client.config.emojis.cross).catch(() => {});

    const confirm = preview.createReactionCollector({
      filter: (reaction, user) => user?.id === message.author.id &&
        [client.config.emojis.check, client.config.emojis.cross].includes(reaction.emoji?.name),
      time: 60_000,
      max: 1,
    });
    confirm.on("collect", async (reaction) => {
      await preview.removeAllReactions?.().catch(() => {});
      if (reaction.emoji?.name === client.config.emojis.check) {
        await createEvent(client, message, args, db);
      } else {
        await message.channel.send({ content: t(client, db, "setupCancelled") }).catch(() => {});
      }
    });
    confirm.on("end", (_collected, reason) => {
      if (reason === "time") message.channel.send({ content: t(client, db, "setupTimedOut") }).catch(() => {});
    });
  };

  const collector = message.channel.createMessageCollector({
    filter: (msg) => msg.author?.id === message.author.id && !msg.author.bot,
    time: 10 * 60 * 1000,
  });
  collector.on("collect", async (msg) => {
    if (finished || busy) return;
    busy = true;
    try {
      const [key] = prompts[index];
      values[key] = String(msg.content ?? "").trim();
      index++;
      if (index < prompts.length) {
        await message.channel.send({ content: prompts[index][1] }).catch(() => {});
      } else {
        collector.stop("done");
        await finish();
      }
    } finally {
      busy = false;
    }
  });
  collector.on("end", (_collected, reason) => {
    if (reason === "time" && !finished) {
      message.channel.send({ content: t(client, db, "setupTimedOut") }).catch(() => {});
    }
  });

  return message.reply({
    embeds: [
      new EmbedBuilder()
        .setColor(db.theme)
        .setTitle(t(client, db, "setupTitle"))
        .setDescription(`${t(client, db, "setupIntro")}\n\n${prompts[0][1]}`),
    ],
  });
}

module.exports = {
  config: {
    name: "events",
    usage: "help",
    cooldown: 5000,
    category: "events",
    available: true,
    permissions: {},
    aliases: ["event", "rsvp"],
  },

  run: async (client, message, args, db) => {
    const sub = (args[0] || "help").toLowerCase();
    if (sub === "help") {
      return message.reply({ embeds: [buildUsageEmbed(client, db, message.guildId)] });
    }
    if (sub === "create") return args[1] ? createEvent(client, message, args.slice(1), db) : setupEvent(client, message, db);
    if (sub === "setup") return setupEvent(client, message, db);
    if (sub === "preview") return previewEvent(client, message, args.slice(1), db);
    if (sub === "list") return listEvents(client, message, args, db);
    if (sub === "view") return viewEvent(client, message, args, db);
    if (sub === "who") return whoEvent(client, message, args, db);
    if (sub === "edit") return editEvent(client, message, args, db);
    if (sub === "remind") return remindEvent(client, message, args, db);
    if (sub === "cancel") return cancelEvent(client, message, args, db);
    if (sub === "delete") return deleteEvent(client, message, args, db);
    return message.reply({ embeds: [buildUsageEmbed(client, db, message.guildId)] });
  },
};
