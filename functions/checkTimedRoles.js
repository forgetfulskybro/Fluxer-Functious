const cron = require("node-cron");
const db = require("../models/guilds");

let cronJob = null;

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

async function processDueTimedRoles(client) {
    const guildsWithUsers = await db.find({ "usersJoined.0": { $exists: true } });
    if (!guildsWithUsers?.length) return;

    const now = Date.now();

    for (const guildData of guildsWithUsers) {
        const guildId = guildData.id;
        let updatedUsersJoined = [];
        let usersToRemove = [];

        for (const userEntry of guildData.usersJoined) {
            const dueRoles = userEntry.roleIds?.filter(r => r.time <= now) || [];
            const pendingRoles = userEntry.roleIds?.filter(r => r.time > now) || [];

            for (const role of dueRoles) {
              await giveRoleWithRetry(client, guildId, userEntry.userId, role.id);
            }

            if (pendingRoles.length > 0) {
                updatedUsersJoined.push({
                    userId: userEntry.userId,
                    roleIds: pendingRoles
                });
            }
        }

        try {
            await client.database.updateGuild(guildId, { usersJoined: updatedUsersJoined }, true);
        } catch (err) {
        }
    }
}

function startTimedRolesCron(client) {
    if (cronJob) {
        cronJob.stop();
    }

    cronJob = cron.schedule("*/5 * * * * *", async () => {
        await processDueTimedRoles(client);
    });
}

function stopTimedRolesCron() {
    if (cronJob) {
        cronJob.stop();
        cronJob = null;
    }
}

module.exports = {
    giveRoleWithRetry,
    startTimedRolesCron,
    stopTimedRolesCron,
};
