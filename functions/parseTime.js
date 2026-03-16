// chrono-node

function parseTime(input, tz = "America/New_York") {
  if (!input || typeof input !== 'string') return null;

  const now = new Date();
  const timeRegex = /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i;
  const match = input.match(timeRegex);
  if (!match) return null;

  let hours = parseInt(match[1], 10);
  const minutes = match[2] ? parseInt(match[2], 10) : 0;
  const period = match[3] ? match[3].toLowerCase() : null;

  if (isNaN(hours) || hours > 23 || minutes > 59) return null;
  if (period === 'pm' && hours < 12) hours += 12;
  if (period === 'am' && hours === 12) hours = 0;

  const currentFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  });

  const currentParts = currentFormatter.formatToParts(now);
  const getPart = (type) => parseInt(
    currentParts.find(p => p.type === type)?.value ?? '0',
    10
  );

  let currYear = getPart('year');
  let currMonth = getPart('month') - 1;
  let currDay = getPart('day');
  let currHour = getPart('hour');
  let currMinute = getPart('minute');

  let targetYear = currYear;
  let targetMonth = currMonth;
  let targetDay = currDay;
  let targetHour = hours;
  let targetMinute = minutes;

  const currentMinutesOfDay = currHour * 60 + currMinute;
  const targetMinutesOfDay = targetHour * 60 + targetMinute;

  if (targetMinutesOfDay <= currentMinutesOfDay) {
    const nextDay = new Date(Date.UTC(targetYear, targetMonth, targetDay + 1));
    targetYear = nextDay.getUTCFullYear();
    targetMonth = nextDay.getUTCMonth();
    targetDay = nextDay.getUTCDate();
  }

  const approxDate = new Date(
    Date.UTC(targetYear, targetMonth, targetDay, targetHour, targetMinute, 0, 0)
  );

  const offsetFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    timeZoneName: 'shortOffset',
  });
  const offsetParts = offsetFormatter.formatToParts(approxDate);
  const tzOffsetStr = offsetParts.find(p => p.type === 'timeZoneName')?.value ?? 'GMT';

  let tzOffsetMinutes = 0;
  const matchOffset = tzOffsetStr.match(/^GMT([+-])?(\d{1,2})(?::(\d{2}))?$/);
  if (matchOffset) {
    const sign = matchOffset[1] === '-' ? -1 : 1;
    const hoursOffset = parseInt(matchOffset[2], 10);
    const minsOffset = matchOffset[3] ? parseInt(matchOffset[3], 10) : 0;
    const rawOffsetHours = sign * hoursOffset + (sign * minsOffset) / 60;
    tzOffsetMinutes = -rawOffsetHours * 60;
  }

  const realMs = approxDate.getTime() + tzOffsetMinutes * 60 * 1000;
  const epoch = Math.floor(realMs / 1000);

  const start = match.index;
  const end = start + match[0].length;
  const timestamp = `<t:${epoch}:t>`;

  const messageText =
    input.slice(0, start) +
    timestamp +
    input.slice(end);

  return {
    timestamp: epoch,
    message: messageText.trim() || null,
  };
}

module.exports = parseTime;