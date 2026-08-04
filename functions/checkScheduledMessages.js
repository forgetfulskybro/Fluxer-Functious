const cron = require("node-cron");
const { EmbedBuilder, Webhook } = require("@fluxerjs/core");
const { processTemplate, gatherContext } = require("./scheduleTemplateEngine");
const TWELVE_HOURS_SECONDS = 12 * 60 * 60;

let refreshCronJob = null;
let clientRef = null;

const scheduledQueue = new Map();
let windowEndTime = 0;

async function sendViaWebhook(client, channel, msgData, processedContent, processedEmbedData) {
    const webhookConfig = msgData.webhook;
    if (!webhookConfig || !webhookConfig.name) return null;

    try {
        const webhook = await channel.createWebhook({ name: webhookConfig.name });
        const wh = Webhook.fromToken(client, webhook.id, webhook.token);

        const sendOptions = { username: webhookConfig.name };
        if (webhookConfig.avatarURL) {
            sendOptions.avatar_url = webhookConfig.avatarURL;
        }

        if (msgData.type === "content") {
            await wh.send({ content: processedContent, ...sendOptions });
        } else if (msgData.type === "embed") {
            const embed = buildEmbed(processedEmbedData);
            await wh.send({ embeds: [embed], ...sendOptions });
        }

        await webhook.delete().catch(() => {});
        return { success: true };
    } catch (err) {
        return { success: false, error: err };
    }
}

function buildEmbed(ed) {
    if (!ed) return null;
    const embed = new EmbedBuilder();
    if (ed.title) embed.setTitle(ed.title);
    if (ed.description) embed.setDescription(ed.description);
    if (ed.footer?.text) embed.setFooter({ text: ed.footer.text, iconURL: ed.footer.iconURL || undefined });
    if (ed.image) embed.setImage(ed.image);
    if (ed.author?.name) embed.setAuthor({ name: ed.author.name, iconURL: ed.author.iconURL || undefined, url: ed.author.url || undefined });
    if (ed.url) embed.setURL(ed.url);
    if (ed.color) embed.setColor(ed.color);
    else embed.setColor("#A52F05");
    if (ed.thumbnail) embed.setThumbnail(ed.thumbnail);
    if (ed.useTimestamp) embed.setTimestamp();
    return embed;
}

async function sendScheduledMessage(client, guildId, msgData) {
    try {
        const guild = client.guilds.get(guildId) || await client.guilds.fetch(guildId);
        if (!guild) return { success: false };

        const channel = guild.channels.get(msgData.channelId) || await guild.channels.fetch(msgData.channelId);
        if (!channel) return { success: false };

        if (msgData.type === "command") {
            return await executeScheduledCommand(client, guild, channel, msgData);
        }

        const context = gatherContext(client, guildId, msgData.channelId, msgData.createdBy, msgData.sendCount || 0);

        let processedContent = null;
        let processedEmbedData = null;

        if (msgData.type === "content" && msgData.content) {
            processedContent = processTemplate(msgData.content, { ...context });
        } else if (msgData.type === "embed" && msgData.embedData) {
            processedEmbedData = {};
            const ed = msgData.embedData;
            if (ed.title) processedEmbedData.title = processTemplate(ed.title, { ...context });
            if (ed.description) processedEmbedData.description = processTemplate(ed.description, { ...context });
            if (ed.footer?.text) {
                processedEmbedData.footer = {
                    text: processTemplate(ed.footer.text, { ...context }),
                    iconURL: ed.footer.iconURL
                };
            }
            if (ed.image) processedEmbedData.image = processTemplate(ed.image, { ...context });
            if (ed.author?.name) {
                processedEmbedData.author = {
                    name: processTemplate(ed.author.name, { ...context }),
                    iconURL: ed.author.iconURL,
                    url: ed.author.url
                };
            }
            if (ed.url) processedEmbedData.url = processTemplate(ed.url, { ...context });
            if (ed.color) processedEmbedData.color = ed.color;
            if (ed.thumbnail) processedEmbedData.thumbnail = processTemplate(ed.thumbnail, { ...context });
            if (ed.useTimestamp) processedEmbedData.useTimestamp = true;
        }

        let sendSuccess = false;

        if (msgData.webhook && msgData.webhook.name) {
            const result = await sendViaWebhook(client, channel, msgData, processedContent, processedEmbedData);
            if (result && result.success) sendSuccess = true;
        }

        if (!sendSuccess) {
            try {
                if (msgData.type === "content") {
                    await channel.send(processedContent || msgData.content);
                    sendSuccess = true;
                } else if (msgData.type === "embed") {
                    const embed = buildEmbed(processedEmbedData || msgData.embedData);
                    if (embed) {
                        await channel.send({ embeds: [embed] });
                        sendSuccess = true;
                    }
                }
            } catch (err) {
                sendSuccess = false;
            }
        }

      if (sendSuccess && msgData.recurring && msgData.recurring !== "none") {
        await scheduleNextRecurring(client, guildId, msgData);
      }

        return { success: sendSuccess };
    } catch (err) {
        return { success: false, error: err };
    }
}

