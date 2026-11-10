const { checkTagMessage } = require("../functions/tagIndex");

module.exports = async (client, _oldMessage, newMessage) => {
  if (!newMessage || !newMessage.guildId) return;

  let message = newMessage;
  if (message.partial) {
    message = await message.fetch().catch(() => null);
    if (!message) return;
  }

  await checkTagMessage(client, message).catch(() => {});

  if (!message.content || message.pinned || message.author?.bot) return;

  await client.emit("messageCreate", (client, message));
}
