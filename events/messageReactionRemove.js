const editCollectorHandler = require("../reactionHandlers/editCollector");
const roleReactionHandler = require("../reactionHandlers/roleReaction");
const collectorHandler = require("../reactionHandlers/collector");
const giveawayHandler = require("../reactionHandlers/giveaway");
const pollHandler = require("../reactionHandlers/poll");
const Giveaways = require("../models/giveaways");

module.exports = async (client, reaction) => {
    if (reaction.user?.bot) return;

    const userId = reaction.user.id;
    const emojiId = reaction.emoji?.name;

    const pollCheck = client.polls.get(reaction.messageId);
    const collector = client.messageCollector.get(userId);
    const editCollector = client.messageEdit.get(userId);

    let reactionChan;
    try {
        reactionChan = await client.channels.fetch(reaction.channelId).catch(() => null);
    } catch {
        reactionChan = null;
    }

    if (!reactionChan) return;

    let reactionMsg;
    try {
        reactionMsg = await reactionChan.messages.fetch(reaction.messageId).catch(() => null);
    } catch {
        reactionMsg = null;
    }

    if (!reactionMsg) return;

    if (collector && 
        collector.messageId === reaction.messageId && 
        collector.channelId === reaction.channelId) {
        return collectorHandler(client, reaction, userId, collector, reactionChan, reactionMsg, emojiId, "remove");
    }

    if (editCollector && 
        editCollector.messageId === reaction.messageId && 
        editCollector.channelId === reaction.channelId) {
        return editCollectorHandler(client, reaction, userId, editCollector, reactionChan, reactionMsg, emojiId, "remove");
    }

    if (pollCheck) {
        return pollHandler(client, reaction, userId, pollCheck, reactionMsg, emojiId, "remove");
    }

    const db = await Giveaways.findOne({ messageId: reaction.messageId }).catch(() => null);
    if (db && !db.ended) {
        return giveawayHandler(client, reaction, userId, db, emojiId, "remove");
    }

    return roleReactionHandler(client, reaction, userId, emojiId, "remove");
};