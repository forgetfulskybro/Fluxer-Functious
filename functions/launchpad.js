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

function permissionName(flag) {
  return CORE_PERMISSIONS.find(([key]) => PermissionFlags[key] === flag)?.[1] ?? String(flag);
}

async function getBotMember(guild) {
  return guild?.members?.me ?? await guild?.members?.fetchMe?.().catch(() => null);
}

async function checkChannel(client, guild, member, channelId, required = CORE_PERMISSIONS, label = "") {
  if (!channelId) return { ok: true, skipped: true };
  const channel = await client.channels.resolve(channelId).catch(() => null);
  if (!channel) return { ok: false, detail: `${label || "Configured channel"} ${channelId} is missing.` };

  const permissions = member?.permissionsIn?.(channel);
  if (!permissions) return { ok: false, detail: `Could not verify access to ${label || `<#${channelId}>`}.` };

  const missing = required
    .map(([key]) => PermissionFlags[key])
    .filter((flag) => flag !== undefined && flag !== null && !permissions.has(flag));

  if (missing.length) {
    return {
      ok: false,
      detail: `${label || `<#${channelId}>`} is missing: ${missing.map(permissionName).join(", ")}.`,
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
        if (!member) return { status: "fail", detail: "I could not fetch my guild member." };
        const permissions = member.permissions;
        if (!permissions) return { status: "warn", detail: "I could not read my cached guild permissions." };
        const missing = CORE_PERMISSIONS
          .map(([key]) => PermissionFlags[key])
          .filter((flag) => flag !== undefined && flag !== null && !permissions.has(flag));
        if (missing.length) {
          return { status: "fail", detail: `Missing guild permissions: ${missing.map(permissionName).join(", ")}.` };
        }
        if (!permissions.has(PermissionFlags.ManageRoles)) {
          return { status: "warn", detail: "Manage Roles is missing; assignable-role checks may fail." };
        }
        return { status: "ok", detail: "Core guild permissions are present." };
      },
    },
    {
      id: "roles",
      run: async () => {
        const refs = assignableRoleRefs(db);
        if (!refs.length) return { status: "skip", detail: "No assignable roles are configured." };
        const permissions = member?.permissions;
        if (permissions && !permissions.has(PermissionFlags.ManageRoles)) {
          return { status: "fail", detail: "I do not have Manage Roles." };
        }
        if (highest == null) return { status: "warn", detail: "I could not determine my highest role position." };

        const problems = [];
        for (const ref of refs) {
          const role = getRole(guild, ref.roleId);
          if (!role) {
            problems.push(`${ref.label} ${ref.roleId} is missing`);
          } else if (Number.isFinite(role.position) && role.position >= highest) {
            problems.push(`${ref.label} ${role.name ?? ref.roleId} is above my highest role`);
          }
        }
        return problems.length
          ? { status: "fail", detail: problems.slice(0, 8).join("; ") }
          : { status: "ok", detail: `${refs.length} assignable role(s) look reachable.` };
      },
    },
    {
      id: "reactionRoles",
      run: async () => {
        const panels = db?.roles ?? [];
        if (!panels.length) return { status: "skip", detail: "No reaction-role panels are configured." };
        const problems = [];
        for (const panel of panels) {
          const channelId = panel?.chanId ?? panel?.channelId;
          const channelCheck = await checkChannel(client, guild, member, channelId, CORE_PERMISSIONS, "Reaction-role panel channel");
          if (!channelCheck.ok) {
            problems.push(channelCheck.detail);
            continue;
          }
          const channel = await client.channels.resolve(channelId).catch(() => null);
          const message = await channel?.messages?.fetch?.(panel?.msgId).catch(() => null);
          if (!message) problems.push(`Panel ${panel?.msgId ?? "unknown"} is missing.`);
          for (const roleEntry of panel?.roles ?? []) {
            if (!roleEntry?.emoji && !roleEntry?.emojiKey && !roleEntry?.reaction) {
              problems.push(`Panel role ${roleEntry?.role ?? "unknown"} has no configured emoji.`);
            }
            const role = getRole(guild, roleEntry?.role);
            if (!role) problems.push(`Panel role ${roleEntry?.role ?? "unknown"} is missing.`);
            else if (Number.isFinite(role.position) && highest != null && role.position >= highest) {
              problems.push(`Panel role ${role.name ?? roleEntry.role} is above my highest role.`);
            }
          }
        }
        return problems.length
          ? { status: "fail", detail: problems.slice(0, 8).join("; ") }
          : { status: "ok", detail: `${panels.length} reaction-role panel(s) look reachable.` };
      },
    },
    {
      id: "channels",
      run: async () => {
        const refs = configuredChannels(db);
        if (!refs.length) return { status: "skip", detail: "No bot-managed channels are configured." };
        const problems = [];
        for (const ref of refs) {
          const result = await checkChannel(client, guild, member, ref.channelId, ref.required, ref.label);
          if (!result.ok) problems.push(result.detail);
        }
        return problems.length
          ? { status: "fail", detail: problems.slice(0, 8).join("; ") }
          : { status: "ok", detail: `${refs.length} configured channel(s) look reachable.` };
      },
    },
    {
      id: "forms",
      run: async () => {
        const forms = await Forms.find({ guildId: guild.id }).lean().catch(() => []);
        if (!forms.length) return { status: "skip", detail: "No forms are configured." };
        const problems = [];
        for (const form of forms) {
          for (const [label, channelId] of [
            ["Panel channel", form.panelChannelId],
            ["Review channel", form.reviewChannelId],
          ]) {
            if (!channelId) {
              if (label === "Review channel" || form.status === "open") problems.push(`${form.name}: ${label} is not set`);
              continue;
            }
            const result = await checkChannel(client, guild, member, channelId, CORE_PERMISSIONS, `${form.name} ${label}`);
            if (!result.ok) problems.push(result.detail);
          }
          if (form.panelChannelId && form.panelMessageId) {
            const channel = await client.channels.resolve(form.panelChannelId).catch(() => null);
            const message = await channel?.messages?.fetch?.(form.panelMessageId).catch(() => null);
            if (!message) problems.push(`${form.name}: panel message is missing`);
          } else if (form.status === "open") {
            problems.push(`${form.name}: panel message is not published`);
          }
          if (form.status === "open" && !form.questions?.length) {
            problems.push(`${form.name}: no questions`);
          }
          for (const roleId of form.reviewerRoleIds ?? []) {
            if (!getRole(guild, roleId)) problems.push(`${form.name}: reviewer role ${roleId} is missing`);
          }
        }
        return problems.length
          ? { status: "warn", detail: problems.slice(0, 8).join("; ") }
          : { status: "ok", detail: `${forms.length} form(s) look reachable.` };
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
        if (!refs.length) return { status: "skip", detail: "No active events, giveaways, or polls." };
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
            if (!message) problems.push(`${ref.label} message ${ref.messageId} is missing`);
          }
        }
        return problems.length
          ? { status: "fail", detail: problems.slice(0, 8).join("; ") }
          : { status: "ok", detail: `${refs.length} active feature message(s) look reachable.` };
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
