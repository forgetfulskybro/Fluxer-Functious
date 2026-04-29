module.exports = async (client, _oldMessage, newMessage) => {
  if (!newMessage || !newMessage.content || newMessage.pinned || newMessage.author.bot || !newMessage.guildId) return;
  
  await client.emit("messageCreate", (client, newMessage));
}
