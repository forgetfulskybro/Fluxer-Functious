const { EmbedBuilder } = require("@fluxerjs/core");
const Forms = require("../models/forms");
const dhms = require("./dhms");
const {
  CHOICE_EMOJIS,
  formT,
  resolveForm,
  buildPanelEmbed,
} = require("./formHelpers");

const NAV_EMOJIS = ["⏪", "⬅️", "➡️", "⏩"];
const FIELD_EMOJIS = CHOICE_EMOJIS;
const CLOSE = "❌";
const BACK = "↩️";
const ADD = "➕";
const DELETE = "🗑️";
const CONFIRM = "✅";
const QUESTIONS_PER_PAGE = 5;
const PICKER_PER_PAGE = 5;
const MAX_QUESTIONS = 50;
const MIN_COOLDOWN_MS = 60 * 60 * 1000;
const MAX_COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000;
const MENU_TIMEOUT = 10 * 60 * 1000;
const INPUT_TIMEOUT = 2 * 60 * 1000;
const TYPE_OPTIONS = [
  { type: "text", emoji: "✏️", label: "menuTypeText" },
  { type: "paragraph", emoji: "📄", label: "menuTypeParagraph" },
  { type: "choice", emoji: "🔢", label: "menuTypeChoice" },
];

function truncate(value, max) {
  const text = String(value ?? "");
  return text.length > max ? `${text.slice(0, Math.max(0, max - 1))}…` : text;
}

function createQuestionId() {
  return `q${Date.now()}${Math.floor(Math.random() * 1000)}`;
}

function splitParts(value) {
  return String(value ?? "")
    .split("|")
    .map((part) => part.trim())
    .filter(Boolean);
}

function roleIds(value) {
  return [...new Set(String(value ?? "").match(/\d{15,25}/g) ?? [])];
}

