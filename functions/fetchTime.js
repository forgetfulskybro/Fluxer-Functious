function fetchTime(ms, client, lang, short=false, minimal=false) {
  var totalSeconds = (ms / 1000);
  let years = Math.floor(totalSeconds / 31536000);
  totalSeconds %= 31536000;
  let days = Math.floor(totalSeconds / 86400);
  totalSeconds %= 86400;
  let hours = Math.floor(totalSeconds / 3600);
  totalSeconds %= 3600;
  let minutes = Math.floor(totalSeconds / 60);
  let seconds = totalSeconds % 60;
  seconds = Math.floor(seconds);
  
  const yearStr = client.translate.get(lang, "Functions.fetchTime.years");
  const dayStr = client.translate.get(lang, "Functions.fetchTime.days");
  const hourStr = client.translate.get(lang, "Functions.fetchTime.hours");
  const minuteStr = client.translate.get(lang, "Functions.fetchTime.minutes");
  const secondStr = client.translate.get(lang, "Functions.fetchTime.seconds");
  
  if (minimal) {
    if (years) return `${years} ${yearStr}${years > 1 ? 's' : ''}`;
    if (days) return `${days} ${dayStr}${days > 1 ? 's' : ''}`;
    if (hours) return `${hours} ${hourStr}${hours > 1 ? 's' : ''}`;
    if (minutes) return `${minutes} ${minuteStr}${minutes > 1 ? 's' : ''}`;
    return `${seconds} ${secondStr}${seconds > 1 ? 's' : ''}`;
  }
  
  if (short) {
    const parts = [];
    if (years) parts.push(`${years}y`);
    if (days) parts.push(`${days}d`);
    if (hours) parts.push(`${hours}h`);
    if (minutes) parts.push(`${minutes}m`);
    parts.push(`${seconds}s`);
    return parts.join(', ');
  }
  
  
  return `${years ? `${years} ${yearStr}${years > 1 ? 's' : ''},` : ""} ${days ? `${days} ${dayStr}${days > 1 ? 's' : ''},` : ""} ${hours ? `${hours} ${hourStr}${hours > 1 ? 's' : ''},` : ""} ${minutes ? `${minutes} ${minuteStr}${minutes > 1 ? 's' : ''},` : ""} ${seconds} ${secondStr}${seconds > 1 ? 's' : ''}`;
}

module.exports = fetchTime;