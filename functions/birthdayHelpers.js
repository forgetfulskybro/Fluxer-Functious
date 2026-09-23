const { EmbedBuilder } = require("@fluxerjs/core");

const MONTH_DAYS = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function getMonthName(index, client, lang) {
  return client.translate.get(lang, `Commands.birthday.months.${index}`);
}

function ordinal(n, client, lang) {
  const s = ["th", "st", "nd", "rd"].map((k) => client.translate.get(lang, `Commands.birthday.ordinals.${k}`));
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function validDay(month, day) {
  return day >= 1 && day <= MONTH_DAYS[month - 1];
}

function nextBirthdayTimestamp(month, day, timezone) {
  const tz = timezone || "UTC";
  const now = new Date();

  for (let yearOffset = 0; yearOffset <= 1; yearOffset++) {
    const year = now.getFullYear() + yearOffset;
    try {
      const localNow = new Date(now.toLocaleString("en-US", { timeZone: tz }));
      const birthdayLocal = new Date(year, month - 1, day, 0, 0, 0, 0);
      const tzOffsetMs = now.getTime() - localNow.getTime();
      const birthdayUTC = new Date(birthdayLocal.getTime() + tzOffsetMs);
      if (birthdayUTC.getTime() > now.getTime()) {
        return Math.floor(birthdayUTC.getTime() / 1000);
      }
    } catch {
      const bd = new Date(now.getFullYear() + yearOffset, month - 1, day, 0, 0, 0);
      if (bd.getTime() > now.getTime()) return Math.floor(bd.getTime() / 1000);
    }
  }

  const bd = new Date(now.getFullYear() + 1, month - 1, day, 0, 0, 0);
  return Math.floor(bd.getTime() / 1000);
}

function resolveBirthdayText(client, db, member, userData) {
  const lang = db.language;
  const bday = userData.birthday ?? {};
  const hasAge = bday.age != null;
  const template = (hasAge ? db.birthdayMessageWithAge : db.birthdayMessageNoAge) || "";
  const trimmed = template.trim();

  const userName = member?.displayName || member?.user?.username || client.translate.get(lang, "Commands.birthday.member");
  const ageText = hasAge ? ordinal(bday.age + 1, client, lang) : "";

  if (!trimmed) return { custom: false, userName, ageText };

  return {
    custom: true,
    userName,
    ageText,
    text: trimmed
      .replace(/\{user\}/gi, userName)
      .replace(/\{age\}/gi, ageText),
  };
}

function buildBirthdayAnnouncement(client, db, member, userData, guildName) {
  const lang = db.language;
  const { custom, text, userName, ageText } = resolveBirthdayText(client, db, member, userData);

  const embed = new EmbedBuilder()
    .setColor(db.theme)
    .setTitle(client.translate.get(lang, "Commands.birthday.announceTitle"))
    .setAuthor({
      name: userName,
      iconURL: member?.user?.displayAvatarURL?.({ size: 128 }) || undefined,
    });

  if (custom) {
    embed.setDescription(text);
  } else {
    embed.setDescription(
      client.translate.get(lang, "Commands.birthday.announceDesc", {
        age: ageText ? `**${ageText}** ` : "",
        guild: guildName ?? client.translate.get(lang, "Commands.birthday.server"),
      })
    );
  }

  return { custom, embed };
}

module.exports = {
  EmbedBuilder,
  MONTH_DAYS,
  getMonthName,
  ordinal,
  validDay,
  nextBirthdayTimestamp,
  buildBirthdayAnnouncement,
};