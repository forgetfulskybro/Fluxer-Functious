const cron = require("node-cron");
const db = require("../models/guilds");
const TWELVE_HOURS_SECONDS = 12 * 60 * 60;

let refreshCronJob = null;
let clientRef = null;

const roleQueue = new Map();
let windowEndTime = 0;

async function giveRoleWithRetry(client, guildId, userId, roleId, maxRetries = 3) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          const guild = await client.guilds.fetch(guildId);
          if (!guild) return { success: false, error: "Guild not found" };

          let member = await guild.members.fetch(userId);
          member = await guild.members.get(userId);
          if (!member) return { success: false, error: "Member not found" };

            await member.roles.add(roleId);
            return { success: true };
        } catch (err) {
            if (attempt === maxRetries) {
                return { success: false, error: err };
            }
            await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
        }
    }
    return { success: false };
}

async function processQueue(guildId, userId, roleId) {
    const queueKey = `${guildId}:${userId}:${roleId}`;
    roleQueue.delete(queueKey);

    await giveRoleWithRetry(clientRef, guildId, userId, roleId);

    try {
        const guildData = await db.findOne({ id: guildId });
        if (!guildData) return;

        const userEntry = guildData.usersJoined?.find(u => u.userId === userId);
        if (!userEntry) return;

        const updatedRoles = userEntry.roleIds?.filter(r => r.id !== roleId) || [];
        const otherUsers = guildData.usersJoined.filter(u => u.userId !== userId);

        let updatedUsersJoined = otherUsers;
        if (updatedRoles.length > 0) {
            updatedUsersJoined.push({ userId, roleIds: updatedRoles });
        }

        await clientRef.database.updateGuild(guildId, { usersJoined: updatedUsersJoined }, true);
    } catch (err) {
    }
}

function addToQueue(guildId, userId, role) {
    const now = Date.now();
    const roleTime = Number(role.time);
    const queueKey = `${guildId}:${userId}:${role.id}`;

    if (roleQueue.has(queueKey)) {
        const existing = roleQueue.get(queueKey);
        if (existing.timeout) {
            clearTimeout(existing.timeout);
        }
    }

    const delay = roleTime - now;

    if (delay <= 0) {
        processQueue(guildId, userId, role.id);
        return;
    }

    const timeout = setTimeout(() => {
        processQueue(guildId, userId, role.id);
    }, delay);

    roleQueue.set(queueKey, {
        timeout,
        guildId,
        userId,
        roleId: role.id,
        timestamp: Math.floor(roleTime / 1000),
    });
}

function removeFromQueue(guildId, userId, roleId) {
    const queueKey = `${guildId}:${userId}:${roleId}`;
    const queued = roleQueue.get(queueKey);

    if (queued && queued.timeout) {
        clearTimeout(queued.timeout);
    }

    roleQueue.delete(queueKey);
}

async function loadQueue() {
    if (!clientRef) return;

    const now = Math.floor(Date.now() / 1000);
    windowEndTime = now + TWELVE_HOURS_SECONDS;

    for (const [key, value] of roleQueue) {
        if (value.timeout) {
            clearTimeout(value.timeout);
        }
    }
    roleQueue.clear();

    try {
        const currentTime = Date.now();
        const windowEndMs = windowEndTime * 1000;

        const guildsWithUsers = await db.find({ "usersJoined.0": { $exists: true } });

        for (const guildData of guildsWithUsers) {
            const guildId = guildData.id;

            for (const userEntry of guildData.usersJoined) {
                const dueRoles = userEntry.roleIds?.filter(r => {
                    const t = Number(r.time);
                    return t <= windowEndMs;
                }) || [];

                for (const role of dueRoles) {
                    addToQueue(guildId, userEntry.userId, role);
                }
            }
        }
    } catch (err) {
    }
}

function handleNew(guildId, userId, role) {
    const now = Date.now();
    const roleTime = Number(role.time);

    if (roleTime <= windowEndTime * 1000 && roleTime > now) {
        addToQueue(guildId, userId, role);
    }
}

function handleDelete(guildId, userId, roleId) {
    removeFromQueue(guildId, userId, roleId);
}

function getStatus() {
    return {
        queueSize: roleQueue.size,
        windowEndTime,
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

    for (const [key, value] of roleQueue) {
        if (value.timeout) {
            clearTimeout(value.timeout);
        }
    }
    roleQueue.clear();
    clientRef = null;
}

module.exports = {
    giveRoleWithRetry,
    startCron,
    stopCron,
    handleNew,
    handleDelete,
    getStatus,
};