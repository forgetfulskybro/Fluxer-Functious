const { EmbedBuilder } = require("@fluxerjs/core");
const { runTagSafe } = require("../interpreter/index");
const { trackGuildUpdates } = require("../api/trackSettings");
const {
  MAX_STICKIES,
  STICKY_DELAY,
  isValidHttpUrl,
  hasEmbedContent,
  buildStickyContext,
  renderStickyPayload,
  refreshSticky,
} = require("./stickyMessages");
const SESSION_TIMEOUT = 10 * 60 * 1000;
const MAX_CONTENT = 2000;
const MAX_SCRIPT = 12000;

const EMBED_STAGES = [
  {
    key: "title",
    labelKey: "stageTitle",
    get: (data) => data.title,
    set: (data, value) => {
      data.title = value.slice(0, 256);
    },
    clear: (data) => {
      delete data.title;
    },
  },
  {
    key: "description",
    labelKey: "stageDescription",
    get: (data) => data.description,
    set: (data, value) => {
      data.description = value.slice(0, 4096);
    },
    clear: (data) => {
      delete data.description;
    },
  },
  {
    key: "color",
    labelKey: "stageColor",
    get: (data) => data.color,
    set: (data, value) => {
      data.color = value;
    },
    clear: (data) => {
      delete data.color;
    },
  },
  {
    key: "footer_text",
    labelKey: "stageFooter",
    get: (data) => data.footer?.text,
    set: (data, value) => {
      data.footer = data.footer || {};
      data.footer.text = value.slice(0, 2048);
    },
    clear: (data) => {
      if (data.footer) delete data.footer.text;
    },
  },
  {
    key: "footer_icon",
    labelKey: "stageFooterIcon",
    get: (data) => data.footer?.iconURL,
    set: (data, value) => {
      data.footer = data.footer || {};
      data.footer.iconURL = value;
    },
    clear: (data) => {
      if (data.footer) delete data.footer.iconURL;
    },
  },
  {
    key: "image",
    labelKey: "stageImage",
    get: (data) => data.image,
    set: (data, value) => {
      data.image = value;
    },
    clear: (data) => {
      delete data.image;
    },
  },
  {
    key: "thumbnail",
    labelKey: "stageThumbnail",
    get: (data) => data.thumbnail,
    set: (data, value) => {
      data.thumbnail = value;
    },
    clear: (data) => {
      delete data.thumbnail;
    },
  },
  {
    key: "author_name",
    labelKey: "stageAuthor",
    get: (data) => data.author?.name,
    set: (data, value) => {
      data.author = data.author || {};
      data.author.name = value.slice(0, 256);
    },
    clear: (data) => {
      if (data.author) delete data.author.name;
    },
  },
  {
    key: "author_icon",
    labelKey: "stageAuthorIcon",
    get: (data) => data.author?.iconURL,
    set: (data, value) => {
      data.author = data.author || {};
      data.author.iconURL = value;
    },
    clear: (data) => {
      if (data.author) delete data.author.iconURL;
    },
  },
  {
    key: "author_url",
    labelKey: "stageAuthorUrl",
    get: (data) => data.author?.url,
    set: (data, value) => {
      data.author = data.author || {};
      data.author.url = value;
    },
    clear: (data) => {
      if (data.author) delete data.author.url;
    },
  },
  {
    key: "url",
    labelKey: "stageUrl",
    get: (data) => data.url,
    set: (data, value) => {
      data.url = value;
    },
    clear: (data) => {
      delete data.url;
    },
  },
  {
    key: "timestamp",
    labelKey: "stageTimestamp",
    get: (data) => data.useTimestamp === true,
    set: (data, value) => {
      data.useTimestamp = value;
    },
    clear: (data) => {
      delete data.useTimestamp;
    },
  },
];

const SHORTCUTS = {
  title: "title",
  t: "title",
  desc: "description",
  description: "description",
  d: "description",
  color: "color",
  c: "color",
  footer: "footer_text",
  f: "footer_text",
  footer_icon: "footer_icon",
  ficon: "footer_icon",
  footericon: "footer_icon",
  image: "image",
  img: "image",
  i: "image",
  thumbnail: "thumbnail",
  thumb: "thumbnail",
  author: "author_name",
  a: "author_name",
  author_icon: "author_icon",
  aicon: "author_icon",
  authoricon: "author_icon",
  author_url: "author_url",
  aurl: "author_url",
  authorurl: "author_url",
  url: "url",
  link: "url",
  timestamp: "timestamp",
  time: "timestamp",
};

