const { EmbedBuilder, PermissionFlags } = require("@fluxerjs/core");
const Paginator = require("../functions/pagination");
const { dashboardHelpField } = require("../functions/dashboardHelp");
const { trackGuildUpdates } = require("../api/trackSettings");
const {
  MAX_STICKIES,
  MIN_STICKY_DELAY,
  MAX_STICKY_DELAY,
  STICKY_MENTION_POLICIES,
  normalizeMentionPolicy,
  renderStickyPayload,
  refreshSticky,
  deleteStickyMessage,
  clearStickyTimer,
} = require("../functions/stickyMessages");
const {
  startStickyEditor,
  startStickyTypeChange,
  cancelStickySession,
} = require("../functions/stickyCollector");

function typeLabel(client, db, type) {
  const t = (key) => client.translate.get(db.language, `Commands.sticky.${key}`);
  if (type === "embed") return t("typeEmbed");
  if (type === "script") return t("typeScript");
  return t("typeContent");
}

function stickyPreview(sticky) {
  if (sticky.type === "embed") {
    const text =
      sticky.embedData?.title ||
      sticky.embedData?.description ||
      sticky.embedData?.author?.name ||
      "";
    return String(text).replace(/\s+/g, " ").slice(0, 90) || "(empty embed)";
  }

  return (
    String(sticky.content ?? "")
      .replace(/\s+/g, " ")
      .slice(0, 90) || "(empty message)"
  );
}

function normalizeType(value) {
  const type = String(value ?? "").toLowerCase();
  if (type === "message" || type === "text" || type === "content") return "content";
  if (type === "embed" || type === "rich") return "embed";
  if (type === "script" || type === "rune" || type === "code") return "script";
  return null;
}

