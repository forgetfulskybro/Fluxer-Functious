const { EmbedBuilder } = require("@fluxerjs/core");
const { runTagSafe } = require("../interpreter/index");
const { toFluxerEmbed } = require("./tagExecution");
const { processTemplate } = require("./scheduleTemplateEngine");

const STICKY_DELAY = 2500;
const MIN_STICKY_DELAY = 1000;
const MAX_STICKY_DELAY = 60000;
const MAX_STICKIES = 10;
const STICKY_MENTION_POLICIES = ["none", "users", "roles", "everyone"];

const timers = new Map();
const sending = new Set();

function normalizeStickyDelay(value) {
  const delay = Number(value);
  if (!Number.isFinite(delay)) return STICKY_DELAY;
  return Math.min(MAX_STICKY_DELAY, Math.max(MIN_STICKY_DELAY, Math.round(delay)));
}

function normalizeMentionPolicy(value) {
  return STICKY_MENTION_POLICIES.includes(value) ? value : "none";
}

function stickyAllowedMentions(value) {
  const policy = normalizeMentionPolicy(value);
  if (policy === "users") return ["users"];
  if (policy === "roles") return ["roles"];
  if (policy === "everyone") return ["users", "roles", "everyone"];
  return [];
}

function isValidHttpUrl(value) {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function processField(value, context, templateContext) {
  if (!value || typeof value !== "string") return value ?? "";

  let output = value;
  const result = runTagSafe(value, context);
  if (result.ok && typeof result.result.text === "string" && result.result.text.trim()) {
    output = result.result.text;
  }

  if (templateContext) {
    try {
      output = processTemplate(output, { ...templateContext });
    } catch {}
  }

  return output;
}

function buildStickyTemplateContext(guild, channel, sticky, triggerMessage) {
  const authorId = triggerMessage?.author?.id ?? sticky.createdBy;
  const member =
    triggerMessage?.member ??
    (authorId ? guild?.members?.get?.(authorId) ?? null : null);
  const author = triggerMessage?.author ?? member?.user ?? null;
  const username =
    member?.displayName ??
    author?.globalName ??
    author?.global_name ??
    author?.username ??
    String(authorId ?? "Unknown");

  const community = guild?.name ?? "Unknown Community";

  return {
    community,
    server: community,
    members: guild?.members?.size ?? 0,
    channel: `<#${channel?.id ?? sticky.channelId}>`,
    user: authorId ? `<@${authorId}>` : username,
    username,
    time: new Date().toLocaleString(),
    timestamp: Math.floor(Date.now() / 1000),
    count: (sticky.sendCount || 0) + 1,
  };
}

function buildStickyContext(guild, channel, sticky, triggerMessage) {
  const authorId = triggerMessage?.author?.id ?? sticky.createdBy;
  const member =
    triggerMessage?.member ??
    (authorId ? guild?.members?.get?.(authorId) ?? null : null);
  const author = triggerMessage?.author ?? member?.user ?? null;
  const username =
    member?.displayName ??
    author?.globalName ??
    author?.global_name ??
    author?.username ??
    String(authorId ?? "Unknown");
  const channelId = channel?.id ?? sticky.channelId;
  const attachments = triggerMessage?.attachments
    ? [...(triggerMessage.attachments.values?.() ?? triggerMessage.attachments)]
    : [];
  const createdAt = triggerMessage?.createdTimestamp
    ? new Date(triggerMessage.createdTimestamp).toISOString()
    : new Date().toISOString();
  const count = (sticky.sendCount || 0) + 1;

  return {
    args: [],
    user: {
      id: author?.id ?? authorId ?? null,
      username: author?.username ?? username,
      discriminator: author?.discriminator ?? "0",
      tag: `${author?.username ?? username}#${author?.discriminator ?? "0"}`,
      display_name: username,
      global_name: author?.globalName ?? author?.global_name ?? username,
      avatar: author?.avatar ?? null,
      avatar_url: null,
      banner: null,
      bot: Boolean(author?.bot),
      system: Boolean(author?.system),
      created_at: author?.createdTimestamp
        ? new Date(author.createdTimestamp).toISOString()
        : null,
    },
    channel: {
      id: channelId,
      name: channel?.name ?? "unknown",
      type: channel?.type ?? 0,
      guild_id: guild?.id ?? "",
      position: channel?.position ?? 0,
      topic: channel?.topic ?? null,
      nsfw: Boolean(channel?.nsfw),
      mention: `<#${channelId}>`,
      rate_limit: 0,
      created_at: null,
    },
    message: {
      id: triggerMessage?.id ?? null,
      content: triggerMessage?.content ?? "",
      author_id: author?.id ?? authorId ?? null,
      author: {
        id: author?.id ?? authorId ?? null,
        username: author?.username ?? username,
      },
      channel_id: channelId,
      guild_id: guild?.id ?? "",
      created_at: createdAt,
      edited_timestamp: null,
      mentions: triggerMessage?.mentions
        ? [...(triggerMessage.mentions.values?.() ?? triggerMessage.mentions)]
        : [],
      mention_roles: triggerMessage?.mentionRoles
        ? [...triggerMessage.mentionRoles]
        : [],
      mention_everyone: Boolean(triggerMessage?.mentionEveryone),
      attachments,
      embeds: triggerMessage?.embeds
        ? [...(triggerMessage.embeds.values?.() ?? triggerMessage.embeds)]
        : [],
      pinned: Boolean(triggerMessage?.pinned),
      tts: Boolean(triggerMessage?.tts),
      webhook_id: triggerMessage?.webhookId ?? null,
      type: triggerMessage?.type ?? 0,
      flags: triggerMessage?.flags ?? 0,
      url: triggerMessage?.url ?? null,
    },
    guild: guild
      ? {
          id: guild.id,
          name: guild.name,
          icon: guild.icon ?? null,
          icon_url: null,
          banner: null,
          banner_url: null,
          description: null,
          owner_id: guild.ownerId ?? null,
          features: [],
          premium_tier: 0,
          member_count: guild.members?.size ?? 0,
          preferred_locale: "en-US",
          created_at: null,
        }
      : null,
    server: guild?.name ?? "Unknown Server",
    community: guild?.name ?? "Unknown Community",
    members: guild?.members?.size ?? 0,
    time: new Date().toLocaleString(),
    timestamp: Math.floor(Date.now() / 1000),
    count,
    sticky: {
      channel: `<#${channelId}>`,
      type: sticky.type,
      count,
    },
  };
}

function buildStickyEmbed(embedData, context, templateContext, fallbackColor) {
  const data = embedData ?? {};
  const embed = new EmbedBuilder();

  if (data.title) {
    embed.setTitle(
      String(processField(data.title, context, templateContext)).slice(0, 256)
    );
  }
  if (data.description) {
    embed.setDescription(
      String(processField(data.description, context, templateContext)).slice(0, 4096)
    );
  }

  const color = data.color || fallbackColor;
  if (color) {
    try {
      embed.setColor(color);
    } catch {
      if (fallbackColor) {
        try {
          embed.setColor(fallbackColor);
        } catch {}
      }
    }
  }

  if (data.footer?.text) {
    const footerText = String(
      processField(data.footer.text, context, templateContext)
    ).slice(0, 2048);
    const footerIcon = data.footer.iconURL
      ? processField(data.footer.iconURL, context, templateContext)
      : null;
    embed.setFooter({
      text: footerText,
      iconURL: isValidHttpUrl(footerIcon) ? footerIcon : undefined,
    });
  }

  if (data.image) {
    const image = processField(data.image, context, templateContext);
    if (isValidHttpUrl(image)) embed.setImage(image);
  }

  if (data.thumbnail) {
    const thumbnail = processField(data.thumbnail, context, templateContext);
    if (isValidHttpUrl(thumbnail)) embed.setThumbnail(thumbnail);
  }

  if (data.author?.name) {
    const name = String(
      processField(data.author.name, context, templateContext)
    ).slice(0, 256);
    const iconURL = data.author.iconURL
      ? processField(data.author.iconURL, context, templateContext)
      : null;
    const url = data.author.url
      ? processField(data.author.url, context, templateContext)
      : null;
    embed.setAuthor({
      name,
      iconURL: isValidHttpUrl(iconURL) ? iconURL : undefined,
      url: isValidHttpUrl(url) ? url : undefined,
    });
  }

  if (data.url) {
    const url = processField(data.url, context, templateContext);
    if (isValidHttpUrl(url)) embed.setURL(url);
  }

  if (data.useTimestamp) embed.setTimestamp();

  return embed;
}

function renderStickyPayload(guild, channel, sticky, triggerMessage, fallbackColor) {
  try {
    const context = buildStickyContext(guild, channel, sticky, triggerMessage);
    const templateContext = buildStickyTemplateContext(
      guild,
      channel,
      sticky,
      triggerMessage
    );

    if (sticky.type === "script") {
      const result = runTagSafe(sticky.content ?? "", context);
      if (!result.ok) return { error: result.error };

      const payload = {};
      const text = String(result.result.text ?? "").trim();
      if (text) payload.content = text.slice(0, 2000);

      const embeds = (result.result.embeds ?? [])
        .slice(0, 10)
        .map((embed) => {
          try {
            return toFluxerEmbed(embed);
          } catch {
            return null;
          }
        })
        .filter(Boolean);

      if (embeds.length) payload.embeds = embeds;
      if (!payload.content && !payload.embeds?.length) return { empty: true };
      return { payload };
    }

    if (sticky.type === "embed") {
      const embed = buildStickyEmbed(
        sticky.embedData,
        context,
        templateContext,
        fallbackColor
      );
      return { payload: { embeds: [embed] } };
    }

    const processed = String(
      processField(sticky.content ?? "", context, templateContext)
    ).trim();
    if (!processed) return { empty: true };
    return { payload: { content: processed.slice(0, 2000) } };
  } catch (error) {
    return { error };
  }
}

async function resolveGuild(client, guildId) {
  try {
    const cached = client.guilds?.get?.(guildId);
    if (cached) return cached;
    return (await client.guilds?.fetch?.(guildId)) ?? null;
  } catch {
    return null;
  }
}

async function resolveChannel(client, guildId, channelId) {
  try {
    const cached = client.channels?.resolve?.(channelId);
    if (cached) return cached;
    const guild = await resolveGuild(client, guildId);
    return (await guild?.channels?.fetch?.(channelId)) ?? null;
  } catch {
    return null;
  }
}

async function updateStickyRecord(client, guildId, stickyId, patch) {
  const db = await client.database.getGuild(guildId, false, true);
  const list = Array.isArray(db?.stickies) ? db.stickies : [];
  const index = list.findIndex((sticky) => sticky.id === stickyId);
  if (index === -1) return null;

  const updated = { ...list[index], ...patch };
  const next = [...list];
  next[index] = updated;
  await client.database.updateGuild(guildId, { stickies: next });
  return updated;
}

async function deleteStickyMessage(client, guildId, sticky) {
  if (!sticky?.stickyMessageId) return;
  const channel = await resolveChannel(client, guildId, sticky.channelId);
  if (!channel) return;

  try {
    const message = await channel.messages.fetch(sticky.stickyMessageId);
    await message.delete();
  } catch {}
}

async function postSticky(client, guildId, stickyId, triggerMessage = null) {
  if (!stickyId) return { ok: false };
  if (sending.has(stickyId)) return { ok: false, busy: true };

  sending.add(stickyId);
  try {
    const guild = await resolveGuild(client, guildId);
    if (!guild) return { ok: false, error: new Error("Guild not found") };

    const db = await client.database.getGuild(guildId, false, true);
    const sticky = (db?.stickies ?? []).find((entry) => entry.id === stickyId);
    if (!sticky) return { ok: false, error: new Error("Sticky not found") };
    if (sticky.enabled === false) return { ok: false, disabled: true };

    clearStickyTimer(sticky.channelId);

    const channel = await resolveChannel(client, guildId, sticky.channelId);
    if (!channel) return { ok: false, error: new Error("Channel not found") };

    const rendered = renderStickyPayload(
      guild,
      channel,
      sticky,
      triggerMessage,
      db?.theme
    );

    if (rendered.error) {
      console.error(
        `[Sticky] Failed to render sticky ${stickyId}:`,
        rendered.error?.message ?? rendered.error
      );
      return { ok: false, error: rendered.error };
    }
    if (!rendered.payload) return { ok: false, empty: true };

    if (sticky.stickyMessageId) {
      try {
        const previous = await channel.messages.fetch(sticky.stickyMessageId);
        await previous.delete();
      } catch {}
    }

    const sent = await channel.send({
      ...rendered.payload,
      allowedMentions: { parse: stickyAllowedMentions(sticky.mentionPolicy) },
    });

    const updated = await updateStickyRecord(client, guildId, stickyId, {
      stickyMessageId: sent.id,
      sendCount: (sticky.sendCount || 0) + 1,
      lastSentAt: Date.now(),
    });

    return { ok: true, message: sent, sticky: updated };
  } catch (error) {
    console.error(`[Sticky] Failed to post sticky ${stickyId}:`, error);
    return { ok: false, error };
  } finally {
    sending.delete(stickyId);
  }
}

async function refreshSticky(client, guildId, stickyId) {
  return postSticky(client, guildId, stickyId);
}

function scheduleSticky(
  client,
  guildId,
  channelId,
  triggerMessage = null,
  delayMs = STICKY_DELAY
) {
  if (!guildId || !channelId) return;

  const existing = timers.get(channelId);
  if (existing) clearTimeout(existing);

  const timer = setTimeout(async () => {
    timers.delete(channelId);
    try {
      const db = await client.database.getGuild(guildId, false, true);
      const sticky = (db?.stickies ?? []).find(
        (entry) => entry.channelId === channelId && entry.enabled
      );
      if (!sticky) return;
      if (sending.has(sticky.id)) {
        scheduleSticky(client, guildId, channelId, triggerMessage);
        return;
      }
      await postSticky(client, guildId, sticky.id, triggerMessage);
    } catch {}
  }, normalizeStickyDelay(delayMs));

  if (timer.unref) timer.unref();
  timers.set(channelId, timer);
}

function clearStickyTimer(channelId) {
  const timer = timers.get(channelId);
  if (timer) clearTimeout(timer);
  timers.delete(channelId);
}

async function removeChannelStickies(client, guildId, channelId) {
  clearStickyTimer(channelId);

  const db = await client.database.getGuild(guildId, false, true);
  const list = Array.isArray(db?.stickies) ? db.stickies : [];
  const updated = list.filter((sticky) => sticky.channelId !== channelId);
  if (updated.length === list.length) return null;

  await client.database.updateGuild(guildId, { stickies: updated });
  return updated;
}

function hasEmbedContent(embedData) {
  if (!embedData) return false;
  return Boolean(
    embedData.title ||
      embedData.description ||
      embedData.footer?.text ||
      embedData.author?.name ||
      embedData.image ||
      embedData.thumbnail
  );
}

module.exports = {
  STICKY_DELAY,
  MIN_STICKY_DELAY,
  MAX_STICKY_DELAY,
  MAX_STICKIES,
  STICKY_MENTION_POLICIES,
  normalizeStickyDelay,
  normalizeMentionPolicy,
  stickyAllowedMentions,
  isValidHttpUrl,
  hasEmbedContent,
  buildStickyContext,
  renderStickyPayload,
  postSticky,
  refreshSticky,
  scheduleSticky,
  clearStickyTimer,
  removeChannelStickies,
  deleteStickyMessage,
  updateStickyRecord,
};
