const MAX_COOLDOWN_MS = 60 * 60 * 1000;

function isConfigurableCommand(command) {
  const config = command?.config;
  return Boolean(
    config &&
      config.available === true &&
      typeof config.name === "string" &&
      config.name.trim()
  );
}

function getConfigurableCommands(client) {
  if (typeof client?.commands?.values !== "function") return [];

  const commands = [];
  for (const command of client.commands.values()) {
    if (isConfigurableCommand(command)) commands.push(command);
  }

  return commands.sort((a, b) => a.config.name.localeCompare(b.config.name));
}

function globalCooldownMs(command) {
  return Math.max(0, Number(command?.config?.cooldown) || 0);
}

function normalizeIds(value) {
  if (!Array.isArray(value)) return [];

  const ids = [];
  const seen = new Set();
  for (const entry of value) {
    const id = typeof entry === "string" ? entry.trim() : "";
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

function normalizeCooldownMs(value, command) {
  if (value === null || value === undefined) return null;

  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;

  return Math.min(
    MAX_COOLDOWN_MS,
    Math.max(globalCooldownMs(command), Math.round(numeric))
  );
}

function normalizePolicy(policy, command) {
  return {
    name: command.config.name,
    enabled: policy?.enabled !== false,
    cooldownMs: normalizeCooldownMs(policy?.cooldownMs, command),
    allowedChannels: normalizeIds(policy?.allowedChannels),
    allowedRoles: normalizeIds(policy?.allowedRoles),
    deleteInvocation: policy?.deleteInvocation === true,
  };
}

function getPolicy(settings, command) {
  const existing = Array.isArray(settings)
    ? settings.find((setting) => setting?.name === command.config.name)
    : undefined;

  return normalizePolicy(existing, command);
}

function hasPolicy(settings, command) {
  return (
    Array.isArray(settings) &&
    settings.some((setting) => setting?.name === command.config.name)
  );
}

function updatePolicy(settings, command, patch) {
  const list = Array.isArray(settings) ? settings : [];
  const existing =
    list.find((setting) => setting?.name === command.config.name) ?? {};

  const next = normalizePolicy(
    { ...existing, ...patch, name: command.config.name },
    command
  );

  return [
    ...list.filter((setting) => setting?.name !== command.config.name),
    next,
  ];
}

function removePolicy(settings, command) {
  return (Array.isArray(settings) ? settings : []).filter(
    (setting) => setting?.name !== command.config.name
  );
}

function effectiveCooldownMs(policy, command) {
  const minimum = globalCooldownMs(command);
  return policy?.cooldownMs == null
    ? minimum
    : Math.max(minimum, policy.cooldownMs);
}

function formatCooldown(ms) {
  const totalSeconds = Math.max(0, Number(ms) || 0) / 1000;
  if (!totalSeconds) return "none";

  if (totalSeconds < 60) {
    return `${Number.isInteger(totalSeconds) ? totalSeconds : totalSeconds.toFixed(1)}s`;
  }

  if (totalSeconds >= 3600) {
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.round((totalSeconds % 3600) / 60);
    return minutes ? `${hours}h ${minutes}m` : `${hours}h`;
  }

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.round(totalSeconds % 60);
  return seconds ? `${minutes}m ${seconds}s` : `${minutes}m`;
}

module.exports = {
  MAX_COOLDOWN_MS,
  effectiveCooldownMs,
  formatCooldown,
  getConfigurableCommands,
  getPolicy,
  globalCooldownMs,
  hasPolicy,
  isConfigurableCommand,
  normalizePolicy,
  removePolicy,
  updatePolicy,
};
