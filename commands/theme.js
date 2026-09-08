const { EmbedBuilder, AttachmentBuilder, PermissionFlags } = require("@fluxerjs/core");
const { createCanvas, loadImage } = require("canvas");
const path = require("path");
const fs = require("fs");
const { normalizeColor, hexToArgb } = require("../functions/color");
const { trackGuildUpdates } = require("../api/trackSettings");

function hexToRgb(hex) {
  hex = hex.replace(/^#/, "");
  const num = parseInt(hex.slice(0, 6), 16);
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

function rgbToHsl(r, g, b) {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h, s;
  const l = (max + min) / 2;

  if (max === min) {
    h = s = 0;
  } else {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
      case g: h = ((b - r) / d + 2) / 6; break;
      case b: h = ((r - g) / d + 4) / 6; break;
    }
  }
  return [h, s, l];
}

function hslToRgb(h, s, l) {
  let r, g, b;
  if (s === 0) {
    r = g = b = l;
  } else {
    const hue2rgb = (p, q, t) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

async function recolorAvatar(imagePath, hex) {
  const img = await loadImage(imagePath);
  const canvas = createCanvas(img.width, img.height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0);

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;

  const [baseR, baseG, baseB] = hexToRgb(hex);
  const [h, s] = rgbToHsl(baseR, baseG, baseB);

  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;

    const gray = data[i] / 255;
    const newL = 0.12 + gray * 0.78;
    const [nr, ng, nb] = hslToRgb(h, s, Math.min(0.92, newL));
    data[i]     = nr;
    data[i + 1] = ng;
    data[i + 2] = nb;
  }

  ctx.putImageData(imageData, 0, 0);
  return canvas.toBuffer("image/png");
}

function roundedIconMask(x, y, iconX, iconY, iconSize, radius, feather) {
  const localX = x - iconX;
  const localY = y - iconY;

  if (localX < -feather || localY < -feather ||
      localX >= iconSize + feather || localY >= iconSize + feather) {
    return 0;
  }

  let dist = 0;
  const inLeft = localX < radius;
  const inRight = localX > iconSize - radius;
  const inTop = localY < radius;
  const inBottom = localY > iconSize - radius;

  if (inLeft && inTop) {
    const dx = radius - localX;
    const dy = radius - localY;
    dist = Math.sqrt(dx * dx + dy * dy) - radius;
  } else if (inRight && inTop) {
    const dx = localX - (iconSize - radius);
    const dy = radius - localY;
    dist = Math.sqrt(dx * dx + dy * dy) - radius;
  } else if (inLeft && inBottom) {
    const dx = radius - localX;
    const dy = localY - (iconSize - radius);
    dist = Math.sqrt(dx * dx + dy * dy) - radius;
  } else if (inRight && inBottom) {
    const dx = localX - (iconSize - radius);
    const dy = localY - (iconSize - radius);
    dist = Math.sqrt(dx * dx + dy * dy) - radius;
  } else {
    if (localX < 0) dist = -localX;
    else if (localX >= iconSize) dist = localX - (iconSize - 1);
    else if (localY < 0) dist = -localY;
    else if (localY >= iconSize) dist = localY - (iconSize - 1);
    else dist = 0;
  }

  if (dist <= 0) return 1;
  if (dist >= feather) return 0;
  return 1 - dist / feather;
}

async function recolorBanner(imagePath, hex) {
  const img = await loadImage(imagePath);
  const canvas = createCanvas(img.width, img.height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0);

  const { width, height } = canvas;
  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;

  const [baseR, baseG, baseB] = hexToRgb(hex);
  const [h, s] = rgbToHsl(baseR, baseG, baseB);

  const iconSize = Math.round(height * 0.52);
  const iconX = Math.round(width * 0.028) + 14.5;
  const iconY = Math.round((height - iconSize) / 2);
  const radius = Math.round(iconSize * 0.12);
  const feather = Math.max(2, Math.round(iconSize * 0.03));

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (data[i + 3] === 0) continue;

      const gray = data[i] / 255;
      const mask = roundedIconMask(x, y, iconX, iconY, iconSize, radius, feather);

      const iconL = 0.12 + gray * 0.78;
      const [iR, iG, iB] = hslToRgb(h, s, Math.min(0.92, iconL));

      let bR, bG, bB;
      if (gray >= 0.62) {
        const newL = 0.72 + (gray - 0.62) * 0.7;
        [bR, bG, bB] = hslToRgb(h, Math.min(s * 0.12, 0.15), Math.min(0.98, newL));
      } else {
        const newL = 0.04 + gray * 0.38;
        const sat = s * (0.55 + gray * 0.35);
        [bR, bG, bB] = hslToRgb(h, sat, newL);
      }

      data[i] = Math.round(iR * mask + bR * (1 - mask));
      data[i + 1] = Math.round(iG * mask + bG * (1 - mask));
      data[i + 2] = Math.round(iB * mask + bB * (1 - mask));
    }
  }

  ctx.putImageData(imageData, 0, 0);
  return canvas.toBuffer("image/png");
}

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