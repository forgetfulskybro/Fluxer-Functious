const SIMILARITY_THRESHOLD = 0.75;
const EXACT_TOKEN_THRESHOLD = 5;
const TOKEN_WEIGHT = 0.65;
const TRIGRAM_WEIGHT = 0.35;
const CONTAINMENT_BASE = 0.75;
const CONTAINMENT_RATIO = 0.2;
const FINGERPRINT_MAX_LENGTH = 500;
const SAMPLE_MAX_LENGTH = 120;
const MIN_MATCH_TOKENS = 3;
const MIN_MATCH_CHARS = 8;
const MAX_EMBEDS = 3;
const MAX_EMBED_FIELDS = 10;
const MAX_ATTACHMENTS = 10;

const URL_REGEX = /https?:\/\/\S+/g;
const CUSTOM_EMOJI_REGEX = /<a?:\d+:\d+>/g;
const MENTION_REGEX = /<@[!&]?\d+>/g;
const CHANNEL_MENTION_REGEX = /<#\d+>/g;
const PUNCTUATION_REGEX = /[^\p{L}\p{N}\s]/gu;
const SPACE_REGEX = /\s+/g;

function normalizeText(text) {
  if (!text) return "";
  let value = String(text).toLowerCase();
  value = value.replace(URL_REGEX, " ");
  value = value.replace(CUSTOM_EMOJI_REGEX, " ");
  value = value.replace(MENTION_REGEX, " ");
  value = value.replace(CHANNEL_MENTION_REGEX, " ");
  value = value.replace(PUNCTUATION_REGEX, " ");
  value = value.replace(SPACE_REGEX, " ");
  return value.trim();
}

function tokenize(text) {
  const tokens = [];
  for (const token of String(text || "").split(" ")) {
    if (token.length >= 2) tokens.push(token);
  }
  return tokens;
}

function buildTrigrams(text) {
  const set = new Set();
  const value = String(text || "");
  if (!value) return set;
  if (value.length < 3) {
    set.add(value);
    return set;
  }
  for (let i = 0; i <= value.length - 3; i++) set.add(value.slice(i, i + 3));
  return set;
}

function dice(a, b) {
  if (!a || !b || a.size === 0 || b.size === 0) return 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let shared = 0;
  for (const value of small) {
    if (large.has(value)) shared += 1;
  }
  return (2 * shared) / (a.size + b.size);
}

function containmentRatio(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) {
    return Math.min(a.length, b.length) / Math.max(a.length, b.length);
  }
  return 0;
}

function attachmentList(message) {
  const attachments = message?.attachments;
  if (!attachments) return [];
  if (typeof attachments.values === "function") return [...attachments.values()];
  if (Array.isArray(attachments)) return attachments;
  return [attachments];
}

function attachNames(message) {
  const names = [];
  for (const attachment of attachmentList(message).slice(0, MAX_ATTACHMENTS)) {
    if (!attachment) continue;
    const raw = attachment.name || attachment.filename || "";
    if (!raw) continue;
    const dot = raw.lastIndexOf(".");
    const base = dot > 0 ? raw.slice(0, dot) : raw;
    const cleaned = normalizeText(base);
    if (cleaned) names.push(cleaned);
  }
  return [...new Set(names)];
}

function buildFingerprint(message) {
  const parts = [];
  if (message?.content) parts.push(message.content);

  const embeds = Array.isArray(message?.embeds) ? message.embeds : [];
  for (const embed of embeds.slice(0, MAX_EMBEDS)) {
    if (!embed) continue;
    if (embed.title) parts.push(embed.title);
    if (embed.description) parts.push(embed.description);
    if (Array.isArray(embed.fields)) {
      for (const field of embed.fields.slice(0, MAX_EMBED_FIELDS)) {
        if (field?.name) parts.push(field.name);
        if (field?.value) parts.push(field.value);
      }
    }
  }

  for (const name of attachNames(message)) parts.push(name);

  return normalizeText(parts.join(" ")).slice(0, FINGERPRINT_MAX_LENGTH);
}

