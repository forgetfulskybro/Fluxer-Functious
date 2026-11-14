const { EmbedBuilder } = require("@fluxerjs/core");
const { runTagSafe } = require("../interpreter/index");
const { trackGuildUpdates } = require("../api/trackSettings");
const { resolveSource } = require("./messageSource");

function isHttpUrl(value) {
  return typeof value === "string" && /^https?:\/\/\S+$/i.test(value.trim());
}

function imageUrl(value) {
  if (typeof value === "string") return isHttpUrl(value) ? value.trim() : null;
  if (value && typeof value === "object" && isHttpUrl(value.url)) return value.url.trim();
  return null;
}

function toFluxerEmbed(data) {
  if (!data || typeof data !== "object") return null;

  const embed = new EmbedBuilder();

  if (data.title) embed.setTitle(String(data.title).slice(0, 256));
  if (data.description) embed.setDescription(String(data.description).slice(0, 4096));
  if (isHttpUrl(data.url)) {
    try {
      embed.setURL(String(data.url));
    } catch {}
  }
  if (data.timestamp) {
    try {
      embed.setTimestamp(data.timestamp);
    } catch {}
  }

  if (data.color != null) {
    try {
      embed.setColor(data.color);
    } catch {}
  }

  if (data.author?.name) {
    const a = data.author;
    try {
      embed.setAuthor({
        name: String(a.name).slice(0, 256),
        url: isHttpUrl(a.url) ? a.url : undefined,
        iconURL: isHttpUrl(a.icon_url)
          ? a.icon_url
          : isHttpUrl(a.iconURL)
            ? a.iconURL
            : undefined,
      });
    } catch {}
  }

  if (data.footer?.text) {
    const f = data.footer;
    try {
      embed.setFooter({
        text: String(f.text).slice(0, 2048),
        iconURL: isHttpUrl(f.icon_url)
          ? f.icon_url
          : isHttpUrl(f.iconURL)
            ? f.iconURL
            : undefined,
      });
    } catch {}
  }

  const thumbnail = imageUrl(data.thumbnail);
  if (thumbnail) {
    try {
      embed.setThumbnail(thumbnail);
    } catch {}
  }

  const image = imageUrl(data.image);
  if (image) {
    try {
      embed.setImage(image);
    } catch {}
  }

  if (Array.isArray(data.fields)) {
    for (const field of data.fields.slice(0, 25)) {
      if (!field?.name || !field?.value) continue;
      try {
        embed.addFields({
          name: String(field.name).slice(0, 256),
          value: String(field.value).slice(0, 1024),
          inline: Boolean(field.inline),
        });
      } catch {}
    }
  }

  return embed;
}

function parseTagEmbedData(raw, fallbackColor = null) {
  const text = String(raw ?? "").trim();
  if (!text) return { error: "empty" };

  if (!text.startsWith("{")) {
    return {
      value: {
        description: text.slice(0, 4096),
        ...(fallbackColor ? { color: fallbackColor } : {}),
      },
    };
  }

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return { error: "invalidJson" };
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return { error: "invalidJson" };
  }

  const embed = {};
  if (typeof data.title === "string" && data.title.trim()) {
    embed.title = data.title.trim().slice(0, 256);
  }
  if (typeof data.description === "string" && data.description.trim()) {
    embed.description = data.description.trim().slice(0, 4096);
  }
  if (isHttpUrl(data.url)) embed.url = data.url.trim();
  if (data.timestamp === true || typeof data.timestamp === "string") {
    embed.timestamp = data.timestamp;
  }
  if (typeof data.color === "string" && data.color.trim()) {
    embed.color = data.color.trim().slice(0, 32);
  } else if (fallbackColor) {
    embed.color = fallbackColor;
  }

  if (data.author && typeof data.author === "object") {
    const name =
      typeof data.author.name === "string" ? data.author.name.trim().slice(0, 256) : "";
    if (name) {
      embed.author = { name };
      if (isHttpUrl(data.author.url)) embed.author.url = data.author.url.trim();
      const icon = data.author.icon_url ?? data.author.iconURL;
      if (isHttpUrl(icon)) embed.author.icon_url = icon.trim();
    }
  }

  if (data.footer && typeof data.footer === "object") {
    const footerText =
      typeof data.footer.text === "string" ? data.footer.text.trim().slice(0, 2048) : "";
    if (footerText) {
      embed.footer = { text: footerText };
      const icon = data.footer.icon_url ?? data.footer.iconURL;
      if (isHttpUrl(icon)) embed.footer.icon_url = icon.trim();
    }
  }

  const thumbnail = imageUrl(data.thumbnail);
  if (thumbnail) embed.thumbnail = { url: thumbnail };

  const image = imageUrl(data.image);
  if (image) embed.image = { url: image };

  const fields = Array.isArray(data.fields)
    ? data.fields
        .filter((field) => field && typeof field.name === "string" && typeof field.value === "string")
        .slice(0, 25)
        .map((field) => ({
          name: field.name.trim().slice(0, 256),
          value: field.value.trim().slice(0, 1024),
          inline: field.inline === true,
        }))
        .filter((field) => field.name && field.value)
    : [];
  if (fields.length) embed.fields = fields;

  if (
    !embed.title &&
    !embed.description &&
    !embed.author &&
    !embed.footer &&
    !embed.thumbnail &&
    !embed.image &&
    !embed.fields
  ) {
    return { error: "empty" };
  }

  return { value: embed };
}

