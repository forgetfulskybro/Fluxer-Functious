const UserDB = require("../models/users");
const PollDB = require("../models/polls");
const GiveawayDB = require("../models/giveaways");
const EventDB = require("../models/events");
const EventRsvpDB = require("../models/eventRsvps");
const FormDB = require("../models/forms");
const FormSubmissionDB = require("../models/formSubmissions");
const GuildDB = require("../models/guilds");
const TranslationDB = require("../models/translations");
const { handleDelete: handlePollDelete } = require("./checkPolls");
const { handleDelete: handleGiveawayDelete } = require("./checkGiveaways");
const { handleDeletedReminder } = require("./checkReminders");
const { handleDelete: handleScheduledDelete } = require("./checkScheduledMessages");
const { removeWatchers } = require("./checkReactionReminders");
const { removeUserFromQueue: removeTimedRoleUser } = require("./checkTimedRoles");
const { removeUserFromSchedule } = require("./checkBirthdays");
const { clearStickyTimer, deleteStickyMessage } = require("./stickyMessages");
const { refreshGuild: refreshTagIndex } = require("./tagIndex");

const DATA_CACHE_TTL_MS = 20 * 60 * 1000;
const dataCache = new Map();

function toPlain(value) {
  return value?.toObject ? value.toObject() : value;
}

function text(value) {
  return value == null ? "" : String(value);
}

function fieldMatches(value, userId) {
  return text(value) === userId;
}

function pollVoterId(entry) {
  return text(entry?.user ?? entry?.userId ?? entry?.id);
}

function giveawayUserId(entry) {
  return text(entry?.userID ?? entry?.userId ?? entry?.id ?? entry?.user);
}

function guildMatch(guild, userId, client) {
  const plain = toPlain(guild) ?? {};
  const usersJoined = (Array.isArray(plain.usersJoined) ? plain.usersJoined : [])
    .filter((entry) => fieldMatches(entry?.userId, userId));
  const userTimezones = (Array.isArray(plain.userTimezones) ? plain.userTimezones : [])
    .filter((entry) => fieldMatches(entry?.userId, userId));
  const stickyRoles = (Array.isArray(plain.stickyRoles) ? plain.stickyRoles : [])
    .filter((entry) => fieldMatches(entry?.user, userId));
  const birthdayPendingRemovals = (Array.isArray(plain.birthdayPendingRemovals)
    ? plain.birthdayPendingRemovals
    : []
  ).filter((entry) => fieldMatches(entry?.userId, userId));
  const tags = (Array.isArray(plain.tags) ? plain.tags : [])
    .filter((entry) => fieldMatches(entry?.createdBy, userId));
  const stickies = (Array.isArray(plain.stickies) ? plain.stickies : [])
    .filter((entry) => fieldMatches(entry?.createdBy, userId));
  const scheduledMessages = (Array.isArray(plain.scheduledMessages)
    ? plain.scheduledMessages
    : []
  ).filter((entry) => fieldMatches(entry?.createdBy, userId));
  const tempChannels = (Array.isArray(plain.tempChannels) ? plain.tempChannels : [])
    .filter((entry) => fieldMatches(entry?.ownerId, userId));
  const birthdayBlacklist = (Array.isArray(plain.birthdayBlacklist)
    ? plain.birthdayBlacklist
    : []
  ).filter((entry) => fieldMatches(entry, userId));

  const hasReference =
    usersJoined.length > 0 ||
    userTimezones.length > 0 ||
    stickyRoles.length > 0 ||
    birthdayPendingRemovals.length > 0 ||
    tags.length > 0 ||
    stickies.length > 0 ||
    scheduledMessages.length > 0 ||
    tempChannels.length > 0 ||
    birthdayBlacklist.length > 0;

  if (!hasReference) return null;

  return {
    id: plain.id,
    name: client.guilds?.get?.(plain.id)?.name ?? null,
    usersJoined,
    userTimezones,
    stickyRoles,
    birthdayBlacklist,
    birthdayPendingRemovals,
    tags,
    stickies,
    scheduledMessages,
    tempChannels,
  };
}

function pollRelation(poll, userId) {
  const owned = fieldMatches(poll?.owner, userId);
  const voted = (Array.isArray(poll?.users) ? poll.users : [])
    .some((entry) => fieldMatches(pollVoterId(entry), userId));
  return { owned, voted };
}

