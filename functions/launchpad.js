const { PermissionFlags } = require("@fluxerjs/core");
const Forms = require("../models/forms");
const Events = require("../models/events");
const Giveaways = require("../models/giveaways");
const Polls = require("../models/polls");

const CHECK_DELAY_MS = 850;
const activeRuns = new Set();
const CORE_PERMISSIONS = [
  ["ViewChannel", "View Channels"],
  ["SendMessages", "Send Messages"],
  ["EmbedLinks", "Embed Links"],
  ["AddReactions", "Add Reactions"],
];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function roleValues(guild) {
  const roles = guild?.roles;
  if (!roles) return [];
  if (Array.isArray(roles)) return roles;
  if (typeof roles.values === "function") return [...roles.values()];
  if (typeof roles.cache?.values === "function") return [...roles.cache.values()];
  return [];
}

function getRole(guild, roleId) {
  if (!roleId) return null;
  const roles = guild?.roles;
  return roles?.get?.(roleId) ??
    roles?.cache?.get?.(roleId) ??
    roleValues(guild).find((role) => role.id === roleId) ??
    null;
}

function memberRoleValues(member) {
  const roles = member?.roles;
  if (!roles) return [];
  if (Array.isArray(roles)) return roles;
  if (typeof roles.values === "function") return [...roles.values()];
  if (typeof roles.cache?.values === "function") return [...roles.cache.values()];
  return [];
}

function highestRolePosition(member) {
  const positions = memberRoleValues(member)
    .map((role) => Number(role?.position))
    .filter((position) => Number.isFinite(position));
  return positions.length ? Math.max(...positions) : null;
}

const PERMISSION_LABELS = {
  ViewChannel: "View Channels",
  SendMessages: "Send Messages",
  EmbedLinks: "Embed Links",
  AddReactions: "Add Reactions",
  ManageMessages: "Manage Messages",
  ManageChannels: "Manage Channels",
  ManageRoles: "Manage Roles",
  ManageGuild: "Manage Guild",
};

const PERMISSION_NAMES = new Map(
  Object.entries(PermissionFlags)
    .filter(([, value]) => typeof value === "bigint" || typeof value === "number")
    .map(([key, value]) => [
      String(value),
      PERMISSION_LABELS[key] ?? key.replace(/([a-z])([A-Z])/g, "$1 $2"),
    ])
);

function permissionName(flag) {
  return PERMISSION_NAMES.get(String(flag)) ?? "an unknown permission";
}

