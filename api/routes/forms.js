const { Router } = require('express');
const { randomUUID } = require('node:crypto');
const Forms = require('../../models/forms');
const FormSubmissions = require('../../models/formSubmissions');
const { makeRequireApiKey } = require('../middleware');
const { trackResource, actorFromReq } = require('../trackSettings');
const {
  CHOICE_EMOJIS,
  buildPanelEmbed,
  finalizeReview,
} = require('../../functions/formHelpers');

const MAX_FORMS = 25;
const MAX_QUESTIONS = 50;
const MAX_SUBMISSIONS = 1000;
const MIN_COOLDOWN_MS = 60 * 60 * 1000;
const MAX_COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000;
const STATUSES = ['draft', 'open', 'closed'];
const SUBMISSION_STATUSES = [
  'in_progress',
  'pending',
  'accepted',
  'declined',
  'withdrawn',
  'expired',
];
const FORM_KEYS = new Set([
  'name',
  'description',
  'status',
  'panelChannelId',
  'panelEmoji',
  'reviewChannelId',
  'reviewerRoleIds',
  'reviewerPing',
  'color',
  'imageUrl',
  'introMessage',
  'confirmationMessage',
  'acceptMessage',
  'declineMessage',
  'questions',
  'cooldownMs',
  'allowMultiple',
  'maxSubmissions',
  'dmApplicant',
  'anonymous',
  'requiredRoleIds',
]);

function isSnowflake(value) {
  return typeof value === 'string' && /^\d{17,20}$/.test(value);
}

