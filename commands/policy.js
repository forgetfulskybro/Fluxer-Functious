const { EmbedBuilder, PermissionFlags } = require("@fluxerjs/core");
const { trackGuildUpdates } = require("../api/trackSettings");
const {
  MAX_COOLDOWN_MS,
  effectiveCooldownMs,
  formatCooldown,
  getConfigurableCommands,
  getPolicy,
  globalCooldownMs,
  hasPolicy,
  removePolicy,
  updatePolicy,
} = require("../functions/commandPolicies");
const { dashboardHelpText } = require("../functions/dashboardHelp");

const MENU_TIMEOUT = 5 * 60 * 1000;
const INPUT_TIMEOUT = 60 * 1000;
const NO_MENTIONS = { parse: [], repliedUser: false };
const BACK = "◀️";
const CLOSE = "❌";
const TOGGLE = "🔁";
const CHANNELS = "📢";
const ROLES = "🎭";
const COOLDOWN = "⏱️";
const CLEANUP = "🧹";
const RESET = "♻️";
const CONFIRM = "✅";

function toArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (typeof value.values === "function") return [...value.values()];
  if (typeof value[Symbol.iterator] === "function") return [...value];
  return [];
}

function cooldownLabel(ms, t) {
  return ms > 0 ? formatCooldown(ms) : t("cooldownNone");
}

