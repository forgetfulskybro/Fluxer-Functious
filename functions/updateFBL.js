const cron = require("node-cron");
const color = require("./colorCodes");

const FBL_API = "https://fbl.gg/api/v1/bots/1475548817821799084";
const STATS_INTERVAL = "0 */2 * * *";
const COMMAND_LANGUAGE = "en_EN";
const DEFAULT_CATEGORY = "Utility";

const COMMAND_CATEGORIES = {
    autoroles: "Configuration",
    birthday: "Utility",
    bypass: "Configuration",
    checkup: "Configuration",
    events: "Events",
    forms: "Forms",
    giveaway: "Giveaways",
    help: "Utility",
    info: "Utility",
    language: "Configuration",
    mediachannels: "Configuration",
    ping: "Utility",
    policy: "Configuration",
    polls: "Polls",
    prefix: "Configuration",
    remind: "Utility",
    roles: "Configuration",
    schedule: "Utility",
    sticky: "Configuration",
    tags: "Utility",
    tempchannels: "Configuration",
    theme: "Configuration",
    timezone: "Utility",
};

let refreshCronJob = null;
let clientRef = null;

function getToken() {
    return String(process.env.FBL ?? "").trim();
}

function cleanText(value) {
    if (typeof value !== "string") return null;

    const text = value.replace(/\s+/g, " ").trim();
    return text || null;
}

function translatedText(client, key) {
    const value = client?.translate?.get?.(COMMAND_LANGUAGE, key);
    if (
        typeof value !== "string" ||
        value.startsWith("Unknown translation:")
    ) {
        return null;
    }

    return value;
}

function titleCase(value) {
    return String(value).replace(/\b\w/g, (character) => character.toUpperCase());
}

function buildCommandUsage(client, config) {
    if (config.usage === false) return null;

    const usage =
        typeof config.usage === "string"
            ? config.usage
            : translatedText(client, `Commands.${config.name}.usage`);

    if (!usage) return null;

    return cleanText(`${config.name} ${usage}`);
}

function buildCommands(client) {
    const commands = [];
    if (typeof client?.commands?.values !== "function") return commands;

    for (const command of client.commands.values()) {
        const config = command?.config;
        if (
            !config ||
            config.available !== true ||
            typeof config.name !== "string" ||
            !config.name.trim()
        ) {
            continue;
        }

        const name = config.name.trim();
        const description = cleanText(
            translatedText(
                client,
                `Commands.${config.descriptionKey ?? name}.description`
            )
        );
        const usage = buildCommandUsage(client, config);
        const category =
            cleanText(
                COMMAND_CATEGORIES[name] ??
                    (config.category
                        ? titleCase(config.category)
                        : DEFAULT_CATEGORY)
            ) ?? DEFAULT_CATEGORY;

        const entry = { name, kind: "prefix", category };
        if (description) entry.description = description;
        if (usage) entry.usage = usage;
        commands.push(entry);
    }

    return commands
        .sort((a, b) => a.name.localeCompare(b.name))
}

async function pushStats(client) {
    const token = getToken();
    const serverCount = Number(client?.guilds?.size) || 0;

    if (!token) return false;

    try {
        const res = await fetch(`${FBL_API}/stats`, {
            method: "POST",
            headers: {
                "Authorization": token,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ server_count: serverCount }),
        });

        if (!res.ok) {
            const text = await res.text().catch(() => "");
            console.log(color("%", `%4[FBL]%7 :: Stats update rejected (${res.status}) :: ${String(text).slice(0, 200)}`));
            return false;
        }

        await res.json().catch(() => null);
        console.log(color("%", `%2[FBL]%7 :: Updated stats :: ${serverCount} server(s)`));
        return true;
    } catch (err) {
        console.log(color("%", `%4[FBL]%7 :: Stats update failed :: ${err}`));
        return false;
    }
}

async function pushCommands(client) {
    const token = getToken();
    if (!token) return false;

    const commands = buildCommands(client);
    if (commands.length === 0) {
        console.log(color("%", "%4[FBL]%7 :: No public commands found, skipping command sync"));
        return false;
    }

    try {
        const res = await fetch(`${FBL_API}/commands`, {
            method: "PUT",
            headers: {
                "Authorization": token,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ commands }),
        });

        if (!res.ok) {
            const text = await res.text().catch(() => "");
            console.log(color("%", `%4[FBL]%7 :: Command sync rejected (${res.status}) :: ${String(text).slice(0, 200)}`));
            return false;
        }

        const data = await res.json().catch(() => null);
        const count = Number.isFinite(Number(data?.count))
            ? Number(data.count)
            : commands.length;
        console.log(color("%", `%2[FBL]%7 :: Updated commands :: ${count} command(s)`));
        return true;
    } catch (err) {
        console.log(color("%", `%4[FBL]%7 :: Command sync failed :: ${err}`));
        return false;
    }
}

function startCron(client) {
    clientRef = client;

    if (refreshCronJob) {
        refreshCronJob.stop();
    }

    pushStats(client);
    pushCommands(client);

    refreshCronJob = cron.schedule(STATS_INTERVAL, async () => {
        await pushStats(clientRef);
    });
}

function stopCron() {
    if (refreshCronJob) {
        refreshCronJob.stop();
        refreshCronJob = null;
    }

    clientRef = null;
}

module.exports = {
    FBL_API,
    buildCommands,
    pushStats,
    pushCommands,
    startCron,
    stopCron,
};
