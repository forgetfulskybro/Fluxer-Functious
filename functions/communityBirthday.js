const { EmbedBuilder } = require("@fluxerjs/core");
const { getMonthName, ordinal } = require("./birthdayHelpers");

const DEFAULT_TIMEZONE = "UTC";
const MONTH_DAYS = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function isLeapYear(year) {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function normalizeCommunityBirthday(value) {
  const config = value && typeof value === "object" ? value : {};
  return {
    month: Number.isInteger(config.month) ? config.month : null,
    day: Number.isInteger(config.day) ? config.day : null,
    year: Number.isInteger(config.year) ? config.year : null,
    enabled: config.enabled === true,
    channelId: config.channelId || null,
    roleId: config.roleId || null,
    ping: config.ping === true,
    message: typeof config.message === "string" && config.message.trim() ? config.message : null,
    timezone: typeof config.timezone === "string" && config.timezone.trim()
      ? config.timezone
      : DEFAULT_TIMEZONE,
    lastAnnouncedYear: Number.isInteger(config.lastAnnouncedYear)
      ? config.lastAnnouncedYear
      : null,
  };
}

function getTimeZoneParts(date, timeZone = DEFAULT_TIMEZONE) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timeZone || DEFAULT_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });

  const parts = formatter.formatToParts(date);
  const get = (type) => Number(parts.find((part) => part.type === type)?.value ?? 0);

  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second"),
  };
}

function getTimeZoneOffsetMs(date, timeZone) {
  const parts = getTimeZoneParts(date, timeZone);
  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second
  );
  return asUtc - date.getTime();
}

function zonedTimeToUtc(year, month, day, hour = 0, minute = 0, timeZone = DEFAULT_TIMEZONE) {
  const guess = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  const firstOffset = getTimeZoneOffsetMs(new Date(guess), timeZone);
  let result = guess - firstOffset;
  const secondOffset = getTimeZoneOffsetMs(new Date(result), timeZone);
  if (secondOffset !== firstOffset) result = guess - secondOffset;
  return result;
}

function validCommunityDate(month, day) {
  return Number.isInteger(month) && month >= 1 && month <= 12 &&
    Number.isInteger(day) && day >= 1 && day <= MONTH_DAYS[month - 1];
}

function getGuildCreationDate(guild, timezone = DEFAULT_TIMEZONE) {
  const timestamp = Number(guild?.createdTimestamp);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return null;

  try {
    const { year, month, day } = getTimeZoneParts(
      new Date(timestamp),
      timezone || DEFAULT_TIMEZONE
    );
    if (!validCommunityDate(month, day)) return null;
    return { month, day, year };
  } catch {
    return null;
  }
}

function communityDateForYear(year, month, day) {
  if (month === 2 && day === 29 && !isLeapYear(year)) return { month: 2, day: 28 };
  return { month, day };
}

function nextCommunityBirthdayTimestamp(month, day, timezone = DEFAULT_TIMEZONE, after = Date.now()) {
  if (!validCommunityDate(month, day)) return null;
  const timeZone = timezone || DEFAULT_TIMEZONE;
  const now = new Date(after);
  const local = getTimeZoneParts(now, timeZone);

  for (let offset = 0; offset <= 2; offset++) {
    const year = local.year + offset;
    const target = communityDateForYear(year, month, day);
    const timestamp = zonedTimeToUtc(year, target.month, target.day, 0, 0, timeZone);
    if (timestamp > after) return timestamp;
  }

  return null;
}

function isCommunityBirthdayToday(config, now = Date.now()) {
  const normalized = normalizeCommunityBirthday(config);
  if (!normalized.month || !normalized.day) return false;
  const local = getTimeZoneParts(new Date(now), normalized.timezone);
  const target = communityDateForYear(local.year, normalized.month, normalized.day);
  return local.month === target.month && local.day === target.day;
}

function communityBirthdayYear(config, now = Date.now()) {
  const normalized = normalizeCommunityBirthday(config);
  if (!normalized.year) return null;
  const local = getTimeZoneParts(new Date(now), normalized.timezone);
  return Math.max(0, local.year - normalized.year);
}

function formatCommunityDate(client, db, config) {
  const normalized = normalizeCommunityBirthday(config);
  if (!normalized.month || !normalized.day) return null;
  return `${ordinal(normalized.day, client, db.language)} ${getMonthName(
    normalized.month - 1,
    client,
    db.language
  )}`;
}

function applyCommunityPlaceholders(text, data) {
  return String(text).replace(/\{(\w+)\}/g, (match, key) =>
    Object.prototype.hasOwnProperty.call(data, key) ? String(data[key]) : match
  );
}

function buildCommunityBirthdayEmbed(client, db, guild, config, now = Date.now()) {
  const normalized = normalizeCommunityBirthday(config);
  const date = formatCommunityDate(client, db, normalized);
  if (!date) return null;

  const years = communityBirthdayYear(normalized, now);
  const guildName = guild?.name || client.translate.get(db.language, "Commands.birthday.server");
  const memberCount = guild?.members?.size ?? 0;

  const title = client.translate.get(db.language, "Commands.birthday.serverAnnounceTitle", {
    guild: guildName,
  });

  const defaultDescription = years != null
    ? client.translate.get(db.language, "Commands.birthday.serverAnnounceDesc", {
        guild: guildName,
        years,
        date,
      })
    : client.translate.get(db.language, "Commands.birthday.serverAnnounceDescNoYear", {
        guild: guildName,
        date,
      });

  const description = normalized.message
    ? applyCommunityPlaceholders(normalized.message, {
        server: guildName,
        community: guildName,
        guild: guildName,
        years: years ?? "",
        date,
        memberCount,
      })
    : defaultDescription;

  const embed = new EmbedBuilder()
    .setColor(db.theme)
    .setTitle(title)
    .setDescription(description.slice(0, 4096));

  if (years != null) {
    embed.addFields({
      name: client.translate.get(db.language, "Commands.birthday.serverYears"),
      value: String(years),
      inline: true,
    });
  }

  embed.addFields({
    name: client.translate.get(db.language, "Commands.birthday.serverDate"),
    value: date,
    inline: true,
  });

  return embed;
}

function buildCommunityBirthdayPayload(client, db, guild, config, now = Date.now()) {
  const normalized = normalizeCommunityBirthday(config);
  const embed = buildCommunityBirthdayEmbed(client, db, guild, normalized, now);
  if (!embed) return null;

  const content = normalized.ping && normalized.roleId
    ? `<@&${normalized.roleId}>`
    : undefined;

  return {
    payload: {
      embeds: [embed],
      ...(content ? { content } : {}),
      allowedMentions: { parse: content ? ["roles"] : [] },
    },
    config: normalized,
  };
}

module.exports = {
  DEFAULT_TIMEZONE,
  MONTH_DAYS,
  isLeapYear,
  normalizeCommunityBirthday,
  getTimeZoneParts,
  zonedTimeToUtc,
  validCommunityDate,
  getGuildCreationDate,
  communityDateForYear,
  nextCommunityBirthdayTimestamp,
  isCommunityBirthdayToday,
  communityBirthdayYear,
  formatCommunityDate,
  applyCommunityPlaceholders,
  buildCommunityBirthdayEmbed,
  buildCommunityBirthdayPayload,
};
