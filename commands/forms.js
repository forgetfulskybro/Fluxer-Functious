const { EmbedBuilder, PermissionFlags } = require("@fluxerjs/core");
const Forms = require("../models/forms");
const FormSubmissions = require("../models/formSubmissions");
const Paginator = require("../functions/pagination");
const dhms = require("../functions/dhms");
const { trackResource } = require("../api/trackSettings");
const { dashboardHelpText } = require("../functions/dashboardHelp");
const { startFormMenu, startFormPicker } = require("../functions/formMenu");

const MAX_FORMS = 25;
const MAX_QUESTIONS = 50;
const QUESTIONS_PER_PAGE = 10;
const MAX_EMBED_CHARS = 6000;
const PAGE_FOOTER_RESERVE = 32;
const EMBED_FIELD_NAME_LIMIT = 256;
const EMBED_FIELD_VALUE_LIMIT = 1024;
const {
  CHOICE_EMOJIS,
  formT,
  isAdmin,
  isReviewer,
  getGuildDb,
  resolveForm,
  getMember,
  sendDM,
  buildPanelEmbed,
  buildReviewEmbed,
  reviewPageCount,
  addReviewReactions,
  finalizeReview,
} = require("../functions/formHelpers");

function formError(client, message, db, key, vars) {
  return message.reply({
    embeds: [
      new EmbedBuilder()
        .setColor("#FF0000")
        .setDescription(formT(client, db, key, vars)),
    ],
  });
}

function roleId(value) {
  if (!value) return null;
  const match = String(value).match(/(\d{15,25})/);
  return match ? match[1] : null;
}

async function memberFor(message) {
  return message.guild?.members?.get(message.author.id) ??
    await message.guild?.fetchMember?.(message.author.id).catch(() => null);
}

async function requireAdmin(client, message, db) {
  const member = await memberFor(message);
  if (!isAdmin(member, client)) {
    await message.reply({
      embeds: [new EmbedBuilder().setColor("#FF0000").setDescription(formT(client, db, "adminOnly"))],
    });
    return null;
  }
  return member;
}

async function requireReviewer(client, message, db, form) {
  const member = await memberFor(message);
  if (!isReviewer(member, form, client)) {
    await message.reply({
      embeds: [new EmbedBuilder().setColor("#FF0000").setDescription(formT(client, db, "reviewerOnly"))],
    });
    return null;
  }
  return member;
}