function t(client, session, key, vars) {
  return client.translate.get(session.language, `Commands.sticky.${key}`, vars);
}

function armTimeout(client, session) {
  clearTimeout(session.timeout);
  session.timeout = setTimeout(() => {
    endSession(client, session, "timeout").catch(() => {});
  }, SESSION_TIMEOUT);
  if (session.timeout.unref) session.timeout.unref();
}

async function showSessionPayload(client, session, payload) {
  try {
    const channel = await client.channels.resolve(session.channelId);
    if (!channel) return null;

    if (session.botMessageId) {
      const message = await channel.messages
        .fetch(session.botMessageId)
        .catch(() => null);
      if (message) {
        await message.edit({
          ...payload,
          content: payload.content ?? null,
          embeds: payload.embeds ?? [],
        });
        return message;
      }
    }

    const sent = await channel.send(payload);
    session.botMessageId = sent.id;
    return sent;
  } catch {
    return null;
  }
}

async function showSessionEmbed(client, session, embeds) {
  return showSessionPayload(client, session, { embeds });
}

async function endSession(client, session, reason) {
  clearTimeout(session.timeout);

  const current = client.stickyCollector.get(session.userId);
  if (current === session) client.stickyCollector.delete(session.userId);

  const key = reason === "timeout" ? "timeout" : "cancelled";
  const embed = new EmbedBuilder()
    .setColor(reason === "timeout" ? "#FF0000" : session.theme)
    .setDescription(t(client, session, key));

  await showSessionEmbed(client, session, [embed]);
}

async function sendError(client, session, key, vars) {
  try {
    const channel = await client.channels.resolve(session.channelId);
    if (!channel) return;

    const message = await channel.send({
      embeds: [
        new EmbedBuilder()
          .setColor("#FF0000")
          .setDescription(t(client, session, key, vars)),
      ],
    });

    if (message) {
      setTimeout(() => message.delete().catch(() => {}), 8000);
    }
  } catch {}
}

async function sendScriptError(client, session, error, code) {
  try {
    const channel = await client.channels.resolve(session.channelId);
    if (!channel) return;

    const location =
      error?.line != null
        ? ` (line ${error.line}${error.col != null ? `:${error.col}` : ""})`
        : "";
    let description = `\`\`\`\n${error?.name ?? "Error"}: ${error?.message ?? "Unknown error"}${location}\n\`\`\``;

    if (code && error?.line != null) {
      const line = String(code).split("\n")[error.line - 1] ?? "";
      description += `\n\`\`\`fluxer\n${line}\n\`\`\``;
    }

    description += `\n\n${t(client, session, "runeGuide")}`;

    const message = await channel.send({
      embeds: [
        new EmbedBuilder()
          .setColor("#FF0000")
          .setTitle(t(client, session, "scriptError"))
          .setDescription(description.slice(0, 4000)),
      ],
    });

    if (message) {
      setTimeout(() => message.delete().catch(() => {}), 12000);
    }
  } catch {}
}

function buildPreviewEmbeds(client, session, triggerMessage) {
  if (!hasEmbedContent(session.embedData)) return [];

  const guild = client.guilds?.get?.(session.guildId) ?? null;
  const channel = client.channels?.resolve?.(session.targetChannelId) ?? null;
  const sticky = {
    type: "embed",
    embedData: session.embedData,
    sendCount: 0,
    createdBy: session.userId,
  };

  const preview = renderStickyPayload(
    guild,
    channel,
    sticky,
    triggerMessage,
    session.theme
  );

  return preview.payload?.embeds ?? [];
}

function stageValueText(stage, embedData) {
  const value = stage.get(embedData);
  if (value === undefined || value === null || value === "") return "(not set)";
  if (stage.key === "timestamp") return value === true ? "yes" : "no";
  return String(value).slice(0, 300);
}

function applyStageValue(stage, embedData, raw) {
  const value = String(raw ?? "").trim();
  if (!value) return { error: "contentEmpty" };

  if (value.toLowerCase() === "none") {
    stage.clear(embedData);
    return { ok: true };
  }

  if (stage.key === "color") {
    try {
      new EmbedBuilder().setColor(value);
    } catch {
      return { error: "invalidColor" };
    }
  }

  if (
    ["footer_icon", "image", "thumbnail", "author_icon", "author_url", "url"].includes(
      stage.key
    ) &&
    !isValidHttpUrl(value)
  ) {
    return { error: "invalidUrl" };
  }

  if (stage.key === "timestamp") {
    stage.set(embedData, ["yes", "true", "on", "1"].includes(value.toLowerCase()));
    return { ok: true };
  }

  stage.set(embedData, value);
  return { ok: true };
}