function giveawayRelation(giveaway, userId) {
  const owned = fieldMatches(giveaway?.owner, userId);
  const entered = (Array.isArray(giveaway?.users) ? giveaway.users : [])
    .some((entry) => fieldMatches(giveawayUserId(entry), userId));
  const picking = (Array.isArray(giveaway?.picking) ? giveaway.picking : [])
    .some((entry) => fieldMatches(giveawayUserId(entry), userId));
  const won = (Array.isArray(giveaway?.pickedWinners) ? giveaway.pickedWinners : [])
    .some((entry) => fieldMatches(giveawayUserId(entry), userId));
  return { owned, entered, picking, won };
}

async function collectUserData(client, userId) {
  const normalizeId = text(userId);

  const [
    user,
    polls,
    giveaways,
    hostedEvents,
    rsvps,
    createdForms,
    submissions,
    translations,
    guilds,
  ] = await Promise.all([
    UserDB.findOne({ userId: normalizeId }).lean(),
    PollDB.find({
      $or: [{ owner: normalizeId }, { "users.user": normalizeId }],
    }).lean(),
    GiveawayDB.find({
      $or: [
        { owner: normalizeId },
        { "users.userID": normalizeId },
        { "picking.userID": normalizeId },
        { "pickedWinners.id": normalizeId },
      ],
    }).lean(),
    EventDB.find({ hostId: normalizeId }).lean(),
    EventRsvpDB.find({ userId: normalizeId }).lean(),
    FormDB.find({ createdBy: normalizeId }).lean(),
    FormSubmissionDB.find({
      $or: [{ userId: normalizeId }, { reviewerId: normalizeId }],
    }).lean(),
    TranslationDB.find({
      $or: [
        { updatedBy: normalizeId },
        { translatedBy: normalizeId },
        { "previous.updatedBy": normalizeId },
        { "notes.userId": normalizeId },
      ],
    }).lean(),
    GuildDB.find({
      $or: [
        { "usersJoined.userId": normalizeId },
        { "userTimezones.userId": normalizeId },
        { "stickyRoles.user": normalizeId },
        { birthdayBlacklist: normalizeId },
        { "birthdayPendingRemovals.userId": normalizeId },
        { "tags.createdBy": normalizeId },
        { "stickies.createdBy": normalizeId },
        { "scheduledMessages.createdBy": normalizeId },
        { "tempChannels.ownerId": normalizeId },
      ],
    }).lean(),
  ]);

  const rsvpEventIds = [...new Set(rsvps.map((entry) => text(entry.eventId)).filter(Boolean))];
  const rsvpEvents = rsvpEventIds.length
    ? await EventDB.find({ messageId: { $in: rsvpEventIds } }).lean()
    : [];
  const rsvpEventMap = new Map(
    rsvpEvents.map((event) => [text(event.messageId), event]),
  );

  const submissionFormIds = [...new Set(submissions.map((entry) => text(entry.formId)).filter(Boolean))];
  const submissionForms = submissionFormIds.length
    ? await FormDB.find({ _id: { $in: submissionFormIds } }).lean()
    : [];
  const submissionFormMap = new Map(
    submissionForms.map((form) => [text(form._id), form]),
  );

  const pollList = polls.map((poll) => ({
    ...poll,
    relationship: pollRelation(poll, normalizeId),
  }));
  const giveawayList = giveaways.map((giveaway) => ({
    ...giveaway,
    relationship: giveawayRelation(giveaway, normalizeId),
  }));
  const submissionList = submissions.map((submission) => ({
    ...submission,
    relationship: {
      submitted: fieldMatches(submission.userId, normalizeId),
      reviewed: fieldMatches(submission.reviewerId, normalizeId),
    },
    form: submissionFormMap.get(text(submission.formId)) ?? null,
  }));
  const rsvpList = rsvps.map((rsvp) => ({
    ...rsvp,
    event: rsvpEventMap.get(text(rsvp.eventId)) ?? null,
  }));
  const guildList = guilds
    .map((guild) => guildMatch(guild, normalizeId, client))
    .filter(Boolean);

  const data = {
    user: user ?? null,
    polls: pollList,
    giveaways: giveawayList,
    events: {
      hosted: hostedEvents,
      rsvps: rsvpList,
    },
    forms: {
      created: createdForms,
      submissions: submissionList,
    },
    translations,
    guilds: guildList,
  };

  return {
    counts: {
      pollsOwned: pollList.filter((entry) => entry.relationship.owned).length,
      pollsVoted: pollList.filter((entry) => entry.relationship.voted).length,
      giveawaysOwned: giveawayList.filter((entry) => entry.relationship.owned).length,
      giveawaysEntered: giveawayList.filter((entry) => entry.relationship.entered).length,
      eventsHosted: hostedEvents.length,
      eventRsvps: rsvpList.length,
      formsCreated: createdForms.length,
      formSubmissions: submissionList.length,
      translations: translations.length,
      guildReferences: guildList.length,
    },
    data,
  };
}