async function getTextChannel(client, message, value) {
  const id = String(value ?? "").replace(/[<#>]/g, "");
  if (!id) return null;
  const channel = await client.channels.resolve(id).catch(() => null);
  if (!channel || channel.type !== 0) return null;
  const guildId = channel.guildId ?? channel.guild?.id;
  if (guildId && guildId !== message.guildId) return null;
  return channel;
}

function questionId() {
  return `q${Date.now()}${Math.floor(Math.random() * 1000)}`;
}

function splitParts(input) {
  return String(input ?? "")
    .split("|")
    .map((value) => value.trim())
    .filter(Boolean);
}

function isHttpUrl(value) {
  try {
    const url = new URL(String(value));
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function parseBool(value) {
  return ["yes", "true", "1", "on", "enable", "enabled"].includes(String(value ?? "").toLowerCase());
}

function helpEmbed(client, db, guildId) {
  const t = (key, vars) => formT(client, db, key, vars);
  return new EmbedBuilder()
    .setColor(db.theme)
    .setTitle(t("helpTitle"))
    .setDescription(
      [
        `**${t("setupTitle")}**`,
        `\`${db.prefix}forms setup [form]\``,
        `\`${db.prefix}forms create <name>\``,
        `\`${db.prefix}forms edit <form>\``,
        `\`${db.prefix}forms edit <form> <field>:<value>\``,
        `\`${db.prefix}forms description <form> <text>\``,
        `\`${db.prefix}forms question add <form> <text|paragraph|choice> | <prompt> [| option] [| option]\``,
        `\`${db.prefix}forms question remove <form> <number>\``,
        `\`${db.prefix}forms question move <form> <number> <new number>\``,
        `\`${db.prefix}forms channel <form> #channel\``,
        `\`${db.prefix}forms review <form> #channel\``,
        `\`${db.prefix}forms reviewer <form> @role|clear\``,
        `\`${db.prefix}forms require <form> @role|clear\``,
        `\`${db.prefix}forms emoji <form> <emoji>\``,
        `\`${db.prefix}forms color <form> #hex\``,
        `\`${db.prefix}forms image <form> <url|clear>\``,
        `\`${db.prefix}forms cooldown <form> <duration>\``,
        `\`${db.prefix}forms multiple <form> yes|no\``,
        `\`${db.prefix}forms ping <form> yes|no\``,
        `\`${db.prefix}forms dm <form> yes|no\``,
        `\`${db.prefix}forms anonymous <form> yes|no\``,
        `\`${db.prefix}forms max <form> <number|unlimited>\``,
        `\`${db.prefix}forms message <form> <intro|confirmation|accept|decline> <text>\``,
        "",
        `**${t("publishTitle")}**`,
        `\`${db.prefix}forms preview <form>\``,
        `\`${db.prefix}forms open <form>\``,
        `\`${db.prefix}forms panel <form> [#channel]\``,
        `\`${db.prefix}forms close <form>\``,
        "",
        `**${t("reviewSection")}**`,
        `\`${db.prefix}forms submissions <form> [status]\``,
        `\`${db.prefix}forms submission <id>\``,
        `\`${db.prefix}forms reason <id> <reason>\``,
        `\`${db.prefix}forms repost <id>\``,
        `\`${db.prefix}forms withdraw <id>\``,
        "",
        `\`${db.prefix}forms list\``,
        `\`${db.prefix}forms view <form>\``,
        `\`${db.prefix}forms delete <form> confirm\``,
        "",
        t("menuHint"),
        "",
        t("reviewHint"),
        "",
        t("dmHint"),
        "",
        dashboardHelpText(client, db, guildId, "forms"),
      ].join("\n")
    );
}

async function createForm(client, message, args, db) {
  if (!(await requireAdmin(client, message, db))) return;
  const name = args.slice(1).join(" ").trim();
  if (!name) return formError(client, message, db, "nameRequired");
  if (await resolveForm(message.guildId, name)) {
    return formError(client, message, db, "alreadyExists", { name });
  }
  const count = await Forms.countDocuments({ guildId: message.guildId }).catch(() => 0);
  if (count >= MAX_FORMS) return formError(client, message, db, "tooManyForms", { max: MAX_FORMS });
  const form = await Forms.create({
    guildId: message.guildId,
    name: name.slice(0, 100),
    createdBy: message.author.id,
  });
  await trackResource(client, {
    userId: message.author.id,
    groupId: message.guildId,
    category: "forms",
    key: "form",
    action: "create",
    label: "Form",
    value: { id: String(form._id), name: form.name },
    previous: null,
  }).catch(() => {});
  const menu = await startFormMenu(
    client,
    message,
    db,
    form,
    null,
    formT(client, db, "created", { name: form.name })
  );
  if (menu) return menu;
  return message.reply({
    embeds: [
      new EmbedBuilder()
        .setColor(db.theme)
        .setDescription(formT(client, db, "created", { name: form.name })),
    ],
  });
}

async function listForms(client, message, db) {
  const forms = await Forms.find({ guildId: message.guildId }).sort({ createdAt: 1 }).lean();
  if (!forms.length) {
    return message.reply({ embeds: [new EmbedBuilder().setColor(db.theme).setDescription(formT(client, db, "listEmpty"))] });
  }
  const paginator = new Paginator({ user: message.author.id, client, timeout: 60000 });
  for (let index = 0; index < forms.length; index += 8) {
    const page = new EmbedBuilder()
      .setColor(db.theme)
      .setTitle(formT(client, db, "listTitle"))
      .setFooter({ text: formT(client, db, "listFooter", { count: forms.length }) });
    for (const form of forms.slice(index, index + 8)) {
      page.addFields({
        name: `${form.name} - ${form.status}`,
        value: formT(client, db, "listItem", {
          questions: form.questions?.length ?? 0,
          reviews: form.reviewChannelId ? `<#${form.reviewChannelId}>` : formT(client, db, "notSet"),
        }),
        inline: false,
      });
    }
    paginator.add(page);
  }
  return paginator.start(message.channel);
}

function buildQuestionField(client, db, question, index) {
  return {
    name: `${index + 1}. ${question.prompt} (${question.type}${question.required ? "" : ", optional"})`,
    value: question.type === "choice"
      ? (question.choices ?? []).map((choice, choiceIndex) => `${CHOICE_EMOJIS[choiceIndex] || "•"} ${choice.label}`).join("\n")
      : formT(client, db, "textQuestion"),
    inline: false,
  };
}

function fieldCharCount(field) {
  return Math.min(String(field.name).length, EMBED_FIELD_NAME_LIMIT) +
    Math.min(String(field.value).length, EMBED_FIELD_VALUE_LIMIT);
}

function paginateQuestions(client, db, questions, baseLength) {
  const pages = [];
  let page = [];
  let pageLength = baseLength + PAGE_FOOTER_RESERVE;

  for (let index = 0; index < questions.length; index += 1) {
    const field = buildQuestionField(client, db, questions[index], index);
    const fieldLength = fieldCharCount(field);

    if (page.length >= QUESTIONS_PER_PAGE || (page.length && pageLength + fieldLength > MAX_EMBED_CHARS)) {
      pages.push(page);
      page = [];
      pageLength = baseLength + PAGE_FOOTER_RESERVE;
    }

    page.push(field);
    pageLength += fieldLength;
  }

  if (page.length) pages.push(page);
  return pages;
}

async function viewForm(client, message, args, db) {
  const form = await resolveForm(message.guildId, args[1]);
  if (!form) return formError(client, message, db, "notFound");
  const fields = [
    { name: formT(client, db, "statusLabel"), value: form.status, inline: true },
    { name: formT(client, db, "reviewChannel"), value: form.reviewChannelId ? `<#${form.reviewChannelId}>` : formT(client, db, "notSet"), inline: true },
    { name: formT(client, db, "panelChannel"), value: form.panelChannelId ? `<#${form.panelChannelId}>` : formT(client, db, "notSet"), inline: true },
    { name: formT(client, db, "cooldownLabel"), value: `${Math.round((form.cooldownMs || 0) / 60000)}m`, inline: true },
    { name: formT(client, db, "maxSubmissionsLabel"), value: form.maxSubmissions ? String(form.maxSubmissions) : formT(client, db, "unlimited"), inline: true },
    { name: formT(client, db, "multipleLabel"), value: form.allowMultiple ? formT(client, db, "enabled") : formT(client, db, "disabled"), inline: true },
    { name: formT(client, db, "reviewersLabel"), value: form.reviewerRoleIds?.length ? form.reviewerRoleIds.map((id) => `<@&${id}>`).join(", ") : formT(client, db, "notSet"), inline: false },
  ];
  const questions = form.questions ?? [];
  const description = form.description || formT(client, db, "noDescription");

  if (!questions.length) {
    return message.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(form.color || db.theme)
          .setTitle(form.name)
          .setDescription(description)
          .addFields(...fields),
      ],
    });
  }

  const baseLength = Math.min(String(form.name).length, 256) +
    Math.min(description.length, 4096) +
    fields.reduce((total, field) => total + fieldCharCount(field), 0);
  const questionPages = paginateQuestions(client, db, questions, baseLength);
  const paginator = new Paginator({ user: message.author.id, client, timeout: 60000 });

  for (const questionFields of questionPages) {
    const embed = new EmbedBuilder()
      .setColor(form.color || db.theme)
      .setTitle(form.name)
      .setDescription(description)
      .addFields(...fields)
      .addFields(...questionFields);
    paginator.add(embed);
  }

  return paginator.start(message.channel);
}

async function addQuestion(client, message, args, db) {
  if (!(await requireAdmin(client, message, db))) return;
  const form = await resolveForm(message.guildId, args[2]);
  if (!form) return formError(client, message, db, "notFound");
  const type = String(args[3] || "text").toLowerCase();
  if (!["text", "paragraph", "choice"].includes(type)) {
    return formError(client, message, db, "questionTypeError");
  }
  const parts = splitParts(args.slice(4).join(" "));
  const prompt = parts.shift();
  if (!prompt) return formError(client, message, db, "questionPromptRequired");
  const choices = type === "choice" ? parts : [];
  if (type === "choice" && choices.length < 2) {
    return formError(client, message, db, "choiceRequired");
  }
  if (choices.length > CHOICE_EMOJIS.length) {
    return formError(client, message, db, "tooManyChoices", { max: CHOICE_EMOJIS.length });
  }
  if ((form.questions?.length ?? 0) >= MAX_QUESTIONS) {
    return formError(client, message, db, "tooManyQuestions", { max: MAX_QUESTIONS });
  }

  form.questions.push({
    id: questionId(),
    type,
    prompt: prompt.slice(0, 500),
    required: true,
    maxLength: type === "paragraph" ? 2000 : 1000,
    choices: choices.slice(0, CHOICE_EMOJIS.length).map((label) => ({ label: label.slice(0, 100), emoji: null })),
  });
  form.updatedAt = Date.now();
  await form.save();
  return message.reply({ content: formT(client, db, "questionAdded", { count: form.questions.length }) });
}

async function questionTypePicker(client, message, args, db) {
  if (!(await requireAdmin(client, message, db))) return;
  const form = await resolveForm(message.guildId, args[2]);
  if (!form) return formError(client, message, db, "notFound");
  const types = [
    { type: "text", emoji: "✏️" },
    { type: "paragraph", emoji: "📄" },
    { type: "choice", emoji: "🔢" },
  ];
  const prompt = await message.reply({
    embeds: [new EmbedBuilder().setColor(db.theme).setDescription(formT(client, db, "questionTypePicker"))],
  });
  for (const item of types) await prompt.react(item.emoji).catch(() => {});
  const collector = prompt.createReactionCollector({
    filter: (reaction, user) => user?.id === message.author.id && types.some((item) => item.emoji === reaction.emoji?.name),
    time: 30_000,
    max: 1,
  });
  collector.on("collect", async (reaction) => {
    const selected = types.find((item) => item.emoji === reaction.emoji.name);
    if (!selected) return;
    await prompt.removeAllReactions?.().catch(() => {});
    await prompt.edit({ embeds: [new EmbedBuilder().setColor(db.theme).setDescription(formT(client, db, "questionPrompt", { type: selected.type }))] }).catch(() => {});
    const answerCollector = message.channel.createMessageCollector?.({
      filter: (next) => next.author?.id === message.author.id,
      time: 60_000,
      max: 1,
    });
    if (!answerCollector) return formError(client, message, db, "collectorUnavailable");
    answerCollector.on("collect", async (next) => {
      if (next.content.toLowerCase() === "cancel") return prompt.edit({ embeds: [new EmbedBuilder().setColor(db.theme).setDescription(formT(client, db, "setupCancelled"))] }).catch(() => {});
      await addQuestion(client, next, ["forms", "question", "add", String(form._id), selected.type, next.content], db);
    });
  });
  collector.on("end", () => prompt.removeAllReactions?.().catch(() => {}));
}

async function removeQuestion(client, message, args, db) {
  if (!(await requireAdmin(client, message, db))) return;
  const form = await resolveForm(message.guildId, args[2]);
  if (!form) return formError(client, message, db, "notFound");
  const index = Number.parseInt(args[3], 10) - 1;
  if (!Number.isInteger(index) || index < 0 || index >= form.questions.length) {
    return formError(client, message, db, "invalidQuestion");
  }
  const [removed] = form.questions.splice(index, 1);
  form.updatedAt = Date.now();
  await form.save();
  return message.reply({ content: formT(client, db, "questionRemoved", { prompt: removed.prompt }) });
}

async function moveQuestion(client, message, args, db) {
  if (!(await requireAdmin(client, message, db))) return;
  const form = await resolveForm(message.guildId, args[2]);
  if (!form) return formError(client, message, db, "notFound");
  const from = Number.parseInt(args[3], 10) - 1;
  const to = Number.parseInt(args[4], 10) - 1;
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < 0 || from >= form.questions.length || to >= form.questions.length) {
    return formError(client, message, db, "invalidQuestion");
  }
  const [question] = form.questions.splice(from, 1);
  form.questions.splice(to, 0, question);
  form.updatedAt = Date.now();
  await form.save();
  return message.reply({ content: formT(client, db, "questionMoved", { from: from + 1, to: to + 1 }) });
}

