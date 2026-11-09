const { EmbedBuilder } = require("@fluxerjs/core");
const dhms = require("./dhms");
const { reactionKey } = require("./syncReactions");
const { getTimeZoneParts, zonedTimeToUtc } = require("./communityBirthday");
const EventRsvps = require("../models/eventRsvps");
const Events = require("../models/events");
const { dashboardHelpText } = require("./dashboardHelp");

const RELATIVE_DURATION = /^(?:\d+(?:\.\d+)?[smhdw])+$/i;
const ISO_LIKE = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{1,2}):(\d{2}))?$/;
const TIMESTAMP = /^<t:(\d+)(?::[tTdDfFR])?>$/;

function isHttpUrl(value) {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function parseEventWhen(input, timezone = "UTC", now = Date.now()) {
  if (!input || typeof input !== "string") return null;
  const text = input.trim();
  if (!text) return null;

  const timestamp = text.match(TIMESTAMP);
  if (timestamp) {
    const value = Number(timestamp[1]) * 1000;
    return Number.isFinite(value) ? value : null;
  }

  if (RELATIVE_DURATION.test(text)) {
    const duration = dhms(text);
    return duration > 0 ? now + duration : null;
  }

  if (/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:?\d{2})$/i.test(text)) {
    const value = Date.parse(text);
    return Number.isFinite(value) ? value : null;
  }

  const match = text.match(ISO_LIKE);
  if (match) {
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const hour = match[4] != null ? Number(match[4]) : 0;
    const minute = match[5] != null ? Number(match[5]) : 0;
    if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) {
      return null;
    }
    try {
      return zonedTimeToUtc(year, month, day, hour, minute, timezone || "UTC");
    } catch {
      return null;
    }
  }

  return null;
}

function parseEventEnd(input, timezone, startAt) {
  if (!input || !startAt) return null;
  if (RELATIVE_DURATION.test(input.trim())) {
    const duration = dhms(input.trim());
    return duration > 0 ? startAt + duration : null;
  }
  return parseEventWhen(input, timezone);
}

function parseColor(value) {
  if (typeof value !== "string") return null;
  const color = value.trim();
  return /^#?[0-9a-f]{6}$/i.test(color)
    ? (color.startsWith("#") ? color : `#${color}`)
    : null;
}

function formatTimestamp(timestamp, style = "f") {
  if (!timestamp) return "-";
  return `<t:${Math.floor(timestamp / 1000)}:${style}>`;
}

function localDateForEvent(event) {
  if (!event?.startAt) return null;
  try {
    return getTimeZoneParts(new Date(event.startAt), event.timezone || "UTC");
  } catch {
    return null;
  }
}

function getRsvpOptions(event) {
  const options = event?.rsvpOptions ?? {};
  return {
    going: {
      emoji: options.going?.emoji || "✅",
      label: options.going?.label || "Going",
    },
    maybe: {
      emoji: options.maybe?.emoji || "❔",
      label: options.maybe?.label || "Maybe",
      enabled: options.maybe?.enabled !== false,
    },
    declined: {
      emoji: options.declined?.emoji || "❌",
      label: options.declined?.label || "Not going",
      enabled: options.declined?.enabled !== false,
    },
  };
}

function getConfiguredReactions(event) {
  const options = getRsvpOptions(event);
  return [
    options.going.emoji,
    options.maybe.enabled ? options.maybe.emoji : null,
    options.declined.enabled ? options.declined.emoji : null,
  ].filter(Boolean);
}

function renderEventTemplate(text, event, counts = {}) {
  const requirements = (event.requiredRoleIds ?? []).map((id) => `<@&${id}>`).join(", ");
  const data = {
    title: event.title ?? "",
    host: event.hostId ? `<@${event.hostId}>` : "",
    start: formatTimestamp(event.startAt, "f"),
    end: event.endAt ? formatTimestamp(event.endAt, "f") : "",
    location: event.location ?? "",
    capacity: event.capacity ?? "∞",
    going: counts.going ?? 0,
    waitlist: counts.waitlist ?? 0,
    requirements,
  };
  return String(text ?? "").replace(/\{(\w+)\}/g, (match, key) =>
    Object.prototype.hasOwnProperty.call(data, key) ? String(data[key]) : match
  );
}

function getMemberHasAnyRole(member, roleIds) {
  if (!Array.isArray(roleIds) || roleIds.length === 0) return true;
  if (!member) return false;
  if (Array.isArray(member.roles)) {
    return roleIds.some((roleId) =>
      member.roles.some((role) => (typeof role === "string" ? role : role?.id) === roleId)
    );
  }
  if (Array.isArray(member.roles?.roleIds)) {
    return roleIds.some((roleId) => member.roles.roleIds.includes(roleId));
  }
  return roleIds.some((roleId) => member.roles?.has?.(roleId) === true);
}

function isEventPosted(event) {
  return !event?.postAt || event?.postedAt != null;
}

async function getEventMember(client, event, userId) {
  const guild = client.guilds?.get?.(event.guildId) ?? null;
  if (!guild) return null;
  try {
    return guild.members?.get?.(userId) ??
      await guild.members?.resolve?.(userId) ??
      null;
  } catch {
    return null;
  }
}