function parseShortcut(content) {
  const match = String(content).match(/^\{(\w+):([\s\S]+)\}$/);
  if (!match) return null;

  const key = SHORTCUTS[match[1].toLowerCase()];
  if (!key) return null;

  return { key, value: match[2].trim() };
}

async function showEmbedPrompt(client, session, triggerMessage) {
  session.waitingFor = "embed";
  const total = EMBED_STAGES.length;
  let description;

  if (session.stage >= total) {
    description = t(client, session, "embedDone");
  } else {
    const stage = EMBED_STAGES[session.stage];
    description = t(client, session, "embedStage", {
      stage: t(client, session, stage.labelKey),
      current: session.stage + 1,
      total,
      value: stageValueText(stage, session.embedData),
    });
  }

  description += `\n\n${t(client, session, "runeGuide")}`;

  const prompt = new EmbedBuilder()
    .setColor(session.theme)
    .setTitle(
      t(
        client,
        session,
        session.editingId ? "editTitle" : "createTitle",
        { number: session.number ?? "" }
      )
    )
    .setDescription(description);

  const embeds = [prompt, ...buildPreviewEmbeds(client, session, triggerMessage)];
  await showSessionEmbed(client, session, embeds);
  armTimeout(client, session);
}

async function promptContentOrScript(client, session) {
  const isScript = session.type === "script";
  session.waitingFor = isScript ? "script" : "content";

  const channel = `<#${session.targetChannelId}>`;
  const key = session.editingId
    ? isScript
      ? "editScript"
      : "editContent"
    : isScript
      ? "scriptPrompt"
      : "contentPrompt";

  let description = `${t(client, session, key, { channel })}\n\n${t(
    client,
    session,
    "runeGuide"
  )}`;

  if (session.editingId && session.content) {
    const current = String(session.content)
      .slice(0, 900)
      .replace(/```/g, "'''");
    description += `\n\n**${t(client, session, "currentContent")}**\n\`\`\`\n${current}\n\`\`\``;
  }

  const embed = new EmbedBuilder()
    .setColor(session.theme)
    .setTitle(
      t(
        client,
        session,
        session.editingId ? "editTitle" : "createTitle",
        { number: session.number ?? "" }
      )
    )
    .setDescription(description);

  await showSessionEmbed(client, session, [embed]);
  armTimeout(client, session);
}

async function saveSession(client, session) {
  const fresh = await client.database.getGuild(session.guildId, false, true);
  if (!fresh) {
    await endSession(client, session, "cancelled");
    return;
  }

  const list = Array.isArray(fresh.stickies) ? [...fresh.stickies] : [];
  let sticky;
  let number;

  if (session.editingId) {
    const index = list.findIndex((entry) => entry.id === session.editingId);
    if (index === -1) {
      await endSession(client, session, "cancelled");
      return;
    }

    sticky = {
      ...list[index],
      type: session.type,
      content: session.type === "embed" ? null : session.content,
      embedData: session.type === "embed" ? session.embedData : null,
      updatedAt: Date.now(),
    };
    list[index] = sticky;
    number = index + 1;
  } else {
    if (list.length >= MAX_STICKIES) {
      await sendError(client, session, "maxReached", { max: MAX_STICKIES });
      return;
    }

    if (list.some((entry) => entry.channelId === session.targetChannelId)) {
      await sendError(client, session, "channelInUse", {
        channel: `<#${session.targetChannelId}>`,
      });
      return;
    }

    sticky = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      channelId: session.targetChannelId,
      type: session.type,
      content: session.type === "embed" ? null : session.content,
      embedData: session.type === "embed" ? session.embedData : null,
      enabled: true,
      stickyMessageId: null,
      createdBy: session.userId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      sendCount: 0,
      repostDelayMs: STICKY_DELAY,
      mentionPolicy: "none",
    };
    list.push(sticky);
    number = list.length;
  }

  await client.database.updateGuild(session.guildId, { stickies: list });
  await trackGuildUpdates(client, {
    guildId: session.guildId,
    userId: session.userId,
    existing: fresh,
    updates: { stickies: list },
  }).catch(() => {});

  const result =
    sticky.enabled === false
      ? { ok: true, skipped: true }
      : await refreshSticky(client, session.guildId, sticky.id);

  clearTimeout(session.timeout);
  client.stickyCollector.delete(session.userId);

  const channel = `<#${session.targetChannelId}>`;
  const description = result.ok
    ? sticky.enabled === false
      ? t(client, session, "savedDisabled", { number })
      : t(
          client,
          session,
          session.editingId ? "savedEdit" : "saved",
          { number, channel }
        )
    : t(client, session, "saveFailed", { channel });

  await showSessionEmbed(client, session, [
    new EmbedBuilder()
      .setColor(result.ok ? session.theme : "#FF0000")
      .setDescription(description),
  ]);
}