async function getUserData(client, userId) {
  const normalizeId = text(userId);
  const now = Date.now();
  const cached = dataCache.get(normalizeId);

  if (cached && cached.expiresAt > now) {
    return {
      cached: true,
      cachedAt: cached.cachedAt,
      expiresAt: cached.expiresAt,
      ...cached.value,
    };
  }

  if (cached) dataCache.delete(normalizeId);

  const value = await collectUserData(client, normalizeId);
  const entry = {
    cachedAt: now,
    expiresAt: now + DATA_CACHE_TTL_MS,
    value,
  };

  dataCache.set(normalizeId, entry);

  return {
    cached: false,
    cachedAt: entry.cachedAt,
    expiresAt: entry.expiresAt,
    ...value,
  };
}

function clearUserDataCache(userId) {
  if (userId == null) {
    dataCache.clear();
    return;
  }
  dataCache.delete(text(userId));
}

async function deleteFluxerMessage(client, channelId, messageId) {
  if (!channelId || !messageId) return;
  try {
    const channel = await client?.channels?.resolve?.(channelId);
    const message = await channel?.messages?.fetch?.(messageId);
    await message?.delete?.();
  } catch {}
}

function removePollAvatars(avatars, userId) {
  if (Array.isArray(avatars)) {
    return avatars.filter((entry) => {
      if (entry == null) return true;
      if (typeof entry !== "object") return !fieldMatches(entry, userId);
      return !fieldMatches(entry.user ?? entry.userId ?? entry.id, userId);
    });
  }

  if (avatars && typeof avatars === "object") {
    const next = { ...avatars };
    delete next[userId];
    return next;
  }

  return avatars;
}

function countPollVotes(poll, remainingUsers) {
  const optionCount = Array.isArray(poll?.options?.name)
    ? poll.options.name.length
    : Array.isArray(poll?.votes)
      ? poll.votes.length
      : 0;
  const counts = Array.from({ length: optionCount }, () => 0);

  for (const entry of remainingUsers) {
    const index = Number(entry?.option);
    if (!Number.isInteger(index) || index < 0) continue;
    while (counts.length <= index) counts.push(0);
    counts[index] += 1;
  }

  return counts;
}

async function deletePollReferences(client, userId, pollIds = null) {
  const selection = Array.isArray(pollIds);
  const polls = await PollDB.find({
    ...(selection ? { _id: { $in: pollIds } } : {}),
    $or: [{ owner: userId }, { "users.user": userId }],
  }).lean();

  const owned = polls.filter((poll) => fieldMatches(poll.owner, userId));
  const participated = polls.filter((poll) => !fieldMatches(poll.owner, userId));

  if (owned.length) {
    await PollDB.deleteMany({
      _id: { $in: owned.map((poll) => poll._id).filter(Boolean) },
    });
  }

  for (const poll of owned) {
    handlePollDelete(poll.messageId);
    client?.polls?.delete?.(poll.messageId);
    await deleteFluxerMessage(client, poll.channelId, poll.messageId);
  }

  let votesRemoved = 0;

  for (const poll of participated) {
    const originalUsers = Array.isArray(poll.users) ? poll.users : [];
    const remainingUsers = originalUsers.filter(
      (entry) => !fieldMatches(pollVoterId(entry), userId),
    );
    const removed = originalUsers.length - remainingUsers.length;
    if (removed <= 0) continue;

    votesRemoved += removed;
    const votes = countPollVotes(poll, remainingUsers);
    const avatars = removePollAvatars(poll.avatars, userId);
    await PollDB.updateOne(
      { _id: poll._id },
      { $set: { users: remainingUsers, votes, avatars } },
    );

    const cached = client?.polls?.get?.(poll.messageId);
    if (cached?.poll) {
      cached.poll.users = remainingUsers;
      cached.poll.votes = votes;
      cached.poll.avatars = avatars;
    }
  }

  return {
    pollsOwned: owned.length,
    pollVotesRemoved: votesRemoved,
  };
}