async function userHasOtherAttendeeEvent(event, userId, roleId) {
  if (!roleId) return false;
  const events = await Events.find({
    _id: { $ne: event._id },
    guildId: event.guildId,
    attendeeRoleId: roleId,
    status: { $in: ["scheduled", "live"] },
  }).select("messageId").lean().catch(() => []);
  const eventIds = events.map((entry) => entry.messageId).filter(Boolean);
  if (!eventIds.length) return false;
  const rsvp = await EventRsvps.exists({
    eventId: { $in: eventIds },
    userId,
    response: "going",
    waitlisted: false,
  }).catch(() => null);
  return Boolean(rsvp);
}

async function addAttendeeRole(client, event, userId) {
  if (!event?.attendeeRoleId) return;
  const member = await getEventMember(client, event, userId);
  if (!member) return;
  try {
    await member.roles.add(event.attendeeRoleId);
  } catch {}
}

async function removeAttendeeRole(client, event, userId, roleId = event?.attendeeRoleId) {
  if (!roleId) return;
  if (await userHasOtherAttendeeEvent(event, userId, roleId)) return;
  const member = await getEventMember(client, event, userId);
  if (!member) return;
  try {
    await member.roles.remove(roleId);
  } catch {}
}

async function removeEventAttendeeRoles(client, event) {
  if (!event?.attendeeRoleId || !event.messageId) return;
  const rsvps = await EventRsvps.find({
    eventId: event.messageId,
    response: "going",
    waitlisted: false,
  }).lean().catch(() => []);
  for (const rsvp of rsvps) {
    await removeAttendeeRole(client, event, rsvp.userId);
  }
}

async function syncEventAttendeeRoles(client, event, previousRoleId) {
  if ((previousRoleId ?? null) === (event.attendeeRoleId ?? null)) return;
  if (!event.messageId) return;
  const rsvps = await EventRsvps.find({
    eventId: event.messageId,
    response: "going",
    waitlisted: false,
  }).lean().catch(() => []);
  for (const rsvp of rsvps) {
    if (previousRoleId) {
      await removeAttendeeRole(
        client,
        { ...event, attendeeRoleId: previousRoleId },
        rsvp.userId,
        previousRoleId
      );
    }
    if (event.attendeeRoleId) {
      await addAttendeeRole(client, event, rsvp.userId);
    }
  }
}

async function getEventCounts(eventId) {
  const [going, maybe, declined, waitlist] = await Promise.all([
    EventRsvps.countDocuments({ eventId, response: "going", waitlisted: false }),
    EventRsvps.countDocuments({ eventId, response: "maybe" }),
    EventRsvps.countDocuments({ eventId, response: "declined" }),
    EventRsvps.countDocuments({ eventId, response: "going", waitlisted: true }),
  ]);
  return { going, maybe, declined, waitlist };
}

function buildEventEmbed(client, db, event, counts = {}) {
  const options = getRsvpOptions(event);
  const language = db?.language || "en_EN";
  const theme = db?.theme || "#A52F05";
  const t = (key, vars) => client.translate.get(language, `Commands.events.${key}`, vars);
  const embed = new EmbedBuilder()
    .setColor(event.color || theme)
    .setTitle(String(event.title || t("untitled")).slice(0, 256));

  if (event.description) {
    embed.setDescription(renderEventTemplate(event.description, event, counts).slice(0, 4096));
  }

  embed.addFields({
    name: t("host"),
    value: `<@${event.hostId}>`,
    inline: true,
  });

  embed.addFields({
    name: t("schedule"),
    value: [
      `**${t("starts")}:** ${formatTimestamp(event.startAt, "F")} (${formatTimestamp(event.startAt, "R")})`,
      event.endAt
        ? `**${t("ends")}:** ${formatTimestamp(event.endAt, "F")} (${formatTimestamp(event.endAt, "R")})`
        : null,
    ].filter(Boolean).join("\n"),
    inline: false,
  });

  if (event.location) {
    embed.addFields({
      name: t("location"),
      value: String(event.location).slice(0, 1024),
      inline: false,
    });
  }

  const capacity = event.capacity
    ? t("capacityValue", {
        going: counts.going ?? 0,
        capacity: event.capacity,
        waitlist: counts.waitlist ?? 0,
      })
    : t("capacityUnlimited", { going: counts.going ?? 0 });

  embed.addFields({
    name: t("attendance"),
    value: [
      `${options.going.emoji} ${options.going.label}: **${counts.going ?? 0}**`,
      options.maybe.enabled ? `${options.maybe.emoji} ${options.maybe.label}: **${counts.maybe ?? 0}**` : null,
      options.declined.enabled ? `${options.declined.emoji} ${options.declined.label}: **${counts.declined ?? 0}**` : null,
      capacity,
    ].filter(Boolean).join("\n"),
    inline: false,
  });

  if (event.requiredRoleIds?.length) {
    embed.addFields({
      name: t("requirements"),
      value: event.requiredRoleIds.map((id) => `<@&${id}>`).join(", ").slice(0, 1024),
      inline: false,
    });
  }

  if (event.attendeeRoleId) {
    embed.addFields({
      name: t("attendeeRole"),
      value: `<@&${event.attendeeRoleId}>`,
      inline: true,
    });
  }

  if (event.signupCutoffAt) {
    embed.addFields({
      name: t("signupsClose"),
      value: formatTimestamp(event.signupCutoffAt, "F"),
      inline: true,
    });
  }

  if (event.status === "cancelled") {
    embed.addFields({
      name: t("status"),
      value: t("cancelled"),
      inline: false,
    });
  } else if (event.status === "ended") {
    embed.addFields({
      name: t("status"),
      value: t("ended"),
      inline: false,
    });
  } else if (event.status === "live") {
    embed.addFields({
      name: t("status"),
      value: t("live"),
      inline: false,
    });
  }

  const reactionLine = getConfiguredReactions(event)
    .map((emoji) => `${emoji} ${emoji === options.going.emoji ? options.going.label : emoji === options.maybe.emoji ? options.maybe.label : options.declined.label}`)
    .join("   ");

  const footer = event.footer
    ? renderEventTemplate(event.footer, event, counts)
    : event.status === "scheduled" || event.status === "live"
      ? t("rsvpFooter", { reactions: reactionLine })
      : t("endedFooter");
  embed.setFooter({ text: footer.slice(0, 2048) });

  if (isHttpUrl(event.imageUrl)) embed.setImage(event.imageUrl);
  return embed;
}

