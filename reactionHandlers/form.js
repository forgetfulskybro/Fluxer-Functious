const { handleFormReaction } = require("../functions/formHelpers");

module.exports = async (client, reaction, userId, reactionMsg, eventType = "add") => {
  try {
    return await handleFormReaction(client, reaction, userId, reactionMsg, eventType);
  } catch (err) {
    console.error("[Forms] Reaction handler error:", err);
    return false;
  }
};
