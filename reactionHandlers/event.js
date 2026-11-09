const Events = require("../models/events");
const EventRsvps = require("../models/eventRsvps");
const {
  getReactionKey,
  resolveRsvpResponse,
  getMemberHasAnyRole,
  getEventCounts,
  buildEventEmbed,
  getRsvpOptions,
  addAttendeeRole,
  removeAttendeeRole,
} = require("../functions/eventHelpers");

async function promoteWaitlist(event, client) {
  if (!event.capacity) return false;
  let promoted = false;

  for (;;) {
    const going = await EventRsvps.countDocuments({
      eventId: event.messageId,
      response: "going",
      waitlisted: false,
    });
    if (going >= event.capacity) break;

    const next = await EventRsvps.findOneAndUpdate(
      {
        eventId: event.messageId,
        response: "going",
        waitlisted: true,
      },
      { $set: { waitlisted: false, updatedAt: Date.now() } },
      { sort: { createdAt: 1 }, returnDocument: "after" }
    );

    if (!next) break;
    promoted = true;
    await addAttendeeRole(client, event, next.userId);
  }

  return promoted;
}

async function refreshCard(client, event, reactionMsg) {
  const db = await client.database.getGuild(event.guildId, false, true).catch(() => null);
  const counts = await getEventCounts(event.messageId);
  const embed = buildEventEmbed(client, db, event, counts);
  try {
    if (reactionMsg?.edit) {
      await reactionMsg.edit({ embeds: [embed] });
    } else {
      const channel = await client.channels.resolve(event.channelId);
      const message = await channel?.messages?.fetch?.(event.messageId);
      await message?.edit({ embeds: [embed] });
    }
  } catch {}
}

module.exports = async (client, reaction, userId, reactionMsg, eventType = "add") => {
  const event = await Events.findOne({ messageId: reaction.messageId }).catch(() => null);
  if (!event) return false;

  if (event.status === "ended" || event.status === "cancelled") return true;

  const emojiKey = getReactionKey(reaction);
  const response = resolveRsvpResponse(event, emojiKey);
  if (!response) return true;

  if (event.signupCutoffAt && Date.now() >= event.signupCutoffAt) {
    await reactionMsg?.removeReaction?.(reaction.emoji, userId).catch(() => {});
    return true;
  }

  const guild = client.guilds?.get?.(event.guildId) ?? null;
  const member = reaction.member ?? guild?.members?.get?.(userId) ?? null;
  if (!getMemberHasAnyRole(member, event.requiredRoleIds)) {
    await reactionMsg?.removeReaction?.(reaction.emoji, userId).catch(() => {});
    return true;
  }

  const existing = await EventRsvps.findOne({
    eventId: event.messageId,
    userId,
  }).catch(() => null);

  if (eventType === "remove") {
    if (!existing || existing.response !== response) return true;

    const wasGoing = existing.response === "going" && !existing.waitlisted;
    await EventRsvps.deleteOne({ _id: existing._id }).catch(() => {});
    if (wasGoing) {
      await removeAttendeeRole(client, event, userId);
      await promoteWaitlist(event, client);
    }
    await refreshCard(client, event, reactionMsg);
    return true;
  }

  if (existing?.response === response && existing.waitlisted) return true;

  let waitlisted = false;
  if (response === "going" && event.capacity) {
    const going = await EventRsvps.countDocuments({
      eventId: event.messageId,
      response: "going",
      waitlisted: false,
      ...(existing ? { _id: { $ne: existing._id } } : {}),
    });
    waitlisted = going >= event.capacity;
    if (waitlisted && existing?.response === "going" && !existing.waitlisted) {
      waitlisted = false;
    }
  }

  await EventRsvps.findOneAndUpdate(
    { eventId: event.messageId, userId },
    {
      $set: {
        guildId: event.guildId,
        response,
        waitlisted,
        updatedAt: Date.now(),
      },
      $setOnInsert: {
        eventId: event.messageId,
        userId,
        createdAt: Date.now(),
      },
    },
    { upsert: true, returnDocument: "after" }
  ).catch(() => {});

  if (response === "going" && !waitlisted) {
    await addAttendeeRole(client, event, userId);
  } else {
    await removeAttendeeRole(client, event, userId);
  }

  if (response !== "going") {
    await promoteWaitlist(event, client);
  }

  if (reactionMsg?.removeReaction) {
    const options = getRsvpOptions(event);
    const others = [
      ["maybe", options.maybe.enabled ? options.maybe.emoji : null],
      ["declined", options.declined.enabled ? options.declined.emoji : null],
      ["going", options.going.emoji],
    ].filter(([name, emoji]) => name !== response && emoji);
    for (const [, emoji] of others) {
      await reactionMsg.removeReaction(emoji, userId).catch(() => {});
    }
  }

  await refreshCard(client, event, reactionMsg);
  return true;
};