async function editForm(client, message, args, db) {
  if (!(await requireAdmin(client, message, db))) return;
  const form = await resolveForm(message.guildId, args[1]);
  if (!form) return formError(client, message, db, "notFound");
  const raw = args.slice(2).join(" ").trim();
  if (!raw) return startFormMenu(client, message, db, form);
  const colon = raw.indexOf(":");
  if (colon === -1) return formError(client, message, db, "editUsage");
  const field = raw.slice(0, colon).trim().toLowerCase();
  const value = raw.slice(colon + 1).trim();
  if (!value) return formError(client, message, db, "editUsage");

  if (field === "name") {
    const existing = await resolveForm(message.guildId, value);
    if (existing && String(existing._id) !== String(form._id)) return formError(client, message, db, "alreadyExists", { name: value });
    form.name = value.slice(0, 100);
  } else if (field === "description") {
    form.description = value.slice(0, 2000);
  } else if (field === "color") {
    if (!/^#?[0-9a-f]{6}$/i.test(value)) return formError(client, message, db, "invalidColor");
    form.color = value.startsWith("#") ? value : `#${value}`;
  } else if (field === "image") {
    if (!isHttpUrl(value)) return formError(client, message, db, "invalidImage");
    form.imageUrl = value;
  } else if (field === "emoji") {
    form.panelEmoji = value;
  } else if (field === "cooldown") {
    const duration = dhms(value);
    if (duration < 60 * 60 * 1000) return formError(client, message, db, "cooldownTooShort");
    if (duration > 30 * 24 * 60 * 60 * 1000) return formError(client, message, db, "cooldownTooLong");
    form.cooldownMs = duration;
  } else if (["multiple", "ping", "dm", "anonymous"].includes(field)) {
    const key = { multiple: "allowMultiple", ping: "reviewerPing", dm: "dmApplicant", anonymous: "anonymous" }[field];
    form[key] = parseBool(value);
  } else {
    return formError(client, message, db, "editUsage");
  }
  form.updatedAt = Date.now();
  await form.save();
  return message.reply({ content: formT(client, db, "edited") });
}

async function updateChannel(client, message, args, db, field, labelKey) {
  if (!(await requireAdmin(client, message, db))) return;
  const form = await resolveForm(message.guildId, args[2]);
  if (!form) return formError(client, message, db, "notFound");
  if (args[3]?.toLowerCase() === "clear" || args[3]?.toLowerCase() === "none") {
    form[field] = null;
    form.updatedAt = Date.now();
    await form.save();
    return message.reply({ content: formT(client, db, `${labelKey}Cleared`) });
  }
  const channel = await getTextChannel(client, message, args[3]);
  if (!channel) return formError(client, message, db, "invalidChannel");
  form[field] = channel.id;
  form.updatedAt = Date.now();
  await form.save();
  return message.reply({ content: formT(client, db, `${labelKey}Set`, { channel: `<#${channel.id}>` }) });
}

async function updateReviewer(client, message, args, db, field, labelKey) {
  if (!(await requireAdmin(client, message, db))) return;
  const form = await resolveForm(message.guildId, args[2]);
  if (!form) return formError(client, message, db, "notFound");
  if (args[3]?.toLowerCase() === "clear" || args[3]?.toLowerCase() === "none") {
    form[field] = [];
    form.updatedAt = Date.now();
    await form.save();
    return message.reply({ content: formT(client, db, `${labelKey}Cleared`) });
  }
  const id = roleId(args[3]);
  if (!id) return formError(client, message, db, "invalidRole");
  if (!form[field].includes(id)) form[field].push(id);
  form.updatedAt = Date.now();
  await form.save();
  return message.reply({ content: formT(client, db, `${labelKey}Set`, { role: `<@&${id}>` }) });
}

async function withdrawSubmission(client, message, args, db) {
  const submission = await FormSubmissions.findById(args[1]).catch(() => null);
  if (!submission || submission.guildId !== message.guildId) {
    return formError(client, message, db, "submissionNotFound");
  }
  const form = await Forms.findById(submission.formId).catch(() => null);
  if (!form) return formError(client, message, db, "notFound");
  const member = await memberFor(message);
  if (submission.userId !== message.author.id && !isAdmin(member, client)) {
    return formError(client, message, db, "withdrawOwn");
  }
  if (!["in_progress", "pending"].includes(submission.status)) {
    return formError(client, message, db, "withdrawClosed");
  }
  if (submission.reviewMessageId && submission.reviewChannelId) {
    try {
      const channel = await client.channels.resolve(submission.reviewChannelId);
      const review = await channel?.messages?.fetch?.(submission.reviewMessageId);
      await review?.delete?.();
    } catch {}
  }
  submission.status = "withdrawn";
  submission.reviewMessageId = null;
  submission.reviewChannelId = null;
  submission.updatedAt = Date.now();
  await submission.save();
  await sendDM(client, submission.userId, { content: formT(client, db, "withdrawnDM", { form: form.name }) }).catch(() => {});
  return message.reply({ content: formT(client, db, "withdrawn") });
}

async function repostSubmission(client, message, args, db) {
  const submission = await FormSubmissions.findById(args[1]).catch(() => null);
  if (!submission || submission.guildId !== message.guildId) {
    return formError(client, message, db, "submissionNotFound");
  }
  const form = await Forms.findById(submission.formId).catch(() => null);
  if (!form) return formError(client, message, db, "notFound");
  const member = await memberFor(message);
  if (!isReviewer(member, form, client)) return formError(client, message, db, "reviewerOnly");
  if (submission.status !== "pending") return formError(client, message, db, "repostPending");
  const channel = form.reviewChannelId && await client.channels.resolve(form.reviewChannelId).catch(() => null);
  if (!channel) return formError(client, message, db, "reviewRequired");
  submission.reviewPage = 0;
  const review = await channel.send({
    content: form.reviewerPing && form.reviewerRoleIds?.length
      ? form.reviewerRoleIds.map((id) => `<@&${id}>`).join(" ")
      : undefined,
    embeds: [buildReviewEmbed(client, db, form, submission, 0)],
    allowedMentions: { parse: form.reviewerPing && form.reviewerRoleIds?.length ? ["roles"] : [] },
  }).catch(() => null);
  if (!review) return formError(client, message, db, "panelSendFailed");
  submission.reviewChannelId = channel.id;
  submission.reviewMessageId = review.id;
  submission.updatedAt = Date.now();
  await submission.save();
  await addReviewReactions(client, form, review);
  return message.reply({ content: formT(client, db, "reposted", { channel: `<#${channel.id}>` }) });
}

async function setImage(client, message, args, db) {
  if (!(await requireAdmin(client, message, db))) return;
  const form = await resolveForm(message.guildId, args[1]);
  if (!form) return formError(client, message, db, "notFound");
  const value = String(args[2] ?? "").trim();
  if (!value || value.toLowerCase() === "clear" || value.toLowerCase() === "none") {
    form.imageUrl = null;
    form.updatedAt = Date.now();
    await form.save();
    return message.reply({ content: formT(client, db, "imageCleared") });
  }
  if (!isHttpUrl(value)) return formError(client, message, db, "invalidImage");
  form.imageUrl = value;
  form.updatedAt = Date.now();
  await form.save();
  return message.reply({ content: formT(client, db, "imageSet") });
}

async function setBoolean(client, message, args, db, field, labelKey) {
  if (!(await requireAdmin(client, message, db))) return;
  const form = await resolveForm(message.guildId, args[1]);
  if (!form) return formError(client, message, db, "notFound");
  const value = String(args[2] ?? "").toLowerCase();
  if (!["yes", "no", "true", "false", "on", "off", "enable", "disable", "enabled", "disabled"].includes(value)) {
    return formError(client, message, db, "booleanError");
  }
  form[field] = parseBool(value);
  form.updatedAt = Date.now();
  await form.save();
  return message.reply({
    content: formT(client, db, `${labelKey}Set`, {
      value: form[field] ? formT(client, db, "enabled") : formT(client, db, "disabled"),
    }),
  });
}

async function previewForm(client, message, args, db) {
  if (!(await requireAdmin(client, message, db))) return;
  const form = await resolveForm(message.guildId, args[1]);
  if (!form) return formError(client, message, db, "notFound");
  return message.reply({ embeds: [buildPanelEmbed(client, db, form)] });
}

async function setEmoji(client, message, args, db) {
  if (!(await requireAdmin(client, message, db))) return;
  const form = await resolveForm(message.guildId, args[1]);
  if (!form) return formError(client, message, db, "notFound");
  const emoji = args[2];
  if (emoji) {
    form.panelEmoji = emoji;
    form.updatedAt = Date.now();
    await form.save();
    return message.reply({ content: formT(client, db, "emojiSet", { emoji }) });
  }

  const choices = ["✅", "📝", "📋", "📨", "🎟️"];
  const prompt = await message.reply({ embeds: [new EmbedBuilder().setColor(db.theme).setDescription(formT(client, db, "emojiPicker"))] });
  for (const choice of choices) await prompt.react(choice).catch(() => {});
  const collector = prompt.createReactionCollector({
    filter: (reaction, user) => user?.id === message.author.id && choices.includes(reaction.emoji?.name),
    time: 30_000,
    max: 1,
  });
  collector.on("collect", async (reaction) => {
    form.panelEmoji = reaction.emoji.name;
    form.updatedAt = Date.now();
    await form.save().catch(() => {});
    await prompt.removeAllReactions?.().catch(() => {});
    await prompt.edit({ embeds: [new EmbedBuilder().setColor(db.theme).setDescription(formT(client, db, "emojiSet", { emoji: form.panelEmoji }))] }).catch(() => {});
  });
  collector.on("end", () => prompt.removeAllReactions?.().catch(() => {}));
}

async function setupForm(client, message, args, db) {
  if (!(await requireAdmin(client, message, db))) return;
  if (args[1]) {
    const form = await resolveForm(message.guildId, args[1]);
    if (!form) return formError(client, message, db, "notFound");
    return startFormMenu(client, message, db, form);
  }

  const forms = await Forms.find({ guildId: message.guildId }).sort({ createdAt: 1 }).lean();
  if (!forms.length) return message.reply({ content: formT(client, db, "listEmpty") });
  if (forms.length === 1) {
    const form = await Forms.findById(forms[0]._id).catch(() => null);
    if (form) return startFormMenu(client, message, db, form);
  }
  return startFormPicker(client, message, db, forms);
}

async function setMessage(client, message, args, db) {
  if (!(await requireAdmin(client, message, db))) return;
  const form = await resolveForm(message.guildId, args[1]);
  if (!form) return formError(client, message, db, "notFound");
  const type = String(args[2] || "").toLowerCase();
  const field = {
    intro: "introMessage",
    confirmation: "confirmationMessage",
    accept: "acceptMessage",
    decline: "declineMessage",
  }[type];
  if (!field) return formError(client, message, db, "messageTypeError");
  const text = args.slice(3).join(" ").trim();
  if (!text || text.toLowerCase() === "reset") {
    form[field] = null;
    form.updatedAt = Date.now();
    await form.save();
    return message.reply({ content: formT(client, db, "messageReset") });
  }
  if (text.length > 1000) return formError(client, message, db, "messageTooLong");
  form[field] = text;
  form.updatedAt = Date.now();
  await form.save();
  return message.reply({ content: formT(client, db, "messageSet") });
}

async function setMaxSubmissions(client, message, args, db) {
  if (!(await requireAdmin(client, message, db))) return;
  const form = await resolveForm(message.guildId, args[1]);
  if (!form) return formError(client, message, db, "notFound");
  const raw = String(args[2] || "").toLowerCase();
  const value = ["0", "none", "unlimited"].includes(raw) ? 0 : Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value < 0 || value > 1000) {
    return formError(client, message, db, "maxSubmissionsUsage");
  }
  form.maxSubmissions = value;
  form.updatedAt = Date.now();
  await form.save();
  return message.reply({ content: formT(client, db, "maxSubmissionsSet", { value: value || formT(client, db, "unlimited") }) });
}