function codeSnippet(code, line, col) {
  if (!code) return null;
  if (line != null) {
    const text = code.split("\n")[line - 1] ?? "";
    const colIndex = Math.min(Math.max(0, (col ?? 1) - 1), text.length);
    const gutter = String(line);
    return `${gutter} | ${text}\n${" ".repeat(gutter.length + 3 + colIndex)}^`;
  }
  const head = code.split("\n").slice(0, 12).join("\n");
  return head.length > 800 ? head.slice(0, 800) + "\n..." : head;
}

function avatarUrl(user) {
  try {
    return user?.displayAvatarURL?.({ dynamic: true }) ?? null;
  } catch {
    return null;
  }
}

function userContext(user, member) {
  return {
    id: user?.id,
    username: user?.username,
    discriminator: user?.discriminator,
    tag: user?.tag ?? (user ? `${user.username}#${user.discriminator ?? "0"}` : null),
    display_name: member?.displayName ?? user?.username,
    global_name: user?.globalName ?? user?.global_name,
    avatar: avatarUrl(user),
    avatar_url: avatarUrl(user),
    bot: Boolean(user?.bot),
    system: Boolean(user?.system),
    created_at: user?.createdTimestamp
      ? new Date(user.createdTimestamp).toISOString()
      : null,
  };
}

function messageContext(message, author) {
  const createdAt = message?.createdTimestamp
    ? new Date(message.createdTimestamp).toISOString()
    : null;

  return {
    id: message?.id,
    content: message?.content ?? "",
    author_id: author?.id ?? message?.authorId ?? null,
    author: author ? userContext(author, null) : null,
    channel_id: message?.channelId ?? message?.channel?.id ?? null,
    guild_id: message?.guildId ?? message?.guild?.id ?? null,
    created_at: createdAt,
    createdTimestamp: message?.createdTimestamp ?? null,
    edited_timestamp: message?.editedTimestamp ?? null,
    mentions: message?.mentions
      ? [...(message.mentions.values?.() ?? message.mentions)]
      : [],
    mention_roles: message?.mentionRoles ? [...message.mentionRoles] : [],
    mention_everyone: Boolean(message?.mentionEveryone),
    attachments: message?.attachments
      ? [...(message.attachments.values?.() ?? [message.attachments])]
      : [],
    embeds: message?.embeds
      ? [...(message.embeds.values?.() ?? message.embeds)]
      : [],
    pinned: Boolean(message?.pinned),
    tts: Boolean(message?.tts),
    webhook_id: message?.webhookId ?? null,
    type: message?.type ?? 0,
    flags: message?.flags ?? 0,
    url: message?.url ?? null,
  };
}

function channelContext(channel) {
  if (!channel) return null;
  return {
    id: channel.id,
    name: channel.name,
    type: channel.type,
    guild_id: channel.guildId ?? channel.guild?.id ?? null,
    position: channel.position ?? null,
    topic: channel.topic ?? null,
    nsfw: Boolean(channel.nsfw),
    mention: `<#${channel.id}>`,
    rate_limit: channel.rateLimitPerUser ?? 0,
    created_at: channel.createdTimestamp
      ? new Date(channel.createdTimestamp).toISOString()
      : null,
  };
}