function isHttpUrl(value) {
  try {
    const url = new URL(String(value));
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function formatDuration(ms) {
  const value = Math.max(0, Number(ms) || 0);
  const days = Math.floor(value / 86400000);
  const hours = Math.floor((value % 86400000) / 3600000);
  const minutes = Math.floor((value % 3600000) / 60000);
  return [days ? `${days}d` : "", hours ? `${hours}h` : "", minutes ? `${minutes}m` : ""]
    .filter(Boolean)
    .join(" ") || "0m";
}

function noMentions() {
  return { parse: [], repliedUser: false };
}

async function getTextChannel(client, message, value) {
  const id = String(value ?? "").replace(/[<#>]/g, "").trim();
  if (!id) return null;
  const channel = await client.channels.resolve(id).catch(() => null);
  if (!channel || channel.type !== 0) return null;
  const guildId = channel.guildId ?? channel.guild?.id;
  if (guildId && guildId !== message.guildId) return null;
  return channel;
}

async function startFormPicker(client, message, db, forms, existingMessage = null) {
  if (!forms?.length) {
    return message.reply({
      embeds: [new EmbedBuilder().setColor(db.theme).setDescription(formT(client, db, "listEmpty"))],
    });
  }

  const t = (key, vars) => formT(client, db, key, vars);
  const authorId = message.author.id;
  const pages = Math.ceil(forms.length / PICKER_PER_PAGE);
  let page = 0;
  let notice = "";
  let menuMsg = existingMessage ?? null;
  let collector;

  function buildEmbed() {
    const pageForms = forms.slice(page * PICKER_PER_PAGE, page * PICKER_PER_PAGE + PICKER_PER_PAGE);
    const lines = [t("menuPickerHint")];
    if (notice) lines.push("", `> ${notice}`);
    lines.push("");
    for (let index = 0; index < pageForms.length; index += 1) {
      const form = pageForms[index];
      lines.push(
        `${FIELD_EMOJIS[index]} **${form.name}** - ${form.status} · ${form.questions?.length ?? 0} ${t("questionsLabel").toLowerCase()}`
      );
    }
    return new EmbedBuilder()
      .setColor(db.theme)
      .setTitle(t("menuPickerTitle"))
      .setDescription(truncate(lines.join("\n"), 4096))
      .setFooter({
        text: t("menuPickerFooter", { page: page + 1, total: pages }),
      });
  }

  async function render() {
    if (!menuMsg) {
      menuMsg = await message.reply({ embeds: [buildEmbed()], allowedMentions: noMentions() }).catch(() => null);
    } else {
      await menuMsg.edit({ embeds: [buildEmbed()], allowedMentions: noMentions() }).catch(() => null);
    }
    if (!menuMsg) return false;

    await menuMsg.removeAllReactions().catch(() => {});
    const pageForms = forms.slice(page * PICKER_PER_PAGE, page * PICKER_PER_PAGE + PICKER_PER_PAGE);
    for (let index = 0; index < pageForms.length; index += 1) {
      await menuMsg.react(FIELD_EMOJIS[index]).catch(() => {});
    }
    for (const emoji of [...NAV_EMOJIS, CLOSE]) {
      await menuMsg.react(emoji).catch(() => {});
    }
    return true;
  }

  if (!(await render())) return null;

  try {
    collector = menuMsg.createReactionCollector({
      filter: (reaction, user) => user?.id === authorId && !user.bot,
      time: MENU_TIMEOUT,
    });
  } catch {
    await menuMsg.edit({
      embeds: [new EmbedBuilder().setColor(db.theme).setDescription(t("collectorUnavailable"))],
    }).catch(() => {});
    return menuMsg;
  }

  collector.on("collect", async (reaction) => {
    const emoji = reaction.emoji?.name;
    if (!emoji) return;
    await menuMsg.removeReaction(emoji, authorId).catch(() => {});

    if (emoji === CLOSE) {
      collector.stop("closed");
      await menuMsg.removeAllReactions().catch(() => {});
      await menuMsg.edit({
        embeds: [new EmbedBuilder().setColor(db.theme).setDescription(t("menuClosed"))],
        allowedMentions: noMentions(),
      }).catch(() => {});
      return;
    }

    if (NAV_EMOJIS.includes(emoji)) {
      const next = emoji === "⏪"
        ? 0
        : emoji === "⏩"
          ? pages - 1
          : emoji === "⬅️"
            ? page - 1
            : page + 1;
      if (next >= 0 && next < pages && next !== page) {
        page = next;
        notice = "";
        await render();
      }
      return;
    }

    const index = FIELD_EMOJIS.indexOf(emoji);
    const selected = index >= 0
      ? forms[page * PICKER_PER_PAGE + index]
      : null;
    if (!selected) return;

    const form = await Forms.findById(selected._id).catch(() => null);
    if (!form) {
      notice = t("notFound");
      await render();
      return;
    }

    collector.stop("selected");
    await menuMsg.removeAllReactions().catch(() => {});
    await startFormMenu(client, message, db, form, menuMsg);
  });

  collector.on("end", async (_, reason) => {
    if (reason !== "time") return;
    await menuMsg.removeAllReactions().catch(() => {});
    await menuMsg.edit({
      embeds: [new EmbedBuilder().setColor(db.theme).setDescription(t("menuTimedOut", { "prefix": db.prefix }))],
      allowedMentions: noMentions(),
    }).catch(() => {});
  });

  return menuMsg;
}

async function startFormMenu(client, message, db, form, existingMessage = null, initialNotice = "") {
  const t = (key, vars) => formT(client, db, key, vars);
  const authorId = message.author.id;
  const channel = message.channel;
  if (!channel) return null;

  let screens = [];
  let screenIndex = 0;
  let activeQuestionId = null;
  let transient = null;
  let notice = initialNotice || "";
  let busy = false;
  let menuMsg = existingMessage ?? null;
  let collector;
  let inputCollector;
  const currentReactions = new Set();

  const questions = () => form.questions ?? [];
  const currentQuestion = () => questions().find((question) => question.id === activeQuestionId) ?? null;

  function typeLabel(question) {
    return question?.type === "paragraph"
      ? t("menuTypeParagraph")
      : question?.type === "choice"
        ? t("menuTypeChoice")
        : t("menuTypeText");
  }

  function statusLabel() {
    return form.status === "open"
      ? t("open")
      : form.status === "closed"
        ? t("closedStatus")
        : t("menuDraftStatus");
  }

  function formatChannel(id) {
    return id ? `<#${id}>` : t("notSet");
  }

  function formatRoles(ids) {
    return ids?.length ? ids.map((id) => `<@&${id}>`).join(", ") : t("notSet");
  }

  function pageFooter(text) {
    return { text: truncate(text, 2048) };
  }

  function questionPageCount() {
    return Math.max(1, Math.ceil(questions().length / QUESTIONS_PER_PAGE));
  }

  function buildScreens() {
    const next = [{ type: "basics" }];
    for (let page = 0; page < questionPageCount(); page += 1) {
      next.push({ type: "questions", page });
    }
    next.push({ type: "access" }, { type: "behavior" }, { type: "messages" }, { type: "publish" });
    return next;
  }

  function refreshScreens() {
    screens = buildScreens();
    screenIndex = Math.min(Math.max(0, screenIndex), screens.length - 1);
  }

  function sectionLabel(screen) {
    if (screen.type === "questions") {
      return t("menuSectionQuestions", { page: screen.page + 1, total: questionPageCount() });
    }
    return {
      basics: t("menuSectionBasics"),
      access: t("menuSectionAccess"),
      behavior: t("menuSectionBehavior"),
      messages: t("menuSectionMessages"),
      publish: t("menuSectionPublish"),
    }[screen.type] ?? t("menuTitle");
  }

  function goToQuestionList(index) {
    refreshScreens();
    const page = Math.floor(Math.max(0, index) / QUESTIONS_PER_PAGE);
    screenIndex = 1 + Math.min(page, questionPageCount() - 1);
  }

  function withNotice(lines) {
    return notice ? [`> ${notice}`, "", ...lines] : lines;
  }

  function buildBasicsEmbed() {
    return new EmbedBuilder()
      .setColor(form.color || db.theme)
      .setTitle(t("menuTitle", { name: form.name }))
      .setDescription(withNotice([
        t("menuIntro"),
        "",
        t("menuNavHint"),
      ]).join("\n"))
      .addFields(
        {
          name: `${FIELD_EMOJIS[0]} ${t("menuEditName")}`,
          value: truncate(form.name, 1024),
          inline: false,
        },
        {
          name: `${FIELD_EMOJIS[1]} ${t("menuEditDescription")}`,
          value: truncate(form.description || t("notSet"), 1024),
          inline: false,
        },
        {
          name: `${FIELD_EMOJIS[2]} ${t("menuEditColor")}`,
          value: form.color || t("notSet"),
          inline: true,
        },
        {
          name: `${FIELD_EMOJIS[3]} ${t("menuEditImage")}`,
          value: truncate(form.imageUrl || t("notSet"), 1024),
          inline: false,
        },
        {
          name: `${FIELD_EMOJIS[4]} ${t("menuEditEmoji")}`,
          value: form.panelEmoji || t("notSet"),
          inline: true,
        }
      )
      .setFooter(pageFooter(t("menuPage", {
        page: screenIndex + 1,
        total: screens.length,
        section: sectionLabel(screens[screenIndex]),
      })));
  }

  function buildQuestionsEmbed() {
    const screen = screens[screenIndex];
    const start = screen.page * QUESTIONS_PER_PAGE;
    const shown = questions().slice(start, start + QUESTIONS_PER_PAGE);
    const lines = [t("menuQuestionsHint")];
    if (notice) lines.unshift(`> ${notice}`, "");
    if (!questions().length) {
      lines.push("", t("menuNoQuestions"));
    } else {
      lines.push("");
      for (let index = 0; index < shown.length; index += 1) {
        const question = shown[index];
        const number = start + index + 1;
        const choices = question.type === "choice"
          ? `\n${t("menuChoices")}: ${question.choices?.length ?? 0}`
          : "";
        lines.push(
          `${FIELD_EMOJIS[index]} **${number}. ${truncate(question.prompt, 180)}**\n` +
          `${typeLabel(question)} · ${question.required === false ? t("optional") : t("required")}${choices}`
        );
      }
    }
    lines.push("", `${ADD} ${t("menuAddQuestion")}`);

    return new EmbedBuilder()
      .setColor(form.color || db.theme)
      .setTitle(t("menuQuestionsTitle", { name: form.name }))
      .setDescription(truncate(lines.join("\n"), 4096))
      .setFooter(pageFooter(t("menuPage", {
        page: screenIndex + 1,
        total: screens.length,
        section: sectionLabel(screen),
      })));
  }

  function buildQuestionEmbed() {
    const question = currentQuestion();
    if (!question) return buildQuestionsEmbed();
    const index = questions().findIndex((item) => item.id === question.id);
    const lines = [t("menuQuestionDetailHint")];
    if (notice) lines.unshift(`> ${notice}`, "");
    lines.push(
      "",
      `${FIELD_EMOJIS[0]} ${t("menuQuestionPromptAction")}`,
      `${FIELD_EMOJIS[1]} ${t("menuQuestionTypeAction")}`,
      `${FIELD_EMOJIS[2]} ${t("menuQuestionRequiredAction")}`
    );
    if (question.type === "choice") {
      lines.push(`${FIELD_EMOJIS[3]} ${t("menuQuestionChoicesAction")}`);
    }
    lines.push(
      `${FIELD_EMOJIS[4]} ${t("menuQuestionMoveUp")}`,
      `${FIELD_EMOJIS[5]} ${t("menuQuestionMoveDown")}`,
      `${DELETE} ${t("menuQuestionDelete")}`,
      `${BACK} ${t("menuQuestionBack")}`
    );

    return new EmbedBuilder()
      .setColor(form.color || db.theme)
      .setTitle(t("menuQuestionDetailTitle", { number: index + 1, total: questions().length }))
      .setDescription(truncate(lines.join("\n"), 4096))
      .addFields(
        {
          name: t("menuPrompt"),
          value: truncate(question.prompt, 1024),
          inline: false,
        },
        {
          name: t("menuType"),
          value: typeLabel(question),
          inline: true,
        },
        {
          name: t("menuRequiredLabel"),
          value: question.required === false ? t("disabled") : t("enabled"),
          inline: true,
        },
        ...(question.type === "choice"
          ? [{
              name: t("menuChoices"),
              value: truncate(
                (question.choices ?? []).map((choice) => choice.label).join(" · ") || t("menuNoChoices"),
                1024
              ),
              inline: false,
            }]
          : []),
        {
          name: t("menuPosition"),
          value: `${index + 1} / ${questions().length}`,
          inline: true,
        }
      )
      .setFooter(pageFooter(t("menuQuestionFooter", {
        page: index + 1,
        total: questions().length,
      })));
  }

  function buildAccessEmbed() {
    return new EmbedBuilder()
      .setColor(form.color || db.theme)
      .setTitle(t("menuAccessTitle", { name: form.name }))
      .setDescription(withNotice([
        t("menuAccessHint"),
        "",
        t("menuNavHint"),
      ]).join("\n"))
      .addFields(
        {
          name: `${FIELD_EMOJIS[0]} ${t("menuPanelChannel")}`,
          value: formatChannel(form.panelChannelId),
          inline: true,
        },
        {
          name: `${FIELD_EMOJIS[1]} ${t("menuReviewChannel")}`,
          value: formatChannel(form.reviewChannelId),
          inline: true,
        },
        {
          name: `${FIELD_EMOJIS[2]} ${t("menuReviewerRoles")}`,
          value: truncate(formatRoles(form.reviewerRoleIds), 1024),
          inline: false,
        },
        {
          name: `${FIELD_EMOJIS[3]} ${t("menuRequiredRoles")}`,
          value: truncate(formatRoles(form.requiredRoleIds), 1024),
          inline: false,
        }
      )
      .setFooter(pageFooter(t("menuPage", {
        page: screenIndex + 1,
        total: screens.length,
        section: sectionLabel(screens[screenIndex]),
      })));
  }

  function buildBehaviorEmbed() {
    return new EmbedBuilder()
      .setColor(form.color || db.theme)
      .setTitle(t("menuBehaviorTitle", { name: form.name }))
      .setDescription(withNotice([
        t("menuNavHint"),
      ]).join("\n"))
      .addFields(
        {
          name: `${FIELD_EMOJIS[0]} ${t("menuCooldown")}`,
          value: formatDuration(form.cooldownMs),
          inline: true,
        },
        {
          name: `${FIELD_EMOJIS[1]} ${t("menuMultiple")}`,
          value: form.allowMultiple ? t("enabled") : t("disabled"),
          inline: true,
        },
        {
          name: `${FIELD_EMOJIS[2]} ${t("menuMax")}`,
          value: form.maxSubmissions ? String(form.maxSubmissions) : t("unlimited"),
          inline: true,
        },
        {
          name: `${FIELD_EMOJIS[3]} ${t("menuReviewerPing")}`,
          value: form.reviewerPing === false ? t("disabled") : t("enabled"),
          inline: true,
        },
        {
          name: `${FIELD_EMOJIS[4]} ${t("menuDmApplicant")}`,
          value: form.dmApplicant === false ? t("disabled") : t("enabled"),
          inline: true,
        },
        {
          name: `${FIELD_EMOJIS[5]} ${t("menuAnonymous")}`,
          value: form.anonymous ? t("enabled") : t("disabled"),
          inline: true,
        }
      )
      .setFooter(pageFooter(t("menuPage", {
        page: screenIndex + 1,
        total: screens.length,
        section: sectionLabel(screens[screenIndex]),
      })));
  }

  function buildMessagesEmbed() {
    return new EmbedBuilder()
      .setColor(form.color || db.theme)
      .setTitle(t("menuMessagesTitle", { name: form.name }))
      .setDescription(withNotice([
        t("menuMessageHint"),
        "",
        t("menuNavHint"),
      ]).join("\n"))
      .addFields(
        {
          name: `${FIELD_EMOJIS[0]} ${t("menuIntroMessage")}`,
          value: truncate(form.introMessage || t("menuDefault"), 1024),
          inline: false,
        },
        {
          name: `${FIELD_EMOJIS[1]} ${t("menuConfirmationMessage")}`,
          value: truncate(form.confirmationMessage || t("menuDefault"), 1024),
          inline: false,
        },
        {
          name: `${FIELD_EMOJIS[2]} ${t("menuAcceptMessage")}`,
          value: truncate(form.acceptMessage || t("menuDefault"), 1024),
          inline: false,
        },
        {
          name: `${FIELD_EMOJIS[3]} ${t("menuDeclineMessage")}`,
          value: truncate(form.declineMessage || t("menuDefault"), 1024),
          inline: false,
        }
      )
      .setFooter(pageFooter(t("menuPage", {
        page: screenIndex + 1,
        total: screens.length,
        section: sectionLabel(screens[screenIndex]),
      })));
  }

  function buildPublishEmbed() {
    const missing = [];
    if (!form.questions?.length) missing.push(t("menuSectionQuestions"));
    if (!form.reviewChannelId) missing.push(t("menuReviewChannel"));
    if (!form.panelChannelId) missing.push(t("menuPanelChannel"));
    const readiness = missing.length
      ? t("menuNotReady", { items: missing.join(", ") })
      : t("menuReady");
    const actions = [
      `${FIELD_EMOJIS[0]} ${t("menuPreview")}`,
      `${FIELD_EMOJIS[1]} ${form.status === "open" ? t("menuCloseAction") : t("menuOpenAction")}`,
      `${FIELD_EMOJIS[2]} ${t("menuPublishAction")}`,
    ];

    return new EmbedBuilder()
      .setColor(form.color || db.theme)
      .setTitle(t("menuPublishTitle", { name: form.name }))
      .setDescription(withNotice([
        readiness,
        "",
        ...actions,
        "",
        t("menuNavHint"),
      ]).join("\n"))
      .addFields(
        {
          name: t("menuStatus"),
          value: statusLabel(),
          inline: true,
        },
        {
          name: t("questionsLabel"),
          value: String(form.questions?.length ?? 0),
          inline: true,
        },
        {
          name: t("menuReviewChannel"),
          value: formatChannel(form.reviewChannelId),
          inline: true,
        },
        {
          name: t("menuPanelChannel"),
          value: formatChannel(form.panelChannelId),
          inline: true,
        }
      )
      .setFooter(pageFooter(t("menuPage", {
        page: screenIndex + 1,
        total: screens.length,
        section: sectionLabel(screens[screenIndex]),
      })));
  }

  function buildTypePickerEmbed() {
    return new EmbedBuilder()
      .setColor(form.color || db.theme)
      .setTitle(transient?.mode === "edit" ? t("menuQuestionTypeAction") : t("menuQuestionTypeTitle"))
      .setDescription([
        t("menuQuestionTypeDesc"),
        "",
        ...TYPE_OPTIONS.map((option) => `${option.emoji} ${t(option.label)}`),
        "",
        `${BACK} ${t("menuReturn")}`,
      ].join("\n"));
  }

  function buildDeleteEmbed() {
    return new EmbedBuilder()
      .setColor("#FF0000")
      .setTitle(t("menuDeleteTitle"))
      .setDescription([
        t("menuDeleteDesc", {
          prompt: truncate(currentQuestion()?.prompt ?? "", 200),
        }),
        "",
        `${CONFIRM} ${t("menuDeleteConfirm")}`,
        `${CLOSE} ${t("menuReturn")}`,
      ].join("\n"));
  }

  function buildPreviewEmbed() {
    const embed = buildPanelEmbed(client, db, form);
    const previous = embed.data?.footer?.text;
    return embed.setFooter({
      text: truncate(
        [previous, t("menuPreviewFooter")].filter(Boolean).join(" · "),
        2048
      ),
    });
  }

  function buildCurrentEmbed() {
    if (transient?.type === "typePicker") return buildTypePickerEmbed();
    if (transient?.type === "confirmDelete") return buildDeleteEmbed();
    if (transient?.type === "preview") return buildPreviewEmbed();
    if (activeQuestionId) {
      const question = currentQuestion();
      if (question) return buildQuestionEmbed();
      activeQuestionId = null;
    }
    const screen = screens[screenIndex];
    if (!screen) return buildBasicsEmbed();
    if (screen.type === "questions") return buildQuestionsEmbed();
    if (screen.type === "access") return buildAccessEmbed();
    if (screen.type === "behavior") return buildBehaviorEmbed();
    if (screen.type === "messages") return buildMessagesEmbed();
    if (screen.type === "publish") return buildPublishEmbed();
    return buildBasicsEmbed();
  }

  function desiredReactions() {
    if (transient?.type === "typePicker") {
      return [...TYPE_OPTIONS.map((option) => option.emoji), BACK];
    }
    if (transient?.type === "confirmDelete") return [CONFIRM, CLOSE];
    if (transient?.type === "preview") return [BACK];
    if (activeQuestionId) {
      const question = currentQuestion();
      if (!question) return [CLOSE];
      const reactions = [FIELD_EMOJIS[0], FIELD_EMOJIS[1], FIELD_EMOJIS[2]];
      if (question.type === "choice") reactions.push(FIELD_EMOJIS[3]);
      reactions.push(FIELD_EMOJIS[4], FIELD_EMOJIS[5], DELETE, BACK, ...NAV_EMOJIS, CLOSE);
      return reactions;
    }

    const screen = screens[screenIndex];
    if (!screen) return [CLOSE];
    const reactions = [];
    if (screen.type === "basics") {
      reactions.push(...FIELD_EMOJIS.slice(0, 5));
    } else if (screen.type === "questions") {
      const start = screen.page * QUESTIONS_PER_PAGE;
      const shown = Math.min(QUESTIONS_PER_PAGE, Math.max(0, questions().length - start));
      reactions.push(...FIELD_EMOJIS.slice(0, shown), ADD);
    } else if (screen.type === "access") {
      reactions.push(...FIELD_EMOJIS.slice(0, 4));
    } else if (screen.type === "behavior") {
      reactions.push(...FIELD_EMOJIS.slice(0, 6));
    } else if (screen.type === "messages") {
      reactions.push(...FIELD_EMOJIS.slice(0, 4));
    } else if (screen.type === "publish") {
      reactions.push(...FIELD_EMOJIS.slice(0, 3));
    }
    reactions.push(...NAV_EMOJIS, CLOSE);
    return [...new Set(reactions)];
  }

  async function syncReactions(override = null) {
    if (!menuMsg) return;
    const desired = new Set(override ?? desiredReactions());
    for (const emoji of [...currentReactions]) {
      if (desired.has(emoji)) continue;
      try {
        await menuMsg.removeReactionEmoji(emoji);
        currentReactions.delete(emoji);
      } catch {}
    }
    for (const emoji of desired) {
      if (currentReactions.has(emoji)) continue;
      try {
        await menuMsg.react(emoji);
        currentReactions.add(emoji);
      } catch {}
    }
  }

  function stopInput(reason = "done") {
    const active = inputCollector;
    if (!active) return;
    inputCollector = null;
    active.stop(reason);
  }

  async function render() {
    refreshScreens();
    if (activeQuestionId && !currentQuestion()) activeQuestionId = null;
    if (transient?.type === "confirmDelete" && !currentQuestion()) transient = null;
    try {
      await menuMsg.edit({
        embeds: [buildCurrentEmbed()],
        allowedMentions: noMentions(),
      });
    } catch {
      stopInput("deleted");
      collector?.stop("deleted");
      return false;
    }
    await syncReactions();
    return true;
  }

  async function close() {
    stopInput("closed");
    collector?.stop("closed");
    await menuMsg.removeAllReactions().catch(() => {});
    currentReactions.clear();
    await menuMsg.edit({
      embeds: [new EmbedBuilder().setColor(db.theme).setDescription(t("menuClosed"))],
      allowedMentions: noMentions(),
    }).catch(() => {});
  }

  async function requestValue({ title, lines, validate, apply, after }) {
    if (!channel?.createMessageCollector) {
      notice = t("collectorUnavailable");
      await render();
      return;
    }

    stopInput("replaced");
    const embed = new EmbedBuilder()
      .setColor(form.color || db.theme)
      .setTitle(title)
      .setDescription(truncate([
        ...(lines ?? []),
        "",
        t("menuInputHint"),
      ].join("\n"), 4096))
      .setFooter({ text: t("menuInputFooter", { seconds: Math.round(INPUT_TIMEOUT / 1000) }) });

    try {
      await menuMsg.edit({ embeds: [embed], allowedMentions: noMentions() });
    } catch {
      return;
    }
    await syncReactions([]);

    let active;
    try {
      active = channel.createMessageCollector({
        filter: (input) => input.author?.id === authorId && !input.author.bot,
        time: INPUT_TIMEOUT,
        max: 1,
      });
    } catch {
      notice = t("collectorUnavailable");
      await render();
      return;
    }
    inputCollector = active;

    active.on("collect", async (input) => {
      if (inputCollector !== active) return;
      inputCollector = null;
      const content = String(input.content ?? "").trim();
      await input.delete().catch(() => {});

      if (!content) {
        notice = t("menuInvalidValue");
        await render();
        return;
      }
      if (content.toLowerCase() === "cancel") {
        notice = t("menuCancelled");
        await render();
        return;
      }

      try {
        const error = validate ? await validate(content) : null;
        if (error) {
          notice = error;
          await render();
          return;
        }
        await apply(content);
        form.updatedAt = Date.now();
        await form.save();
        notice = t("menuSaved");
        after?.(content);
        await render();
      } catch (error) {
        console.error("[Forms] menu save:", error);
        notice = t("menuSaveFailed");
        await render();
      }
    });

    active.on("end", async (_, reason) => {
      if (inputCollector !== active) return;
      inputCollector = null;
      if (reason !== "time") return;
      notice = t("menuInputTimeout");
      await render();
    });
  }

  async function persist(successNotice = t("menuSaved")) {
    form.updatedAt = Date.now();
    await form.save();
    notice = successNotice;
    await render();
  }

  async function publishPanel() {
    if (form.status !== "open") {
      notice = t("openRequired");
      return render();
    }
    if (!form.reviewChannelId) {
      notice = t("reviewRequired");
      return render();
    }
    if (!form.panelChannelId) {
      notice = t("panelChannelRequired");
      return render();
    }
    const target = await client.channels.resolve(form.panelChannelId).catch(() => null);
    if (!target) {
      notice = t("invalidChannel");
      return render();
    }

    if (form.panelMessageId) {
      try {
        const oldChannel = await client.channels.resolve(form.panelChannelId);
        const oldMessage = await oldChannel?.messages?.fetch?.(form.panelMessageId);
        await oldMessage?.delete?.();
      } catch {}
    }

    const sent = await target.send({ embeds: [buildPanelEmbed(client, db, form)] }).catch(() => null);
    if (!sent) {
      notice = t("panelSendFailed");
      return render();
    }
    await sent.react(form.panelEmoji).catch(() => {});
    form.panelMessageId = sent.id;
    form.updatedAt = Date.now();
    await form.save();
    notice = t("panelPublished", { channel: `<#${target.id}>` });
    await render();
  }

  async function handleTypePicker(emoji) {
    if (emoji === BACK) {
      transient = null;
      notice = "";
      await render();
      return;
    }
    const selected = TYPE_OPTIONS.find((option) => option.emoji === emoji);
    if (!selected) return;

    const mode = transient?.mode;
    transient = null;

    if (mode === "add") {
      if (questions().length >= MAX_QUESTIONS) {
        notice = t("tooManyQuestions", { max: MAX_QUESTIONS });
        await render();
        return;
      }
      const isChoice = selected.type === "choice";
      let added;
      await requestValue({
        title: t("menuQuestionPromptTitle"),
        lines: [
          isChoice ? t("menuChoicePromptDesc") : t("menuQuestionPromptDesc"),
          ...(isChoice ? [t("menuChoicesHint")] : []),
        ],
        validate: (value) => {
          const parts = splitParts(value);
          if (!parts.length) return t("questionPromptRequired");
          if (isChoice && parts.length < 3) return t("choiceRequired");
          if (isChoice && parts.length - 1 > CHOICE_EMOJIS.length) {
            return t("tooManyChoices", { max: CHOICE_EMOJIS.length });
          }
          return null;
        },
        apply: (value) => {
          const parts = splitParts(value);
          const prompt = isChoice ? parts.shift() : value.trim();
          const choices = isChoice
            ? parts.map((label) => ({ label: label.slice(0, 100), emoji: null }))
            : [];
          added = {
            id: createQuestionId(),
            type: selected.type,
            prompt: prompt.slice(0, 500),
            required: true,
            maxLength: selected.type === "paragraph" ? 2000 : 1000,
            choices,
          };
          form.questions.push(added);
        },
        after: () => {
          activeQuestionId = added?.id ?? null;
          goToQuestionList(questions().length - 1);
          notice = t("questionAdded", { count: questions().length });
        },
      });
      return;
    }

    const question = currentQuestion();
    if (!question) {
      notice = t("notFound");
      await render();
      return;
    }

    const nextType = selected.type;
    const setType = (choices = []) => {
      question.type = nextType;
      question.maxLength = nextType === "paragraph" ? 2000 : 1000;
      question.choices = nextType === "choice" ? choices : [];
    };

    if (nextType === "choice" && (question.choices?.length ?? 0) < 2) {
      await requestValue({
        title: t("menuQuestionChoicesAction"),
        lines: [t("menuChoicesHint")],
        validate: (value) => {
          const parts = splitParts(value);
          if (parts.length < 2) return t("choiceRequired");
          if (parts.length > CHOICE_EMOJIS.length) return t("tooManyChoices", { max: CHOICE_EMOJIS.length });
          return null;
        },
        apply: (value) => {
          setType(splitParts(value).map((label) => ({ label: label.slice(0, 100), emoji: null })));
        },
      });
      return;
    }

    setType(question.choices ?? []);
    await persist(t("menuSaved"));
  }

  async function handleQuestionReaction(emoji) {
    const question = currentQuestion();
    if (!question) {
      activeQuestionId = null;
      await render();
      return;
    }
    const index = questions().findIndex((item) => item.id === question.id);

    if (emoji === CLOSE) return close();
    if (emoji === BACK) {
      activeQuestionId = null;
      goToQuestionList(index);
      notice = "";
      await render();
      return;
    }
    if (NAV_EMOJIS.includes(emoji)) {
      const target = emoji === "⏪"
        ? 0
        : emoji === "⏩"
          ? questions().length - 1
          : emoji === "⬅️"
            ? index - 1
            : index + 1;
      if (target >= 0 && target < questions().length) {
        activeQuestionId = questions()[target].id;
        notice = "";
        await render();
      }
      return;
    }
    if (emoji === DELETE) {
      transient = { type: "confirmDelete" };
      await render();
      return;
    }

    if (emoji === FIELD_EMOJIS[0]) {
      await requestValue({
        title: t("menuQuestionPromptTitle"),
        lines: [`${t("menuCurrent")}: ${truncate(question.prompt, 500)}`],
        validate: (value) => value ? null : t("questionPromptRequired"),
        apply: (value) => {
          question.prompt = value.slice(0, 500);
        },
      });
      return;
    }
    if (emoji === FIELD_EMOJIS[1]) {
      transient = { type: "typePicker", mode: "edit" };
      await render();
      return;
    }
    if (emoji === FIELD_EMOJIS[2]) {
      question.required = question.required === false;
      await persist(t(question.required ? "required" : "optional"));
      return;
    }
    if (emoji === FIELD_EMOJIS[3] && question.type === "choice") {
      await requestValue({
        title: t("menuQuestionChoicesAction"),
        lines: [
          t("menuChoicesHint"),
          `${t("menuCurrent")}: ${truncate((question.choices ?? []).map((choice) => choice.label).join(" | "), 800)}`,
        ],
        validate: (value) => {
          const parts = splitParts(value);
          if (parts.length < 2) return t("choiceRequired");
          if (parts.length > CHOICE_EMOJIS.length) return t("tooManyChoices", { max: CHOICE_EMOJIS.length });
          return null;
        },
        apply: (value) => {
          const previous = question.choices ?? [];
          question.choices = splitParts(value).map((label, choiceIndex) => ({
            label: label.slice(0, 100),
            emoji: previous[choiceIndex]?.emoji ?? null,
          }));
        },
      });
      return;
    }
    if (emoji === FIELD_EMOJIS[4] || emoji === FIELD_EMOJIS[5]) {
      const direction = emoji === FIELD_EMOJIS[4] ? -1 : 1;
      const target = index + direction;
      if (target < 0 || target >= questions().length) {
        notice = t(direction < 0 ? "menuAlreadyFirst" : "menuAlreadyLast");
        await render();
        return;
      }
      const [moved] = form.questions.splice(index, 1);
      form.questions.splice(target, 0, moved);
      activeQuestionId = moved.id;
      await persist(t("questionMoved", {
        from: index + 1,
        to: target + 1,
      }));
    }
  }

  async function handleBasics(emoji) {
    if (emoji === FIELD_EMOJIS[0]) {
      await requestValue({
        title: t("menuInputTitle", { field: t("menuName") }),
        lines: [`${t("menuCurrent")}: ${form.name}`],
        validate: async (value) => {
          if (!value.trim()) return t("nameRequired");
          const existing = await resolveForm(form.guildId, value);
          if (existing && String(existing._id) !== String(form._id)) {
            return t("alreadyExists", { name: value });
          }
          return null;
        },
        apply: (value) => {
          form.name = value.slice(0, 100);
        },
      });
      return;
    }
    if (emoji === FIELD_EMOJIS[1]) {
      await requestValue({
        title: t("menuInputTitle", { field: t("menuDescription") }),
        lines: [
          `${t("menuCurrent")}: ${truncate(form.description || t("notSet"), 800)}`,
          t("menuClearHint"),
        ],
        validate: (value) => value.length > 2000 ? t("menuTooLong") : null,
        apply: (value) => {
          form.description = ["clear", "none"].includes(value.toLowerCase()) ? null : value;
        },
      });
      return;
    }
    if (emoji === FIELD_EMOJIS[2]) {
      await requestValue({
        title: t("menuInputTitle", { field: t("menuColor") }),
        lines: [
          `${t("menuCurrent")}: ${form.color || t("notSet")}`,
          t("menuColorHint"),
        ],
        validate: (value) => {
          if (["clear", "none", "default"].includes(value.toLowerCase())) return null;
          return /^#?[0-9a-f]{6}$/i.test(value) ? null : t("menuInvalidColor");
        },
        apply: (value) => {
          form.color = ["clear", "none", "default"].includes(value.toLowerCase())
            ? null
            : value.startsWith("#") ? value : `#${value}`;
        },
      });
      return;
    }
    if (emoji === FIELD_EMOJIS[3]) {
      await requestValue({
        title: t("menuInputTitle", { field: t("menuImage") }),
        lines: [
          `${t("menuCurrent")}: ${truncate(form.imageUrl || t("notSet"), 800)}`,
          t("menuClearHint"),
        ],
        validate: (value) => {
          if (["clear", "none"].includes(value.toLowerCase())) return null;
          return isHttpUrl(value) ? null : t("menuInvalidImage");
        },
        apply: (value) => {
          form.imageUrl = ["clear", "none"].includes(value.toLowerCase()) ? null : value;
        },
      });
      return;
    }
    if (emoji === FIELD_EMOJIS[4]) {
      await requestValue({
        title: t("menuInputTitle", { field: t("menuEmoji") }),
        lines: [
          `${t("menuCurrent")}: ${form.panelEmoji || t("notSet")}`,
          t("menuEmojiHint"),
        ],
        validate: (value) => value.length > 100 ? t("menuTooLong") : null,
        apply: (value) => {
          form.panelEmoji = ["clear", "none"].includes(value.toLowerCase()) ? "📝" : value;
        },
      });
    }
  }

  async function handleAccess(emoji) {
    if (emoji === FIELD_EMOJIS[0] || emoji === FIELD_EMOJIS[1]) {
      const isPanel = emoji === FIELD_EMOJIS[0];
      const field = isPanel ? "panelChannelId" : "reviewChannelId";
      const label = isPanel ? t("menuPanelChannel") : t("menuReviewChannel");
      await requestValue({
        title: t("menuInputTitle", { field: label }),
        lines: [
          `${t("menuCurrent")}: ${formatChannel(form[field])}`,
          t("menuChannelHint"),
          t("menuClearHint"),
        ],
        validate: async (value) => {
          if (["clear", "none"].includes(value.toLowerCase())) return null;
          const channel = await getTextChannel(client, message, value);
          return channel ? null : t("invalidChannel");
        },
        apply: async (value) => {
          if (["clear", "none"].includes(value.toLowerCase())) {
            form[field] = null;
            return;
          }
          const channel = await getTextChannel(client, message, value);
          form[field] = channel?.id ?? null;
        },
      });
      return;
    }

    const isReviewer = emoji === FIELD_EMOJIS[2];
    const field = isReviewer ? "reviewerRoleIds" : "requiredRoleIds";
    const label = isReviewer ? t("menuReviewerRoles") : t("menuRequiredRoles");
    await requestValue({
      title: t("menuInputTitle", { field: label }),
      lines: [
        `${t("menuCurrent")}: ${formatRoles(form[field])}`,
        t("menuRolesHint"),
        t("menuClearHint"),
      ],
      validate: (value) => {
        if (["clear", "none"].includes(value.toLowerCase())) return null;
        return roleIds(value).length ? null : t("menuInvalidRole");
      },
      apply: (value) => {
        form[field] = ["clear", "none"].includes(value.toLowerCase()) ? [] : roleIds(value);
      },
    });
  }

  async function handleBehavior(emoji) {
    if (emoji === FIELD_EMOJIS[0]) {
      await requestValue({
        title: t("menuInputTitle", { field: t("menuCooldown") }),
        lines: [
          `${t("menuCurrent")}: ${formatDuration(form.cooldownMs)}`,
          t("menuCooldownHint"),
        ],
        validate: (value) => {
          const duration = dhms(value);
          if (duration < MIN_COOLDOWN_MS) return t("cooldownTooShort");
          if (duration > MAX_COOLDOWN_MS) return t("cooldownTooLong");
          return null;
        },
        apply: (value) => {
          form.cooldownMs = dhms(value);
        },
      });
      return;
    }
    if (emoji === FIELD_EMOJIS[1]) {
      form.allowMultiple = !form.allowMultiple;
      await persist(t("menuSaved"));
      return;
    }
    if (emoji === FIELD_EMOJIS[2]) {
      await requestValue({
        title: t("menuInputTitle", { field: t("menuMax") }),
        lines: [
          `${t("menuCurrent")}: ${form.maxSubmissions || t("unlimited")}`,
          t("menuMaxHint"),
        ],
        validate: (value) => {
          const parsed = ["0", "none", "unlimited"].includes(value.toLowerCase())
            ? 0
            : Number.parseInt(value, 10);
          return Number.isInteger(parsed) && parsed >= 0 && parsed <= 1000
            ? null
            : t("menuInvalidMax");
        },
        apply: (value) => {
          form.maxSubmissions = ["0", "none", "unlimited"].includes(value.toLowerCase())
            ? 0
            : Number.parseInt(value, 10);
        },
      });
      return;
    }
    if (emoji === FIELD_EMOJIS[3]) {
      form.reviewerPing = form.reviewerPing === false;
      await persist(t("menuSaved"));
      return;
    }
    if (emoji === FIELD_EMOJIS[4]) {
      form.dmApplicant = form.dmApplicant === false;
      await persist(t("menuSaved"));
      return;
    }
    if (emoji === FIELD_EMOJIS[5]) {
      form.anonymous = !form.anonymous;
      await persist(t("menuSaved"));
    }
  }

  async function handleMessages(emoji) {
    const fields = {
      [FIELD_EMOJIS[0]]: "introMessage",
      [FIELD_EMOJIS[1]]: "confirmationMessage",
      [FIELD_EMOJIS[2]]: "acceptMessage",
      [FIELD_EMOJIS[3]]: "declineMessage",
    };
    const labels = {
      [FIELD_EMOJIS[0]]: t("menuIntroMessage"),
      [FIELD_EMOJIS[1]]: t("menuConfirmationMessage"),
      [FIELD_EMOJIS[2]]: t("menuAcceptMessage"),
      [FIELD_EMOJIS[3]]: t("menuDeclineMessage"),
    };
    const field = fields[emoji];
    if (!field) return;
    await requestValue({
      title: t("menuInputTitle", { field: labels[emoji] }),
      lines: [
        `${t("menuCurrent")}: ${truncate(form[field] || t("menuDefault"), 800)}`,
        t("menuMessageHint"),
        t("menuMessageResetHint"),
      ],
      validate: (value) => value.length > 1000 ? t("messageTooLong") : null,
      apply: (value) => {
        form[field] = value.toLowerCase() === "reset" ? null : value;
      },
    });
  }

  async function handlePublish(emoji) {
    if (emoji === FIELD_EMOJIS[0]) {
      transient = { type: "preview" };
      await render();
      return;
    }
    if (emoji === FIELD_EMOJIS[1]) {
      if (form.status === "open") {
        form.status = "closed";
        await persist(t("closed"));
        return;
      }
      if (!form.questions?.length) {
        notice = t("questionsRequired");
        await render();
        return;
      }
      if (!form.reviewChannelId) {
        notice = t("reviewRequired");
        await render();
        return;
      }
      if (!form.panelChannelId) {
        notice = t("panelChannelRequired");
        await render();
        return;
      }
      form.status = "open";
      await persist(t("opened"));
      return;
    }
    if (emoji === FIELD_EMOJIS[2]) await publishPanel();
  }

  async function handleScreenReaction(emoji) {
    if (emoji === CLOSE) return close();
    if (NAV_EMOJIS.includes(emoji)) {
      const next = emoji === "⏪"
        ? 0
        : emoji === "⏩"
          ? screens.length - 1
          : emoji === "⬅️"
            ? screenIndex - 1
            : screenIndex + 1;
      if (next >= 0 && next < screens.length && next !== screenIndex) {
        screenIndex = next;
        notice = "";
        await render();
      }
      return;
    }

    const screen = screens[screenIndex];
    if (!screen) return;
    if (screen.type === "basics") return handleBasics(emoji);
    if (screen.type === "questions") {
      if (emoji === ADD) {
        transient = { type: "typePicker", mode: "add" };
        await render();
        return;
      }
      const index = FIELD_EMOJIS.indexOf(emoji);
      if (index < 0) return;
      const target = questions()[screen.page * QUESTIONS_PER_PAGE + index];
      if (!target) return;
      activeQuestionId = target.id;
      notice = "";
      await render();
      return;
    }
    if (screen.type === "access") return handleAccess(emoji);
    if (screen.type === "behavior") return handleBehavior(emoji);
    if (screen.type === "messages") return handleMessages(emoji);
    if (screen.type === "publish") return handlePublish(emoji);
  }

  async function handleConfirmDelete(emoji) {
    if (emoji === CLOSE) {
      transient = null;
      notice = "";
      await render();
      return;
    }
    if (emoji !== CONFIRM) return;
    const question = currentQuestion();
    if (!question) {
      transient = null;
      activeQuestionId = null;
      await render();
      return;
    }
    const index = questions().findIndex((item) => item.id === question.id);
    const [removed] = form.questions.splice(index, 1);
    transient = null;
    activeQuestionId = null;
    refreshScreens();
    goToQuestionList(Math.min(index, Math.max(0, questions().length - 1)));
    form.updatedAt = Date.now();
    await form.save();
    notice = t("menuDeleted", { prompt: truncate(removed.prompt, 200) });
    await render();
  }

  async function handleReaction(emoji) {
    if (transient?.type === "typePicker") return handleTypePicker(emoji);
    if (transient?.type === "confirmDelete") return handleConfirmDelete(emoji);
    if (transient?.type === "preview") {
      if (emoji === BACK) {
        transient = null;
        await render();
      }
      return;
    }
    if (activeQuestionId) return handleQuestionReaction(emoji);
    return handleScreenReaction(emoji);
  }

  refreshScreens();

  if (!menuMsg) {
    menuMsg = await message.reply({
      embeds: [buildCurrentEmbed()],
      allowedMentions: noMentions(),
    }).catch(() => null);
    if (!menuMsg) return null;
  } else {
    await menuMsg.removeAllReactions().catch(() => {});
    if (!(await render())) return null;
  }

  try {
    collector = menuMsg.createReactionCollector({
      filter: (reaction, user) => user?.id === authorId && !user.bot,
      time: MENU_TIMEOUT,
    });
  } catch {
    await menuMsg.edit({
      embeds: [new EmbedBuilder().setColor(db.theme).setDescription(t("collectorUnavailable"))],
      allowedMentions: noMentions(),
    }).catch(() => {});
    return menuMsg;
  }

  collector.on("collect", async (reaction) => {
    const emoji = reaction.emoji?.name;
    if (!emoji) return;
    collector.collected.clear();

    if (busy || inputCollector) {
      await menuMsg.removeReaction(emoji, authorId).catch(() => {});
      return;
    }
    if (!desiredReactions().includes(emoji)) {
      await menuMsg.removeReaction(emoji, authorId).catch(() => {});
      return;
    }

    busy = true;
    try {
      await menuMsg.removeReaction(emoji, authorId).catch(() => {});
      notice = "";
      await handleReaction(emoji);
    } catch (error) {
      console.error("[Forms] menu reaction:", error);
      notice = t("menuSaveFailed");
      await render().catch(() => {});
    } finally {
      busy = false;
    }
  });

  collector.on("end", async (_, reason) => {
    if (reason !== "time") return;
    stopInput("timeout");
    await menuMsg.removeAllReactions().catch(() => {});
    currentReactions.clear();
    await menuMsg.edit({
      embeds: [new EmbedBuilder().setColor(db.theme).setDescription(t("menuTimedOut", { "prefix": db.prefix }))],
      allowedMentions: noMentions(),
    }).catch(() => {});
  });

  await syncReactions();
  return menuMsg;
}

module.exports = {
  startFormMenu,
  startFormPicker,
};
