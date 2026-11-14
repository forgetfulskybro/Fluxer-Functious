function parseTriggerContent(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "message" || normalized === "messages" || normalized === "text") {
    return "messages";
  }
  if (normalized === "embed" || normalized === "embeds") {
    return "embeds";
  }
  if (normalized === "both" || normalized === "all") {
    return "both";
  }
  return null;
}

function normalizeTriggerContent(value) {
  return parseTriggerContent(value) ?? "both";
}

function allowsBotTrigger(tag) {
  return tag?.triggerBots !== false;
}

module.exports = {
  parseTriggerContent,
  normalizeTriggerContent,
  allowsBotTrigger,
};
