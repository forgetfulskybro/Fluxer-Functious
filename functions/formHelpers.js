const { EmbedBuilder, PermissionFlags } = require("@fluxerjs/core");
const Forms = require("../models/forms");
const FormSubmissions = require("../models/formSubmissions");
const { reactionKey } = require("./syncReactions");
const { getMemberHasAnyRole } = require("./eventHelpers");

const CHOICE_EMOJIS = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣", "🔟"];
const REVIEW_QUESTIONS_PER_PAGE = 10;
const REVIEW_NAV_EMOJIS = ["⏪", "⬅️", "➡️", "⏩"];
const STARTING_FORMS = new Set();

function formT(client, db, key, vars) {
  return client.translate.get(db?.language || "en_EN", `Commands.forms.${key}`, vars);
}

function isAdmin(member, client) {
  return member?.permissions?.has?.(PermissionFlags.ManageGuild) === true ||
    client.config.owners.includes(member?.id);
}

function isReviewer(member, form, client) {
  if (isAdmin(member, client)) return true;
  const roleIds = Array.isArray(form?.reviewerRoleIds) ? form.reviewerRoleIds : [];
  if (!roleIds.length) return false;
  return getMemberHasAnyRole(member, roleIds);
}

async function getGuildDb(client, form) {
  return (await client.database.getGuild(form.guildId, false, true).catch(() => null)) || {
    language: "en_EN",
    theme: "#A52F05",
  };
}

async function resolveForm(guildId, input) {
  if (!input) return null;
  const forms = await Forms.find({ guildId }).catch(() => []);
  const value = String(input).toLowerCase();
  return forms.find((form) =>
    String(form._id) === String(input) || String(form.name).toLowerCase() === value
  ) || null;
}

async function getMember(client, guildId, userId) {
  const guild = client.guilds?.get?.(guildId);
  return guild?.members?.get?.(userId) ??
    await guild?.fetchMember?.(userId).catch(() => null);
}

async function sendDM(client, userId, payload, user = null) {
  try {
    let target = user ?? client.users?.get?.(userId);
    if (!target && typeof client.users?.fetch === "function") {
      target = await client.users.fetch(userId).catch(() => null);
    }
    const dm = await target?.createDM?.();
    if (!dm) return null;
    return await dm.send(payload);
  } catch {
    return null;
  }
}

function applyFormTemplate(text, data) {
  return String(text).replace(/\{(\w+)\}/g, (match, key) =>
    Object.prototype.hasOwnProperty.call(data, key) ? String(data[key]) : match
  );
}

function buildPanelEmbed(client, db, form) {
  const embed = new EmbedBuilder()
    .setColor(form.color || db.theme)
    .setTitle(form.name)
    .setDescription(
      (form.description || formT(client, db, "panelDescription"))
        .slice(0, 4096)
    )
    .setFooter({
      text: formT(client, db, "panelFooter", {
        status: form.status === "open"
          ? formT(client, db, "open")
          : form.status === "closed"
            ? formT(client, db, "closedStatus")
            : formT(client, db, "menuDraftStatus"),
      }),
    });

  if (form.questions?.length) {
    embed.addFields({
      name: formT(client, db, "questionsLabel"),
      value: String(form.questions.length),
      inline: true,
    });
  }

  if (isHttpUrl(form.imageUrl)) embed.setImage(form.imageUrl);
  return embed;
}

