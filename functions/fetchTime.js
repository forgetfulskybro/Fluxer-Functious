function fetchTime(ms, client, lang, short=false) {
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
    
  if (short) return `${years ? `${years}y,` : ""} ${days ? `${days}d,` : ""} ${hours ? `${hours}h,` : ""} ${minutes ? `${minutes}m,` : ""} ${seconds}s`;
  return `${years ? `${years} ${client.translate.get(lang, "Functions.fetchTime.years")},` : ""} ${days ? `${days} ${client.translate.get(lang, "Functions.fetchTime.days")},` : ""} ${hours ? `${hours} ${client.translate.get(lang, "Functions.fetchTime.hours")},` : ""} ${minutes ? `${minutes} ${client.translate.get(lang, "Functions.fetchTime.minutes")},` : ""} ${seconds} ${client.translate.get(lang, "Functions.fetchTime.seconds")}`;
}

export default fetchTime;
