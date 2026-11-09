const cron = require("node-cron");
const Events = require("../models/events");
const EventRsvps = require("../models/eventRsvps");
const {
  buildEventEmbed,
  getEventCounts,
  addEventReactions,
  getConfiguredReactions,
  isEventPosted,
  removeEventAttendeeRoles,
} = require("./eventHelpers");

let job = null;
let clientRef = null;
let running = false;

async function resolveMessage(client, event) {
  if (!isEventPosted(event)) return null;
  if (/^(pending|posting):/.test(String(event.messageId ?? ""))) return null;
  try {
    const channel = await client.channels.resolve(event.channelId);
    return (await channel?.messages?.fetch?.(event.messageId)) ?? null;
  } catch {
    return null;
  }
}

async function refreshEventMessage(client, event) {
  const message = await resolveMessage(client, event);
  if (!message) return;
  const db = await client.database.getGuild(event.guildId, false, true).catch(() => null);
  const counts = await getEventCounts(event.messageId);
  await message
    .edit({ embeds: [buildEventEmbed(client, db, event, counts)] })
    .catch(() => {});
}

async function claimDueReminders(event, reminders) {
  const offsets = [...new Set(reminders.map((reminder) => reminder.offsetMs))];
  if (!offsets.length) return false;

  const result = await Events.updateOne(
    {
      _id: event._id,
      status: { $in: ["scheduled", "live"] },
      reminders: {
        $elemMatch: {
          offsetMs: { $in: offsets },
          sent: { $ne: true },
        },
      },
    },
    {
      $set: {
        "reminders.$[entry].sent": true,
        updatedAt: Date.now(),
      },
    },
    {
      arrayFilters: [{
        "entry.offsetMs": { $in: offsets },
        "entry.sent": { $ne: true },
      }],
    }
  );

  return (result.modifiedCount ?? 0) > 0;
}

async function markEventLive(event, now) {
  return Events.findOneAndUpdate(
    {
      _id: event._id,
      status: "scheduled",
      startAt: { $lte: now },
    },
    {
      $set: {
        status: "live",
        updatedAt: now,
      },
    },
    { returnDocument: "after" }
  ).catch(() => null);
}

async function sendEventStarted(client, event) {
  const db = await client.database.getGuild(event.guildId, false, true).catch(() => null);
  const channel = await client.channels.resolve(event.channelId).catch(() => null);
  if (!channel) return;

  const content = client.translate.get(db?.language ?? "en_EN", "Commands.events.started", {
    title: event.title,
  });
  const ping = event.pingRoleId ? `<@&${event.pingRoleId}> ` : "";

  await channel.send({
    content: `${ping}${content}`.slice(0, 2000),
    allowedMentions: { parse: event.pingRoleId ? ["roles"] : [] },
  }).catch(() => {});
}

async function sendEventEnded(client, event) {
  const db = await client.database.getGuild(event.guildId, false, true).catch(() => null);
  const channel = await client.channels.resolve(event.channelId).catch(() => null);
  if (!channel) return;

  const content = client.translate.get(db?.language ?? "en_EN", "Commands.events.endedAnnouncement", {
    title: event.title,
  });
  const ping = event.pingRoleId ? `<@&${event.pingRoleId}> ` : "";

  await channel.send({
    content: `${ping}${content}`.slice(0, 2000),
    allowedMentions: { parse: event.pingRoleId ? ["roles"] : [] },
  }).catch(() => {});
}

async function clearEventReactions(client, event) {
  const message = await resolveMessage(client, event);
  if (!message) return;
  for (const emoji of getConfiguredReactions(event)) {
    await message.removeReactionEmoji?.(emoji).catch(() => {});
  }
}