async function deleteGiveawayReferences(client, userId, giveawayIds = null) {
  const selection = Array.isArray(giveawayIds);
  const giveaways = await GiveawayDB.find({
    ...(selection ? { _id: { $in: giveawayIds } } : {}),
    $or: [
      { owner: userId },
      { "users.userID": userId },
      { "picking.userID": userId },
      { "pickedWinners.id": userId },
    ],
  }).lean();

  const owned = giveaways.filter((entry) => fieldMatches(entry.owner, userId));
  const participated = giveaways.filter((entry) => !fieldMatches(entry.owner, userId));

  if (owned.length) {
    await GiveawayDB.deleteMany({
      _id: { $in: owned.map((entry) => entry._id).filter(Boolean) },
    });
  }

  for (const giveaway of owned) {
    handleGiveawayDelete(giveaway.messageId);
    await deleteFluxerMessage(client, giveaway.channelId, giveaway.messageId);
  }

  let entriesRemoved = 0;

  for (const giveaway of participated) {
    const before =
      (Array.isArray(giveaway.users) ? giveaway.users.length : 0) +
      (Array.isArray(giveaway.picking) ? giveaway.picking.length : 0) +
      (Array.isArray(giveaway.pickedWinners) ? giveaway.pickedWinners.length : 0);

    await GiveawayDB.updateOne(
      { _id: giveaway._id },
      {
        $pull: {
          users: { userID: userId },
          picking: { userID: userId },
          pickedWinners: { id: userId },
        },
      },
    );

    const after =
      (Array.isArray(giveaway.users)
        ? giveaway.users.filter((entry) => !fieldMatches(giveawayUserId(entry), userId)).length
        : 0) +
      (Array.isArray(giveaway.picking)
        ? giveaway.picking.filter((entry) => !fieldMatches(giveawayUserId(entry), userId)).length
        : 0) +
      (Array.isArray(giveaway.pickedWinners)
        ? giveaway.pickedWinners.filter((entry) => !fieldMatches(giveawayUserId(entry), userId)).length
        : 0);

    entriesRemoved += Math.max(0, before - after);
  }

  return {
    giveawaysOwned: owned.length,
    giveawayEntriesRemoved: entriesRemoved,
  };
}

async function deleteEventReferences(client, userId, eventIds = null) {
  const selection = Array.isArray(eventIds);
  const hosted = await EventDB.find({
    hostId: userId,
    ...(selection ? { _id: { $in: eventIds } } : {}),
  }).lean();
  const hostedMessageIds = hosted.map((event) => text(event.messageId)).filter(Boolean);
  const rsvps = selection
    ? await EventRsvpDB.find({ eventId: { $in: hostedMessageIds } }).lean()
    : await EventRsvpDB.find({ userId }).lean();

  for (const event of hosted) {
    await deleteFluxerMessage(client, event.channelId, event.messageId);
  }

  if (hosted.length) {
    if (hostedMessageIds.length) {
      await EventRsvpDB.deleteMany({ eventId: { $in: hostedMessageIds } });
    }
    await EventDB.deleteMany({
      _id: { $in: hosted.map((event) => event._id).filter(Boolean) },
    });
  }

  if (!selection) {
    await EventRsvpDB.deleteMany({ userId });
  }

  return {
    eventsHosted: hosted.length,
    eventRsvpsRemoved: rsvps.length,
  };
}