async function openForm(client, message, args, db) {
  if (!(await requireAdmin(client, message, db))) return;
  const form = await resolveForm(message.guildId, args[1]);
  if (!form) return formError(client, message, db, "notFound");
  if (!form.reviewChannelId) return formError(client, message, db, "reviewRequired");
  if (!form.panelChannelId) return formError(client, message, db, "panelChannelRequired");
  if (!form.questions?.length) return formError(client, message, db, "questionsRequired");
  form.status = "open";
  form.updatedAt = Date.now();
  await form.save();
  return message.reply({ content: formT(client, db, "opened") });
}

async function closeForm(client, message, args, db) {
  if (!(await requireAdmin(client, message, db))) return;
  const form = await resolveForm(message.guildId, args[1]);
  if (!form) return formError(client, message, db, "notFound");
  form.status = "closed";
  form.updatedAt = Date.now();
  await form.save();
  return message.reply({ content: formT(client, db, "closed") });
}

async function publishPanel(client, message, args, db) {
  if (!(await requireAdmin(client, message, db))) return;
  const form = await resolveForm(message.guildId, args[1]);
  if (!form) return formError(client, message, db, "notFound");
  if (form.status !== "open") return formError(client, message, db, "openRequired");
  if (!form.reviewChannelId) return formError(client, message, db, "reviewRequired");
  const channel = args[2]
    ? await getTextChannel(client, message, args[2])
    : await client.channels.resolve(form.panelChannelId).catch(() => null);
  if (!channel) return formError(client, message, db, "invalidChannel");

  if (form.panelMessageId && form.panelChannelId) {
    try {
      const oldChannel = await client.channels.resolve(form.panelChannelId);
      const oldMessage = await oldChannel?.messages?.fetch?.(form.panelMessageId);
      await oldMessage?.delete?.();
    } catch {}
  }

  const sent = await channel.send({ embeds: [buildPanelEmbed(client, db, form)] }).catch(() => null);
  if (!sent) return formError(client, message, db, "panelSendFailed");
  await sent.react(form.panelEmoji).catch(() => {});
  form.panelChannelId = channel.id;
  form.panelMessageId = sent.id;
  form.updatedAt = Date.now();
  await form.save();
  return message.reply({ content: formT(client, db, "panelPublished", { channel: `<#${channel.id}>` }) });
}

