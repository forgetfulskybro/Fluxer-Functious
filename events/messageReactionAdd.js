const scheduleCollectorHandler = require("../reactionHandlers/scheduleCollector");
const reloadSelectionHandler = require("../reactionHandlers/reloadSelection");
const editCollectorHandler = require("../reactionHandlers/editCollector");
const roleReactionHandler = require("../reactionHandlers/roleReaction");
const paginationHandler = require("../reactionHandlers/pagination");
const collectorHandler = require("../reactionHandlers/collector");
const giveawayHandler = require("../reactionHandlers/giveaway");
const timezoneHandler = require("../reactionHandlers/timezone");
const manageVC = require("../reactionHandlers/manageVC");
const pollHandler = require("../reactionHandlers/poll");
const parseTime = require("../functions/parseTime");
const Giveaways = require("../models/giveaways");

module.exports = async (client, reaction) => {
  if (reaction.user?.bot) return;

  const userId = reaction.user.id;
  const emojiId = reaction.emoji?.name;
  const emote = reaction.emoji?.id ? `<:${emojiId}:${reaction.emoji.id}>` : emojiId;

  const scheduleCollector = client.scheduleCollector.get(userId);
  const reloadSelection = client.reloadSelection.get(userId);
  const voiceUser = client.observedVoiceUsers.get(userId);
  const pollCheck = client.polls.get(reaction.messageId);
  const collector = client.messageCollector.get(userId);
  const editCollector = client.messageEdit.get(userId);
  const paginateCheck = client.paginate.get(userId);
  
  let reactionChan;
  try {
    reactionChan = await client.channels.fetch(reaction.channelId);
  } catch {
    reactionChan = null;
  }

  if (!reactionChan) return;

  let reactionMsg;
  try {
    reactionMsg = await reactionChan.messages.fetch(reaction.messageId);
  } catch {
    reactionMsg = null;
  }

  if (!reactionMsg) return;

  if (reloadSelection && reloadSelection.messageId === reaction.messageId) {
    return reloadSelectionHandler(client, reaction, userId, reloadSelection, emojiId);
  }

  if (collector && (
    collector.messageId === reaction.messageId || 
    (collector?.oldMessageId && collector.oldMessageId === reaction.messageId && collector.channelId === reaction.channelId)
  )) {
    return collectorHandler(client, reaction, userId, collector, reactionChan, reactionMsg, emojiId, "add");
  }

  if (scheduleCollector && 
      scheduleCollector.botMessage === reaction.messageId && 
      scheduleCollector.channelId === reaction.channelId) {
    return scheduleCollectorHandler(client, reaction, userId, scheduleCollector, reactionChan, reactionMsg, emojiId, "add");
  }

  if (editCollector && (
    editCollector.messageId === reaction.messageId || 
    (editCollector?.botMessage && editCollector.botMessage === reaction.messageId && editCollector.channelId === reaction.channelId)
  )) {
    return editCollectorHandler(client, reaction, userId, editCollector, reactionChan, reactionMsg, emojiId, "add");
  }

  if (paginateCheck && paginateCheck.message === reaction.messageId) {
    return paginationHandler(client, reaction, paginateCheck, reactionMsg, emojiId, userId);
  }

  if (pollCheck) {
    return pollHandler(client, reaction, userId, pollCheck, reactionMsg, emojiId, "add");
  }

  if (emojiId === "⌚" && 
      parseTime(reactionMsg.content, "America/New_York") && 
      reactionMsg.author.id === userId) {
    return timezoneHandler(client, reaction, userId);
  }

  if (voiceUser && ['<:rename:1502164676598628060>', '<:userlimit:1502164677802393309>', '<:region:1502164672647593687>',
    '<:privacy:1502164674153348824>', '<:unblock:1502164681409494751>', '<:block:1502164675642326745>',
    '<:transfer:1502164678616088286>', '<:close:1502185371235901763>'].includes(emote)) {
    await reactionMsg.removeReaction(emote, userId).catch(() => { });
    return manageVC(client, reaction, userId, emojiId);
  }

  const db = await Giveaways.findOne({ messageId: reaction.messageId }).catch(() => null);
  if (db) {
    return giveawayHandler(client, reaction, userId, db, emojiId, "add");
  }

  return roleReactionHandler(client, reaction, userId, emojiId, "add");
};