async function deleteFormReferences(client, userId) {
  const createdForms = await FormDB.find({ createdBy: userId }).lean();
  const submissions = await FormSubmissionDB.find({
    $or: [{ userId }, { reviewerId: userId }],
  }).lean();

  const createdFormIds = createdForms.map((form) => text(form._id)).filter(Boolean);
  const createdFormIdSet = new Set(createdFormIds);
  const ownSubmissions = submissions.filter((entry) => fieldMatches(entry.userId, userId));
  const reviewedOnly = submissions.filter(
    (entry) => !fieldMatches(entry.userId, userId) && fieldMatches(entry.reviewerId, userId),
  );

  for (const form of createdForms) {
    await deleteFluxerMessage(client, form.panelChannelId, form.panelMessageId);
  }

  const formSubmissions = createdFormIds.length
    ? await FormSubmissionDB.find({ formId: { $in: createdFormIds } }).lean()
    : [];

  for (const submission of [...formSubmissions, ...ownSubmissions]) {
    if (!submission.reviewMessageId || !submission.reviewChannelId) continue;
    await deleteFluxerMessage(
      client,
      submission.reviewChannelId,
      submission.reviewMessageId,
    );
  }

  if (createdFormIds.length) {
    await FormSubmissionDB.deleteMany({ formId: { $in: createdFormIds } });
  }

  const ownIds = ownSubmissions
    .filter((entry) => !createdFormIdSet.has(text(entry.formId)))
    .map((entry) => entry._id)
    .filter(Boolean);
  if (ownIds.length) {
    await FormSubmissionDB.deleteMany({ _id: { $in: ownIds } });
  }

  const reviewedIds = reviewedOnly.map((entry) => entry._id).filter(Boolean);
  if (reviewedIds.length) {
    await FormSubmissionDB.updateMany(
      { _id: { $in: reviewedIds } },
      { $set: { reviewerId: null } },
    );
  }

  if (createdForms.length) {
    await FormDB.deleteMany({
      _id: { $in: createdForms.map((form) => form._id).filter(Boolean) },
    });
  }

  return {
    formsCreated: createdForms.length,
    formSubmissionsRemoved: formSubmissions.length + ownIds.length,
    formReviewsAnonymized: reviewedIds.length,
  };
}

async function deleteFormById(client, userId, formId) {
  const form = await FormDB.findOne({ _id: formId, createdBy: userId }).lean();
  if (!form) return { formsCreated: 0, formSubmissionsRemoved: 0 };

  const formKey = text(form._id);
  const submissions = await FormSubmissionDB.find({ formId: formKey }).lean();

  await deleteFluxerMessage(client, form.panelChannelId, form.panelMessageId);

  for (const submission of submissions) {
    if (!submission.reviewMessageId || !submission.reviewChannelId) continue;
    await deleteFluxerMessage(client, submission.reviewChannelId, submission.reviewMessageId);
  }

  await FormSubmissionDB.deleteMany({ formId: formKey });
  await FormDB.deleteOne({ _id: form._id, createdBy: userId });

  return {
    formsCreated: 1,
    formSubmissionsRemoved: submissions.length,
  };
}

async function deleteSubmissionById(client, userId, submissionId) {
  const submission = await FormSubmissionDB.findOne({
    _id: submissionId,
    $or: [{ userId }, { reviewerId: userId }],
  }).lean();

  if (!submission) {
    return { formSubmissionsRemoved: 0, formReviewsAnonymized: 0 };
  }

  if (fieldMatches(submission.userId, userId)) {
    await deleteFluxerMessage(
      client,
      submission.reviewChannelId,
      submission.reviewMessageId,
    );
    await FormSubmissionDB.deleteOne({ _id: submission._id });
    return { formSubmissionsRemoved: 1, formReviewsAnonymized: 0 };
  }

  await FormSubmissionDB.updateOne(
    { _id: submission._id, reviewerId: userId },
    { $set: { reviewerId: null } },
  );
  return { formSubmissionsRemoved: 0, formReviewsAnonymized: 1 };
}

async function deleteRsvpReferences(userId, rsvpIds) {
  const result = await EventRsvpDB.deleteMany({
    _id: { $in: rsvpIds },
    userId,
  });

  return { eventRsvpsRemoved: result.deletedCount ?? 0 };
}

