const cron = require("node-cron");
const color = require("./colorCodes");

const FLUXERLIST_API = "https://fluxerlist.com/api/bots";
const STATS_INTERVAL = "0 */2 * * *";

let refreshCronJob = null;
let clientRef = null;

async function pushStats(client) {
    const token = process.env.FLUXERLIST;
    const botId = client?.user?.id || process.env.BOTID;
    const serverCount = client?.guilds?.size ?? 0;

    try {
        const res = await fetch(`${FLUXERLIST_API}/${botId}/stats`, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${token}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ serverCount }),
        });

        if (!res.ok) {
            const text = await res.text().catch(() => "");
            console.log(color("%", `%4[FluxerList]%7 :: Stats update rejected (${res.status}) :: ${String(text).slice(0, 200)}`));
            return false;
        }

        await res.json().catch(() => null);
        console.log(color("%", `%2[FluxerList]%7 :: Updated stats :: ${serverCount} server(s)`));
        return true;
    } catch (err) {
        console.log(color("%", `%4[FluxerList]%7 :: Stats update failed :: ${err}`));
        return false;
    }
}

function startCron(client) {
    clientRef = client;

    if (refreshCronJob) {
        refreshCronJob.stop();
    }

    pushStats(client);

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

module.exports = { startCron, stopCron, pushStats };