function buildSample(message) {
  const raw = message?.content || "";
  if (raw) return raw.slice(0, SAMPLE_MAX_LENGTH);
  const embeds = Array.isArray(message?.embeds) ? message.embeds : [];
  for (const embed of embeds) {
    if (embed?.description) return String(embed.description).slice(0, SAMPLE_MAX_LENGTH);
    if (embed?.title) return String(embed.title).slice(0, SAMPLE_MAX_LENGTH);
  }
  const names = attachNames(message);
  return names.length > 0 ? names.join(", ").slice(0, SAMPLE_MAX_LENGTH) : "";
}

function detectSourceType(message) {
  if (message?.content) return "content";
  const embeds = Array.isArray(message?.embeds) ? message.embeds : [];
  if (embeds.length > 0) return "embed";
  if (attachNames(message).length > 0) return "attachment";
  return "content";
}

function isMatchable(fingerprint, attachmentNames) {
  if (Array.isArray(attachmentNames) && attachmentNames.length > 0) return true;
  const tokens = tokenize(fingerprint);
  if (tokens.length >= MIN_MATCH_TOKENS) return true;
  return String(fingerprint || "").length >= MIN_MATCH_CHARS;
}

function createProfile(fingerprint, attachmentNames) {
  const normalized = normalizeText(fingerprint).slice(0, FINGERPRINT_MAX_LENGTH);
  const tokens = tokenize(normalized);
  const names = Array.isArray(attachmentNames) ? attachmentNames : [];
  return {
    fingerprint: normalized,
    tokens: new Set(tokens),
    significant: new Set(tokens.filter((token) => token.length >= 3)),
    trigrams: buildTrigrams(normalized),
    attachmentNames: names,
  };
}

function sharesSignal(saved, candidate) {
  if (!saved || !candidate) return false;
  if (saved.attachmentNames.length > 0) {
    const candidateNames = new Set(candidate.attachmentNames);
    if (saved.attachmentNames.some((name) => candidateNames.has(name))) return true;
    if (saved.tokens.size === 0) return false;
  }
  for (const token of candidate.significant) {
    if (saved.significant.has(token)) return true;
  }
  return false;
}

function scoreProfiles(saved, candidate) {
  if (!saved || !candidate) return 0;
  if (!saved.fingerprint && saved.attachmentNames.length === 0) return 0;

  if (saved.attachmentNames.length > 0) {
    const candidateNames = new Set(candidate.attachmentNames);
    const shared = saved.attachmentNames.filter((name) => candidateNames.has(name));
    if (saved.tokens.size === 0) return shared.length === saved.attachmentNames.length ? 1 : 0;
    if (shared.length === 0) return 0;
  }

  if (!saved.fingerprint || !candidate.fingerprint) return 0;
  if (saved.fingerprint === candidate.fingerprint) return 1;
  if (saved.tokens.size < EXACT_TOKEN_THRESHOLD || candidate.tokens.size < EXACT_TOKEN_THRESHOLD) return 0;

  const base =
    TOKEN_WEIGHT * dice(saved.tokens, candidate.tokens) +
    TRIGRAM_WEIGHT * dice(saved.trigrams, candidate.trigrams);

  const ratio = containmentRatio(saved.fingerprint, candidate.fingerprint);
  if (ratio > 0) return Math.max(base, CONTAINMENT_BASE + CONTAINMENT_RATIO * ratio);
  return base;
}

module.exports = {
  SIMILARITY_THRESHOLD,
  FINGERPRINT_MAX_LENGTH,
  SAMPLE_MAX_LENGTH,
  normalizeText,
  tokenize,
  buildTrigrams,
  dice,
  containmentRatio,
  attachNames,
  buildFingerprint,
  buildSample,
  detectSourceType,
  isMatchable,
  createProfile,
  sharesSignal,
  scoreProfiles,
};
