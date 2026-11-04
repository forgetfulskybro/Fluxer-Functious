const {
  finalizeCustomSetup,
  cancelCustomSetup,
  addReactionToSession,
  removeReactionFromSession,
} = require('../functions/customRoleSetup');

module.exports = async (client, message, userId, session, reactionChan, reactionMsg, emojiId, event = 'add') => {
  if (!session?.custom) return;

  const isControl = message.messageId === session.controlMessageId;
  const isReaction = message.messageId === session.reactionMessageId;
  if (!isControl && !isReaction) return;

  if (event === 'remove') {
    if (isReaction) removeReactionFromSession(session, message);
    return;
  }

  if (isControl) {
    if (emojiId === client.config?.emojis?.check) {
      const db = await client.database.getGuild(session.guildId || message.reaction?.guildId);
      return finalizeCustomSetup(client, session, userId, db);
    }

    if (emojiId === client.config?.emojis?.cross) {
      const db = await client.database.getGuild(session.guildId || message.reaction?.guildId);
      return cancelCustomSetup(client, db, session, 'cancel');
    }

    return;
  }

  addReactionToSession(session, message);
};