function isHttpUrl(value) {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function answerFor(submission, questionId) {
  return submission.answers?.find((answer) => answer.questionId === questionId)?.value ?? "";
}

function reviewPageCount(form) {
  return Math.max(1, Math.ceil((form.questions?.length ?? 0) / REVIEW_QUESTIONS_PER_PAGE));
}

function reviewPageIndex(form, submission, requestedPage = null) {
  const totalPages = reviewPageCount(form);
  const value = Number(requestedPage ?? submission?.reviewPage ?? 0);
  if (!Number.isFinite(value)) return 0;
  return Math.min(Math.max(0, Math.trunc(value)), totalPages - 1);
}

function buildReviewEmbed(client, db, form, submission, requestedPage = null) {
  const applicant = form.anonymous
    ? formT(client, db, "anonymousApplicant")
    : `<@${submission.userId}>`;
  const resolved = submission.status === "accepted" || submission.status === "declined";
  const statusText = submission.status === "accepted"
    ? formT(client, db, "acceptedStatus")
    : formT(client, db, "declinedStatus");
  const totalPages = reviewPageCount(form);
  const pageIndex = reviewPageIndex(form, submission, requestedPage);
  const summary = [
    `${formT(client, db, "applicant")}: ${applicant}`,
    `${formT(client, db, "submissionId")}: \`${submission._id}\``,
    `${formT(client, db, "submittedLabel")}: <t:${Math.floor((submission.submittedAt || Date.now()) / 1000)}:f>`,
  ];

  if (resolved) {
    summary.push(`${formT(client, db, "statusLabel")}: **${statusText}**`);
    if (submission.reviewerId) {
      summary.push(`${formT(client, db, "reviewedBy")}: <@${submission.reviewerId}>`);
    }
    if (submission.reviewedAt) {
      summary.push(`${formT(client, db, "reviewedAt")}: <t:${Math.floor(submission.reviewedAt / 1000)}:f>`);
    }
  }

  let footer = resolved
    ? formT(client, db, "reviewResolvedFooter")
    : formT(client, db, "reviewFooter");
  if (totalPages > 1) {
    footer += ` · ${formT(client, db, "reviewPageFooter", {
      page: pageIndex + 1,
      total: totalPages,
    })}`;
  }

  const embed = new EmbedBuilder()
    .setColor(resolved
      ? submission.status === "accepted" ? "#57F287" : "#ED4245"
      : form.color || db.theme)
    .setTitle(formT(client, db, "reviewTitle", { form: form.name }))
    .setDescription(summary.join("\n"))
    .setFooter({ text: footer.slice(0, 2048) });

  const start = pageIndex * REVIEW_QUESTIONS_PER_PAGE;
  for (const question of (form.questions ?? []).slice(start, start + REVIEW_QUESTIONS_PER_PAGE)) {
    const value = answerFor(submission, question.id) || formT(client, db, "noAnswer");
    embed.addFields({
      name: question.prompt.slice(0, 256),
      value: String(value).slice(0, 1024),
      inline: false,
    });
  }

  if (submission.reason) {
    embed.addFields({
      name: formT(client, db, "reason"),
      value: String(submission.reason).slice(0, 1024),
      inline: false,
    });
  }

  return embed;
}

async function addReviewReactions(client, form, message) {
  if (!message) return;
  if (reviewPageCount(form) > 1) {
    for (const emoji of REVIEW_NAV_EMOJIS) {
      await message.react(emoji).catch(() => {});
    }
  }
  await message.react(client.config.emojis.check).catch(() => {});
  await message.react(client.config.emojis.cross).catch(() => {});
}

function questionPrompt(client, db, form, question, index) {
  const number = index + 1;
  const total = form.questions.length;
  const required = question.required === false
    ? formT(client, db, "optional")
    : formT(client, db, "required");
  return formT(client, db, "question", {
    number,
    total,
    prompt: question.prompt,
    required,
  });
}

async function sendQuestion(client, form, submission, dm) {
  if (!dm) return null;
  const index = submission.currentQuestionIndex ?? 0;
  const question = form.questions?.[index];
  if (!question) return finalizeSubmission(client, form, submission, dm);

  const db = await getGuildDb(client, form);
  let sent;

  if (question.type === "choice" && question.choices?.length) {
    const lines = question.choices.slice(0, CHOICE_EMOJIS.length).map((choice, choiceIndex) =>
      `${CHOICE_EMOJIS[choiceIndex]} ${choice.label}`
    );
    sent = await dm.send({
      embeds: [
        new EmbedBuilder()
          .setColor(form.color || db.theme)
          .setTitle(formT(client, db, "questionTitle", { number: index + 1, total: form.questions.length }))
          .setDescription(
            `${questionPrompt(client, db, form, question, index)}\n\n${lines.join("\n")}\n\n${formT(client, db, "choiceHint")}`
          ),
      ],
    }).catch(() => null);

    if (sent) {
      for (let choiceIndex = 0; choiceIndex < Math.min(question.choices.length, CHOICE_EMOJIS.length); choiceIndex++) {
        await sent.react(question.choices[choiceIndex].emoji || CHOICE_EMOJIS[choiceIndex]).catch(() => {});
      }
    }
  } else {
    sent = await dm.send({
      content: `${questionPrompt(client, db, form, question, index)}\n\n${formT(client, db, "textHint")}`,
      allowedMentions: { parse: [] },
    }).catch(() => null);
  }

  submission.promptMessageId = sent?.id ?? null;
  submission.updatedAt = Date.now();
  await submission.save().catch(() => {});
  return sent;
}

async function finalizeSubmission(client, form, submission, dm) {
  const db = await getGuildDb(client, form);
  submission.status = "pending";
  submission.submittedAt = Date.now();
  submission.updatedAt = Date.now();
  submission.currentQuestionIndex = form.questions?.length ?? 0;
  submission.promptMessageId = null;
  submission.reviewPage = 0;
  await submission.save().catch(() => {});

  await dm?.send({
    content: form.confirmationMessage
      ? applyFormTemplate(form.confirmationMessage, {
          form: form.name,
          user: `<@${submission.userId}>`,
        })
      : formT(client, db, "submissionSent"),
    allowedMentions: { parse: [] },
  }).catch(() => {});

  if (!form.reviewChannelId) return submission;
  const reviewChannel = await client.channels.resolve(form.reviewChannelId).catch(() => null);
  if (!reviewChannel) return submission;

  const reviewMessage = await reviewChannel.send({
    content: form.reviewerPing && form.reviewerRoleIds?.length
      ? form.reviewerRoleIds.map((id) => `<@&${id}>`).join(" ")
      : undefined,
    embeds: [buildReviewEmbed(client, db, form, submission, 0)],
    allowedMentions: {
      parse: form.reviewerPing && form.reviewerRoleIds?.length ? ["roles"] : [],
    },
  }).catch(() => null);

  if (!reviewMessage) return submission;

  submission.reviewChannelId = reviewChannel.id;
  submission.reviewMessageId = reviewMessage.id;
  submission.reviewState = "none";
  submission.updatedAt = Date.now();
  await submission.save().catch(() => {});

  await addReviewReactions(client, form, reviewMessage);
  return submission;
}

async function startForm(client, form, user, member) {
  const key = `${form._id}:${user?.id}`;
  if (STARTING_FORMS.has(key)) return { ok: false, message: "" };
  STARTING_FORMS.add(key);
  try {
  const db = await getGuildDb(client, form);
  if (form.status !== "open") {
    return { ok: false, message: formT(client, db, "closedError") };
  }
  if (!getMemberHasAnyRole(member, form.requiredRoleIds)) {
    return { ok: false, message: formT(client, db, "requiredRoleError") };
  }

  const existing = await FormSubmissions.findOne({
    formId: String(form._id),
    userId: user.id,
    status: { $in: ["in_progress", "pending"] },
  }).catch(() => null);

  if (existing?.status === "in_progress") {
    const dm = await user.createDM().catch(() => null);
    if (dm) await sendQuestion(client, form, existing, dm);
    return { ok: true, resumed: true, submission: existing };
  }
  if (existing?.status === "pending" && !form.allowMultiple) {
    return { ok: false, message: formT(client, db, "pendingError") };
  }

  if (form.maxSubmissions > 0) {
    const accepted = await FormSubmissions.countDocuments({
      formId: String(form._id),
      userId: user.id,
      status: "accepted",
    }).catch(() => 0);
    if (accepted >= form.maxSubmissions) {
      return { ok: false, message: formT(client, db, "maxSubmissionsError", { max: form.maxSubmissions }) };
    }
  }

  const latest = await FormSubmissions.findOne({
    formId: String(form._id),
    userId: user.id,
    submittedAt: { $ne: null },
  }).sort({ submittedAt: -1 }).catch(() => null);

  if (latest?.submittedAt && Date.now() - latest.submittedAt < (form.cooldownMs ?? 0)) {
    const remaining = Math.ceil((form.cooldownMs - (Date.now() - latest.submittedAt)) / 1000);
    return { ok: false, message: formT(client, db, "cooldownError", { time: `<t:${Math.floor((Date.now() + remaining * 1000) / 1000)}:R>` }) };
  }

  const dm = await user.createDM().catch(() => null);
  if (!dm) return { ok: false, message: formT(client, db, "dmError") };

  const submission = await FormSubmissions.create({
    formId: String(form._id),
    guildId: form.guildId,
    userId: user.id,
    status: "in_progress",
    dmChannelId: dm.id ?? null,
    currentQuestionIndex: 0,
    answers: [],
    expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
  });

  await dm.send({
    content: form.introMessage
      ? applyFormTemplate(form.introMessage, { form: form.name, user: `<@${user.id}>` })
      : formT(client, db, "intro", { form: form.name, count: form.questions?.length ?? 0 }),
    allowedMentions: { parse: [] },
  }).catch(() => {});

  await sendQuestion(client, form, submission, dm);
  return { ok: true, submission };
  } finally {
    STARTING_FORMS.delete(key);
  }
}

function validateAnswer(question, value) {
  const text = String(value ?? "");
  if (question.required && !text.trim()) return false;
  if (text.length < (question.minLength ?? 0)) return false;
  if (text.length > (question.maxLength ?? 1000)) return false;
  return true;
}

async function recordAnswer(client, form, submission, question, value, dm) {
  submission.answers = [
    ...(submission.answers ?? []).filter((answer) => answer.questionId !== question.id),
    { questionId: question.id, value: String(value ?? "") },
  ];
  submission.currentQuestionIndex = (submission.currentQuestionIndex ?? 0) + 1;
  submission.updatedAt = Date.now();
  await submission.save().catch(() => {});
  if (submission.currentQuestionIndex >= (form.questions?.length ?? 0)) {
    return finalizeSubmission(client, form, submission, dm);
  }
  return sendQuestion(client, form, submission, dm);
}

async function cancelSubmission(client, db, dm, submission) {
  submission.status = "withdrawn";
  submission.updatedAt = Date.now();
  await submission.save().catch(() => {});
  await dm?.send({ content: formT(client, db, "cancelled") }).catch(() => {});
}

async function finalizeReview(client, form, submission, status, reviewerId, reason = null) {
  const db = await getGuildDb(client, form);
  submission.status = status;
  submission.reviewerId = reviewerId;
  submission.reviewState = "done";
  submission.reason = reason;
  submission.reviewedAt = Date.now();
  submission.updatedAt = Date.now();
  await submission.save().catch(() => {});

  if (submission.reviewMessageId && submission.reviewChannelId) {
    const channel = await client.channels.resolve(submission.reviewChannelId).catch(() => null);
    const reviewMessage = await channel?.messages?.fetch?.(submission.reviewMessageId).catch(() => null);
    if (reviewMessage) {
      await reviewMessage.edit({
        embeds: [buildReviewEmbed(client, db, form, submission)],
      }).catch(() => {});
      await reviewMessage.removeAllReactions().catch(() => {});
    }
  }

  const applicantMessage = status === "accepted"
    ? form.acceptMessage || formT(client, db, "acceptedDM")
    : form.declineMessage || formT(client, db, "declinedDM");

  if (form.dmApplicant !== false) {
    await sendDM(client, submission.userId, {
      content: applyFormTemplate(applicantMessage, {
        form: form.name,
        reason: reason ?? "",
        user: `<@${submission.userId}>`,
      }).slice(0, 2000),
      allowedMentions: { parse: [] },
    });
  }

  return submission;
}

async function handleFormDM(client, message) {
  const content = String(message.content ?? "").trim();
  const userId = message.author.id;
  const lower = content.toLowerCase();

  const awaiting = await FormSubmissions.findOne({
    reviewerId: userId,
    reviewState: "awaiting_reason",
    status: "pending",
  }).sort({ updatedAt: -1 }).catch(() => null);

  if (awaiting) {
    const form = await Forms.findById(awaiting.formId).catch(() => null);
    if (!form) return false;
    const db = await getGuildDb(client, form);
    if (lower === "cancel") {
      awaiting.reviewState = "none";
      awaiting.reviewerId = null;
      awaiting.updatedAt = Date.now();
      await awaiting.save().catch(() => {});
      await message.channel.send({ content: formT(client, db, "reasonCancelled") }).catch(() => {});
      return true;
    }
    await finalizeReview(client, form, awaiting, "declined", userId, content.slice(0, 1000));
    await message.channel.send({ content: formT(client, db, "reasonSaved") }).catch(() => {});
    return true;
  }

  const submission = await FormSubmissions.findOne({
    userId,
    dmChannelId: message.channelId,
    status: "in_progress",
  }).sort({ updatedAt: -1 }).catch(() => null);
  if (!submission) return false;

  const form = await Forms.findById(submission.formId).catch(() => null);
  if (!form) return false;
  const db = await getGuildDb(client, form);
  const dm = message.channel;

  if (lower === "cancel" || lower === "withdraw") {
    await cancelSubmission(client, db, dm, submission);
    return true;
  }

  const index = submission.currentQuestionIndex ?? 0;
  const question = form.questions?.[index];
  if (!question) {
    await finalizeSubmission(client, form, submission, dm);
    return true;
  }

  if (lower === "back") {
    if (index <= 0) {
      await dm.send({ content: formT(client, db, "backError") }).catch(() => {});
      return true;
    }
    submission.currentQuestionIndex = index - 1;
    submission.updatedAt = Date.now();
    await submission.save().catch(() => {});
    await sendQuestion(client, form, submission, dm);
    return true;
  }

  if (lower === "skip") {
    if (question.required) {
      await dm.send({ content: formT(client, db, "requiredError") }).catch(() => {});
      return true;
    }
    await recordAnswer(client, form, submission, question, "", dm);
    return true;
  }

  if (question.type === "choice") {
    const choiceIndex = Number.parseInt(content, 10) - 1;
    if (!Number.isInteger(choiceIndex) || choiceIndex < 0 || choiceIndex >= question.choices.length) {
      await dm.send({ content: formT(client, db, "choiceError") }).catch(() => {});
      return true;
    }
    await recordAnswer(client, form, submission, question, question.choices[choiceIndex].label, dm);
    return true;
  }

  if (!validateAnswer(question, content)) {
    await dm.send({
      content: formT(client, db, "validationError", {
        min: question.minLength ?? 0,
        max: question.maxLength ?? 1000,
      }),
    }).catch(() => {});
    return true;
  }

  await recordAnswer(client, form, submission, question, content, dm);
  return true;
}

async function handleChoiceReaction(client, reaction, userId, reactionMsg) {
  const submission = await FormSubmissions.findOne({
    promptMessageId: reaction.messageId,
    status: "in_progress",
  }).catch(() => null);
  if (!submission || submission.userId !== userId) return false;

  const form = await Forms.findById(submission.formId).catch(() => null);
  if (!form) return false;
  const question = form.questions?.[submission.currentQuestionIndex ?? 0];
  if (!question || question.type !== "choice") return false;

  const key = reaction.emoji?.id
    ? reactionKey(`${reaction.emoji.name}:${reaction.emoji.id}`)
    : reactionKey(reaction.emoji?.name);

  const choiceIndex = question.choices.findIndex((choice, index) =>
    reactionKey(choice.emoji || CHOICE_EMOJIS[index]) === key
  );
  if (choiceIndex === -1) return true;

  const dm = reactionMsg?.channel ?? null;
  await recordAnswer(
    client,
    form,
    submission,
    question,
    question.choices[choiceIndex].label,
    dm
  );
  return true;
}

async function handleReviewReaction(client, reaction, userId, reactionMsg) {
  const submission = await FormSubmissions.findOne({
    reviewMessageId: reaction.messageId,
    status: "pending",
  }).catch(() => null);
  if (!submission) return false;

  const form = await Forms.findById(submission.formId).catch(() => null);
  if (!form) return true;

  const member = reaction.member ?? await getMember(client, form.guildId, userId);
  if (!isReviewer(member, form, client)) {
    const db = await getGuildDb(client, form);
    await sendDM(client, userId, { content: formT(client, db, "notReviewerDM") }).catch(() => {});
    return true;
  }

  const emojiName = reaction.emoji?.name;
  if (REVIEW_NAV_EMOJIS.includes(emojiName)) {
    const totalPages = reviewPageCount(form);
    if (totalPages <= 1) return true;
    const currentPage = reviewPageIndex(form, submission);
    const nextPage = emojiName === "⏪"
      ? 0
      : emojiName === "⏩"
        ? totalPages - 1
        : Math.min(
            totalPages - 1,
            Math.max(0, currentPage + (emojiName === "➡️" ? 1 : -1)),
          );
    if (nextPage !== currentPage) {
      submission.reviewPage = nextPage;
      submission.updatedAt = Date.now();
      await submission.save().catch(() => {});
      const reviewDb = await getGuildDb(client, form);
      await reactionMsg?.edit?.({
        embeds: [buildReviewEmbed(client, reviewDb, form, submission)],
      }).catch(() => {});
    }
    await reactionMsg?.removeReaction?.(emojiName, userId).catch(() => {});
    return true;
  }

  const emojiKey = reaction.emoji?.id
    ? reactionKey(`${reaction.emoji.name}:${reaction.emoji.id}`)
    : reactionKey(reaction.emoji?.name);
  const decision = emojiKey === reactionKey(client.config.emojis.check)
    ? "accepted"
    : emojiKey === reactionKey(client.config.emojis.cross)
      ? "declined"
      : null;
  if (!decision) return true;

  if (decision === "accepted") {
    await finalizeReview(client, form, submission, "accepted", userId);
    return true;
  }

  submission.reviewState = "awaiting_reason";
  submission.reviewerId = userId;
  submission.updatedAt = Date.now();
  await submission.save().catch(() => {});

  const db = await getGuildDb(client, form);
  const dmSent = await sendDM(client, userId, {
    content: formT(client, db, "reasonPrompt", { id: submission._id, form: form.name }),
  });
  if (!dmSent) {
    await reactionMsg?.channel?.send({
      content: `<@${userId}>, I couldn't DM you. Use \`forms reason ${submission._id} <reason>\` here.`,
      allowedMentions: { parse: [] },
    }).catch(() => {});
  }
  return true;
}

async function handleFormReaction(client, reaction, userId, reactionMsg, eventType = "add") {
  if (!reaction?.messageId) return false;

  // Gateway reaction payloads keep the guild on the nested reaction, while a
  // message fetched from REST may not include guild_id at all. Resolve every
  // available source so panel reactions are not silently ignored.
  const guildId =
    reaction.reaction?.guildId ??
    reaction.guildId ??
    reaction.member?.guildId ??
    reaction.member?.guild?.id ??
    reaction.channel?.guildId ??
    reaction.channel?.guild?.id ??
    reactionMsg?.guildId ??
    reactionMsg?.guild?.id ??
    null;

  // panelMessageId is a platform-unique snowflake, so it identifies the form
  // even when the fetched message has no guild context.
  const form = await Forms.findOne({
    panelMessageId: reaction.messageId,
  }).catch(() => null);

  if (form) {
    if (eventType === "remove") return true;
    const key = reaction.emoji?.id
      ? reactionKey(`${reaction.emoji.name}:${reaction.emoji.id}`)
      : reactionKey(reaction.emoji?.name);
    if (key !== reactionKey(form.panelEmoji)) return true;
    const member = reaction.member ?? await getMember(client, form.guildId ?? guildId, userId);
    const result = await startForm(client, form, reaction.user, member);
    if (!result.ok) {
      await sendDM(client, userId, { content: result.message }, reaction.user);
    }
    return true;
  }

  if (guildId) {
    if (eventType === "remove") {
      const review = await FormSubmissions.findOne({
        reviewMessageId: reaction.messageId,
        status: "pending",
      }).catch(() => null);
      if (review) return true;
    } else {
      const handledReview = await handleReviewReaction(client, reaction, userId, reactionMsg);
      if (handledReview) return true;
    }
  }

  if (eventType === "remove") return false;
  return handleChoiceReaction(client, reaction, userId, reactionMsg);
}

module.exports = {
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
  startForm,
  sendQuestion,
  finalizeSubmission,
  finalizeReview,
  handleFormDM,
  handleFormReaction,
  handleReviewReaction,
  handleChoiceReaction,
};
