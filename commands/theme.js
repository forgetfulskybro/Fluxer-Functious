const { EmbedBuilder, AttachmentBuilder, PermissionFlags } = require("@fluxerjs/core");
const path = require("path");
const fs = require("fs");
const { normalizeColor, hexToArgb } = require("../functions/color");
const { trackGuildUpdates } = require("../api/trackSettings");
const { recolorAvatar, recolorBanner } = require("../functions/avatarCanvas");

module.exports = {
  config: {
    name: "theme",
    usage: "help",
    cooldown: 15000,
    available: true,
    permissions: {
      name: "Manage Guild",
      bitField: PermissionFlags.ManageGuild,
    },
    aliases: [],
  },
  run: async (client, message, args, db) => {
    const input = args.join(" ").trim();

    if (!input || input.toLowerCase() === "help") {
      const helpEmbed = new EmbedBuilder()
        .setColor(db.theme)
        .setTitle("Theme Command Help")
        .setDescription(client.translate.get(db.language, "Commands.theme.helpDesc", { prefix: db.prefix, default: "default" }))

      return message.reply({
        embeds: [helpEmbed],
        mentions: false,
      });
    }

    let hex;
    if (input.toLowerCase() === "default") {
      hex = "#A52F05";
    } else {
      hex = normalizeColor(input);
      if (!hex) {
        return message.reply({
          content: client.translate.get(db.language, "Commands.theme.invalidColor", { prefix: db.prefix, default: "default" }),
          mentions: false,
        });
      }
    }

    const normalizedHex =
      hex.length === 9 ? `#${hex.slice(1, 7).toUpperCase()}` : hex.toUpperCase();

    const progressEmbed = new EmbedBuilder()
      .setColor(normalizedHex)
      .setTitle(client.translate.get(db.language, "Commands.theme.update"))
      .setDescription(client.translate.get(db.language, "Commands.theme.updateDesc"));

    const progressMsg = await message.reply({
      embeds: [progressEmbed],
      mentions: false,
    });

    let avatarBuffer;
    let bannerBuffer;

    const isDefault =
      normalizedHex === "#A52F05" || input.toLowerCase() === "default";

    if (isDefault) {
      avatarBuffer = fs.readFileSync(
        path.join(__dirname, "../assets/theme-default.png")
      );
      bannerBuffer = fs.readFileSync(
        path.join(__dirname, "../assets/theme-banner.png")
      );
    } else {
      avatarBuffer = await recolorAvatar(
        path.join(__dirname, "../assets/theme-grayscale.png"),
        normalizedHex
      );
      bannerBuffer = await recolorBanner(
        path.join(__dirname, "../assets/theme-banner-grayscale.png"),
        normalizedHex
      );
    }

    await message.guild.members.me.edit({
      avatar: `data:image/png;base64,${avatarBuffer.toString("base64")}`,
      banner: `data:image/png;base64,${bannerBuffer.toString("base64")}`,
      accentColor: hexToArgb(normalizedHex),
    });

    await client.database.updateGuild(message.guild.id, {
      theme: normalizedHex,
    });

    const avatarAttachment = new AttachmentBuilder(avatarBuffer, {
      name: "avatar.png",
    });

    const bannerAttachment = new AttachmentBuilder(bannerBuffer, {
      name: "banner.png",
    });

    const finishedEmbed = new EmbedBuilder()
      .setColor(normalizedHex)
      .setTitle("Theme Updated")
      .setDescription(client.translate.get(db.language, "Commands.theme.success", { normalizedHex }))
      .setThumbnail({ url: "attachment://avatar.png" })
      .setImage("attachment://banner.png");

    await progressMsg.delete().catch(() => null);

    await trackGuildUpdates(client, {
      guildId: message.guildId,
      userId: message.author.id,
      existing: db,
      updates: { theme: normalizedHex },
    });
    
    return message.reply({
      embeds: [finishedEmbed],
      files: [avatarAttachment, bannerAttachment],
      mentions: false,
    });
  },
};