async function listSubmissions(client, message, args, db) {
  const form = await resolveForm(message.guildId, args[1]);
  if (!form) return formError(client, message, db, "notFound");
  const member = await memberFor(message);
  if (!isReviewer(member, form, client)) return formError(client, message, db, "reviewerOnly");
  const status = args[2] || "pending";
  const submissions = await FormSubmissions.find({
    formId: String(form._id),
    ...(status === "all" ? {} : { status }),
  }).sort({ updatedAt: -1 }).limit(100).lean();
  if (!submissions.length) return message.reply({ content: formT(client, db, "noSubmissions") });

  const paginator = new Paginator({ user: message.author.id, client, timeout: 60000 });
  for (let index = 0; index < submissions.length; index += 8) {
    const embed = new EmbedBuilder()
      .setColor(db.theme)
      .setTitle(formT(client, db, "submissionsTitle", { form: form.name }))
      .setFooter({ text: `${submissions.length} submission(s)` });
    for (const submission of submissions.slice(index, index + 8)) {
      const applicant = form.anonymous
        ? formT(client, db, "anonymousApplicant")
        : `<@${submission.userId}>`;
      embed.addFields({
        name: `\`${submission._id}\` - ${submission.status}`,
        value: `${formT(client, db, "applicant")}: ${applicant}\n${submission.submittedAt ? `<t:${Math.floor(submission.submittedAt / 1000)}:R>` : ""}`,
        inline: false,
      });
    }
    paginator.add(embed);
  }
  return paginator.start(message.channel);
}

