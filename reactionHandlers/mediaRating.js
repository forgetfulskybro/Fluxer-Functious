const { UPVOTE, DOWNVOTE } = require("../commands/mediachannels");

module.exports = async function mediaRatingHandler(client, reaction, userId, mc, reactionMsg, emojiId, event) {
  if (emojiId !== UPVOTE && emojiId !== DOWNVOTE) return;
  if (!mc.rating || mc.deleteThreshold <= 0) return;
  if (reactionMsg.author?.id === client.user.id) return;

  let upvotes = 0;
  let downvotes = 0;

  try {
    const upReaction = reactionMsg.reactions?.cache.get(UPVOTE);
    const downReaction = reactionMsg.reactions?.cache.get(DOWNVOTE);

    upvotes = (upReaction?.count ?? 0) - (upReaction?.me ? 1 : 0);
    downvotes = (downReaction?.count ?? 0) - (downReaction?.me ? 1 : 0);
  } catch(e) { return console.log(e) }

  const net = upvotes - downvotes;

  if (net <= -mc.deleteThreshold) {
    await reactionMsg.delete().catch(() => {});
  }
};
