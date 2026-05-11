const cron = require("node-cron");
const db = require("../models/users");

const TWELVE_HOURS_MS = 12 * 60 * 60 * 1000;
const TWELVE_HOURS_SECONDS = 12 * 60 * 60;

let refreshCronJob = null;
let clientRef = null;

const reminderQueue = new Map();
let windowEndTime = 0;

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

async function deleteReminderFromDB(userId, reminderId) {
    try {
        if (!clientRef || !clientRef.database) return;

        const userData = await db.findOne({ userId });
        if (!userData) return;

        const updatedReminders = userData.reminders.filter(r => r.id !== reminderId);
        if (updatedReminders.length !== userData.reminders.length) {
            await clientRef.database.updateUser(userId, { reminders: updatedReminders }, true);
        }
    } catch (err) {
    }
}

async function processReminder(client, userId, reminder) {
    const queueKey = `${userId}:${reminder.id}`;

    reminderQueue.delete(queueKey);

    if (reminder.type === "guild") {
        await sendGuildReminderWithRetry(client, reminder.channelId, userId, reminder.message, reminder.createdAt);
    } else {
        await sendDMReminderWithRetry(client, userId, reminder.message, reminder.createdAt);
    }

    await deleteReminderFromDB(userId, reminder.id);
}

function addReminderToQueue(userId, reminder) {
    const now = Date.now();
    const reminderTime = reminder.timestamp * 1000;
    const queueKey = `${userId}:${reminder.id}`;

    if (reminderQueue.has(queueKey)) {
        const existing = reminderQueue.get(queueKey);
        if (existing.timeout) {
            clearTimeout(existing.timeout);
        }
    }

    const delay = reminderTime - now;

    if (delay <= 0) {
        processReminder(clientRef, userId, reminder);
        return;
    }

    const timeout = setTimeout(() => {
        processReminder(clientRef, userId, reminder);
    }, delay);

    reminderQueue.set(queueKey, {
        timeout,
        userId,
        reminderId: reminder.id,
        timestamp: reminder.timestamp
    });
}

function removeReminderFromQueue(userId, reminderId) {
    const queueKey = `${userId}:${reminderId}`;
    const queued = reminderQueue.get(queueKey);

    if (queued && queued.timeout) {
        clearTimeout(queued.timeout);
    }

    reminderQueue.delete(queueKey);
}

async function loadRemindersIntoQueue() {
    if (!clientRef) return;

    const now = Math.floor(Date.now() / 1000);
    windowEndTime = now + TWELVE_HOURS_SECONDS;

    for (const [key, value] of reminderQueue) {
        if (value.timeout) {
            clearTimeout(value.timeout);
        }
    }
    reminderQueue.clear();

    try {
        const usersWithReminders = await db.find({
            "reminders.0": { $exists: true },
            "reminders.timestamp": { $lte: windowEndTime, $gt: now }
        });

        for (const userData of usersWithReminders) {
            const userId = userData.userId;
            const upcomingReminders = userData.reminders.filter(r => r.timestamp <= windowEndTime && r.timestamp > now);

            for (const reminder of upcomingReminders) {
                addReminderToQueue(userId, reminder);
            }
        }
    } catch (err) {
    }
}

async function handleNewReminder(userId, reminder) {
    const now = Math.floor(Date.now() / 1000);

    if (reminder.timestamp <= windowEndTime && reminder.timestamp > now) {
        addReminderToQueue(userId, reminder);
    }
}

function handleDeletedReminder(userId, reminderId) {
    removeReminderFromQueue(userId, reminderId);
}

function getRemainingWindowMs() {
    const now = Date.now();
    const windowEndMs = windowEndTime * 1000;
    return Math.max(0, windowEndMs - now);
}

function getQueueStatus() {
    return {
        queueSize: reminderQueue.size,
        windowEndTime,
        remainingWindowMs: getRemainingWindowMs()
    };
}

function startReminderCron(client) {
    clientRef = client;

    if (refreshCronJob) {
        refreshCronJob.stop();
    }

    loadRemindersIntoQueue();

    refreshCronJob = cron.schedule("0 */12 * * *", async () => {
        await loadRemindersIntoQueue();
    });
}

function stopReminderCron() {
    if (refreshCronJob) {
        refreshCronJob.stop();
        refreshCronJob = null;
    }

    for (const [key, value] of reminderQueue) {
        if (value.timeout) {
            clearTimeout(value.timeout);
        }
    }
    reminderQueue.clear();
    clientRef = null;
}

module.exports = {
    sendGuildReminderWithRetry,
    sendDMReminderWithRetry,
    startReminderCron,
    stopReminderCron,
    handleNewReminder,
    handleDeletedReminder,
    getQueueStatus,
    getRemainingWindowMs,
};
