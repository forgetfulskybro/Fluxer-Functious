const { EmbedBuilder, PermissionFlags } = require("@fluxerjs/core");
const { inspect } = require("util");
module.exports = {
  config: {
    name: "eval",
    cooldown: 1000,
    permissions: {},
    available: "Owner",
    aliases: ["e"],
  },
  run: async (client, message, args) => {
    if (!client.config.owners.includes(message.author.id)) return;
    try {
      let codein = args.join(" ");
      if (!args[0]) return message.reply("Send me code.", false);
      if (codein === "client.rest") {
        return message.reply(`\`\`\`js\nnull`, false);
      }

      let code = await eval(codein);
      if (typeof code !== "string") {
        if (code && typeof code.session === "string") code.session = null;
        if (code && typeof code.vapid === "string") code.vapid = null;
        if (code && typeof code.connectionString === "string")
          code.connectionString = null;
        code = inspect(code, { depth: 1 });
      }

      message.reply(`\`\`\`js\n${code}`, false).catch((e) => {
        message.reply(`\`\`\`js\n${e.message.slice(0, 1985)}\n\`\`\``, false);
      });
    } catch (e) {
      message.reply(`\`\`\`js\n${e ? e.message : "Unknown Error"}`, false);
    }
  },
};