async function executeScheduledCommand(client, guild, channel, msgData) {
    try {
        const triggerMessage = await channel.send({
            content: `📅 Executing scheduled ${msgData.commandName}...`,
            allowedMentions: { parse: [] }
        });

        const creator = await client.users.fetch(msgData.createdBy).catch(() => null);
        const simulatedMessage = {
            id: triggerMessage.id,
            channel: channel,
            guild: {
                ...guild,
                id: guild.id,
                name: guild.name,
                members: guild.members,
                roles: guild.roles,
                channels: guild.channels,
                fetchChannels: guild.fetchChannels
                    ? guild.fetchChannels.bind(guild)
                    : async () => guild.channels || new Map(),
            },
            guildId: guild.id,
            author: creator || { id: msgData.createdBy },
            content: `${msgData.commandArgs.join(" | ")}`,
            createdAt: new Date(),
            delete: async () => {},
            reply: async (options) => {
                try {
                    return await channel.send(options);
                } catch (err) {
                    console.error(`Error replying to scheduled command:`, err);
                }
            },
            fetch: async () => triggerMessage,
        };

        const guildData = await client.database.getGuild(guild.id);
        let commandModule;
        try {
            commandModule = require(`../commands/${msgData.commandName}`);
        } catch (err) {
            console.error(`Failed to load command module for ${msgData.commandName}:`, err);
            await triggerMessage.edit({ content: `❌ Failed to execute scheduled ${msgData.commandName}: Command not found` });
            return { success: false, error: "Command not found" };
        }

        const argsForCommand = msgData.commandArgs.join(' | ').split(' ');

        try {
            await commandModule.run(client, simulatedMessage, argsForCommand, guildData);
            await triggerMessage.edit({ content: `✅ Executed scheduled ${msgData.commandName}` });
        } catch (err) {
            console.error(`Error executing scheduled command ${msgData.commandName}:`, err);
            await triggerMessage.edit({ content: `❌ Failed to execute scheduled ${msgData.commandName}: ${err.message}` });
            return { success: false, error: err };
        }

        if (msgData.recurring && msgData.recurring !== "none") {
            await scheduleNextRecurring(client, guild.id, msgData);
        }

        return { success: true };
    } catch (err) {
        console.error(`Error in executeScheduledCommand:`, err);
        return { success: false, error: err };
    }
}

async function scheduleNextRecurring(client, guildId, msgData) {
    try {
        const now = Math.floor(Date.now() / 1000);
        let nextTimestamp = null;
        let interval = null;

        switch (msgData.recurring) {
            case "daily":
                interval = 86400;
                break;
            case "weekly":
                interval = 604800;
                break;
            case "monthly":
                interval = 2592000;
                break;
            default:
                if (msgData.recurring.startsWith("cron:")) {
                    const cronParts = msgData.recurring.slice(5).trim().split(/\s+/);
                    if (cronParts.length === 5) {
                        const minField = cronParts[0];
                        if (minField === '*') {
                            interval = 600;
                        } else if (minField.startsWith('*/')) {
                            const step = parseInt(minField.slice(2), 10);
                            interval = Math.max(step, 10) * 60;
                        } else {
                            interval = 3600;
                        }
                    } else {
                        interval = 86400;
                    }
                }
                break;
        }

        if (!interval) return;

        nextTimestamp = msgData.timestamp + interval;

        while (nextTimestamp <= now) {
            nextTimestamp += interval;
        }

        const guildData = await client.database.getGuild(guildId);
        const updatedMessages = guildData.scheduledMessages?.map(m => {
            if (m.id === msgData.id) {
                return {
                    ...m,
                    timestamp: nextTimestamp,
                    sendCount: (m.sendCount || 0) + 1,
                };
            }
            return m;
        });

        await client.database.updateGuild(guildId, { scheduledMessages: updatedMessages }, true);

        removeFromQueue(guildId, msgData.id);
        if (nextTimestamp <= windowEndTime) {
            const updatedMsgData = { ...msgData, timestamp: nextTimestamp, sendCount: (msgData.sendCount || 0) + 1 };
            addToQueue(guildId, updatedMsgData);
        }
    } catch (err) {
        console.error(`Error scheduling next recurring:`, err);
    }
}

async function processQueue(guildId, msgId) {
    const queueKey = `${guildId}:${msgId}`;
    scheduledQueue.delete(queueKey);

    try {
        const guildData = await clientRef.database.getGuild(guildId, false);
        if (!guildData) return;

        const msgData = guildData.scheduledMessages.find(m => m.id === msgId);
        if (!msgData) return;

        const result = await sendScheduledMessage(clientRef, guildId, msgData);

        if (result.success) {
            if (!msgData.recurring || msgData.recurring === "none") {
                const updated = guildData.scheduledMessages.filter(m => m.id !== msgId);
                if (updated.length !== guildData.scheduledMessages.length) {
                    await clientRef.database.updateGuild(guildId, { scheduledMessages: updated }, true);
                }
            }
        } else {
            if (!msgData.recurring || msgData.recurring === "none") {
                console.error(`Failed to send scheduled message ${msgId} in guild ${guildId}`);
            }
        }
    } catch (err) {
        console.error(`Error processing queue for ${msgId}:`, err);
    }
}

