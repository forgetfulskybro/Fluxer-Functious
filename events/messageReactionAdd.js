const editCollectorHandler = require("../reactionHandlers/editCollector");
const roleReactionHandler = require("../reactionHandlers/roleReaction");
const paginationHandler = require("../reactionHandlers/pagination");
const collectorHandler = require("../reactionHandlers/collector");
const giveawayHandler = require("../reactionHandlers/giveaway");
const timezoneHandler = require("../reactionHandlers/timezone");
const pollHandler = require("../reactionHandlers/poll");
const parseTime = require("../functions/parseTime");
const Giveaways = require("../models/giveaways");

module.exports = async (client, message, user) => {
    if (user.bot) return;

    const userId = user.id;
    const emojiId = message.emoji?.name;

    const paginateCheck = client.paginate.get(userId);
    const pollCheck = client.polls.get(message.messageId);
    const collector = client.messageCollector.get(userId);
    const editCollector = client.messageEdit.get(userId);

    const reactionChan = await client.channels.resolve(message.channelId).catch(() => null);
    const reactionMsg  = await reactionChan?.messages.fetch(message.messageId).catch(() => null);

    if (collector && (collector.messageId === message.messageId || (collector?.oldMessageId && collector.oldMessageId === message.messageId && collector.channelId === message.channelId))) return collectorHandler(client, message, userId, collector, reactionChan, reactionMsg, emojiId, "add");
    if (editCollector && (editCollector.messageId === message.messageId || (editCollector?.botMessage && editCollector.botMessage === message.messageId && editCollector.channelId === message.channelId))) return editCollectorHandler(client, message, userId, editCollector, reactionChan, reactionMsg, emojiId, "add");
    if (paginateCheck && paginateCheck.message === message.messageId) return paginationHandler(client, message, paginateCheck, reactionMsg, emojiId);
    if (pollCheck) return pollHandler(client, message, userId, pollCheck, reactionMsg, emojiId, "add");
    if (emojiId === "⌚" && reactionMsg.author.id === userId) return timezoneHandler(client, message, userId);
  
    const db = await Giveaways.findOne({ messageId: message.messageId });
    if (db) return giveawayHandler(client, message, userId, db, emojiId, "add");
    return roleReactionHandler(client, message, userId, emojiId, "add");
};