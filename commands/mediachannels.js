const { EmbedBuilder, PermissionFlags } = require("@fluxerjs/core");
const { trackGuildUpdates } = require("../api/trackSettings");

const UPVOTE = "⬆️";
const DOWNVOTE = "⬇️";
const STICKY_DELAY = 5000;
const URL_REGEX = /https?:\/\/\S+/i;
const stickyTimers = new Map();

const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp", "tiff", "tif", "avif"]);
const VIDEO_EXTS = new Set(["mp4", "mov", "webm", "mkv", "avi", "wmv", "flv", "m4v"]);

module.exports = {
  config: {
    name: "mediachannels",
    usage: "help",
    cooldown: 3000,
    available: true,
    permissions: {
      name: "Manage Guild",
      bitField: PermissionFlags.ManageGuild,
    },
    aliases: ["mediachannel", "mc", "mediachan"],
  },

  UPVOTE,
  DOWNVOTE,
  URL_REGEX,
  STICKY_DELAY,
  stickyTimers,
  IMAGE_EXTS,
  VIDEO_EXTS,

  run: async (client, message, args, db) => {
    const sub = args[0]?.toLowerCase();
    const t = (key, vars) => client.translate.get(db.language, `Commands.mediachannels.${key}`, vars);

    function embed(desc, color = db.theme) {
      return new EmbedBuilder().setColor(color).setDescription(desc);
    }

    function err(desc) {
      return message.reply({ embeds: [embed(desc, "#FF0000")] });
    }

    const helpText = [
      `**${t("helpDesc")}**\n`,
      `**${t("addChannel")}**`,
      `\`${db.prefix}mc add #channel [${t("options")}]\``,
      `**${t("attachmentOptions")}** (${t("attachmentDefault")}):`,
      `\`--attachments\` ${t("attachAny")}`,
      `\`--images\` ${t("attachImages")}`,
      `\`--videos\` ${t("attachVideos")}`,
      `\`--files\` ${t("attachFiles")}`,
      `\`--links\` ${t("attachLinks")}\n`,
      `**${t("ratingOptions")}:**`,
      `\`--rating\` ${t("ratingAdd")}`,
      `\`--delete <number>\` ${t("ratingDelete")}\n`,
      `**${t("stickyOptions")}:**`,
      `\`--sticky\` ${t("stickyPost")}`,
      `\`--stickytext <text>\` ${t("stickyText")}\n`,
      `**${t("removeChannel")}**`,
      `\`${db.prefix}mc remove <#channel>\`\n`,
      `**${t("editChannel")}**`,
      `\`${db.prefix}mc edit <#channel> [${t("editSame")}]\`\n`,
      `**${t("listChannels")}**`,
      `\`${db.prefix}mc list\``,
    ].join("\n");

    if (!sub || sub === "help") {
      return message.reply({ embeds: [new EmbedBuilder().setColor(db.theme).setTitle(t("help")).setDescription(helpText)] });
    }

    if (sub === "list") {
      const list = db.mediaChannels ?? [];
      if (list.length === 0) {
        return message.reply({ embeds: [embed(t("noChannels"))] });
      }
      const lines = list.map((mc) => {
        const flags = [
          mc.allowAttachments && "attachments",
          mc.allowImages && "images",
          mc.allowVideos && "videos",
          mc.allowFiles && "files",
          mc.allowLinks && "links",
          mc.rating && `rating${mc.deleteThreshold > 0 ? ` (delete at -${mc.deleteThreshold})` : ""}`,
          mc.sticky && "sticky",
        ].filter(Boolean).join(", ");
        return `<#${mc.channelId}> - ${flags || t("attachmentsOnly")}`;
      });
      return message.reply({ embeds: [embed(`**${t("channelsList")}:**\n${lines.join("\n")}`)] });
    }

    if (sub === "add" || sub === "edit") {
      const chanMention = args[1];
      if (!chanMention) return err(`${t("mentionChannel")}: \`${db.prefix}mc ${sub} <#channel>\``);

      const channelId = chanMention.replace(/[<#>]/g, "");
      const channel = await client.channels.resolve(channelId).catch(() => null);
      if (!channel || channel.type !== 0) return err(t("validChannel"));

      const rest = args.slice(2);

      const allowLinks = rest.includes("--links");
      const allowImages = rest.includes("--images");
      const allowVideos = rest.includes("--videos");
      const allowFiles = rest.includes("--files");
      const anySpecific = allowImages || allowVideos || allowFiles || allowLinks;
      const allowAttachments = rest.includes("--attachments") || !anySpecific;

      const rating = rest.includes("--rating");
      const deleteIdx = rest.indexOf("--delete");
      const deleteThreshold = deleteIdx !== -1 ? (parseInt(rest[deleteIdx + 1]) || 0) : 0;

      const sticky = rest.includes("--sticky");
      const stickyTextIdx = rest.indexOf("--stickytext");
      const stickyText = stickyTextIdx !== -1 ? rest.slice(stickyTextIdx + 1).join(" ") || null : null;

      const existing = (db.mediaChannels ?? []).find((mc) => mc.channelId === channelId);
      if (sub === "add" && existing) return err(`<#${channelId}> ${t("alreadyConfigured")} \`${db.prefix}mc edit <#${channelId}>\` ${t("alreadyConfiguredSuffix")}`);
      if (sub === "edit" && !existing) return err(`<#${channelId}> ${t("notConfigured")} \`${db.prefix}mc add <#${channelId}>\` ${t("notConfiguredSuffix")}`);

      const entry = {
        channelId,
        allowAttachments,
        allowImages,
        allowVideos,
        allowFiles,
        allowLinks,
        rating,
        deleteThreshold: rating ? deleteThreshold : 0,
        sticky,
        stickyText,
        stickyMessageId: existing?.stickyMessageId ?? null,
      };

      let updatedList;
      if (sub === "add") {
        updatedList = [...(db.mediaChannels ?? []), entry];
      } else {
        updatedList = (db.mediaChannels ?? []).map((mc) => mc.channelId === channelId ? entry : mc);
      }

      await client.database.updateGuild(message.guildId, { mediaChannels: updatedList });
      await trackGuildUpdates(client, {
        guildId: message.guildId,
        userId: message.author.id,
        existing: db,
        updates: { mediaChannels: updatedList },
      });

      const flags = [
        allowAttachments && "attachments",
        allowImages && "images",
        allowVideos && "videos",
        allowFiles && "files",
        allowLinks && "links",
        rating && `rating${deleteThreshold > 0 ? ` (auto-delete at -${deleteThreshold})` : ""}`,
        sticky && "sticky",
      ].filter(Boolean).join(", ");

      return message.reply({ embeds: [embed(`${sub === "add" ? t("added") : t("updated")} <#${channelId}> ${t("asMediaChannel")}\n**${t("allowed")}:** ${flags || t("attachmentsOnly")}`)] });
    }

    if (sub === "remove") {
      const chanMention = args[1];
      if (!chanMention) return err(`${t("mentionChannel")}: \`${db.prefix}mc remove <#channel>\``);

      const channelId = chanMention.replace(/[<#>]/g, "");
      const existing = (db.mediaChannels ?? []).find((mc) => mc.channelId === channelId);
      if (!existing) return err(`<#${channelId}> ${t("notConfigured")} \`${db.prefix}mc add <#${channelId}>\` ${t("notConfiguredSuffix")}`);

      const updatedList = (db.mediaChannels ?? []).filter((mc) => mc.channelId !== channelId);

      await client.database.updateGuild(message.guildId, { mediaChannels: updatedList });
      await trackGuildUpdates(client, {
        guildId: message.guildId,
        userId: message.author.id,
        existing: db,
        updates: { mediaChannels: updatedList },
      });

      if (stickyTimers.has(channelId)) {
        clearTimeout(stickyTimers.get(channelId));
        stickyTimers.delete(channelId);
      }

      return message.reply({ embeds: [embed(`${t("removed")} <#${channelId}> ${t("fromMediaChannels")}`)] });
    }

    return err(`${t("unknownSub")} \`${db.prefix}mc help\` ${t("unknownSubSuffix")}`);
  },
};