async function viewSubmission(client, message, args, db) {
  const submission = await FormSubmissions.findById(args[1]).catch(() => null);
  if (!submission || submission.guildId !== message.guildId) {
    return formError(client, message, db, "submissionNotFound");
  }
  const form = await Forms.findById(submission.formId).catch(() => null);
  if (!form) return formError(client, message, db, "notFound");
  const member = await memberFor(message);
  if (!isReviewer(member, form, client)) return formError(client, message, db, "reviewerOnly");
  const totalPages = reviewPageCount(form);
  if (totalPages <= 1) {
    return message.reply({ embeds: [buildReviewEmbed(client, db, form, submission, 0)] });
  }
  const paginator = new Paginator({ user: message.author.id, client, timeout: 60000 });
  for (let page = 0; page < totalPages; page += 1) {
    paginator.add(buildReviewEmbed(client, db, form, submission, page));
  }
  return paginator.start(message.channel);
}

async function setReason(client, message, args, db) {
  const submission = await FormSubmissions.findById(args[1]).catch(() => null);
  if (!submission || submission.guildId !== message.guildId || submission.status !== "pending") {
    return formError(client, message, db, "submissionNotFound");
  }
  const form = await Forms.findById(submission.formId).catch(() => null);
  if (!form) return formError(client, message, db, "notFound");
  const member = await memberFor(message);
  if (!isReviewer(member, form, client)) return formError(client, message, db, "reviewerOnly");
  const reason = args.slice(2).join(" ").trim();
  if (!reason) return formError(client, message, db, "reasonRequired");
  await finalizeReview(client, form, submission, "declined", message.author.id, reason.slice(0, 1000));
  return message.reply({ content: formT(client, db, "declined") });
}

