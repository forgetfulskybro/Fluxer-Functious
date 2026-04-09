const cron = require("node-cron");
const db = require("../models/users");

let cronJob = null;

function formatTimeWithTimezone(timestamp) {
    return `<t:${timestamp}:f>`;
}

async function sendGuildReminderWithRetry(client, channelId, userId, message, createdAt, maxRetries = 3) {
    const timestampText = formatTimeWithTimezone(createdAt);
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const channel = await client.channels.fetch(channelId);
            if (channel) {
                await channel.send(`<@${userId}>, reminder from ${timestampText}: ${message}`);
                return { success: true };
            }
        } catch (err) {
            if (attempt === maxRetries) {
                return { success: false, error: err };
            }
            await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
        }
    }
    return { success: false };
}

async function sendDMReminderWithRetry(client, userId, message, createdAt, maxRetries = 3) {
    const timestampText = formatTimeWithTimezone(createdAt);
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const user = await client.users.fetch(userId);
            if (user) {
                await user.createDM().then((u) => u.send(`<@${userId}>, reminder from ${timestampText}: ${message}`));
                return { success: true };
            }
        } catch (err) {
            if (attempt === maxRetries) {
                return { success: false, error: err };
            }
            await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
        }
    }
    return { success: false };
}

async function processDueReminders(client) {
    const usersWithReminders = await db.find({ "reminders.0": { $exists: true } });
    if (!usersWithReminders?.length) return;

    const nowSeconds = Math.floor(Date.now() / 1000);

    for (const userData of usersWithReminders) {
        const userId = userData.userId;
        const dueReminders = userData.reminders.filter(r => r.timestamp <= nowSeconds);

        if (dueReminders.length === 0) continue;

        for (const reminder of dueReminders) {
            if (reminder.type === "guild") {
                await sendGuildReminderWithRetry(client, reminder.channelId, userId, reminder.message, reminder.createdAt);
            } else {
                await sendDMReminderWithRetry(client, userId, reminder.message, reminder.createdAt);
            }
        }

        try {
            const remainingReminders = userData.reminders.filter(r => r.timestamp > nowSeconds);
            await client.database.updateUser(userId, { reminders: remainingReminders }, true);
        } catch (err) {
        }
    }
}

function startReminderCron(client) {
    if (cronJob) {
        cronJob.stop();
    }

    cronJob = cron.schedule("*/5 * * * * *", async () => {
        await processDueReminders(client);
    });
}

function stopReminderCron() {
    if (cronJob) {
        cronJob.stop();
        cronJob = null;
    }
}

module.exports = {
    sendGuildReminderWithRetry,
    sendDMReminderWithRetry,
    startReminderCron,
    stopReminderCron,
};
