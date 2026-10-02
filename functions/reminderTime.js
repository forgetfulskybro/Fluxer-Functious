const chrono = require("chrono-node");

const timeRegex =
  /(?:(?<months>\d+)mo)?(?:(?<weeks>\d+)w)?(?:(?<days>\d+)d)?(?:(?<hours>\d+)h)?(?:(?<minutes>\d+)m)?(?:(?<seconds>\d+)s)?/i;

function parseRelative(txt) {
  if (!txt) return false;
  txt = txt.trim();

  let time = 0;
  let currentTxt = txt;

  if (/^\d+$/.test(currentTxt)) {
    time += parseInt(currentTxt, 10);
  } else {
    const firstWord = currentTxt.split(/\s+/)[0];
    if (/^\d+$/.test(firstWord)) {
      const s = firstWord;
      time += parseInt(s, 10);
      currentTxt = currentTxt.slice(currentTxt.indexOf(s) + s.length);
    } else {
      const match = timeRegex.exec(currentTxt);
      if (!match || !match[0]) return false;

      const g = match.groups || {};
      if (g.months) time += parseInt(g.months, 10) * 2592000;
      if (g.weeks) time += parseInt(g.weeks, 10) * 604800;
      if (g.days) time += parseInt(g.days, 10) * 86400;
      if (g.hours) time += parseInt(g.hours, 10) * 3600;
      if (g.minutes) time += parseInt(g.minutes, 10) * 60;
      if (g.seconds) time += parseInt(g.seconds, 10);

      currentTxt = currentTxt.replace(timeRegex, "");
    }
  }

  let text = currentTxt;
  if (text && text[0] === " ") text = text.slice(1);
  text = text.trim();

  return { time, text };
}

function parseTimeTz(inputText, userTimezone) {
  if (!userTimezone) {
    return chrono.parse(inputText, new Date(), { forwardDate: true });
  }

  try {
    const now = new Date();
    const offsetMinutes = -Math.round(
      (now.getTime() -
       new Date(now.toLocaleString("en-US", { timeZone: userTimezone })).getTime())
      / 60000
    );

    const reference = {
      instant: now,
      timezone: offsetMinutes
    };

    return chrono.parse(inputText, reference, {
      forwardDate: true
    });
  } catch (e) {
    return chrono.parse(inputText, new Date(), { forwardDate: true });
  }
}

function parseTime(inputText, timezone) {
  const parsedResults = parseTimeTz(inputText, timezone);

  if (parsedResults && parsedResults.length > 0) {
    const parsedResult = parsedResults[0];
    const parsedDate = parsedResult.start.date();
    const timestamp = Math.floor(parsedDate.getTime() / 1000);
    const timeText = parsedResult.text;
    const beforeTime = inputText.substring(0, parsedResult.index).trim();
    const afterTime = inputText
      .substring(parsedResult.index + timeText.length)
      .trim();
    const reminderMessage = beforeTime ? (beforeTime + " " + afterTime).trim() : afterTime;
    return { timestamp, reminderMessage };
  }

  const relativeResult = parseRelative(inputText);
  if (relativeResult && relativeResult.time > 0) {
    const now = Math.floor(Date.now() / 1000);
    return {
      timestamp: now + relativeResult.time,
      reminderMessage: relativeResult.text,
    };
  }

  return null;
}

function parseWatchTime(inputText, timezone) {
  const parsed = parseTime(inputText, timezone);
  if (!parsed) return null;
  return {
    timestamp: Number(parsed.timestamp),
    reminderMessage: parsed.reminderMessage || "",
  };
}

async function parseTimeForUser(inputText, userId, client) {
  const userData = await client.database.getUser(userId, false);
  return parseTime(inputText, userData?.timezone);
}

module.exports = {
  timeRegex,
  parseRelative,
  parseTimeTz,
  parseTime,
  parseWatchTime,
  parseTimeForUser,
};