async function deleteForm(client, message, args, db) {
  if (!(await requireAdmin(client, message, db))) return;
  const form = await resolveForm(message.guildId, args[1]);
  if (!form) return formError(client, message, db, "notFound");
  if (String(args[2] || "").toLowerCase() !== "confirm") {
    return message.reply({ content: formT(client, db, "deleteConfirm", { name: form.name }) });
  }
  if (form.panelMessageId && form.panelChannelId) {
    try {
      const channel = await client.channels.resolve(form.panelChannelId);
      const panelMessage = await channel?.messages?.fetch?.(form.panelMessageId);
      await panelMessage?.delete?.();
    } catch {}
  }

  const submissions = await FormSubmissions.find({ formId: String(form._id) }).lean().catch(() => []);
  for (const submission of submissions) {
    if (!submission.reviewMessageId || !submission.reviewChannelId) continue;
    try {
      const channel = await client.channels.resolve(submission.reviewChannelId);
      const reviewMessage = await channel?.messages?.fetch?.(submission.reviewMessageId);
      await reviewMessage?.delete?.();
    } catch {}
  }

  await FormSubmissions.deleteMany({ formId: String(form._id) });
  await Forms.deleteOne({ _id: form._id });
  return message.reply({ content: formT(client, db, "deleted", { name: form.name }) });
}

