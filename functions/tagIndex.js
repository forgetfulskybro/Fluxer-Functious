const GuildModel = require("../models/guilds");
const color = require("./colorCodes");
const { executeTag } = require("./tagExecution");

const guildIndex = new Map();

function normalizeTag(raw) {
  if (!raw) return null;
  const tag = raw.toObject ? raw.toObject() : raw;
  if (!tag?.name) return null;
  return {
    id: tag.id,
    name: String(tag.name),
    type: tag.type,
    content: tag.content ?? null,
    embedData: tag.embedData ?? null,
    createdBy: tag.createdBy ?? null,
    createdAt: tag.createdAt ?? null,
    uses: tag.uses || 0,
    trigger: tag.trigger === true,
    anyTrigger: tag.anyTrigger === true,
  };
}

function buildEntry(guild) {
  if (!guild) return null;

  const tags = new Map();
  const anyTags = new Map();
  for (const raw of guild.tags || []) {
    const tag = normalizeTag(raw);
    if (!tag) continue;
    if (tag.anyTrigger) anyTags.set(tag.name.toLowerCase(), tag);
    else if (tag.trigger) tags.set(tag.name.toLowerCase(), tag);
  }

  return {
    allowBots: guild.tagTriggerBots === true,
    tags,
    anyTags,
  };
}

function setGuild(guildId, guild) {
  if (!guildId) return null;
  const entry = buildEntry(guild);
  if (!entry || (entry.tags.size === 0 && entry.anyTags.size === 0)) {
    guildIndex.delete(guildId);
    return null;
  }
  guildIndex.set(guildId, entry);
  return entry;
}

function removeGuild(guildId) {
  if (!guildId) return false;
  return guildIndex.delete(guildId);
}

function getEntry(guildId) {
  if (!guildId) return null;
  return guildIndex.get(guildId) || null;
}

function findTag(guildId, name) {
  const entry = getEntry(guildId);
  if (!entry) return null;
  const key = String(name).toLowerCase();
  return entry.tags.get(key) || entry.anyTags.get(key) || null;
}

async function refreshGuild(client, guildId) {
  if (!guildId) return null;
  try {
    const guild =
      (await client?.database?.getGuild(guildId, false, true)) ??
      (await GuildModel.findOne({ id: guildId }));

    return setGuild(guildId, guild);
  } catch {
    return null;
  }
}

async function loadIndex(client) {
  guildIndex.clear();

  try {
    const guilds = await GuildModel.find({
      $or: [{ "tags.trigger": true }, { "tags.anyTrigger": true }],
    }).lean();
    let count = 0;

    for (const guild of guilds) {
      const entry = setGuild(guild.id, guild);
      if (entry) count += entry.tags.size + entry.anyTags.size;
    }

    console.log(
      color("%", `%2[Tags]%7 :: Loaded ${count} trigger word(s)`),
    );
    return count;
  } catch (err) {
    console.log(
      color("%", `%4[Tags]%7 :: Failed to load trigger words :: ${err}`),
    );
    return 0;
  }
}

function hasCommandConflict(client, name) {
  const lower = String(name).toLowerCase();
  if (client?.commands?.has?.(lower)) return true;
  const alias = client?.aliases?.get?.(lower);
  return Boolean(alias && client?.commands?.has?.(alias));
}

function isDm(message) {
  if (!message?.guildId) return true;
  const type = message?.channel?.type;
  return type === 1 || type === 3;
}

function isWordChar(char) {
  return Boolean(char) && /[a-z0-9_]/i.test(char);
}

function containsTagName(content, name) {
  const haystack = String(content).toLowerCase();
  const needle = String(name).toLowerCase().trim();
  if (!needle) return false;

  let index = haystack.indexOf(needle);
  while (index !== -1) {
    const before = haystack[index - 1];
    const after = haystack[index + needle.length];
    const startsClean = !isWordChar(needle[0]) || !isWordChar(before);
    const endsClean =
      !isWordChar(needle[needle.length - 1]) || !isWordChar(after);

    if (startsClean && endsClean) return true;
    index = haystack.indexOf(needle, index + 1);
  }

  return false;
}