function guildContext(guild) {
  if (!guild) return null;
  return {
    id: guild.id,
    name: guild.name,
    icon: guild.icon ?? null,
    icon_url: guild.icon
      ? `https://fluxerusercontent.com/icons/${guild.id}/${guild.icon}.png`
      : null,
    banner: guild.banner ?? null,
    banner_url: null,
    description: guild.description ?? null,
    owner_id: guild.ownerId ?? null,
    features: guild.features ?? [],
    premium_tier: guild.premiumTier ?? 0,
    member_count: guild.memberCount ?? null,
    memberCount: guild.memberCount ?? null,
    ownerId: guild.ownerId ?? null,
    preferred_locale: guild.preferredLocale ?? null,
    created_at: guild.createdTimestamp
      ? new Date(guild.createdTimestamp).toISOString()
      : null,
    createdTimestamp: guild.createdTimestamp ?? null,
  };
}

async function resolveTagSource(client, message, args = []) {
  if (!message?.messageReference?.messageId && args.length === 0) return null;
  try {
    return await resolveSource(client, message, args);
  } catch {
    return null;
  }
}

function buildTagContext(client, message, db, source, args) {
  const sourceMessage = source?.message ?? message;
  const sourceChannel = source?.channel ?? message.channel;
  const sourceAuthor = sourceMessage?.author ?? message.author;

  return {
    args,
    user: userContext(message.author, message.member),
    channel: channelContext(sourceChannel),
    message: messageContext(sourceMessage, sourceAuthor),
    guild: guildContext(
      sourceMessage?.guild ??
        (message.guild && message.guild.id === (sourceMessage?.guildId ?? message.guild.id)
          ? message.guild
          : client.guilds?.get?.(sourceMessage?.guildId ?? message.guildId))
    ),
  };
}

async function executeTag(client, message, db, tag, args = [], options = {}) {
  if (!tag) return null;

  const language = db.language;
  const t = (key, vars) =>
    client.translate.get(language, `Commands.tags.${key}`, vars);

  const guildId = message.guildId ?? message.guild?.id;
  if (guildId && db.tags) {
    tag.uses = (tag.uses || 0) + 1;

    try {
      await client.database.updateGuild(guildId, { tags: db.tags });
    } catch {}

    await trackGuildUpdates(client, {
      guildId,
      userId: message.author.id,
      existing: db,
      updates: { tags: db.tags },
    }).catch(() => {});
  }

  if (tag.type === "text") {
    return message.channel.send({ content: tag.content });
  }

  if (tag.type === "embed") {
    const embed = toFluxerEmbed({
      ...(tag.embedData || {}),
      color: tag.embedData?.color || db.theme,
    });
    return message.channel.send({ embeds: [embed] });
  }

  if (tag.type === "script") {
    const source =
      options.source ??
      (await resolveTagSource(client, message, options.sourceArgs ?? []));
    const context = buildTagContext(client, message, db, source, args);
    const result = runTagSafe(tag.content, context);

    if (!result.ok) {
      const err = result.error;
      const loc =
        err.line != null
          ? ` (line ${err.line}${err.col != null ? `:${err.col}` : ""})`
          : "";
      const snippet = codeSnippet(tag.content, err.line, err.col);
      let description = `\`\`\`\n${err.name}: ${err.message}${loc}\n\`\`\``;
      if (snippet) description += `\n\`\`\`fluxer\n${snippet}\n\`\`\``;

      return message.reply({
        embeds: [
          new EmbedBuilder()
            .setColor("#FF0000")
            .setTitle(t("scriptError"))
            .setDescription(description),
        ],
      });
    }

    const { text, embeds: rawEmbeds, reply } = result.result;
    const payload = {};

    if (text && text.trim()) {
      payload.content = text.slice(0, 2000);
    }

    if (rawEmbeds && rawEmbeds.length) {
      const converted = rawEmbeds.slice(0, 10).map(toFluxerEmbed).filter(Boolean);
      if (converted.length) payload.embeds = converted;
    }

    if (!payload.content && !payload.embeds) {
      return message.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(db.theme)
            .setDescription(t("noOutput")),
        ],
      });
    }

    return reply ? message.reply(payload) : message.channel.send(payload);
  }

  return message.reply({
    embeds: [
      new EmbedBuilder()
        .setColor("#FF0000")
        .setDescription(t("unknownType")),
    ],
  });
}

module.exports = {
  toFluxerEmbed,
  parseTagEmbedData,
  executeTag,
  buildTagContext,
  resolveTagSource,
};