async function deleteTranslationById(userId, translationId) {
  const userFilters = [
    { updatedBy: userId },
    { translatedBy: userId },
    { "previous.updatedBy": userId },
    { "notes.userId": userId },
  ];
  const translation = await TranslationDB.findOne({
    _id: translationId,
    $or: userFilters,
  }).lean();

  if (!translation) {
    return { translationsTouched: 0, translationNotesRemoved: 0 };
  }

  const notesRemoved = Array.isArray(translation.notes)
    ? translation.notes.filter((entry) => fieldMatches(entry?.userId, userId)).length
    : 0;
  const set = {};

  if (fieldMatches(translation.updatedBy, userId)) set.updatedBy = null;
  if (fieldMatches(translation.translatedBy, userId)) set.translatedBy = null;
  if (fieldMatches(translation.previous?.updatedBy, userId)) {
    set["previous.updatedBy"] = null;
  }

  if (Object.keys(set).length || notesRemoved) {
    await TranslationDB.updateOne(
      { _id: translation._id },
      {
        ...(Object.keys(set).length ? { $set: set } : {}),
        ...(notesRemoved ? { $pull: { notes: { userId } } } : {}),
      },
    );
  }

  return {
    translationsTouched: 1,
    translationNotesRemoved: notesRemoved,
  };
}

async function deleteTranslationReferences(userId) {
  const filters = [
    { updatedBy: userId },
    { translatedBy: userId },
    { "previous.updatedBy": userId },
    { "notes.userId": userId },
  ];

  const counts = await Promise.all(
    filters.map((filter) => TranslationDB.countDocuments(filter).catch(() => 0)),
  );

  await Promise.all([
    TranslationDB.updateMany({ updatedBy: userId }, { $set: { updatedBy: null } }),
    TranslationDB.updateMany({ translatedBy: userId }, { $set: { translatedBy: null } }),
    TranslationDB.updateMany(
      { "previous.updatedBy": userId },
      { $set: { "previous.updatedBy": null } },
    ),
    TranslationDB.updateMany(
      { "notes.userId": userId },
      { $pull: { notes: { userId } } },
    ),
  ]);

  return {
    translationsTouched: Math.max(...counts, 0),
    translationNotesRemoved: counts[3] ?? 0,
  };
}