module.exports = {
  config: {
    name: "sticky",
    usage: "help",
    cooldown: 3000,
    available: true,
    permissions: {
      name: "Manage Guild",
      bitField: PermissionFlags.ManageGuild,
    },
    aliases: ["stick", "stickies"],
  },

  run: async (client, message, args, db) => {
    const prefix = db.prefix;
    const list = Array.isArray(db.stickies) ? db.stickies : [];
    const sub = (args[0] ?? "help").toLowerCase();
    const t = (key, vars) =>
      client.translate.get(db.language, `Commands.sticky.${key}`, vars);
    const mentionLabel = (policy) =>
      t(
        policy === "users"
          ? "mentionUsers"
          : policy === "roles"
            ? "mentionRoles"
            : policy === "everyone"
              ? "mentionEveryone"
              : "mentionNone"
      );

    const replyError = (key, vars) =>
      message.reply({
        embeds: [
          new EmbedBuilder()
            .setColor("#FF0000")
            .setDescription(t(key, vars)),
        ],
      });

    const getChannel = async (value) => {
      const id = value
        ? String(value).replace(/[<#>]/g, "")
        : String(message.channelId);
      if (!/^\d+$/.test(id)) return null;

      let channel = null;
      try {
        channel = await client.channels.resolve(id);
      } catch {}
      if (!channel) {
        try {
          channel = await message.guild?.channels?.fetch?.(id);
        } catch {}
      }

      if (!channel || channel.type !== 0) return null;
      const guildId = channel.guildId ?? channel.guild?.id;
      if (guildId && guildId !== message.guildId) return null;
      return channel;
    };

    const canPost = async (channel) => {
      try {
        const me =
          message.guild?.members?.me ??
          (await message.guild?.members?.fetchMe?.());
        const permissions = me?.permissionsIn?.(channel);
        if (!permissions) return true;

        const required = [
          PermissionFlags.ViewChannel,
          PermissionFlags.SendMessages,
          PermissionFlags.ManageMessages,
        ].filter((flag) => flag !== undefined && flag !== null);

        return required.every((flag) => permissions.has(flag));
      } catch {
        return true;
      }
    };

    const getIndex = () => {
      const number = Number.parseInt(args[1], 10);
      if (!Number.isInteger(number) || number < 1 || number > list.length) {
        return -1;
      }
      return number - 1;
    };

    if (!args[0] || sub === "help") {
      const embed = new EmbedBuilder()
        .setColor(db.theme)
        .setTitle(t("helpTitle"))
        .setDescription(
          [
            t("helpIntro", { max: MAX_STICKIES }),
            "",
            `**${t("helpCreate")}**`,
            `\`${prefix}sticky create [#channel]\` - ${t("helpCreateDesc")}`,
            `\`${prefix}sticky list\` - ${t("helpListDesc")}`,
            `\`${prefix}sticky view <number>\` - ${t("helpViewDesc")}`,
            `\`${prefix}sticky edit <number>\` - ${t("helpEditDesc")}`,
            `\`${prefix}sticky type <number> content|embed|script\` - ${t("helpTypeDesc")}`,
            `\`${prefix}sticky move <number> #channel\` - ${t("helpMoveDesc")}`,
            `\`${prefix}sticky delay <number> <seconds>\` - ${t("helpDelayDesc")}`,
            `\`${prefix}sticky mentions <number> none|users|roles|everyone\` - ${t("helpMentionsDesc")}`,
            `\`${prefix}sticky toggle <number>\` - ${t("helpToggleDesc")}`,
            `\`${prefix}sticky refresh <number>\` - ${t("helpRefreshDesc")}`,
            `\`${prefix}sticky delete <number>\` - ${t("helpDeleteDesc")}`,
            `\`${prefix}sticky stop\` - ${t("helpStopDesc")}`,
            "",
            `**${t("helpRune")}**`,
            t("helpRuneDesc"),
            t("runeGuide"),
            "",
            `**${t("helpExample")}**`,
            "```rune",
            'say("Welcome to " + $guild.name)',
            'say(embed().title("Rules").description("Be kind and have fun.").color("blurple"))',
            "```",
            "",
            t("helpLimit", { max: MAX_STICKIES }),
          ].join("\n")
        )
        .addFields(dashboardHelpField(client, db, message.guildId, "stickies"));

      return message.reply({ embeds: [embed] });
    }

    if (sub === "stop") {
      return cancelStickySession(client, message, db);
    }

    if (sub === "create" || sub === "add") {
      if (client.stickyCollector.has(message.author.id)) {
        return replyError("activeEditor", { prefix });
      }
      if (list.length >= MAX_STICKIES) {
        return replyError("maxReached", { max: MAX_STICKIES });
      }

      const channel = await getChannel(args[1]);
      if (!channel) return replyError("invalidChannel");

      const existingIndex = list.findIndex(
        (sticky) => sticky.channelId === channel.id
      );
      if (existingIndex !== -1) {
        return replyError("alreadyChannel", {
          channel: `<#${channel.id}>`,
          prefix,
          number: existingIndex + 1,
        });
      }

      if (!(await canPost(channel))) {
        return replyError("noPerms", { channel: `<#${channel.id}>` });
      }

      return startStickyEditor(client, message, db, {
        targetChannelId: channel.id,
      });
    }

    if (sub === "list") {
      if (list.length === 0) {
        return replyError("noStickies", { prefix });
      }

      const pages = new Paginator({
        timeout: 300000,
        user: message.author.id,
        client,
      });

      for (let index = 0; index < list.length; index += 5) {
        const chunk = list
          .slice(index, index + 5)
          .map((sticky, offset) =>
            t("listItem", {
              number: index + offset + 1,
              status: sticky.enabled ? t("enabled") : t("disabled"),
              type: typeLabel(client, db, sticky.type),
              channel: `<#${sticky.channelId}>`,
              delay: String(((sticky.repostDelayMs ?? 2500) / 1000).toFixed(1)).replace(/\.0$/, ""),
              mentions: mentionLabel(sticky.mentionPolicy),
              preview: stickyPreview(sticky),
            })
          )
          .join("\n\n");

        pages.add(
          new EmbedBuilder()
            .setColor(db.theme)
            .setTitle(t("listTitle"))
            .setDescription(chunk)
        );
      }

      return pages.start(message.channel);
    }

    if (sub === "view" && !args[1]) {
      if (list.length === 0) {
        return replyError("noStickies", { prefix });
      }

      const pages = new Paginator({
        timeout: 300000,
        user: message.author.id,
        client,
      });

      for (let index = 0; index < list.length; index += 5) {
        const chunk = list
          .slice(index, index + 5)
          .map((sticky, offset) =>
            t("listItem", {
              number: index + offset + 1,
              status: sticky.enabled ? t("enabled") : t("disabled"),
              type: typeLabel(client, db, sticky.type),
              channel: `<#${sticky.channelId}>`,
              delay: String(((sticky.repostDelayMs ?? 2500) / 1000).toFixed(1)).replace(/\.0$/, ""),
              mentions: mentionLabel(sticky.mentionPolicy),
              preview: stickyPreview(sticky),
            })
          )
          .join("\n\n");

        pages.add(
          new EmbedBuilder()
            .setColor(db.theme)
            .setTitle(t("listTitle"))
            .setDescription(chunk)
        );
      }

      return pages.start(message.channel);
    }

    const indexSubcommands = new Set([
      "view",
      "edit",
      "type",
      "move",
      "channel",
      "delay",
      "mentions",
      "mention",
      "toggle",
      "enable",
      "disable",
      "refresh",
      "post",
      "repost",
      "delete",
      "remove",
    ]);

    if (!indexSubcommands.has(sub)) {
      return replyError("unknownSub", { prefix });
    }

    const index = getIndex();

    if (index === -1) {
      if (list.length === 0) return replyError("noStickies", { prefix });
      return replyError("invalidNumber", { max: list.length });
    }

    const sticky = list[index];

    if (sub === "view") {
      const targetChannel =
        (await getChannel(`<#${sticky.channelId}>`)) ?? message.channel;
      const preview = renderStickyPayload(
        message.guild,
        targetChannel,
        sticky,
        message,
        db.theme
      );

      const info = new EmbedBuilder()
        .setColor(db.theme)
        .setTitle(t("viewTitle", { number: index + 1 }))
        .setDescription(
          t("viewInfo", {
            channel: `<#${sticky.channelId}>`,
            type: typeLabel(client, db, sticky.type),
            status: sticky.enabled ? t("enabled") : t("disabled"),
            user: `<@${sticky.createdBy}>`,
            created: `<t:${Math.floor((sticky.createdAt || Date.now()) / 1000)}:f>`,
            count: sticky.sendCount || 0,
            delay: String(((sticky.repostDelayMs ?? 2500) / 1000).toFixed(1)).replace(/\.0$/, ""),
            mentions: mentionLabel(sticky.mentionPolicy),
          })
        );

      if (sticky.type === "script") {
        info.addFields({
          name: t("helpRune"),
          value: t("runeGuide"),
        });
      }

      if (preview.error) {
        info.addFields({
          name: t("scriptError"),
          value: `\`\`\`\n${String(
            preview.error.message ?? "Unknown error"
          ).slice(0, 900)}\n\`\`\``,
        });
      }

      const embeds = [info, ...(preview.payload?.embeds ?? []).slice(0, 9)];
      const payload = {
        embeds,
        allowedMentions: { parse: [] },
      };
      if (preview.payload?.content) payload.content = preview.payload.content;

      return message.reply(payload);
    }

    if (sub === "edit") {
      if (client.stickyCollector.has(message.author.id)) {
        return replyError("activeEditor", { prefix });
      }

      return startStickyEditor(client, message, db, {
        targetChannelId: sticky.channelId,
        editingId: sticky.id,
        number: index + 1,
      });
    }

    if (sub === "type") {
      const type = normalizeType(args[2]);
      if (!type) {
        return replyError("invalidType", {
          types: "content, embed, script",
        });
      }
      if (sticky.type === type) {
        return replyError("typeAlready", {
          type: typeLabel(client, db, type),
        });
      }
      if (client.stickyCollector.has(message.author.id)) {
        return replyError("activeEditor", { prefix });
      }

      return startStickyTypeChange(
        client,
        message,
        db,
        sticky,
        type,
        index + 1
      );
    }

    if (sub === "delay") {
      const seconds = Number(args[2]);
      if (
        !Number.isFinite(seconds) ||
        seconds * 1000 < MIN_STICKY_DELAY ||
        seconds * 1000 > MAX_STICKY_DELAY
      ) {
        return replyError("invalidDelay", {
          min: MIN_STICKY_DELAY / 1000,
          max: MAX_STICKY_DELAY / 1000,
        });
      }

      const updated = list.map((entry) =>
        entry.id === sticky.id
          ? {
              ...entry,
              repostDelayMs: Math.round(seconds * 1000),
              updatedAt: Date.now(),
            }
          : entry
      );

      await client.database.updateGuild(message.guildId, { stickies: updated });
      await trackGuildUpdates(client, {
        guildId: message.guildId,
        userId: message.author.id,
        existing: db,
        updates: { stickies: updated },
      });

      return message.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(db.theme)
            .setDescription(
              t("delaySet", {
                number: index + 1,
                seconds: Number(seconds.toFixed(2)),
              })
            ),
        ],
      });
    }

    if (sub === "mentions" || sub === "mention") {
      const value = String(args[2] ?? "").toLowerCase();
      if (!STICKY_MENTION_POLICIES.includes(value)) {
        return replyError("invalidMentions");
      }

      const mentionPolicy = normalizeMentionPolicy(value);
      const updated = list.map((entry) =>
        entry.id === sticky.id
          ? { ...entry, mentionPolicy, updatedAt: Date.now() }
          : entry
      );

      await client.database.updateGuild(message.guildId, { stickies: updated });
      await trackGuildUpdates(client, {
        guildId: message.guildId,
        userId: message.author.id,
        existing: db,
        updates: { stickies: updated },
      });

      return message.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(db.theme)
            .setDescription(
              t("mentionsSet", {
                number: index + 1,
                mentions: mentionLabel(mentionPolicy),
              })
            ),
        ],
      });
    }

    if (sub === "move" || sub === "channel") {
      if (!args[2]) {
        return replyError("usageMove", { prefix });
      }

      const channel = await getChannel(args[2]);
      if (!channel) return replyError("invalidChannel");

      if (
        list.some(
          (entry) =>
            entry.id !== sticky.id && entry.channelId === channel.id
        )
      ) {
        return replyError("channelInUse", { channel: `<#${channel.id}>` });
      }

      if (!(await canPost(channel))) {
        return replyError("noPerms", { channel: `<#${channel.id}>` });
      }

      await deleteStickyMessage(client, message.guildId, sticky);
      clearStickyTimer(sticky.channelId);

      const updated = list.map((entry) =>
        entry.id === sticky.id
          ? {
              ...entry,
              channelId: channel.id,
              stickyMessageId: null,
              updatedAt: Date.now(),
            }
          : entry
      );

      await client.database.updateGuild(message.guildId, { stickies: updated });
      await trackGuildUpdates(client, {
        guildId: message.guildId,
        userId: message.author.id,
        existing: db,
        updates: { stickies: updated },
      });

      const result =
        sticky.enabled === false
          ? { ok: true }
          : await refreshSticky(client, message.guildId, sticky.id);
      if (!result.ok) {
        return replyError("saveFailed", { channel: `<#${channel.id}>` });
      }

      return message.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(db.theme)
            .setDescription(
              t("moved", {
                number: index + 1,
                channel: `<#${channel.id}>`,
              })
            ),
        ],
      });
    }

    if (sub === "toggle" || sub === "enable" || sub === "disable") {
      const enabled =
        sub === "enable"
          ? true
          : sub === "disable"
            ? false
            : !sticky.enabled;

      if (!enabled) {
        await deleteStickyMessage(client, message.guildId, sticky);
        clearStickyTimer(sticky.channelId);
      }

      const updated = list.map((entry) =>
        entry.id === sticky.id
          ? {
              ...entry,
              enabled,
              stickyMessageId: enabled ? entry.stickyMessageId : null,
              updatedAt: Date.now(),
            }
          : entry
      );

      await client.database.updateGuild(message.guildId, { stickies: updated });
      await trackGuildUpdates(client, {
        guildId: message.guildId,
        userId: message.author.id,
        existing: db,
        updates: { stickies: updated },
      });

      if (enabled) {
        const result = await refreshSticky(client, message.guildId, sticky.id);
        if (!result.ok) {
          return replyError("saveFailed", {
            channel: `<#${sticky.channelId}>`,
          });
        }
      }

      return message.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(db.theme)
            .setDescription(
              t(enabled ? "toggledOn" : "toggledOff", {
                number: index + 1,
                channel: `<#${sticky.channelId}>`,
              })
            ),
        ],
      });
    }

    if (sub === "refresh" || sub === "post" || sub === "repost") {
      if (sticky.enabled === false) {
        return replyError("disabledSticky", { prefix });
      }

      const result = await refreshSticky(client, message.guildId, sticky.id);
      if (!result.ok) {
        return replyError("saveFailed", {
          channel: `<#${sticky.channelId}>`,
        });
      }

      return message.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(db.theme)
            .setDescription(
              t("refreshed", {
                number: index + 1,
                channel: `<#${sticky.channelId}>`,
              })
            ),
        ],
      });
    }

    if (sub === "delete" || sub === "remove") {
      const check = client.config.emojis.check;
      const cross = client.config.emojis.cross;

      const confirm = await message.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(db.theme)
            .setDescription(
              t("deleteConfirm", {
                number: index + 1,
                channel: `<#${sticky.channelId}>`,
              })
            ),
        ],
      });

      await confirm.react(check).catch(() => {});
      await confirm.react(cross).catch(() => {});

      const filter = (reaction, user) =>
        user.id === message.author.id &&
        [check, cross].includes(reaction.emoji?.name);

      const collector = confirm.createReactionCollector({
        filter,
        time: 30000,
      });

      collector.on("collect", async (reaction) => {
        collector.stop();
        await confirm.removeAllReactions().catch(() => {});

        if (reaction.emoji?.name !== check) {
          await confirm
            .edit({
              embeds: [
                new EmbedBuilder()
                  .setColor(db.theme)
                  .setDescription(t("deleteCancelled")),
              ],
            })
            .catch(() => {});
          return;
        }

        await deleteStickyMessage(client, message.guildId, sticky);
        clearStickyTimer(sticky.channelId);

        const updated = list.filter((entry) => entry.id !== sticky.id);
        await client.database.updateGuild(message.guildId, {
          stickies: updated,
        });
        await trackGuildUpdates(client, {
          guildId: message.guildId,
          userId: message.author.id,
          existing: db,
          updates: { stickies: updated },
        });

        await confirm
          .edit({
            embeds: [
              new EmbedBuilder()
                .setColor(db.theme)
                .setDescription(t("deleted", { number: index + 1 })),
            ],
          })
          .catch(() => {});
      });

      collector.on("end", (_, reason) => {
        if (reason === "time") confirm.removeAllReactions().catch(() => {});
      });

      return;
    }

    return replyError("unknownSub", { prefix });
  },
};