function embedTextParts(message) {
  const embeds = message?.embeds
    ? [...(message.embeds.values?.() ?? message.embeds)]
    : [];
  const parts = [];

  for (const embed of embeds) {
    if (!embed) continue;

    if (embed.title) parts.push(String(embed.title));
    if (embed.description) parts.push(String(embed.description));
    if (embed.author?.name) parts.push(String(embed.author.name));
    if (embed.provider?.name) parts.push(String(embed.provider.name));
    if (embed.footer?.text) parts.push(String(embed.footer.text));

    const fields = Array.isArray(embed.fields)
      ? embed.fields
      : embed.fields?.values?.()
        ? [...embed.fields.values()]
        : [];
    for (const field of fields) {
      if (field?.name) parts.push(String(field.name));
      if (field?.value) parts.push(String(field.value));
    }
  }

  return parts.map((part) => part.trim()).filter(Boolean);
}

async function checkTagMessage(client, message, db = null) {
  if (!client || !message) return false;
  if (isDm(message)) return false;
  if (message.author?.id && message.author.id === client.user?.id) return false;

  const content = String(message.content ?? "").trim();

  let guildData = db;
  if (!guildData) {
    guildData = await client.database.getGuild(message.guildId, true).catch(() => null);
  }
  if (!guildData) return false;

  let entry = getEntry(message.guildId);
  if (!entry) {
    entry = setGuild(message.guildId, guildData);
  }
  if (!entry) return false;

  const isBot = message.author?.bot === true;
  if (isBot && !entry.allowBots) return false;

  const embedParts = isBot ? embedTextParts(message) : [];
  if (!content && embedParts.length === 0) return false;

  const prefix = guildData.prefix || "f!";
  if (content.startsWith(prefix)) return false;

  if (client.user?.id) {
    const mentionRegex = new RegExp(`^(<@!?${client.user.id}>)`);
    if (mentionRegex.test(content)) return false;
  }

  const liveTags = Array.isArray(guildData.tags) ? guildData.tags : [];
  const ranTags = new Set();
  const tagKey = (tag) => String(tag.id || tag.name).toLowerCase();

  const runTag = async (tag, anywhere) => {
    const liveTag =
      liveTags.find(
        (item) =>
          (item?.id && tag.id && item.id === tag.id) ||
          String(item?.name || "").toLowerCase() === tag.name.toLowerCase(),
      ) || tag;

    if (anywhere ? liveTag.anyTrigger !== true : liveTag.trigger !== true) {
      return false;
    }

    if (ranTags.has(tagKey(tag))) return false;

    try {
      await executeTag(client, message, guildData, liveTag, []);
    } catch (err) {
      console.log(
        color("%", `%4[Tags]%7 :: Failed to run trigger word "${tag.name}" :: ${err}`),
      );
      return false;
    }

    ranTags.add(tagKey(tag));
    return true;
  };

  let ran = false;
  const exactCandidates = [...new Set([content, ...embedParts])];

  for (const candidate of exactCandidates) {
    if (!candidate || /\s/.test(candidate)) continue;

    const tag = entry.tags.get(candidate.toLowerCase());
    if (tag && !hasCommandConflict(client, candidate)) {
      ran = (await runTag(tag, false)) || ran;
    }
  }

  for (const tag of entry.anyTags.values()) {
    const matched =
      containsTagName(content, tag.name) ||
      embedParts.some((part) => containsTagName(part, tag.name));
    if (!matched) continue;

    ran = (await runTag(tag, true)) || ran;
  }

  return ran;
}

function size() {
  let total = 0;
  for (const entry of guildIndex.values()) total += entry.tags.size + entry.anyTags.size;
  return total;
}

module.exports = {
  loadIndex,
  refreshGuild,
  setGuild,
  removeGuild,
  getEntry,
  findTag,
  checkTagMessage,
  size,
};