async function deleteGuildReferences(client, userId, guildIds = null) {
  const selection = Array.isArray(guildIds);
  const guilds = await GuildDB.find({
    ...(selection ? { id: { $in: guildIds } } : {}),
    $or: [
      { "usersJoined.userId": userId },
      { "userTimezones.userId": userId },
      { "stickyRoles.user": userId },
      { birthdayBlacklist: userId },
      { "birthdayPendingRemovals.userId": userId },
      { "tags.createdBy": userId },
      { "stickies.createdBy": userId },
      { "scheduledMessages.createdBy": userId },
      { "tempChannels.ownerId": userId },
    ],
  }).lean();

  let updated = 0;
  let tagsRemoved = 0;
  let stickiesRemoved = 0;
  let scheduledMessagesRemoved = 0;

  for (const guild of guilds) {
    const updates = {};
    const usersJoined = Array.isArray(guild.usersJoined) ? guild.usersJoined : [];
    const userTimezones = Array.isArray(guild.userTimezones) ? guild.userTimezones : [];
    const stickyRoles = Array.isArray(guild.stickyRoles) ? guild.stickyRoles : [];
    const pendingRemovals = Array.isArray(guild.birthdayPendingRemovals)
      ? guild.birthdayPendingRemovals
      : [];
    const blacklist = Array.isArray(guild.birthdayBlacklist) ? guild.birthdayBlacklist : [];
    const tags = Array.isArray(guild.tags) ? guild.tags : [];
    const stickies = Array.isArray(guild.stickies) ? guild.stickies : [];
    const scheduledMessages = Array.isArray(guild.scheduledMessages)
      ? guild.scheduledMessages
      : [];
    const tempChannels = Array.isArray(guild.tempChannels) ? guild.tempChannels : [];

    const nextUsersJoined = usersJoined.filter((entry) => !fieldMatches(entry?.userId, userId));
    if (nextUsersJoined.length !== usersJoined.length) updates.usersJoined = nextUsersJoined;

    const nextTimezones = userTimezones.filter((entry) => !fieldMatches(entry?.userId, userId));
    if (nextTimezones.length !== userTimezones.length) updates.userTimezones = nextTimezones;

    const nextStickyRoles = stickyRoles.filter((entry) => !fieldMatches(entry?.user, userId));
    if (nextStickyRoles.length !== stickyRoles.length) updates.stickyRoles = nextStickyRoles;

    const nextPending = pendingRemovals.filter((entry) => !fieldMatches(entry?.userId, userId));
    if (nextPending.length !== pendingRemovals.length) {
      updates.birthdayPendingRemovals = nextPending;
    }

    const nextBlacklist = blacklist.filter((entry) => !fieldMatches(entry, userId));
    if (nextBlacklist.length !== blacklist.length) updates.birthdayBlacklist = nextBlacklist;

    const nextTags = tags.filter((entry) => !fieldMatches(entry?.createdBy, userId));
    if (nextTags.length !== tags.length) {
      updates.tags = nextTags;
      tagsRemoved += tags.length - nextTags.length;
    }

    const removedStickies = stickies.filter((entry) => fieldMatches(entry?.createdBy, userId));
    if (removedStickies.length) {
      updates.stickies = stickies.filter((entry) => !fieldMatches(entry?.createdBy, userId));
      stickiesRemoved += removedStickies.length;
      for (const sticky of removedStickies) {
        clearStickyTimer(sticky.channelId);
        await deleteStickyMessage(client, guild.id, sticky).catch(() => {});
      }
    }

    const nextScheduled = scheduledMessages.filter(
      (entry) => !fieldMatches(entry?.createdBy, userId),
    );
    if (nextScheduled.length !== scheduledMessages.length) {
      updates.scheduledMessages = nextScheduled;
      scheduledMessagesRemoved += scheduledMessages.length - nextScheduled.length;
      for (const entry of scheduledMessages) {
        if (!fieldMatches(entry?.createdBy, userId)) continue;
        handleScheduledDelete(guild.id, entry.id);
      }
    }

    const nextTempChannels = tempChannels.filter(
      (entry) => !fieldMatches(entry?.ownerId, userId),
    );
    if (nextTempChannels.length !== tempChannels.length) {
      updates.tempChannels = nextTempChannels;
    }

    if (Object.keys(updates).length === 0) continue;

    if (typeof client?.database?.updateGuild === "function") {
      await client.database.updateGuild(guild.id, updates, false);
    } else {
      await GuildDB.updateOne({ id: guild.id }, { $set: updates });
    }

    updated += 1;

    if (updates.tags) {
      refreshTagIndex(client, guild.id).catch(() => {});
    }
  }

  return {
    guildsUpdated: updated,
    tagsRemoved,
    stickiesRemoved,
    scheduledMessagesRemoved,
  };
}

async function deleteUserData(client, userId) {
  const normalizeId = text(userId);
  clearUserDataCache(normalizeId);
  const user = await UserDB.findOne({ userId: normalizeId }).lean();

  if (user?.reactionReminders?.length) {
    await removeWatchers(client, normalizeId, () => true).catch(() => {});
  }

  for (const reminder of user?.reminders ?? []) {
    if (reminder?.id) handleDeletedReminder(normalizeId, reminder.id);
  }

  removeTimedRoleUser(normalizeId);
  removeUserFromSchedule(normalizeId);
  client?.observedVoiceUsers?.delete?.(normalizeId);

  const [polls, giveaways, events, forms, translations, guilds] = await Promise.all([
    deletePollReferences(client, normalizeId),
    deleteGiveawayReferences(client, normalizeId),
    deleteEventReferences(client, normalizeId),
    deleteFormReferences(client, normalizeId),
    deleteTranslationReferences(normalizeId),
    deleteGuildReferences(client, normalizeId),
  ]);

  if (typeof client?.database?.deleteUser === "function") {
    await client.database.deleteUser(normalizeId);
  } else {
    await UserDB.deleteMany({ userId: normalizeId });
  }

  clearUserDataCache(normalizeId);

  return {
    userId: normalizeId,
    deletedAt: Date.now(),
    ...polls,
    ...giveaways,
    ...events,
    ...forms,
    ...translations,
    ...guilds,
    userDocumentRemoved: Boolean(user),
  };
}

const SELECTED_ITEM_TYPES = new Set([
  "poll",
  "giveaway",
  "event",
  "rsvp",
  "form",
  "submission",
  "translation",
  "guild",
]);
const MAX_SELECTED_ITEMS = 100;