async function updateEventMessage(client, event, db) {
  if (!event?.messageId) return false;
  try {
    const guildDb = db ?? await client.database.getGuild(event.guildId, false, true);
    const channel = await client.channels.resolve(event.channelId).catch(() => null);
    const message = await channel?.messages?.fetch?.(event.messageId).catch(() => null);
    if (!message) return false;
    const counts = await getEventCounts(event.messageId);
    await message.edit({ embeds: [buildEventEmbed(client, guildDb, event, counts)] });
    return true;
  } catch {
    return false;
  }
}

async function addEventReactions(message, event) {
  for (const emoji of getConfiguredReactions(event)) {
    await message.react(emoji).catch(() => {});
  }
}

function getReactionKey(reaction) {
  if (!reaction?.emoji) return null;
  return reaction.emoji.id
    ? reactionKey(`${reaction.emoji.name}:${reaction.emoji.id}`)
    : reactionKey(reaction.emoji.name);
}

function resolveRsvpResponse(event, emojiKey) {
  const options = getRsvpOptions(event);
  const candidates = [
    ["going", options.going.emoji],
    ["maybe", options.maybe.enabled ? options.maybe.emoji : null],
    ["declined", options.declined.enabled ? options.declined.emoji : null],
  ];
  for (const [response, emoji] of candidates) {
    if (emoji && reactionKey(emoji) === emojiKey) return response;
  }
  return null;
}

function buildUsageEmbed(client, db, guildId) {
  const t = (key, vars) => client.translate.get(db.language, `Commands.events.${key}`, vars);
  return new EmbedBuilder()
    .setColor(db.theme)
    .setTitle(t("helpTitle"))
    .setDescription(
      [
        `**${t("createTitle")}**`,
        `\`${db.prefix}events create <title> | <when> | [flags]\``,
        t("createHelp"),
        "",
        `**${t("flagsTitle")}**`,
        "`desc:` `footer:` `channel:` `end:` `tz:` `location:` `capacity:` `waitlist:` `remind:` `dm:` `ping:` `require:` `image:` `color:` `going:` `maybe:` `declined:` `goinglabel:` `maybelabel:` `declinedlabel:` `repeat:` `repeatuntil:`",
        `**${t("templateHelp")}**`,
        "",
        `**${t("otherTitle")}**`,
        `\`${db.prefix}events setup\``,
        `\`${db.prefix}events preview <title> | <when> | [flags]\``,
        `\`${db.prefix}events list [upcoming|past|all]\``,
        `\`${db.prefix}events view <messageId>\``,
        `\`${db.prefix}events who <messageId>\``,
        `\`${db.prefix}events edit <messageId> <flags>\``,
        `\`${db.prefix}events cancel <messageId> [reason]\``,
        `\`${db.prefix}events remind <messageId> <offset|none> [dm]\``,
        `\`${db.prefix}events delete <messageId>\``,
        "",
        t("whenHelp"),
        "",
        dashboardHelpText(client, db, guildId, "events"),
      ].join("\n")
    );
}

module.exports = {
  RELATIVE_DURATION,
  ISO_LIKE,
  isHttpUrl,
  parseEventWhen,
  parseEventEnd,
  parseColor,
  formatTimestamp,
  localDateForEvent,
  getRsvpOptions,
  getConfiguredReactions,
  renderEventTemplate,
  getMemberHasAnyRole,
  isEventPosted,
  addAttendeeRole,
  removeAttendeeRole,
  removeEventAttendeeRoles,
  syncEventAttendeeRoles,
  getEventCounts,
  buildEventEmbed,
  updateEventMessage,
  addEventReactions,
  getReactionKey,
  resolveRsvpResponse,
  buildUsageEmbed,
};