async function handleContent(client, message, session) {
  const content = message.content;

  if (!content.trim()) {
    await sendError(client, session, "contentEmpty");
    return;
  }

  if (content.length > MAX_CONTENT) {
    await sendError(client, session, "contentTooLong", { max: MAX_CONTENT });
    return;
  }

  await message.delete().catch(() => {});
  session.content = content;
  await saveSession(client, session);
}

async function handleScript(client, message, session) {
  let content = message.content.trim();
  const fenced = content.match(/^```(?:[a-zA-Z0-9_-]+)?\s*\n?([\s\S]*?)```$/);
  if (fenced) content = fenced[1];
  content = content.trim();

  if (!content) {
    await sendError(client, session, "scriptEmpty");
    return;
  }

  if (content.length > MAX_SCRIPT) {
    await sendError(client, session, "scriptTooLong", { max: MAX_SCRIPT });
    return;
  }

  const guild = client.guilds?.get?.(session.guildId) ?? null;
  let channel = null;
  try {
    channel = await client.channels.resolve(session.targetChannelId);
  } catch {}
  const check = runTagSafe(
    content,
    buildStickyContext(
      guild,
      channel,
      {
        type: "script",
        content,
        sendCount: 0,
        createdBy: session.userId,
      },
      message
    )
  );

  await message.delete().catch(() => {});

  if (!check.ok) {
    await sendScriptError(client, session, check.error, content);
    return;
  }

  session.content = content;
  await saveSession(client, session);
}

async function handleEmbed(client, message, session) {
  const content = message.content.trim();
  if (!content) return;

  const lower = content.toLowerCase();
  if (lower === "cancel" || lower === `${session.prefix}sticky stop`) {
    await message.delete().catch(() => {});
    await endSession(client, session, "cancelled");
    return;
  }

  await message.delete().catch(() => {});

  if (lower === "done") {
    if (!hasEmbedContent(session.embedData)) {
      await sendError(client, session, "embedEmpty");
      return;
    }
    await saveSession(client, session);
    return;
  }

  if (lower === "skip") {
    if (session.stage < EMBED_STAGES.length) session.stage++;
    await showEmbedPrompt(client, session, message);
    return;
  }

  const shortcut = parseShortcut(content);
  if (shortcut) {
    const stage = EMBED_STAGES.find((entry) => entry.key === shortcut.key);
    if (!stage) return;
    const result = applyStageValue(stage, session.embedData, shortcut.value);
    if (result.error) {
      await sendError(client, session, result.error);
      return;
    }
    await showEmbedPrompt(client, session, message);
    return;
  }

  if (session.stage >= EMBED_STAGES.length) {
    await showEmbedPrompt(client, session, message);
    return;
  }

  const stage = EMBED_STAGES[session.stage];
  const result = applyStageValue(stage, session.embedData, content);
  if (result.error) {
    await sendError(client, session, result.error);
    return;
  }

  session.stage++;
  await showEmbedPrompt(client, session, message);
}