module.exports = {
  config: {
    name: "forms",
    usage: "help",
    cooldown: 5000,
    category: "forms",
    available: true,
    permissions: {},
    aliases: ["form"],
  },

  run: async (client, message, args, db) => {
    const sub = (args[0] || "help").toLowerCase();
    if (!args[0] || sub === "help") return message.reply({ embeds: [helpEmbed(client, db, message.guildId)] });
    if (sub === "setup") return setupForm(client, message, args, db);
    if (sub === "create") return createForm(client, message, args, db);
    if (sub === "edit") return editForm(client, message, args, db);
    if (sub === "list") return listForms(client, message, db);
    if (sub === "view") return viewForm(client, message, args, db);
    if (sub === "description") {
      if (!(await requireAdmin(client, message, db))) return;
      const form = await resolveForm(message.guildId, args[1]);
      if (!form) return formError(client, message, db, "notFound");
      form.description = args.slice(2).join(" ").trim().slice(0, 2000) || null;
      form.updatedAt = Date.now();
      await form.save();
      return message.reply({ content: formT(client, db, "descriptionSet") });
    }
    if (sub === "question") {
      const action = (args[1] || "").toLowerCase();
      if (action === "add" && (!args[3] || args[3] === "?")) return questionTypePicker(client, message, args, db);
      if (action === "add") return addQuestion(client, message, args, db);
      if (action === "remove") return removeQuestion(client, message, args, db);
      if (action === "move") return moveQuestion(client, message, args, db);
      return message.reply({ embeds: [helpEmbed(client, db, message.guildId)] });
    }
    if (sub === "channel") return updateChannel(client, message, args, db, "panelChannelId", "panelChannel");
    if (sub === "review") return updateChannel(client, message, args, db, "reviewChannelId", "reviewChannel");
    if (sub === "reviewer") return updateReviewer(client, message, args, db, "reviewerRoleIds", "reviewers");
    if (sub === "require") return updateReviewer(client, message, args, db, "requiredRoleIds", "requiredRoles");
    if (sub === "emoji") return setEmoji(client, message, args, db);
    if (sub === "color") {
      if (!(await requireAdmin(client, message, db))) return;
      const form = await resolveForm(message.guildId, args[1]);
      if (!form) return formError(client, message, db, "notFound");
      const color = args[2];
      if (!color || !/^#?[0-9a-f]{6}$/i.test(color)) return formError(client, message, db, "invalidColor");
      form.color = color.startsWith("#") ? color : `#${color}`;
      form.updatedAt = Date.now();
      await form.save();
      return message.reply({ content: formT(client, db, "colorSet") });
    }
    if (sub === "cooldown") {
      if (!(await requireAdmin(client, message, db))) return;
      const form = await resolveForm(message.guildId, args[1]);
      if (!form) return formError(client, message, db, "notFound");
      if (!args[2]) return message.reply({ content: formT(client, db, "cooldownValue", { value: `${Math.round(form.cooldownMs / 60000)}m` }) });
      const value = dhms(args[2]);
      if (value < 60 * 60 * 1000) return formError(client, message, db, "cooldownTooShort");
      if (value > 30 * 24 * 60 * 60 * 1000) return formError(client, message, db, "cooldownTooLong");
      form.cooldownMs = value;
      form.updatedAt = Date.now();
      await form.save();
      return message.reply({ content: formT(client, db, "cooldownSet", { value: args[2] }) });
    }
    if (sub === "image") return setImage(client, message, args, db);
    if (sub === "multiple") return setBoolean(client, message, args, db, "allowMultiple", "multiple");
    if (sub === "ping") return setBoolean(client, message, args, db, "reviewerPing", "reviewerPing");
    if (sub === "dm") return setBoolean(client, message, args, db, "dmApplicant", "dmApplicant");
    if (sub === "anonymous") return setBoolean(client, message, args, db, "anonymous", "anonymous");
    if (sub === "max") return setMaxSubmissions(client, message, args, db);
    if (sub === "preview") return previewForm(client, message, args, db);
    if (sub === "message") return setMessage(client, message, args, db);
    if (sub === "open") return openForm(client, message, args, db);
    if (sub === "close") return closeForm(client, message, args, db);
    if (sub === "panel") return publishPanel(client, message, args, db);
    if (sub === "submissions") return listSubmissions(client, message, args, db);
    if (sub === "submission") return viewSubmission(client, message, args, db);
    if (sub === "reason") return setReason(client, message, args, db);
    if (sub === "repost") return repostSubmission(client, message, args, db);
    if (sub === "withdraw") return withdrawSubmission(client, message, args, db);
    if (sub === "delete") return deleteForm(client, message, args, db);
    return message.reply({ embeds: [helpEmbed(client, db, message.guildId)] });
  },
};
