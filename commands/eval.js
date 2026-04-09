const { EmbedBuilder, PermissionFlags } = require("@erinjs/core");
const { inspect } = require("util");
const Paginator = require("../functions/pagination");

module.exports = {
  config: {
    name: "eval",
    cooldown: 1000,
    permissions: {},
    available: "Owner",
    aliases: ["e"],
  },
  run: async (client, message, args, db) => {
    if (!client.config.owners.includes(message.author.id)) return;

    try {
      let codein = args.join(" ");
      if (!args[0]) return message.reply("Send me code.", false);

      let result = await eval(codein);

      if (result && typeof result === "object") {
        const nullTokens = (obj, visited = new Set()) => {
          if (!obj || typeof obj !== "object") return obj;
          if (visited.has(obj)) return "[Circular]";

          visited.add(obj);

          if (Array.isArray(obj)) {
            return obj.map((item) => nullTokens(item, visited));
          }

          const newObj = { ...obj };

          for (const key in newObj) {
            const lowerKey = key.toLowerCase();

            if (lowerKey.includes("token") || lowerKey === "client" || lowerKey.includes("_token") || lowerKey.includes("connectionString")) {
              newObj[key] = null;
              continue;
            }

            if (newObj[key] && typeof newObj[key] === "object") {
              newObj[key] = nullTokens(newObj[key], visited);
            }
          }

          return newObj;
        };

        result = nullTokens(result);
      }

      let output;
      if (typeof result !== "string") {
        output = inspect(result, { depth: 2, maxArrayLength: 150 });
      } else {
        output = result;
      }

      if (output.includes("token") || output.includes("connectionString") || output.includes("_token")) {
        output = output
          .replace(/"token"\s*:\s*"[^"]+"/g, '"token": null')
          .replace(/"_token"\s*:\s*"[^"]+"/g, '"_token": null')
          .replace(
            /"connectionString"\s*:\s*"[^"]+"/g,
            '"connectionString": null',
          );
      }

      const prefix = "```js\n";
      const suffix = "```";
      const MAX_SAFE = 1950;

      const full = prefix + output + suffix;
      if (full.length <= 2000) {
        await message.reply(full, false);
        return;
      }

      const pages = [];
      let remaining = output;

      while (remaining.length > 0) {
        let chunk = remaining.slice(0, MAX_SAFE);
        const lastNewline = chunk.lastIndexOf("\n");
        if (lastNewline > 200) {
          chunk = chunk.slice(0, lastNewline);
        }

        let content = prefix + chunk + suffix;

        if (content.length > 2000) {
          chunk = chunk.slice(0, 1750 - prefix.length - suffix.length);
          content = prefix + chunk + suffix;
        }

        const embed = new EmbedBuilder().setDescription(content).setColor("#00FF00");
        pages.push(embed);

        remaining = remaining.slice(chunk.length);
      }

      const paginator = new Paginator({
        user: message.author.id,
        client,
        timeout: 600000,
      });

      paginator.add(pages).start(message.channel);
    } catch (e) {
      const errMsg = (e?.stack || e?.message || "Unknown Error").slice(0, 1985);
      await message.reply("```js\n" + errMsg + "```", false);
    }
  },
};