function addToQueue(guildId, msgData) {
    const now = Date.now();
    const msgTime = msgData.timestamp * 1000;
    const queueKey = `${guildId}:${msgData.id}`;

    if (scheduledQueue.has(queueKey)) {
        const existing = scheduledQueue.get(queueKey);
        if (existing.timeout) {
            clearTimeout(existing.timeout);
        }
    }

    const delay = msgTime - now;

    if (delay <= 0) {
        if (!scheduledQueue.has(queueKey)) {
            processQueue(guildId, msgData.id);
        }
        return;
    }

    const timeout = setTimeout(() => {
        processQueue(guildId, msgData.id);
    }, delay);

    scheduledQueue.set(queueKey, {
        timeout,
        guildId,
        msgId: msgData.id,
        timestamp: msgData.timestamp
    });
}

function removeFromQueue(guildId, msgId) {
    const queueKey = `${guildId}:${msgId}`;
    const queued = scheduledQueue.get(queueKey);

    if (queued && queued.timeout) {
        clearTimeout(queued.timeout);
    }

    scheduledQueue.delete(queueKey);
}

async function loadQueue() {
    if (!clientRef) return;

    const now = Math.floor(Date.now() / 1000);
    windowEndTime = now + TWELVE_HOURS_SECONDS;

    for (const [key, value] of scheduledQueue) {
        if (value.timeout) {
            clearTimeout(value.timeout);
        }
    }
    scheduledQueue.clear();

    try {
        const db = clientRef.database;
        const allGuilds = await db.guildModel.find({
            "scheduledMessages.0": { $exists: true },
            "scheduledMessages.timestamp": { $lte: windowEndTime, $gt: now }
        });

        for (const guildData of allGuilds) {
            const guildId = guildData.id;
            const upcomingMessages = guildData.scheduledMessages.filter(m => m.timestamp <= windowEndTime && m.timestamp > now);

            for (const msgData of upcomingMessages) {
                addToQueue(guildId, msgData);
            }
        }

        const pastDueGuilds = await db.guildModel.find({
            "scheduledMessages.0": { $exists: true },
            "scheduledMessages.timestamp": { $lte: now }
        });

        for (const guildData of pastDueGuilds) {
            const guildId = guildData.id;
            const pastDueMessages = guildData.scheduledMessages.filter(m => m.timestamp <= now);

            for (const msgData of pastDueMessages) {
                const queueKey = `${guildId}:${msgData.id}`;
                if (!scheduledQueue.has(queueKey)) {
                    processQueue(guildId, msgData.id);
                }
            }
        }
    } catch (err) {
        console.error(`Error loading schedule queue:`, err);
    }
}

function handleNew(guildId, msgData) {
    const now = Math.floor(Date.now() / 1000);
    const queueKey = `${guildId}:${msgData.id}`;

    if (scheduledQueue.has(queueKey)) return;

    if (msgData.timestamp <= now) {
        processQueue(guildId, msgData.id);
    } else if (msgData.timestamp <= windowEndTime) {
        addToQueue(guildId, msgData);
    }
}

function handleDelete(guildId, msgId) {
    removeFromQueue(guildId, msgId);
}

function handleEdit(guildId, msgId, updatedData) {
    removeFromQueue(guildId, msgId);
    const now = Math.floor(Date.now() / 1000);
    const queueKey = `${guildId}:${updatedData.id}`;

    if (scheduledQueue.has(queueKey)) return;

    if (updatedData.timestamp <= now) {
        processQueue(guildId, updatedData.id);
    } else if (updatedData.timestamp <= windowEndTime) {
        addToQueue(guildId, updatedData);
    }
}

function getRemainingWindowMs() {
    const now = Date.now();
    const windowEndMs = windowEndTime * 1000;
    return Math.max(0, windowEndMs - now);
}

function getQueueStatus() {
    return {
        queueSize: scheduledQueue.size,
        windowEndTime,
        remainingWindowMs: getRemainingWindowMs()
    };
}

function startCron(client) {
    clientRef = client;

    if (refreshCronJob) {
        refreshCronJob.stop();
    }

    loadQueue();

    refreshCronJob = cron.schedule("0 */12 * * *", async () => {
        await loadQueue();
    });
}

function stopCron() {
    if (refreshCronJob) {
        refreshCronJob.stop();
        refreshCronJob = null;
    }

    for (const [key, value] of scheduledQueue) {
        if (value.timeout) {
            clearTimeout(value.timeout);
        }
    }
    scheduledQueue.clear();
    clientRef = null;
}

module.exports = {
    startCron,
    stopCron,
    handleNew,
    handleDelete,
    handleEdit,
    loadQueue,
    addToQueue,
    removeFromQueue,
    processQueue,
    sendScheduledMessage,
    getQueueStatus,
    getRemainingWindowMs,
};