function formatList(items) {
  if (items.length <= 1) return items[0] ?? "";
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

function summarizeProblems(problems) {
  return [...new Set(problems)].slice(0, 8).join("\n");
}

async function getBotMember(guild) {
  return guild?.members?.me ?? await guild?.members?.fetchMe?.().catch(() => null);
}

async function checkChannel(client, guild, member, channelId, required = CORE_PERMISSIONS, label = "") {
  if (!channelId) return { ok: true, skipped: true };
  const channel = await client.channels.resolve(channelId).catch(() => null);
  if (!channel) {
    return {
      ok: false,
      detail: `${label || "Configured channel"} no longer exists. Choose a new one in the dashboard.`,
    };
  }

  const channelName = channel.name ? ` "${channel.name}"` : "";
  const target = `${label || "Configured channel"}${channelName}`;
  const permissions = member?.permissionsIn?.(channel);
  if (!permissions) {
    return {
      ok: false,
      detail: `Could not check the bot's access to ${target}. Run the health check again.`,
    };
  }

  const missing = required
    .map(([key]) => PermissionFlags[key])
    .filter((flag) => flag !== undefined && flag !== null && !permissions.has(flag));

  if (missing.length) {
    return {
      ok: false,
      detail: `${target}: the bot needs ${formatList(missing.map(permissionName))}. Give the bot ${missing.length === 1 ? "this permission" : "these permissions"} there.`,
    };
  }
  return { ok: true };
}

function configuredChannels(db) {
  const refs = [];
  const add = (channelId, label, required) => {
    if (!channelId) return;
    refs.push({ channelId, label, required });
  };

  add(db?.birthdayChannel, "Birthday channel", CORE_PERMISSIONS);
  add(db?.communityBirthday?.channelId, "Community birthday channel", CORE_PERMISSIONS);
  for (const media of db?.mediaChannels ?? []) {
    add(typeof media === "string" ? media : media?.channelId ?? media?.id, "Media channel", CORE_PERMISSIONS);
  }
  for (const sticky of db?.stickies ?? []) {
    add(sticky?.channelId, "Sticky channel", [
      ...CORE_PERMISSIONS,
      ["ManageMessages", "Manage Messages"],
    ]);
  }
  for (const scheduled of db?.scheduledMessages ?? []) {
    add(scheduled?.channelId, "Scheduled message channel", CORE_PERMISSIONS);
  }
  for (const temp of db?.tempChannels ?? []) {
    add(typeof temp === "string" ? temp : temp?.channelId ?? temp?.id, "Temp channel", [
      ...CORE_PERMISSIONS,
      ["ManageChannels", "Manage Channels"],
      ["ManageRoles", "Manage Roles"],
    ]);
  }
  add(db?.parentChannel, "Temp category", [["ManageChannels", "Manage Channels"]]);
  add(db?.childChannel, "Temp join channel", [
    ...CORE_PERMISSIONS,
    ["ManageChannels", "Manage Channels"],
  ]);
  for (const panel of db?.roles ?? []) {
    add(panel?.chanId ?? panel?.channelId, "Reaction-role panel channel", CORE_PERMISSIONS);
  }
  return refs;
}

function assignableRoleRefs(db) {
  const refs = [];
  const add = (roleId, label) => {
    if (roleId) refs.push({ roleId, label });
  };

  for (const role of db?.joinRoles ?? []) add(typeof role === "string" ? role : role?.id ?? role?.roleId, "Join role");
  for (const role of db?.timedRoles ?? []) add(role?.id ?? role?.roleId, "Timed role");
  for (const entry of db?.stickyRoles ?? []) {
    if (entry?.role) add(entry.role, "Sticky role");
    for (const roleId of entry?.roles ?? []) add(roleId, "Sticky role");
  }
  add(db?.birthdayRole, "Birthday role");
  add(db?.communityBirthday?.roleId, "Community birthday role");
  for (const panel of db?.roles ?? []) {
    for (const role of panel?.roles ?? []) add(role?.role, "Reaction role");
  }
  return refs;
}

async function runChecks(client, guild, db, onProgress = async () => {}, options = {}) {
  if (!guild?.id) return [];
  if (activeRuns.has(guild.id)) return [];
  const delayMs = Number.isFinite(options?.delayMs)
    ? Math.max(0, options.delayMs)
    : CHECK_DELAY_MS;
  activeRuns.add(guild.id);
  try {
  const results = [];
  const member = await getBotMember(guild);
  const highest = highestRolePosition(member);

  const checks = [
    {
      id: "access",
      run: async () => {
        if (!member) return { status: "fail", detail: "The bot's server member could not be loaded. Re-add the bot or run the check again." };
        const permissions = member.permissions;
        if (!permissions) return { status: "warn", detail: "The bot could not read its server permissions. Run the health check again." };
        const missing = CORE_PERMISSIONS
          .map(([key]) => PermissionFlags[key])
          .filter((flag) => flag !== undefined && flag !== null && !permissions.has(flag));
        if (missing.length) {
          return { status: "fail", detail: `The bot is missing ${formatList(missing.map(permissionName))}. Add ${missing.length === 1 ? "this permission" : "these permissions"} to the bot's role.` };
        }
        return { status: "ok", detail: "The bot can view channels, send messages, embed links, and add reactions." };
      },
    },
    {
      id: "roles",
      run: async () => {
        const refs = assignableRoleRefs(db);
        if (!refs.length) return { status: "skip", detail: "No roles are configured for the bot to assign." };
        const permissions = member?.permissions;
        if (permissions && !permissions.has(PermissionFlags.ManageRoles)) {
          return { status: "fail", detail: "The bot cannot assign roles because Manage Roles is missing. Add Manage Roles to the bot's role." };
        }
        if (highest == null) return { status: "warn", detail: "The bot's highest role could not be determined. Make sure the bot has a role, then run the check again." };

        const problems = [];
        for (const ref of refs) {
          const role = getRole(guild, ref.roleId);
          if (!role) {
            problems.push(`${ref.label} no longer exists. Choose a new role in the dashboard.`);
          } else if (Number.isFinite(role.position) && role.position >= highest) {
            problems.push(`${ref.label} "${role.name ?? "Unknown role"}" is higher than the bot's highest role. Move the bot's role above it.`);
          }
        }
        return problems.length
          ? { status: "fail", detail: summarizeProblems(problems) }
          : { status: "ok", detail: refs.length === 1 ? "The bot can assign the configured role." : `The bot can assign all ${refs.length} configured roles.` };
      },
    },
    {
      id: "reactionRoles",
      run: async () => {
        const panels = db?.roles ?? [];
        if (!panels.length) return { status: "skip", detail: "No reaction-role panels are configured." };
        const problems = [];
        for (let index = 0; index < panels.length; index += 1) {
          const panel = panels[index];
          const channelId = panel?.chanId ?? panel?.channelId;
          const panelLabel = `Reaction-role panel ${index + 1}`;
          if (!channelId) {
            problems.push(`${panelLabel}: no channel is selected. Choose a channel in the dashboard.`);
            continue;
          }
          const channelCheck = await checkChannel(client, guild, member, channelId, CORE_PERMISSIONS, `${panelLabel} channel`);
          if (!channelCheck.ok) {
            problems.push(channelCheck.detail);
            continue;
          }
          const channel = await client.channels.resolve(channelId).catch(() => null);
          const channelName = channel?.name ? ` "${channel.name}"` : "";
          const message = await channel?.messages?.fetch?.(panel?.msgId).catch(() => null);
          if (!message) problems.push(`${panelLabel}${channelName}: the panel message is missing. Republish the panel.`);
          for (const roleEntry of panel?.roles ?? []) {
            const role = getRole(guild, roleEntry?.role);
            if (!role) {
              problems.push(`${panelLabel}${channelName}: a reaction role no longer exists. Choose a new role or remove it.`);
              continue;
            }
            if (!roleEntry?.emoji && !roleEntry?.emojiKey && !roleEntry?.reaction) {
              problems.push(`${panelLabel}${channelName}: reaction role "${role.name}" has no emoji. Add an emoji or remove it.`);
            }
            if (Number.isFinite(role.position) && highest != null && role.position >= highest) {
              problems.push(`${panelLabel}${channelName}: reaction role "${role.name}" is higher than the bot's highest role. Move the bot's role above it.`);
            }
          }
        }
        return problems.length
          ? { status: "fail", detail: summarizeProblems(problems) }
          : { status: "ok", detail: panels.length === 1 ? "The reaction-role panel is working." : `All ${panels.length} reaction-role panels are working.` };
      },
    },
    {
      id: "channels",
      run: async () => {
        const refs = configuredChannels(db);
        if (!refs.length) return { status: "skip", detail: "No channels are configured for the bot to manage." };
        const problems = [];
        for (const ref of refs) {
          const result = await checkChannel(client, guild, member, ref.channelId, ref.required, ref.label);
          if (!result.ok) problems.push(result.detail);
        }
        return problems.length
          ? { status: "fail", detail: summarizeProblems(problems) }
          : { status: "ok", detail: refs.length === 1 ? "The configured channel is accessible." : `All ${refs.length} configured channels are accessible.` };
      },
    },
    {
      id: "forms",
      run: async () => {
        const forms = await Forms.find({ guildId: guild.id }).lean().catch(() => []);
        if (!forms.length) return { status: "skip", detail: "No forms are configured." };
        const problems = [];
        for (const form of forms) {
          const formName = form.name ? ` "${form.name}"` : "Unnamed form";
          for (const [label, channelId] of [
            ["Panel channel", form.panelChannelId],
            ["Review channel", form.reviewChannelId],
          ]) {
            if (!channelId) {
              if (label === "Review channel" || form.status === "open") {
                problems.push(`${formName}: the ${label.toLowerCase()} is not set. Choose one in the dashboard.`);
              }
              continue;
            }
            const result = await checkChannel(client, guild, member, channelId, CORE_PERMISSIONS, `${formName} ${label.toLowerCase()}`);
            if (!result.ok) problems.push(result.detail);
          }
          if (form.panelChannelId && form.panelMessageId) {
            const channel = await client.channels.resolve(form.panelChannelId).catch(() => null);
            const message = await channel?.messages?.fetch?.(form.panelMessageId).catch(() => null);
            if (!message) problems.push(`${formName}: the panel message is missing. Republish the form.`);
          } else if (form.status === "open") {
            problems.push(`${formName}: the form is open but has not been published. Publish it or close the form.`);
          }
          if (form.status === "open" && !form.questions?.length) {
            problems.push(`${formName}: the form is open but has no questions. Add at least one question or close it.`);
          }
          for (const roleId of form.reviewerRoleIds ?? []) {
            if (!getRole(guild, roleId)) problems.push(`${formName}: a reviewer role no longer exists. Choose a new reviewer role.`);
          }
        }
        return problems.length
          ? { status: "warn", detail: summarizeProblems(problems) }
          : { status: "ok", detail: forms.length === 1 ? "The form is working." : `All ${forms.length} forms are working.` };
      },
    },
    {
      id: "active",
      run: async () => {
        const [events, giveaways, polls] = await Promise.all([
          Events.find({ guildId: guild.id, status: { $in: ["scheduled", "live"] } }).lean().catch(() => []),
          Giveaways.find({ serverId: guild.id, ended: false }).lean().catch(() => []),
          Polls.find({ serverId: guild.id, ended: false }).lean().catch(() => []),
        ]);
        const refs = [
          ...events.map((event) => ({ id: event.channelId, messageId: event.messageId, label: "Event" })),
          ...giveaways.map((giveaway) => ({ id: giveaway.channelId, messageId: giveaway.messageId, label: "Giveaway" })),
          ...polls.map((poll) => ({ id: poll.channelId, messageId: poll.messageId, label: "Poll" })),
        ];
        if (!refs.length) return { status: "skip", detail: "There are no active events, giveaways, or polls to check." };
        const problems = [];
        for (const ref of refs) {
          const result = await checkChannel(client, guild, member, ref.id, CORE_PERMISSIONS, `${ref.label} channel`);
          if (!result.ok) {
            problems.push(result.detail);
            continue;
          }
          if (ref.messageId) {
            const channel = await client.channels.resolve(ref.id).catch(() => null);
            const message = await channel?.messages?.fetch?.(ref.messageId).catch(() => null);
            if (!message) {
              const channelName = channel?.name ? ` "${channel.name}"` : "";
              problems.push(`${ref.label} message${channelName} is missing. Recreate or remove it.`);
            }
          }
        }
        return problems.length
          ? { status: "fail", detail: summarizeProblems(problems) }
          : { status: "ok", detail: refs.length === 1 ? "The active feature message is accessible." : `All ${refs.length} active feature messages are accessible.` };
      },
    },
  ];

  for (let index = 0; index < checks.length; index++) {
    const check = checks[index];
    await onProgress({ id: check.id, index, total: checks.length, results });
    let result;
    try {
      result = await check.run();
    } catch (err) {
      result = { status: "warn", detail: err?.message ?? "Check failed." };
    }
    results.push({ id: check.id, ...result });
    await sleep(delayMs);
  }

  await onProgress({ id: null, index: checks.length, total: checks.length, results });
  return results;
  } finally {
    activeRuns.delete(guild.id);
  }
}

module.exports = {
  CHECK_DELAY_MS,
  CORE_PERMISSIONS,
  runChecks,
  configuredChannels,
  assignableRoleRefs,
};
