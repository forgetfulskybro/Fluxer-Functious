const db = require("../models/guilds");
async function checkRoles(client) {
  let rr = await db.find({ $expr: { $gt: [{ $size: "$roles" }, 0] } });
  if (!rr || rr.length === 0) return;
  let i = 0;
  let ii = 0;
  for (let r of rr) {
    i++;
    setTimeout(async () => {
      r.roles.map((role) => {
        ii++;
        setTimeout(async () => {
          try {
            let channel = await client.channels.resolve(role.chanId);
            channel?.messages?.fetch(role.msgId);
          } catch {
            await client.database.updateGuild(r.id, {
              roles: r.roles.filter((e) => e.msgId !== role.msgId),
            });
          }
          
          if (role.roles.length === 0) {
            return await client.database.updateGuild(r.id, {
              roles: r.roles.filter((e) => e.msgId !== role.msgId),
            });
          }
        }, ii * 700);
      });
    }, i * 600);
  }
}

module.exports = checkRoles;
