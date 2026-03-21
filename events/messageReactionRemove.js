const editCollectorHandler = require("../reactionHandlers/editCollector");
const roleReactionHandler = require("../reactionHandlers/roleReaction");
const collectorHandler = require("../reactionHandlers/collector");
const giveawayHandler = require("../reactionHandlers/giveaway");
const pollHandler = require("../reactionHandlers/poll");
const Giveaways = require("../models/giveaways");

module.exports = async (client, message, user) => {
    if (user.bot) return;

    const userId = user.id;
    const emojiId = message.emoji?.name;

    const pollCheck = client.polls.get(message.messageId);
    const collector = client.messageCollector.get(userId);
    const editCollector = client.messageEdit.get(userId);

    const reactionChan = await client.channels.resolve(message.channelId).catch(() => null);
    const reactionMsg  = await reactionChan?.messages.fetch(message.messageId).catch(() => null);

    if (collector && collector.messageId === message.messageId && collector.channelId === message.channelId) return collectorHandler(client, message, userId, collector, reactionChan, reactionMsg, emojiId, "remove");
    if (editCollector && editCollector.messageId === message.messageId && editCollector.channelId === message.channelId) return editCollectorHandler(client, message, userId, editCollector, reactionChan, reactionMsg, emojiId, "remove");
    if (pollCheck) return pollHandler(client, message, userId, pollCheck, reactionMsg, emojiId, "remove");
  
    const db = await Giveaways.findOne({ messageId: message.messageId });
    if (db && !db.ended) return giveawayHandler(client, message, userId, db, emojiId, "remove");
    return roleReactionHandler(client, message, userId, emojiId, "remove");
};