async function sendReminder(client, event, reminder) {
  const db = await client.database.getGuild(event.guildId, false, true).catch(() => null);
  const base = client.translate.get(db?.language ?? "en_EN", "Commands.events.reminder", {
    title: event.title,
    when: `<t:${Math.floor(event.startAt / 1000)}:R>`,
  });
  const custom = String(reminder.message ?? "").trim();
  const content = custom ? `${base}\n${custom}`.slice(0, 2000) : base;

  if (reminder.mode === "channel" || reminder.mode === "both") {
    try {
      const channel = await client.channels.resolve(event.channelId);
      await channel?.send({
        content: content.slice(0, 2000),
        allowedMentions: { parse: [] },
      });
    } catch {}
  }

  if (reminder.mode === "dm" || reminder.mode === "both") {
    const rsvps = await EventRsvps.find({
      eventId: event.messageId,
      response: "going",
      waitlisted: false,
    }).lean();

    for (const rsvp of rsvps) {
      try {
        const user = client.users?.get?.(rsvp.userId);
        const dm = await user?.createDM?.();
        await dm?.send({ content: content.slice(0, 2000), allowedMentions: { parse: [] } });
      } catch {}
    }
  }
}

function nextRecurrenceStart(startAt, frequency) {
  const date = new Date(startAt);
  if (frequency === "daily") date.setUTCDate(date.getUTCDate() + 1);
  else if (frequency === "weekly") date.setUTCDate(date.getUTCDate() + 7);
  else if (frequency === "monthly") date.setUTCMonth(date.getUTCMonth() + 1);
  else return null;
  return date.getTime();
}

async function postScheduledEvent(client, event) {
  const marker = `posting:${event._id}`;
  const claimed = await Events.findOneAndUpdate(
    {
      _id: event._id,
      postedAt: null,
      postAt: { $lte: Date.now() },
      messageId: /^pending:/,
    },
    { $set: { messageId: marker } },
    { returnDocument: "after" }
  ).catch(() => null);
  if (!claimed) return null;

  const channel = await client.channels.resolve(claimed.channelId).catch(() => null);
  const db = await client.database.getGuild(claimed.guildId, false, true).catch(() => null);
  if (!channel) {
    await Events.updateOne(
      { _id: claimed._id, messageId: marker },
      { $set: { messageId: event.messageId } }
    ).catch(() => {});
    return null;
  }

  const sent = await channel.send({
    embeds: [buildEventEmbed(client, db, claimed, { going: 0, maybe: 0, declined: 0, waitlist: 0 })],
  }).catch(() => null);
  if (!sent) {
    await Events.updateOne(
      { _id: claimed._id, messageId: marker },
      { $set: { messageId: event.messageId } }
    ).catch(() => {});
    return null;
  }

  const updated = await Events.findOneAndUpdate(
    { _id: claimed._id, messageId: marker },
    { $set: { messageId: sent.id, postedAt: Date.now(), updatedAt: Date.now() } },
    { returnDocument: "after" }
  ).catch(() => null);
  if (!updated) {
    await sent.delete?.().catch(() => {});
    await Events.updateOne(
      { _id: claimed._id, messageId: marker },
      { $set: { messageId: event.messageId } }
    ).catch(() => {});
    return null;
  }

  await addEventReactions(sent, updated);
  return updated;
}

async function spawnRecurringEvent(client, event) {
  const recurrence = event.recurrence;
  if (!recurrence?.frequency || recurrence.spawnedAt || recurrence.completed) return;
  if (event.status !== "ended") return;

  const nextStart = nextRecurrenceStart(event.startAt, recurrence.frequency);
  if (!nextStart) return;
  if (recurrence.until && nextStart > recurrence.until) {
    event.recurrence = { ...recurrence, completed: true };
    await event.save().catch(() => {});
    return;
  }

  const channel = await client.channels.resolve(event.channelId).catch(() => null);
  if (!channel) return;
  const db = await client.database.getGuild(event.guildId, false, true).catch(() => null);
  const duration = event.endAt ? event.endAt - event.startAt : null;
  const copy = event.toObject();
  delete copy._id;
  delete copy.__v;
  copy.messageId = "pending";
  copy.startAt = nextStart;
  copy.endAt = duration ? nextStart + duration : null;
  copy.status = "scheduled";
  copy.postAt = null;
  copy.postedAt = Date.now();
  if (copy.signupCutoffAt) copy.signupCutoffAt += nextStart - event.startAt;
  copy.createdAt = Date.now();
  copy.updatedAt = Date.now();
  copy.reminders = (event.reminders ?? []).map((reminder) => ({ ...reminder, sent: false }));
  copy.recurrence = { frequency: recurrence.frequency, until: recurrence.until ?? null };

  const sent = await channel.send({
    embeds: [buildEventEmbed(client, db, copy, { going: 0, maybe: 0, declined: 0, waitlist: 0 })],
  }).catch(() => null);
  if (!sent) return;
  copy.messageId = sent.id;
  const created = await Events.create(copy).catch(() => null);
  if (!created) {
    await sent.delete?.().catch(() => {});
    return;
  }
  await addEventReactions(sent, created);
  event.recurrence = { ...recurrence, spawnedAt: Date.now() };
  await event.save().catch(() => {});
}