function normalizeSelectedItems(items) {
  const normalized = [];
  const seen = new Set();

  for (const item of Array.isArray(items) ? items : []) {
    if (!item || typeof item !== "object") continue;

    const type = text(item.type);
    if (!SELECTED_ITEM_TYPES.has(type)) continue;

    if (type === "guild") {
      const guildId = text(item.guildId);
      if (!/^\d{17,20}$/.test(guildId)) continue;

      const key = `guild:${guildId}`;
      if (seen.has(key)) continue;

      seen.add(key);
      normalized.push({ type, guildId });
    } else {
      const id = text(item.id);
      if (!/^[a-f0-9]{24}$/i.test(id)) continue;

      const key = `${type}:${id}`;
      if (seen.has(key)) continue;

      seen.add(key);
      normalized.push({ type, id });
    }

    if (normalized.length >= MAX_SELECTED_ITEMS) break;
  }

  return normalized;
}

async function deleteSelectedUserData(client, userId, items) {
  const normalizeId = text(userId);
  const selected = normalizeSelectedItems(items);
  const result = {
    userId: normalizeId,
    deletedAt: Date.now(),
    selectedItems: selected.length,
    pollsOwned: 0,
    pollVotesRemoved: 0,
    giveawaysOwned: 0,
    giveawayEntriesRemoved: 0,
    eventsHosted: 0,
    eventRsvpsRemoved: 0,
    formsCreated: 0,
    formSubmissionsRemoved: 0,
    formReviewsAnonymized: 0,
    translationsTouched: 0,
    translationNotesRemoved: 0,
    guildsUpdated: 0,
    tagsRemoved: 0,
    stickiesRemoved: 0,
    scheduledMessagesRemoved: 0,
  };

  if (!selected.length) return result;

  clearUserDataCache(normalizeId);

  const idsFor = (type) => [
    ...new Set(
      selected
        .filter((item) => item.type === type)
        .map((item) => item.id),
    ),
  ];
  const pollIds = idsFor("poll");
  const giveawayIds = idsFor("giveaway");
  const eventIds = idsFor("event");
  const rsvpIds = idsFor("rsvp");
  const formIds = idsFor("form");
  const submissionIds = idsFor("submission");
  const translationIds = idsFor("translation");
  const guildIds = [
    ...new Set(
      selected
        .filter((item) => item.type === "guild")
        .map((item) => item.guildId),
    ),
  ];

  const [
    pollResult,
    giveawayResult,
    eventResult,
    rsvpResult,
    formResults,
    submissionResults,
    translationResults,
    guildResult,
  ] = await Promise.all([
    pollIds.length ? deletePollReferences(client, normalizeId, pollIds) : null,
    giveawayIds.length
      ? deleteGiveawayReferences(client, normalizeId, giveawayIds)
      : null,
    eventIds.length ? deleteEventReferences(client, normalizeId, eventIds) : null,
    rsvpIds.length ? deleteRsvpReferences(normalizeId, rsvpIds) : null,
    formIds.length
      ? Promise.all(formIds.map((id) => deleteFormById(client, normalizeId, id)))
      : [],
    submissionIds.length
      ? Promise.all(
          submissionIds.map((id) => deleteSubmissionById(client, normalizeId, id)),
        )
      : [],
    translationIds.length
      ? Promise.all(
          translationIds.map((id) => deleteTranslationById(normalizeId, id)),
        )
      : [],
    guildIds.length ? deleteGuildReferences(client, normalizeId, guildIds) : null,
  ]);

  const merge = (value) => {
    if (!value) return;
    for (const [key, amount] of Object.entries(value)) {
      if (typeof amount === "number") {
        result[key] = (result[key] ?? 0) + amount;
      }
    }
  };

  merge(pollResult);
  merge(giveawayResult);
  merge(eventResult);
  merge(rsvpResult);
  merge(guildResult);
  for (const value of formResults) merge(value);
  for (const value of submissionResults) merge(value);
  for (const value of translationResults) merge(value);

  clearUserDataCache(normalizeId);
  return result;
}

module.exports = {
  DATA_CACHE_TTL_MS,
  MAX_SELECTED_ITEMS,
  getUserData,
  deleteUserData,
  deleteSelectedUserData,
  clearUserDataCache,
};
