const { UPVOTE, DOWNVOTE, URL_REGEX, STICKY_DELAY, stickyTimers, IMAGE_EXTS, VIDEO_EXTS } = require("../commands/mediachannels");
const stickySending = new Set();

function extOf(filename) {
  if (!filename) return "";
  const dot = filename.lastIndexOf(".");
  return dot !== -1 ? filename.slice(dot + 1).toLowerCase() : "";
}

function attachmentAllowed(attachment, mc) {
  if (mc.allowAttachments) return true;

  const ext = extOf(attachment.filename ?? attachment.name ?? "");
  if (mc.allowImages && IMAGE_EXTS.has(ext)) return true;
  if (mc.allowVideos && VIDEO_EXTS.has(ext)) return true;
  if (mc.allowFiles  && !IMAGE_EXTS.has(ext) && !VIDEO_EXTS.has(ext)) return true;

  return false;
}

const checkMediaChannel = async function checkMediaChannel(client, message, db) {
  const mediaChannels = db.mediaChannels ?? [];
  if (mediaChannels.length === 0) return false;

  const mc = mediaChannels.find((m) => m.channelId === message.channelId);
  if (!mc) return false;

  if (message.author.id === client.user.id) return false;

  const attachments = [...(message.attachments?.values() ?? [])];
  const hasLink = mc.allowLinks && URL_REGEX.test(message.content ?? "");

  const attachmentsOk = attachments.length > 0 && attachments.every((a) => attachmentAllowed(a, mc));
  const isAllowed = attachmentsOk || hasLink;

  if (!isAllowed) {
    message.delete().catch(() => {});
    return true;
  }

  if (mc.rating) {
    message.react(UPVOTE).catch(() => {});
    setTimeout(() => message.react(DOWNVOTE).catch(() => {}), 300);
  }

  if (mc.sticky) {
    scheduleSticky(client, { guildId: message.guildId, channelId: mc.channelId });
  }

  return false;
};

module.exports = checkMediaChannel;
module.exports.scheduleSticky = scheduleSticky;

function scheduleSticky(client, ctx) {
  const { guildId, channelId } = ctx;

  if (stickyTimers.has(channelId)) {
    clearTimeout(stickyTimers.get(channelId));
  }

  const timer = setTimeout(async () => {
    stickyTimers.delete(channelId);

    if (stickySending.has(channelId)) return;
    stickySending.add(channelId);

    try {
      const channel = await client.channels.resolve(channelId);
      if (!channel) return;

      const freshDb = await client.database.getGuild(guildId, false, true);
      if (!freshDb) return;

      const freshMc = (freshDb.mediaChannels ?? []).find((m) => m.channelId === channelId);
      if (!freshMc?.sticky) return; 

      const preList = (freshDb.mediaChannels ?? []).map((m) =>
        m.channelId === channelId ? { ...m, stickyMessageId: null } : m
      );
      await client.database.updateGuild(guildId, { mediaChannels: preList });

      if (freshMc.stickyMessageId) {
        await channel.messages
          .fetch(freshMc.stickyMessageId)
          .then((m) => m.delete())
          .catch(() => {});
      }

      const allowed = [
        freshMc.allowAttachments && "attachments",
        freshMc.allowImages && "images",
        freshMc.allowVideos && "videos",
        freshMc.allowFiles && "files",
        freshMc.allowLinks && "links",
      ].filter(Boolean).join(", ");

      const text =
        freshMc.stickyText?.trim() ||
        client.translate.get(db.language, "defaultStickyText", { types: allowed || client.translate.get(db.language, "attachments") });

      const sent = await channel.send({ content: text }).catch(() => null);
      if (!sent) return;

      const updatedList = (freshDb.mediaChannels ?? []).map((m) =>
        m.channelId === channelId ? { ...m, stickyMessageId: sent.id } : m
      );
      await client.database.updateGuild(guildId, { mediaChannels: updatedList });
    } catch { }
    finally {
      stickySending.delete(channelId);
    }
  }, STICKY_DELAY);

  stickyTimers.set(channelId, timer);
}