module.exports = {
  config: {
    name: "policy",
    usage: "<command>",
    cooldown: 3000,
    available: true,
    permissions: {
      name: "Manage Guild",
      bitField: PermissionFlags.ManageGuild,
    },
    aliases: ["policies", "commandpolicy", "commandpolicies", "cmdpolicy"],
  },

  run: async (client, message, args, db) => {
    const guildId = message.guildId ?? message.guild?.id;
    if (!guildId || !message.guild) return;

    const commands = getConfigurableCommands(client);
    const byName = new Map(
      commands.map((command) => [command.config.name, command])
    );
    const prefix = db.prefix;
    const requested = String(args[0] ?? "").trim().toLowerCase();
    const t = (key, variables) =>
      client.translate.get(db.language, `Commands.policies.${key}`, variables);

    function buildHelpEmbed() {
      return new EmbedBuilder()
        .setColor(db.theme)
        .setTitle(t("helpTitle"))
        .setDescription(
          [
            t("description"),
            "",
            t("helpUsage", { prefix }),
            t("helpExample", { prefix }),
            "",
            t("helpConfigure"),
            t("helpEnabled"),
            t("helpChannels"),
            t("helpRoles"),
            t("helpCooldown"),
            t("helpCleanup"),
            "",
            t("helpFind", { prefix }),
            "",
            t("helpInput"),
            "",
            dashboardHelpText(client, db, message.guildId, "configuration?tab=policies"),
          ].join("\n")
        )
        .setFooter({
          text: t("helpFooter"),
        });
    }

    if (!requested) {
      return message.reply({
        embeds: [buildHelpEmbed()],
        allowedMentions: NO_MENTIONS,
      });
    }

    const match = commands.find(
      (command) =>
        command.config.name === requested ||
        (Array.isArray(command.config.aliases) &&
          command.config.aliases.includes(requested))
    );

    if (!match) {
      return message.reply({
        embeds: [
          new EmbedBuilder()
            .setColor("#FF0000")
            .setDescription(
              t("notFound", { input: args[0], prefix })
            ),
        ],
        allowedMentions: NO_MENTIONS,
      });
    }

    let settings = Array.isArray(db.commandSettings)
      ? db.commandSettings
      : [];
    let channelOptions = null;
    let roleOptions = null;
    let view = "editor";
    const selectedName = match.config.name;
    let notice = "";
    let busy = false;
    let collector;
    let inputCollector;

    function getSelectedCommand() {
      return selectedName ? byName.get(selectedName) ?? null : null;
    }

    function getSelectedPolicy() {
      const command = getSelectedCommand();
      return command ? getPolicy(settings, command) : null;
    }

    async function ensureChannels() {
      if (channelOptions !== null) return channelOptions;

      let channels = [];
      try {
        channels = toArray(await message.guild.fetchChannels?.());
      } catch {}
      if (!channels.length) channels = toArray(message.guild.channels);

      channelOptions = channels
        .filter((channel) => Number(channel?.type) === 0 && channel?.id)
        .map((channel) => ({
          id: String(channel.id),
          name: String(channel.name ?? channel.id),
        }))
        .sort((a, b) => a.name.localeCompare(b.name));

      return channelOptions;
    }

    async function ensureRoles() {
      if (roleOptions !== null) return roleOptions;

      let roles = [];
      try {
        roles = toArray(await message.guild.fetchRoles?.());
      } catch {}
      if (!roles.length) roles = toArray(message.guild.roles);

      roleOptions = roles
        .filter(
          (role) =>
            role?.id &&
            role.name !== "@everyone" &&
            String(role.id) !== String(message.guild.id)
        )
        .map((role) => ({
          id: String(role.id),
          name: String(role.name ?? role.id),
          position: Number(role.position) || 0,
        }))
        .sort(
          (a, b) =>
            b.position - a.position || a.name.localeCompare(b.name)
        );

      return roleOptions;
    }

    function formatChannelSelection(ids) {
      if (!ids.length) return t("allChannels");
      const shown = ids
        .slice(0, 5)
        .map((id) => `<#${id}>`)
        .join(", ");
      return `${shown}${
        ids.length > 5 ? t("more", { count: ids.length - 5 }) : ""
      }`;
    }

    function formatRoleSelection(ids) {
      if (!ids.length) return t("noRoleRequirement");
      const shown = ids
        .slice(0, 5)
        .map((id) => `<@&${id}>`)
        .join(", ");
      return `${shown}${
        ids.length > 5 ? t("more", { count: ids.length - 5 }) : ""
      }`;
    }

    function cleanSelector(value) {
      const text = String(value ?? "").trim();
      const channelMention = /^<#([^>]+)>$/.exec(text);
      if (channelMention) return channelMention[1].trim();
      const roleMention = /^<@&([^>]+)>$/.exec(text);
      if (roleMention) return roleMention[1].trim();
      if (text.startsWith("#")) return text.slice(1).trim();
      if (text.startsWith("@")) return text.slice(1).trim();
      return text;
    }

    function splitSelectors(value) {
      return String(value ?? "")
        .split(/[\n,]+/)
        .map((part) => part.trim())
        .filter(Boolean);
    }

    function findOption(options, value) {
      const token = cleanSelector(value);
      if (!token) return null;

      const byId = options.find((option) => option.id === token);
      if (byId) return byId;

      const lower = token.toLowerCase();
      const exact = options.find(
        (option) => option.name.toLowerCase() === lower
      );
      if (exact) return exact;

      const partial = options.filter((option) =>
        option.name.toLowerCase().startsWith(lower)
      );
      return partial.length === 1 ? partial[0] : null;
    }

    function missingSelectorNotice(kind, values) {
      const singular =
        kind === "channels" ? "missingChannel" : "missingRole";
      const plural = kind === "channels" ? "missingChannels" : "missingRoles";
      const shown = values
        .slice(0, 3)
        .map((value) => `\`${String(value).replace(/`/g, "'")}\``)
        .join(", ");
      const extra =
        values.length > 3
          ? t("missingExtra", { count: values.length - 3 })
          : "";
      return t(values.length === 1 ? singular : plural, {
        values: shown,
        extra,
      });
    }

    function parseCooldownInput(value) {
      const text = String(value ?? "").trim().toLowerCase();
      if (!text) return { ok: false };
      if (["default", "global", "none", "reset", "off"].includes(text)) {
        return { ok: true, cooldownMs: null };
      }
      if (/^\d+(?:\.\d+)?$/.test(text)) {
        return { ok: true, cooldownMs: Math.round(Number(text) * 1000) };
      }

      const pattern =
        /(\d+(?:\.\d+)?)\s*(milliseconds?|ms|seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h|days?|d)\b/gi;
      let total = 0;
      let matched = false;
      let cursor = 0;
      let match;

      while ((match = pattern.exec(text))) {
        if (text.slice(cursor, match.index).trim()) return { ok: false };
        matched = true;

        const amount = Number(match[1]);
        const unit = match[2].toLowerCase();
        const factor =
          unit === "ms" || unit.startsWith("millisecond")
            ? 1
            : unit === "s" || unit.startsWith("sec")
              ? 1000
              : unit === "m" || unit.startsWith("min")
                ? 60 * 1000
                : unit === "h" ||
                    unit.startsWith("hr") ||
                    unit.startsWith("hour")
                  ? 60 * 60 * 1000
                  : 24 * 60 * 60 * 1000;

        total += amount * factor;
        cursor = pattern.lastIndex;
      }

      if (!matched || text.slice(cursor).trim()) {
        return { ok: false };
      }
      return { ok: true, cooldownMs: total > 0 ? Math.round(total) : null };
    }

    function withNotice(lines) {
      return notice ? [`> ${notice}`, "", ...lines] : lines;
    }

    function buildEditorEmbed() {
      const command = getSelectedCommand();
      if (!command) return buildHelpEmbed();

      const policy = getPolicy(settings, command);
      const global = globalCooldownMs(command);
      const effective = effectiveCooldownMs(policy, command);
      const globalLabel = cooldownLabel(global, t);
      const cooldownText =
        policy.cooldownMs == null
          ? t("cooldownGlobal", { cooldown: globalLabel })
          : t("cooldownCustom", {
              cooldown: cooldownLabel(effective, t),
            });

      const lines = withNotice([
        t("status", {
          status: policy.enabled ? t("enabled") : t("disabled"),
        }),
        t("allowedChannels", {
          channels: formatChannelSelection(policy.allowedChannels),
        }),
        t("allowedRoles", {
          roles: formatRoleSelection(policy.allowedRoles),
        }),
        t("cooldown", { cooldown: cooldownText }),
        t("invocation", {
          cleanup: policy.deleteInvocation
            ? t("deleteInvocation")
            : t("keepInvocation"),
        }),
        "",
        t("configure"),
        `${TOGGLE} ${t("toggle")}`,
        `${CHANNELS} ${t("channelsAction")}`,
        `${ROLES} ${t("rolesAction")}`,
        `${COOLDOWN} ${t("cooldownAction")}`,
        `${CLEANUP} ${t("cleanupAction")}`,
      ]);

      if (hasPolicy(settings, command)) {
        lines.push(`${RESET} ${t("resetAction")}`);
      }
      lines.push(`${CLOSE} ${t("closeAction")}`);

      return new EmbedBuilder()
        .setColor(db.theme)
        .setTitle(
          t("editorTitle", {
            command: `${db.prefix}${command.config.name}`,
          })
        )
        .setDescription(lines.join("\n").slice(0, 4096));
    }

    function buildInputEmbed(kind) {
      const command = getSelectedCommand();
      if (!command) return buildHelpEmbed();

      const policy = getPolicy(settings, command);
      const isChannels = kind === "channels";
      const isRoles = kind === "roles";
      const global = globalCooldownMs(command);
      const effective = effectiveCooldownMs(policy, command);
      const globalLabel = cooldownLabel(global, t);
      const current =
        policy.cooldownMs == null
          ? t("cooldownGlobal", { cooldown: globalLabel })
          : t("cooldownCustom", {
              cooldown: cooldownLabel(effective, t),
            });

      const lines = withNotice(
        isChannels
          ? [
              t("channelsPrompt"),
              t("channelsPromptMultiple"),
              t("channelsPromptAll"),
              "",
              t("current", {
                value: formatChannelSelection(policy.allowedChannels),
              }),
            ]
          : isRoles
            ? [
                t("rolesPrompt"),
                t("rolesPromptMultiple"),
                t("rolesPromptNone"),
                "",
                t("current", {
                  value: formatRoleSelection(policy.allowedRoles),
                }),
              ]
            : [
                t("cooldownPrompt"),
                t("cooldownPromptDefault"),
                "",
                t("globalCooldown", { cooldown: globalLabel }),
                t("currentCooldown", { cooldown: current }),
                t("minimum", { cooldown: globalLabel }),
                t("maximum", {
                  cooldown: formatCooldown(MAX_COOLDOWN_MS),
                }),
              ]
      );

      lines.push("", t("backOrClose"));

      return new EmbedBuilder()
        .setColor(db.theme)
        .setTitle(
          t(
            isChannels
              ? "channelsTitle"
              : isRoles
                ? "rolesTitle"
                : "cooldownTitle",
            { command: `${db.prefix}${command.config.name}` }
          )
        )
        .setDescription(lines.join("\n").slice(0, 4096))
        .setFooter({
          text: t("inputFooter", { seconds: INPUT_TIMEOUT / 1000 }),
        });
    }

    function buildResetEmbed() {
      const command = getSelectedCommand();
      if (!command) return buildHelpEmbed();

      return new EmbedBuilder()
        .setColor(db.theme)
        .setTitle(
          t("resetTitle", {
            command: `${db.prefix}${command.config.name}`,
          })
        )
        .setDescription(
          [
            t("resetQuestion"),
            "",
            t("resetBody"),
            "",
            `${CONFIRM} ${t("resetAction")}`,
            `${CLOSE} ${t("resetCancel")}`,
          ].join("\n")
        )
        .setFooter({ text: t("resetFooter") });
    }

    function buildCurrentEmbed() {
      if (view === "channels" || view === "roles" || view === "cooldown") {
        return buildInputEmbed(view);
      }
      if (view === "reset") return buildResetEmbed();
      return buildEditorEmbed();
    }

    function getReactions() {
      if (view === "editor") {
        const reactions = [TOGGLE, CHANNELS, ROLES, COOLDOWN, CLEANUP];
        const command = getSelectedCommand();
        if (command && hasPolicy(settings, command)) reactions.push(RESET);
        reactions.push(CLOSE);
        return reactions;
      }

      if (view === "channels" || view === "roles" || view === "cooldown") {
        return [BACK, CLOSE];
      }

      if (view === "reset") return [CONFIRM, CLOSE];

      return [CLOSE];
    }

    async function persist(next) {
      const previous = settings;
      await client.database.updateGuild(guildId, {
        commandSettings: next,
      });

      settings = next;
      db.commandSettings = next;

      await trackGuildUpdates(client, {
        guildId,
        userId: message.author.id,
        existing: { ...db, commandSettings: previous },
        updates: { commandSettings: next },
      }).catch(() => {});
    }

    async function patchSelected(patch) {
      const command = getSelectedCommand();
      if (!command) throw new Error("No command selected");
      await persist(updatePolicy(settings, command, patch));
    }

    async function applyInput(kind, content) {
      const command = getSelectedCommand();
      if (!command) return false;

      if (kind === "cooldown") {
        const parsed = parseCooldownInput(content);
        if (!parsed.ok) {
          notice = t("invalidCooldown");
          return false;
        }

        const global = globalCooldownMs(command);
        const globalLabel = cooldownLabel(global, t);
        let next = parsed.cooldownMs;
        if (next === null || next <= 0) {
          next = null;
          notice = t("globalCooldownNotice", { cooldown: globalLabel });
        } else if (next < global) {
          next = null;
          notice = t("belowMinimum", { cooldown: globalLabel });
        } else if (next > MAX_COOLDOWN_MS) {
          next = MAX_COOLDOWN_MS;
          notice = t("cooldownCapped", {
            max: formatCooldown(MAX_COOLDOWN_MS),
          });
        } else if (next === global) {
          next = null;
          notice = t("globalCooldownNotice", { cooldown: globalLabel });
        } else {
          notice = t("cooldownSet", {
            cooldown: formatCooldown(next),
          });
        }

        await patchSelected({ cooldownMs: next });
        return true;
      }

      const isChannels = kind === "channels";
      const options = isChannels ? await ensureChannels() : await ensureRoles();
      const tokens = splitSelectors(content);

      if (!tokens.length) {
        notice = t("valuesRequired");
        return false;
      }

      if (tokens.length === 1 && tokens[0] === "*") {
        await patchSelected(
          isChannels ? { allowedChannels: [] } : { allowedRoles: [] }
        );
        notice = isChannels
          ? t("allChannelsNotice")
          : t("rolesRemoved");
        return true;
      }

      const ids = [];
      const missing = [];
      for (const token of tokens) {
        const option = findOption(options, token);
        if (!option) {
          missing.push(token);
          continue;
        }
        if (!ids.includes(option.id)) ids.push(option.id);
      }

      if (missing.length) {
        notice = missingSelectorNotice(kind, missing);
        return false;
      }

      await patchSelected(
        isChannels ? { allowedChannels: ids } : { allowedRoles: ids }
      );
      notice = isChannels
        ? t("channelsUpdated", {
            channels: formatChannelSelection(ids),
          })
        : t("rolesUpdated", { roles: formatRoleSelection(ids) });
      return true;
    }

    let menuMsg;
    const currentReactions = new Set();

    async function syncReactions() {
      const desired = new Set(getReactions());

      for (const emoji of [...currentReactions]) {
        if (desired.has(emoji)) continue;
        try {
          await menuMsg.removeReactionEmoji(emoji);
          currentReactions.delete(emoji);
        } catch {}
      }

      for (const emoji of desired) {
        if (currentReactions.has(emoji)) continue;
        try {
          await menuMsg.react(emoji);
          currentReactions.add(emoji);
        } catch {}
      }
    }

    function stopInputCollector(reason = "done") {
      const active = inputCollector;
      if (!active) return;
      inputCollector = null;
      active.stop(reason);
    }

    function startInputCollector(kind) {
      if (!message.channel?.createMessageCollector) {
        view = "editor";
        notice = t("noTextInput");
        render().catch(() => {});
        return;
      }

      let active;
      try {
        active = message.channel.createMessageCollector({
          filter: (input) =>
            input.author?.id === message.author.id && !input.author.bot,
          time: INPUT_TIMEOUT,
        });
      } catch (error) {
        console.error("[policy] message collector:", error);
        view = "editor";
        notice = t("collectorFailed");
        render().catch(() => {});
        return;
      }

      inputCollector = active;
      active.on("collect", async (input) => {
        const content = String(input.content ?? "").trim();
        await input.delete().catch(() => {});
        if (view !== kind || inputCollector !== active || busy) return;

        if (!content) {
          notice = t("emptyInput");
          await render().catch(() => {});
          return;
        }

        busy = true;
        try {
          const applied = await applyInput(kind, content);
          if (applied) {
            stopInputCollector("done");
            view = "editor";
          }
          await render();
        } catch (error) {
          console.error("[policy] input handler:", error);
          notice = t("saveFailed");
          await render().catch(() => {});
        } finally {
          busy = false;
        }
      });

      active.on("end", (_, reason) => {
        if (inputCollector !== active) return;
        inputCollector = null;
        if (reason !== "time" || view !== kind) return;
        view = "editor";
        notice = t("inputTimeout");
        render().catch(() => {});
      });
    }

    async function openInput(kind) {
      stopInputCollector("replaced");
      view = kind;
      notice = "";
      const shown = await render();
      if (shown) startInputCollector(kind);
    }

    async function render() {
      try {
        await menuMsg.edit({
          embeds: [buildCurrentEmbed()],
          allowedMentions: NO_MENTIONS,
        });
      } catch {
        stopInputCollector("deleted");
        collector?.stop("deleted");
        return false;
      }
      await syncReactions();
      return true;
    }

    async function close() {
      stopInputCollector("closed");
      collector?.stop("closed");
      await menuMsg.removeAllReactions().catch(() => {});
      currentReactions.clear();
      await menuMsg
        .edit({
          embeds: [
            new EmbedBuilder()
              .setColor(db.theme)
              .setDescription(t("closed")),
          ],
          allowedMentions: NO_MENTIONS,
        })
        .catch(() => {});
    }

    async function handleReaction(emoji) {
      const command = getSelectedCommand();
      const policy = getSelectedPolicy();

      if (view === "editor") {
        if (!command || !policy) return close();

        if (emoji === CLOSE) return close();
        if (emoji === TOGGLE) {
          await patchSelected({ enabled: !policy.enabled });
          await render();
          return;
        }
        if (emoji === CHANNELS) {
          await openInput("channels");
          return;
        }
        if (emoji === ROLES) {
          await openInput("roles");
          return;
        }
        if (emoji === COOLDOWN) {
          await openInput("cooldown");
          return;
        }
        if (emoji === CLEANUP) {
          await patchSelected({
            deleteInvocation: !policy.deleteInvocation,
          });
          await render();
          return;
        }
        if (emoji === RESET && hasPolicy(settings, command)) {
          view = "reset";
          await render();
        }
        return;
      }

      if (view === "channels" || view === "roles" || view === "cooldown") {
        if (!command || !policy) return close();

        if (emoji === CLOSE) return close();
        if (emoji === BACK) {
          stopInputCollector("cancelled");
          view = "editor";
          notice = "";
          await render();
        }
        return;
      }

      if (view === "reset") {
        if (!command) return close();

        if (emoji === CONFIRM) {
          await persist(removePolicy(settings, command));
          notice = t("reset");
          view = "editor";
          await render();
          return;
        }
        if (emoji === CLOSE) {
          view = "editor";
          await render();
        }
      }
    }

    menuMsg = await message.reply({
      embeds: [buildCurrentEmbed()],
      allowedMentions: NO_MENTIONS,
    });

    collector = menuMsg.createReactionCollector({
      filter: (reaction, user) =>
        user?.id === message.author.id &&
        !user.bot &&
        getReactions().includes(reaction.emoji?.name),
      time: MENU_TIMEOUT,
    });

    collector.on("collect", async (reaction) => {
      const emoji = reaction.emoji?.name;
      if (!emoji) return;

      collector.collected.clear();

      if (busy) {
        await menuMsg
          .removeReaction(emoji, message.author.id)
          .catch(() => {});
        return;
      }

      busy = true;
      try {
        await menuMsg
          .removeReaction(emoji, message.author.id)
          .catch(() => {});
        notice = "";
        await handleReaction(emoji);
      } catch (error) {
        console.error("[policies] reaction handler:", error);
        notice = t("saveFailed");
        await render().catch(() => {});
      } finally {
        busy = false;
      }
    });

    collector.on("end", (_, reason) => {
      if (reason !== "time") return;
      stopInputCollector("timeout");
      menuMsg.removeAllReactions().catch(() => {});
      currentReactions.clear();
      menuMsg
        .edit({
          embeds: [
            new EmbedBuilder()
              .setColor(db.theme)
              .setDescription(
                t("timedOut", {
                  prefix: db.prefix,
                  command: selectedName,
                })
              ),
          ],
          allowedMentions: NO_MENTIONS,
        })
        .catch(() => {});
    });

    await syncReactions();
  },
};