function has(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function isObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isHttpUrl(value) {
  try {
    const url = new URL(String(value));
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function nullableText(value, max, label) {
  if (value == null || value === '') return { value: null };
  if (typeof value !== 'string') {
    return { error: `${label} must be a string or null` };
  }
  return { value: value.trim().slice(0, max) || null };
}

function normalizeIdArray(raw, label) {
  if (!Array.isArray(raw) || !raw.every(isSnowflake)) {
    return { error: `${label} must be an array of valid IDs` };
  }
  return { value: [...new Set(raw)] };
}

function normalizeQuestions(raw, existing) {
  if (!Array.isArray(raw)) return { error: 'questions must be an array' };
  if (raw.length > MAX_QUESTIONS) {
    return { error: `questions cannot contain more than ${MAX_QUESTIONS} entries` };
  }

  const existingByIndex = Array.isArray(existing) ? existing : [];
  const seenIds = new Set();
  const questions = [];

  for (let index = 0; index < raw.length; index += 1) {
    const input = raw[index];
    if (!isObject(input)) {
      return { error: `questions[${index}] must be an object` };
    }

    const previous = existingByIndex[index];
    const type = input.type ?? previous?.type ?? 'text';
    if (!['text', 'paragraph', 'choice'].includes(type)) {
      return { error: `questions[${index}].type must be text, paragraph, or choice` };
    }

    const prompt = input.prompt ?? previous?.prompt;
    if (typeof prompt !== 'string' || !prompt.trim()) {
      return { error: `questions[${index}].prompt is required` };
    }

    const idValue = input.id ?? previous?.id ?? randomUUID();
    if (typeof idValue !== 'string' || !idValue.trim()) {
      return { error: `questions[${index}].id must be a non-empty string` };
    }
    const id = idValue.trim().slice(0, 100);
    if (seenIds.has(id)) {
      return { error: `questions[${index}].id is duplicated` };
    }
    seenIds.add(id);

    const maxLengthRaw =
      input.maxLength ?? previous?.maxLength ?? (type === 'paragraph' ? 2000 : 1000);
    const maxLength = Number(maxLengthRaw);
    if (!Number.isInteger(maxLength) || maxLength < 1 || maxLength > 2000) {
      return { error: `questions[${index}].maxLength must be between 1 and 2000` };
    }

    const minLengthRaw = input.minLength ?? previous?.minLength ?? 0;
    const minLength = Number(minLengthRaw);
    if (!Number.isInteger(minLength) || minLength < 0 || minLength > maxLength) {
      return { error: `questions[${index}].minLength must be between 0 and maxLength` };
    }

    const requiredRaw = input.required ?? previous?.required ?? true;
    if (typeof requiredRaw !== 'boolean') {
      return { error: `questions[${index}].required must be a boolean` };
    }

    let choices = [];
    if (type === 'choice') {
      const rawChoices = input.choices ?? previous?.choices ?? [];
      if (!Array.isArray(rawChoices) || rawChoices.length < 2) {
        return { error: `questions[${index}].choices must contain at least 2 options` };
      }
      if (rawChoices.length > CHOICE_EMOJIS.length) {
        return {
          error: `questions[${index}].choices cannot contain more than ${CHOICE_EMOJIS.length} options`,
        };
      }
      choices = rawChoices.map((choice, choiceIndex) => {
        const value = typeof choice === 'string' ? { label: choice } : choice;
        if (!isObject(value) || typeof value.label !== 'string' || !value.label.trim()) {
          return { error: `questions[${index}].choices[${choiceIndex}].label is required` };
        }
        const emoji = value.emoji == null ? null : String(value.emoji).trim();
        return {
          label: value.label.trim().slice(0, 100),
          emoji: emoji ? emoji.slice(0, 100) : null,
        };
      });
      const invalid = choices.find((choice) => choice.error);
      if (invalid) return { error: invalid.error };
    }

    questions.push({
      id,
      type,
      prompt: prompt.trim().slice(0, 500),
      required: requiredRaw,
      minLength,
      maxLength,
      choices,
    });
  }

  return { value: questions };
}

function normalizeFormInput(raw, existing, { create = false } = {}) {
  if (!isObject(raw)) return { error: 'Form payload must be an object' };

  const source = raw;
  const base = existing?.toObject?.() ?? existing ?? {};
  const pick = (key, fallback) => (has(source, key) ? source[key] : fallback);

  const nameRaw = pick('name', base.name);
  if (typeof nameRaw !== 'string' || !nameRaw.trim()) {
    return { error: 'name is required' };
  }
  const name = nameRaw.trim().slice(0, 100);

  const description = nullableText(pick('description', base.description), 2000, 'description');
  if (description.error) return description;

  let status = pick('status', base.status ?? 'draft');
  if (!STATUSES.includes(status)) {
    return { error: `status must be one of: ${STATUSES.join(', ')}` };
  }

  const panelChannelId = pick('panelChannelId', base.panelChannelId);
  if (panelChannelId != null && !isSnowflake(panelChannelId)) {
    return { error: 'panelChannelId must be a valid channel ID or null' };
  }
  const reviewChannelId = pick('reviewChannelId', base.reviewChannelId);
  if (reviewChannelId != null && !isSnowflake(reviewChannelId)) {
    return { error: 'reviewChannelId must be a valid channel ID or null' };
  }

  const panelEmojiRaw = pick('panelEmoji', base.panelEmoji ?? '📝');
  if (typeof panelEmojiRaw !== 'string' || !panelEmojiRaw.trim()) {
    return { error: 'panelEmoji must be a non-empty string' };
  }
  const panelEmoji = panelEmojiRaw.trim().slice(0, 100);

  const reviewerRoleIdsResult = normalizeIdArray(
    pick('reviewerRoleIds', base.reviewerRoleIds ?? []),
    'reviewerRoleIds'
  );
  if (reviewerRoleIdsResult.error) return reviewerRoleIdsResult;
  const requiredRoleIdsResult = normalizeIdArray(
    pick('requiredRoleIds', base.requiredRoleIds ?? []),
    'requiredRoleIds'
  );
  if (requiredRoleIdsResult.error) return requiredRoleIdsResult;

  const reviewerPing = pick('reviewerPing', base.reviewerPing !== false);
  if (typeof reviewerPing !== 'boolean') {
    return { error: 'reviewerPing must be a boolean' };
  }

  const colorRaw = pick('color', base.color);
  let color = null;
  if (colorRaw != null && colorRaw !== '') {
    if (typeof colorRaw !== 'string' || !/^#?[0-9a-f]{6}$/i.test(colorRaw.trim())) {
      return { error: 'color must be a 6-digit hex color or null' };
    }
    color = colorRaw.trim().startsWith('#') ? colorRaw.trim() : `#${colorRaw.trim()}`;
  }

  const imageRaw = pick('imageUrl', base.imageUrl);
  let imageUrl = null;
  if (imageRaw != null && imageRaw !== '') {
    if (typeof imageRaw !== 'string' || !isHttpUrl(imageRaw)) {
      return { error: 'imageUrl must be a valid http(s) URL or null' };
    }
    imageUrl = imageRaw;
  }

  const messages = {};
  for (const [key, max] of [
    ['introMessage', 1000],
    ['confirmationMessage', 1000],
    ['acceptMessage', 1000],
    ['declineMessage', 1000],
  ]) {
    const result = nullableText(pick(key, base[key]), max, key);
    if (result.error) return result;
    messages[key] = result.value;
  }

  const questions = normalizeQuestions(
    pick('questions', base.questions ?? []),
    base.questions
  );
  if (questions.error) return questions;

  const cooldownRaw = pick('cooldownMs', base.cooldownMs ?? 24 * 60 * 60 * 1000);
  const cooldownMs = Number(cooldownRaw);
  if (
    !Number.isInteger(cooldownMs) ||
    cooldownMs < MIN_COOLDOWN_MS ||
    cooldownMs > MAX_COOLDOWN_MS
  ) {
    return { error: 'cooldownMs must be between 1 hour and 30 days' };
  }

  const maxSubmissionsRaw = pick('maxSubmissions', base.maxSubmissions ?? 0);
  const maxSubmissions = Number(maxSubmissionsRaw);
  if (
    !Number.isInteger(maxSubmissions) ||
    maxSubmissions < 0 ||
    maxSubmissions > MAX_SUBMISSIONS
  ) {
    return { error: `maxSubmissions must be between 0 and ${MAX_SUBMISSIONS}` };
  }

  const allowMultiple = pick('allowMultiple', base.allowMultiple === true);
  const dmApplicant = pick('dmApplicant', base.dmApplicant !== false);
  const anonymous = pick('anonymous', base.anonymous === true);
  for (const [key, value] of [
    ['allowMultiple', allowMultiple],
    ['dmApplicant', dmApplicant],
    ['anonymous', anonymous],
  ]) {
    if (typeof value !== 'boolean') {
      return { error: `${key} must be a boolean` };
    }
  }

  if (status === 'open') {
    if (!reviewChannelId) return { error: 'reviewChannelId is required before opening a form' };
    if (!questions.value.length) return { error: 'A form needs at least one question before opening' };
  }

  const panelMessageId =
    panelChannelId && panelChannelId === base.panelChannelId
      ? base.panelMessageId ?? null
      : null;

  return {
    value: {
      name,
      description: description.value,
      status,
      panelChannelId: panelChannelId ?? null,
      panelMessageId,
      panelEmoji,
      reviewChannelId: reviewChannelId ?? null,
      reviewerRoleIds: reviewerRoleIdsResult.value,
      requiredRoleIds: requiredRoleIdsResult.value,
      reviewerPing,
      color,
      imageUrl,
      ...messages,
      questions: questions.value,
      cooldownMs,
      allowMultiple,
      maxSubmissions,
      dmApplicant,
      anonymous,
    },
  };
}

function serializeForm(form) {
  const value = form?.toObject?.() ?? form ?? {};
  return {
    id: String(value._id ?? ''),
    guildId: value.guildId ?? null,
    name: value.name ?? null,
    description: value.description ?? null,
    status: value.status ?? null,
    panelChannelId: value.panelChannelId ?? null,
    panelMessageId: value.panelMessageId ?? null,
    panelEmoji: value.panelEmoji ?? null,
    reviewChannelId: value.reviewChannelId ?? null,
    reviewerRoleIds: value.reviewerRoleIds ?? [],
    reviewerPing: value.reviewerPing !== false,
    color: value.color ?? null,
    imageUrl: value.imageUrl ?? null,
    introMessage: value.introMessage ?? null,
    confirmationMessage: value.confirmationMessage ?? null,
    acceptMessage: value.acceptMessage ?? null,
    declineMessage: value.declineMessage ?? null,
    questions: (value.questions ?? []).map((question) => ({
      id: question.id,
      type: question.type,
      prompt: question.prompt,
      required: question.required !== false,
      minLength: question.minLength ?? 0,
      maxLength: question.maxLength ?? 1000,
      choices: (question.choices ?? []).map((choice) => ({
        label: choice.label,
        emoji: choice.emoji ?? null,
      })),
    })),
    cooldownMs: value.cooldownMs ?? null,
    allowMultiple: value.allowMultiple === true,
    maxSubmissions: value.maxSubmissions ?? 0,
    dmApplicant: value.dmApplicant !== false,
    anonymous: value.anonymous === true,
    requiredRoleIds: value.requiredRoleIds ?? [],
    createdBy: value.createdBy ?? null,
    createdAt: value.createdAt ?? null,
    updatedAt: value.updatedAt ?? null,
  };
}

function serializeSubmission(submission, form) {
  const value = submission?.toObject?.() ?? submission ?? {};
  const anonymous = form?.anonymous === true;
  return {
    id: String(value._id ?? ''),
    formId: value.formId ?? null,
    guildId: value.guildId ?? null,
    userId: anonymous ? null : value.userId ?? null,
    status: value.status ?? null,
    answers: (value.answers ?? []).map((answer) => ({
      questionId: answer.questionId,
      value: answer.value ?? '',
    })),
    reviewerId: value.reviewerId ?? null,
    reviewPage: value.reviewPage ?? 0,
    reason: value.reason ?? null,
    createdAt: value.createdAt ?? null,
    updatedAt: value.updatedAt ?? null,
    submittedAt: value.submittedAt ?? null,
    reviewedAt: value.reviewedAt ?? null,
  };
}

async function findForm(guildId, formId) {
  if (!formId) return null;
  const id = String(formId);
  if (/^[a-f0-9]{24}$/i.test(id)) {
    const byId = await Forms.findOne({ _id: id, guildId }).catch(() => null);
    if (byId) return byId;
  }
  const forms = await Forms.find({ guildId }).catch(() => []);
  return forms.find((form) => String(form.name).toLowerCase() === id.toLowerCase()) ?? null;
}

async function resolveTextChannel(client, guildId, channelId) {
  if (!isSnowflake(channelId)) return null;
  const channel = await client.channels.resolve(channelId).catch(() => null);
  if (!channel || channel.type !== 0) return null;
  const channelGuildId = channel.guildId ?? channel.guild?.id;
  if (channelGuildId && String(channelGuildId) !== String(guildId)) return null;
  return channel;
}

async function submissionCounts(guildId, formId) {
  const counts = Object.fromEntries(SUBMISSION_STATUSES.map((status) => [status, 0]));
  const rows = await FormSubmissions.aggregate([
    { $match: { guildId, formId } },
    { $group: { _id: '$status', count: { $sum: 1 } } },
  ]).catch(() => []);
  for (const row of rows) {
    if (row?._id && has(counts, row._id)) counts[row._id] = row.count;
  }
  return counts;
}

function formsRouter(client, apiKey) {
  const router = Router({ mergeParams: true });
  const requireApiKey = makeRequireApiKey(apiKey);

  router.get('/', requireApiKey, async (req, res) => {
    try {
      const { guildId } = req.params;
      const forms = await Forms.find({ guildId }).sort({ createdAt: 1 }).lean();
      return res.json({ forms: forms.map(serializeForm) });
    } catch (err) {
      console.error('[API] GET forms:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  });

  router.post('/', requireApiKey, async (req, res) => {
    try {
      const { guildId } = req.params;
      const body = isObject(req.body) ? req.body : {};

      const guild = await client.database.getGuild(guildId, false);
      if (!guild) return res.status(404).json({ error: 'Guild not found' });

      const count = await Forms.countDocuments({ guildId });
      if (count >= MAX_FORMS) {
        return res.status(400).json({ error: `Too many forms (max ${MAX_FORMS})` });
      }

      const normalized = normalizeFormInput(body, {}, { create: true });
      if (normalized.error) {
        return res.status(400).json({ error: normalized.error });
      }

      const nameTaken = (await Forms.find({ guildId }).lean()).some(
        (form) => String(form.name).toLowerCase() === normalized.value.name.toLowerCase()
      );
      if (nameTaken) {
        return res.status(409).json({ error: 'A form with that name already exists' });
      }

      if (
        normalized.value.panelChannelId &&
        !(await resolveTextChannel(client, guildId, normalized.value.panelChannelId))
      ) {
        return res.status(400).json({ error: 'panelChannelId must be a text channel in this guild' });
      }
      if (
        normalized.value.reviewChannelId &&
        !(await resolveTextChannel(client, guildId, normalized.value.reviewChannelId))
      ) {
        return res.status(400).json({ error: 'reviewChannelId must be a text channel in this guild' });
      }

      const createdBy = actorFromReq(req) || client.user?.id;
      if (!createdBy) return res.status(400).json({ error: 'A creator user ID is required' });

      const form = await Forms.create({
        ...normalized.value,
        guildId,
        createdBy,
      });

      await trackResource(client, {
        userId: actorFromReq(req),
        groupId: guildId,
        category: 'forms',
        key: 'form',
        action: 'create',
        label: 'Form',
        value: { id: String(form._id), name: form.name },
        previous: null,
      });

      return res.status(201).json({ ok: true, form: serializeForm(form) });
    } catch (err) {
      console.error('[API] POST forms:', err);
      return res.status(500).json({ error: 'Failed to create form' });
    }
  });

  router.get('/:formId/submissions', requireApiKey, async (req, res) => {
    try {
      const { guildId, formId } = req.params;
      const form = await findForm(guildId, formId);
      if (!form) return res.status(404).json({ error: 'Form not found' });

      const status = String(req.query.status ?? 'all').toLowerCase();
      if (status !== 'all' && !SUBMISSION_STATUSES.includes(status)) {
        return res.status(400).json({ error: 'Invalid submission status' });
      }

      const query = { guildId, formId: String(form._id) };
      if (status !== 'all') query.status = status;

      const [submissions, counts] = await Promise.all([
        FormSubmissions.find(query).sort({ updatedAt: -1 }).limit(100).lean(),
        submissionCounts(guildId, String(form._id)),
      ]);

      return res.json({
        submissions: submissions.map((submission) =>
          serializeSubmission(submission, form)
        ),
        counts,
      });
    } catch (err) {
      console.error('[API] GET form submissions:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  });

  router.patch('/:formId/submissions/:submissionId', requireApiKey, async (req, res) => {
    try {
      const { guildId, formId, submissionId } = req.params;
      const body = isObject(req.body) ? req.body : {};
      const form = await findForm(guildId, formId);
      if (!form) return res.status(404).json({ error: 'Form not found' });

      const submission = await FormSubmissions.findById(submissionId).catch(() => null);
      if (
        !submission ||
        String(submission.guildId) !== String(guildId) ||
        String(submission.formId) !== String(form._id)
      ) {
        return res.status(404).json({ error: 'Submission not found' });
      }
      if (submission.status !== 'pending') {
        return res.status(409).json({ error: 'Only pending submissions can be reviewed' });
      }

      const status = String(body.status ?? '').toLowerCase();
      if (status !== 'accepted' && status !== 'declined') {
        return res.status(400).json({ error: 'status must be accepted or declined' });
      }

      const reason = status === 'declined'
        ? String(body.reason ?? '').trim().slice(0, 1000)
        : null;
      if (status === 'declined' && !reason) {
        return res.status(400).json({ error: 'A decline reason is required' });
      }

      const reviewerId = actorFromReq(req) || client.user?.id || null;
      await finalizeReview(client, form, submission, status, reviewerId, reason);

      return res.json({
        ok: true,
        submission: serializeSubmission(submission, form),
      });
    } catch (err) {
      console.error('[API] PATCH form submission:', err);
      return res.status(500).json({ error: 'Failed to review submission' });
    }
  });

  router.delete('/:formId/submissions/:submissionId', requireApiKey, async (req, res) => {
    try {
      const { guildId, formId, submissionId } = req.params;
      const form = await findForm(guildId, formId);
      if (!form) return res.status(404).json({ error: 'Form not found' });

      const submission = await FormSubmissions.findById(submissionId).catch(() => null);
      if (
        !submission ||
        String(submission.guildId) !== String(guildId) ||
        String(submission.formId) !== String(form._id)
      ) {
        return res.status(404).json({ error: 'Submission not found' });
      }

      if (submission.reviewMessageId && submission.reviewChannelId) {
        try {
          const channel = await client.channels.resolve(submission.reviewChannelId);
          const message = await channel?.messages?.fetch?.(submission.reviewMessageId);
          await message?.delete?.();
        } catch {}
      }

      await FormSubmissions.deleteOne({ _id: submission._id });

      await trackResource(client, {
        userId: actorFromReq(req),
        groupId: guildId,
        category: 'forms',
        key: 'formSubmissions',
        action: 'delete',
        label: 'Form Submission',
        value: null,
        previous: {
          id: String(submission._id),
          formId: String(form._id),
          formName: form.name,
          status: submission.status,
          submittedAt: submission.submittedAt,
          ...(form.anonymous ? {} : { userId: submission.userId }),
        },
      });

      return res.json({ ok: true });
    } catch (err) {
      console.error('[API] DELETE form submission:', err);
      return res.status(500).json({ error: 'Failed to delete submission' });
    }
  });

  router.get('/:formId', requireApiKey, async (req, res) => {
    try {
      const { guildId, formId } = req.params;
      const form = await findForm(guildId, formId);
      if (!form) return res.status(404).json({ error: 'Form not found' });

      return res.json({
        form: serializeForm(form),
        submissionCounts: await submissionCounts(guildId, String(form._id)),
      });
    } catch (err) {
      console.error('[API] GET form:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  });

  router.patch('/:formId', requireApiKey, async (req, res) => {
    try {
      const { guildId, formId } = req.params;
      const body = isObject(req.body) ? req.body : {};
      if (!Object.keys(body).some((key) => FORM_KEYS.has(key))) {
        return res.status(400).json({ error: 'No valid fields to update' });
      }

      const form = await findForm(guildId, formId);
      if (!form) return res.status(404).json({ error: 'Form not found' });

      const normalized = normalizeFormInput(body, form);
      if (normalized.error) {
        return res.status(400).json({ error: normalized.error });
      }

      const nameTaken = (await Forms.find({ guildId }).lean()).some(
        (candidate) =>
          String(candidate._id) !== String(form._id) &&
          String(candidate.name).toLowerCase() === normalized.value.name.toLowerCase()
      );
      if (nameTaken) {
        return res.status(409).json({ error: 'A form with that name already exists' });
      }

      if (
        normalized.value.panelChannelId &&
        !(await resolveTextChannel(client, guildId, normalized.value.panelChannelId))
      ) {
        return res.status(400).json({ error: 'panelChannelId must be a text channel in this guild' });
      }
      if (
        normalized.value.reviewChannelId &&
        !(await resolveTextChannel(client, guildId, normalized.value.reviewChannelId))
      ) {
        return res.status(400).json({ error: 'reviewChannelId must be a text channel in this guild' });
      }

      const previous = serializeForm(form);
      const oldPanel = {
        channelId: form.panelChannelId,
        messageId: form.panelMessageId,
      };

      Object.assign(form, normalized.value, { updatedAt: Date.now() });
      await form.save();

      if (
        oldPanel.messageId &&
        (form.panelChannelId !== oldPanel.channelId || form.panelMessageId !== oldPanel.messageId)
      ) {
        try {
          const channel = await client.channels.resolve(oldPanel.channelId);
          const message = await channel?.messages?.fetch?.(oldPanel.messageId);
          await message?.delete?.();
        } catch {}
      }

      await trackResource(client, {
        userId: actorFromReq(req),
        groupId: guildId,
        category: 'forms',
        key: 'form',
        action: 'update',
        label: 'Form',
        value: { id: String(form._id), name: form.name, status: form.status },
        previous,
      });

      return res.json({ ok: true, form: serializeForm(form) });
    } catch (err) {
      console.error('[API] PATCH form:', err);
      return res.status(500).json({ error: 'Failed to update form' });
    }
  });

  router.post('/:formId/publish', requireApiKey, async (req, res) => {
    try {
      const { guildId, formId } = req.params;
      const body = isObject(req.body) ? req.body : {};
      const form = await findForm(guildId, formId);
      if (!form) return res.status(404).json({ error: 'Form not found' });
      if (form.status !== 'open') {
        return res.status(400).json({ error: 'Form must be open before publishing its panel' });
      }
      if (!form.reviewChannelId) {
        return res.status(400).json({ error: 'A review channel is required before publishing' });
      }

      const channelId = body.channelId ?? form.panelChannelId;
      const channel = await resolveTextChannel(client, guildId, channelId);
      if (!channel) {
        return res.status(400).json({ error: 'panelChannelId must be a text channel in this guild' });
      }

      const guild = await client.database.getGuild(guildId, false);
      if (!guild) return res.status(404).json({ error: 'Guild not found' });

      const previous = {
        id: String(form._id),
        name: form.name,
        panelChannelId: form.panelChannelId,
        panelMessageId: form.panelMessageId,
      };

      if (form.panelMessageId && form.panelChannelId) {
        try {
          const oldChannel = await client.channels.resolve(form.panelChannelId);
          const oldMessage = await oldChannel?.messages?.fetch?.(form.panelMessageId);
          await oldMessage?.delete?.();
        } catch {}
      }

      const sent = await channel
        .send({ embeds: [buildPanelEmbed(client, guild, form)] })
        .catch(() => null);
      if (!sent) {
        return res.status(502).json({ error: 'Failed to send the form panel' });
      }

      await sent.react(form.panelEmoji).catch(() => {});
      form.panelChannelId = channel.id;
      form.panelMessageId = sent.id;
      form.updatedAt = Date.now();
      await form.save();

      await trackResource(client, {
        userId: actorFromReq(req),
        groupId: guildId,
        category: 'forms',
        key: 'form',
        action: 'update',
        label: 'Form',
        value: {
          id: String(form._id),
          name: form.name,
          panelChannelId: form.panelChannelId,
          panelMessageId: form.panelMessageId,
        },
        previous,
      });

      return res.json({ ok: true, form: serializeForm(form) });
    } catch (err) {
      console.error('[API] POST form publish:', err);
      return res.status(500).json({ error: 'Failed to publish form panel' });
    }
  });

  router.delete('/:formId', requireApiKey, async (req, res) => {
    try {
      const { guildId, formId } = req.params;
      const form = await findForm(guildId, formId);
      if (!form) return res.status(404).json({ error: 'Form not found' });

      const previous = serializeForm(form);
      if (form.panelMessageId && form.panelChannelId) {
        try {
          const channel = await client.channels.resolve(form.panelChannelId);
          const message = await channel?.messages?.fetch?.(form.panelMessageId);
          await message?.delete?.();
        } catch {}
      }

      const submissions = await FormSubmissions.find({
        formId: String(form._id),
      }).lean();
      for (const submission of submissions) {
        if (!submission.reviewMessageId || !submission.reviewChannelId) continue;
        try {
          const channel = await client.channels.resolve(submission.reviewChannelId);
          const message = await channel?.messages?.fetch?.(submission.reviewMessageId);
          await message?.delete?.();
        } catch {}
      }

      await FormSubmissions.deleteMany({ formId: String(form._id) });
      await Forms.deleteOne({ _id: form._id });

      await trackResource(client, {
        userId: actorFromReq(req),
        groupId: guildId,
        category: 'forms',
        key: 'form',
        action: 'delete',
        label: 'Form',
        value: null,
        previous,
      });

      return res.json({ ok: true });
    } catch (err) {
      console.error('[API] DELETE form:', err);
      return res.status(500).json({ error: 'Failed to delete form' });
    }
  });

  return router;
}

module.exports = formsRouter;
