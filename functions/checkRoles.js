const db = require("../models/guilds");

async function checkRoles(client) {
  let rr;
  try {
    rr = await db.find({ $expr: { $gt: [{ $size: "$roles" }, 0] } });
  } catch {
    return;
  }
  if (!rr || rr.length === 0) return;

  for (const r of rr) {
    if (!r.roles || r.roles.length === 0) continue;

    for (const role of r.roles) {
      try {
        const channel = await client.channels.resolve(role.chanId);
        if (!channel) continue;

        await channel.messages?.fetch(role.msgId).catch(() => {});
      } catch {}

      try {
        if (!role.roles || role.roles.length === 0) {
          await client.database.updateGuild(r.id, {
            roles: r.roles.filter((e) => e.msgId !== role.msgId),
          });
        }
      } catch {}
    }
  }
}

module.exports = checkRoles;
