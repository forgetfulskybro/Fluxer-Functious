const { Webhook, EmbedBuilder } = require("@fluxerjs/core");

module.exports = async (client, message, userId) => {
  const db = await client.database.getGuild(message.reaction.guildId);
  if (!db?.timezoneConvert) return;

  const userData = await client.database.getUser(userId, false);
  if (!userData?.timezone) return;

  const channel = await client.channels.resolve(message.channelId);
  if (!channel) return;

  const msg = await channel.messages.fetch(message.messageId).catch(() => null);
  if (!msg) return;

  const convert = client.functions.get("parseTime")(msg.content, userData.timezone);
  const user = await client.users.fetch(userId);
  if (!user) return;

  const displayName = user.globalName || user.username;
  const avatar = user.displayAvatarURL({ dynamic: true });

  try {
    const webhook = await channel.createWebhook({ name: displayName });
    const found = Webhook.fromToken(client, webhook.id, webhook.token);

    await found.send({
      content: convert.message,
      username: displayName,
      avatar_url: avatar,
    });

    await msg.delete().catch(() => {});
    await found.delete();
  } catch (e) {
    await channel
      .send({
        embeds: [
          new EmbedBuilder()
            .setColor("#A52F05")
            .setAuthor({ name: displayName, iconURL: avatar })
            .setDescription(convert.message),
        ],
      })
      .then(() => msg.delete().catch(() => {}))
      .catch(() => {});
  }
};