async function processEvent(client, event) {
  const now = Date.now();
  const endReached = Boolean(event.endAt && event.endAt <= now);
  let changed = false;
  let started = false;
  let ended = false;

  if (event.postAt && event.postedAt == null) {
    if (event.postAt > now) return;
    const posted = await postScheduledEvent(client, event);
    if (!posted) return;
    event = posted;
  }

  if (event.status === "scheduled" && event.startAt <= now && !endReached) {
    const live = await markEventLive(event, now);
    if (!live) return;
    event.status = "live";
    event.updatedAt = now;
    changed = true;
    started = true;
  }

  if (endReached && event.status !== "ended" && event.status !== "cancelled") {
    event.status = "ended";
    changed = true;
    ended = true;
  }

  if (started) await sendEventStarted(client, event);

  if (event.status !== "scheduled" && event.status !== "live") {
    if (changed) {
      event.updatedAt = now;
      await event.save().catch(() => {});
      await refreshEventMessage(client, event);
    }
    if (event.status === "ended") {
      if (ended) {
        await sendEventEnded(client, event);
        await clearEventReactions(client, event);
      }
      await spawnRecurringEvent(client, event);
      if (ended) await removeEventAttendeeRoles(client, event);
    }
    return;
  }

  let remindersChanged = false;
  const dueReminders = (event.reminders ?? []).filter(
    (reminder) => !reminder.sent && now < event.startAt && now >= event.startAt - reminder.offsetMs
  );

  if (dueReminders.length && await claimDueReminders(event, dueReminders)) {
    for (const reminder of dueReminders) reminder.sent = true;
    remindersChanged = true;
    const reminderToSend = dueReminders.reduce((nearest, reminder) =>
      reminder.offsetMs < nearest.offsetMs ? reminder : nearest
    );
    await sendReminder(client, event, reminderToSend);
  }

  if (changed || remindersChanged) {
    event.updatedAt = now;
    await event.save().catch(() => {});
    await refreshEventMessage(client, event);
  }
}

async function restoreEventReactions(client) {
  try {
    const events = await Events.find({
      status: { $in: ["scheduled", "live"] },
    });
    for (const event of events) {
      if (!isEventPosted(event)) continue;
      const message = await resolveMessage(client, event);
      if (message) await addEventReactions(message, event);
    }
  } catch (err) {
    console.error("[Events] Reaction restore error:", err.message);
  }
}

async function checkEvents(client) {
  if (running || !client) return;
  running = true;
  try {
    const events = await Events.find({
      status: { $in: ["scheduled", "live"] },
    });
    for (const event of events) {
      await processEvent(client, event);
    }
  } catch (err) {
    console.error("[Events] Scheduler error:", err.message);
  } finally {
    running = false;
  }
}

function startEventCron(client) {
  clientRef = client;
  if (job) job.stop();
  job = cron.schedule("* * * * *", () => {
    checkEvents(clientRef).catch(() => {});
  });
  checkEvents(clientRef).catch(() => {});
  restoreEventReactions(clientRef).catch(() => {});
}

function stopEventCron() {
  if (job) job.stop();
  job = null;
  clientRef = null;
}

module.exports = {
  startEventCron,
  stopEventCron,
  checkEvents,
  processEvent,
  postScheduledEvent,
  nextRecurrenceStart,
  spawnRecurringEvent,
  restoreEventReactions,
};