async function showTypeMenu(client, message, session) {
  const embed = new EmbedBuilder()
    .setColor(session.theme)
    .setTitle(t(client, session, "createTitle"))
    .setDescription(
      `${t(client, session, "createDesc", {
        channel: `<#${session.targetChannelId}>`,
      })}\n\n${t(client, session, "runeGuide")}`
    );

  let sent;
  try {
    sent = await message.channel.send({ embeds: [embed] });
  } catch {
    await endSession(client, session, "cancelled");
    return;
  }

  session.botMessageId = sent.id;
  await sent.react("1️⃣").catch(() => {});
  await sent.react("2️⃣").catch(() => {});
  await sent.react("3️⃣").catch(() => {});
  await sent.react("❌").catch(() => {});

  const filter = (reaction, user) =>
    user.id === session.userId &&
    ["1️⃣", "2️⃣", "3️⃣", "❌"].includes(reaction.emoji?.name);

  const collector = sent.createReactionCollector({ filter, time: 120000 });

  collector.on("collect", async (reaction) => {
    collector.stop();
    await sent.removeAllReactions().catch(() => {});

    const emoji = reaction.emoji?.name;
    if (emoji === "❌") {
      await endSession(client, session, "cancelled");
      return;
    }

    if (emoji === "1️⃣") {
      session.type = "content";
      await promptContentOrScript(client, session);
      return;
    }

    if (emoji === "2️⃣") {
      session.type = "embed";
      session.embedData = {};
      session.stage = 0;
      await showEmbedPrompt(client, session, null);
      return;
    }

    session.type = "script";
    await promptContentOrScript(client, session);
  });

  collector.on("end", (_, reason) => {
    if (reason === "time") {
      endSession(client, session, "timeout").catch(() => {});
    }
  });
}

function makeSession(client, message, db, options) {
  const session = {
    userId: message.author.id,
    guildId: message.guildId,
    channelId: message.channelId,
    targetChannelId: options.targetChannelId,
    editingId: options.editingId ?? null,
    number: options.number ?? null,
    type: options.type ?? null,
    content: options.content ?? "",
    embedData: options.embedData
      ? JSON.parse(JSON.stringify(options.embedData))
      : {},
    stage: 0,
    waitingFor: null,
    botMessageId: null,
    timeout: null,
    language: db.language ?? "en_EN",
    theme: db.theme ?? "#A52F05",
    prefix: db.prefix ?? "f!",
  };

  client.stickyCollector.set(session.userId, session);
  armTimeout(client, session);
  return session;
}

async function startStickyEditor(client, message, db, options) {
  const existing = options.editingId
    ? (db.stickies ?? []).find((entry) => entry.id === options.editingId)
    : null;

  if (options.editingId && !existing) {
    await message.reply({
      embeds: [
        new EmbedBuilder()
          .setColor("#FF0000")
          .setDescription(
            client.translate.get(db.language, "Commands.sticky.notFound", {
              prefix: db.prefix,
            })
          ),
      ],
    });
    return;
  }

  const session = makeSession(client, message, db, {
    targetChannelId: options.targetChannelId ?? existing.channelId,
    editingId: options.editingId ?? null,
    number: options.number ?? null,
    type: existing?.type ?? null,
    content: existing?.content ?? "",
    embedData: existing?.embedData ?? null,
  });

  if (!existing) {
    await showTypeMenu(client, message, session);
    return;
  }

  if (session.type === "embed") {
    await showEmbedPrompt(client, session, null);
    return;
  }

  await promptContentOrScript(client, session);
}

async function startStickyTypeChange(client, message, db, sticky, type, number) {
  const session = makeSession(client, message, db, {
    targetChannelId: sticky.channelId,
    editingId: sticky.id,
    number,
    type,
  });

  if (type === "embed") {
    await showEmbedPrompt(client, session, null);
    return;
  }

  await promptContentOrScript(client, session);
}

async function cancelStickySession(client, message, db) {
  const session = client.stickyCollector.get(message.author.id);
  if (!session) {
    await message.reply({
      embeds: [
        new EmbedBuilder()
          .setColor("#FF0000")
          .setDescription(
            client.translate.get(db.language, "Commands.sticky.stopNoSession")
          ),
      ],
    });
    return;
  }

  await endSession(client, session, "cancelled");
}

async function StickyCollector(client, message, db) {
  const session = client.stickyCollector.get(message.author.id);
  if (!session) return;

  const lower = message.content.trim().toLowerCase();
  if (lower === "cancel" || lower === `${db.prefix}sticky stop`) {
    await message.delete().catch(() => {});
    await endSession(client, session, "cancelled");
    return;
  }

  if (session.waitingFor === "embed") {
    await handleEmbed(client, message, session);
    return;
  }

  if (session.waitingFor === "content") {
    await handleContent(client, message, session);
    return;
  }

  if (session.waitingFor === "script") {
    await handleScript(client, message, session);
  }
}

module.exports = StickyCollector;
module.exports.startStickyEditor = startStickyEditor;
module.exports.startStickyTypeChange = startStickyTypeChange;
module.exports.cancelStickySession = cancelStickySession;
module.exports.endSession = endSession;
