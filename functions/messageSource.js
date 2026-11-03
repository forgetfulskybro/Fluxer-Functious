const SNOWFLAKE_REGEX = /^\d{17,20}$/;
const LINK_REGEX = /(\d{17,20})\/(\d{17,20})\/(\d{17,20})/;

function parseMessageLink(input) {
  const match = String(input || "").match(LINK_REGEX);
  if (!match) return null;
  return { guildId: match[1], channelId: match[2], messageId: match[3] };
}

function isSourceToken(input) {
  if (!input) return false;
  return Boolean(parseMessageLink(input)) || SNOWFLAKE_REGEX.test(String(input).trim());
}

async function fetchMessage(client, channelId, messageId) {
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel?.messages?.fetch) return null;
  const fetched = await channel.messages.fetch(messageId).catch(() => null);
  if (!fetched) return null;
  return { message: fetched, channel };
}

async function resolveSource(client, message, args = []) {
  const reference = message.messageReference;
  if (reference?.messageId) {
    const replied = await fetchMessage(
      client,
      reference.channelId ?? message.channelId,
      reference.messageId
    );
    if (replied) return replied;
  }

  const token = args[0];
  if (!isSourceToken(token)) return null;

  const link = parseMessageLink(token);
  if (link) return fetchMessage(client, link.channelId, link.messageId);

  const localChannel = await client.channels.fetch(message.channelId).catch(() => null);
  if (localChannel?.messages?.fetch) {
    const local = await localChannel.messages.fetch(String(token).trim()).catch(() => null);
    if (local) return { message: local, channel: localChannel };
  }

  if (!message.channel?.messages?.fetch) return null;
  const own = await message.channel.messages.fetch(String(token).trim()).catch(() => null);
  return own ? { message: own, channel: message.channel } : null;
}

module.exports = {
  parseMessageLink,
  isSourceToken,
  fetchMessage,
  resolveSource,
  SNOWFLAKE_REGEX,
  LINK_REGEX,
};
