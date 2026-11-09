const { EmbedBuilder, PermissionFlags } = require("@fluxerjs/core");
const { runChecks } = require("../functions/launchpad");

const running = new Set();
const CHECK_IDS = ["access", "roles", "reactionRoles", "channels", "forms", "active"];
const STATUS_ICON = {
  ok: "✅",
  warn: "⚠️",
  fail: "❌",
  skip: "➖",
};

function t(client, db, key, vars) {
  return client.translate.get(db.language, `Commands.launchpad.${key}`, vars);
}

function checkLabel(client, db, id) {
  return t(client, db, `check_${id}`);
}

function buildEmbed(client, db, state, final = false) {
  const results = state.results ?? [];
  const byId = new Map(results.map((result) => [result.id, result]));
  const lines = [];
  let ok = 0;
  let warn = 0;
  let fail = 0;
  let skip = 0;

  for (const id of CHECK_IDS) {
    const result = byId.get(id);
    if (result) {
      if (result.status === "ok") ok++;
      else if (result.status === "warn") warn++;
      else if (result.status === "fail") fail++;
      else skip++;
      lines.push(
        `${STATUS_ICON[result.status] || "•"} **${checkLabel(client, db, id)}** - ${result.detail || ""}`
      );
    } else if (!final && state.id === id) {
      lines.push(`⏳ **${checkLabel(client, db, id)}** - ${t(client, db, "checking")}`);
    } else {
      lines.push(`▫️ **${checkLabel(client, db, id)}** - ${t(client, db, "pending")}`);
    }
  }

  const summary = final
    ? [
        "",
        t(client, db, "summary", { ok, warn, fail, skip }),
      ].join("\n")
    : "";

  return new EmbedBuilder()
    .setColor(fail ? "#FF0000" : warn ? "#F0B232" : db.theme)
    .setTitle(t(client, db, "title"))
    .setDescription(`${lines.join("\n")}${summary}`.slice(0, 4096))
}

module.exports = {
  config: {
    name: "checkup",
    usage: "help",
    cooldown: 15000,
    category: "configuration",
    descriptionKey: "launchpad",
    available: true,
    permissions: {
      name: "Manage Guild",
      bitField: PermissionFlags.ManageGuild,
    },
    aliases: ["launchpad", "health"],
  },

  run: async (client, message, args, db) => {
    if (!message.guild) return;

    if (running.has(message.guildId)) {
      return message.reply({
        embeds: [new EmbedBuilder().setColor(db.theme).setDescription(t(client, db, "alreadyRunning"))],
      });
    }

    running.add(message.guildId);
    let progressMessage = null;

    try {
      progressMessage = await message.channel.send({
        embeds: [buildEmbed(client, db, { id: null, results: [] }, false)],
      });

      await runChecks(client, message.guild, db, async (state) => {
        if (!progressMessage) throw Object.assign(new Error("Progress message unavailable"), { code: "PROGRESS_GONE" });
        const edited = await progressMessage.edit({ embeds: [buildEmbed(client, db, state, state.id == null)] }).catch(() => null);
        if (!edited) {
          progressMessage = null;
          throw Object.assign(new Error("Progress message unavailable"), { code: "PROGRESS_GONE" });
        }
      });
    } catch (err) {
      if (err?.code === "PROGRESS_GONE") return;
      console.error("[Launchpad] Check run failed:", err);
      if (progressMessage) {
        await progressMessage.edit({
          embeds: [
            new EmbedBuilder()
              .setColor("#FF0000")
              .setDescription(t(client, db, "failed", { error: err?.message ?? "Unknown error" })),
          ],
        }).catch(() => {});
      }
    } finally {
      running.delete(message.guildId);
    }
  },
};
