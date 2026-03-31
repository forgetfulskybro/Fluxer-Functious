const { EmbedBuilder, PermissionFlags } = require("@fluxerjs/core");
const regex = /^<#(?<id>[A-Z0-9]+)>/;
const pick = ["content", "embed"];
const Paginator = require("../functions/pagination");
const ROLE_LINE_PATTERN = /(?:[\p{Emoji_Presentation}\p{Extended_Pictographic}]|<:[a-zA-Z0-9_]+:\d+>)\s*(\w+)/gu;

function extractRolesAndReplace(text) {
    const replacements = [];
    let match;

    while ((match = ROLE_LINE_PATTERN.exec(text)) !== null) {
        const fullMatch = match[0];
        const role = match[1];

        replacements.push({
            search: fullMatch,
            replace: `{role:${role}}`
        });
    }

    let result = text;
    replacements
        .sort((a, b) => b.search.length - a.search.length)
        .forEach(({ search, replace }) => {
            result = result.replace(search, replace);
        });

    return result;
}

module.exports = {
    config: {
        name: "roles",
        usage: true,
        cooldown: 7000,
        available: true,
        permissions: { name: "Manage Guild", bitField: PermissionFlags.ManageGuild },
        aliases: ["reactionroles", "reactions", "reactroles", "reactionrole", "rr"],
    },
    run: async (client, message, args, db) => {
      const me = (message.guild?.members.me ?? (message.guild ? await message.guild.members.fetchMe() : null));
        if (!me.permissions.has(PermissionFlags.ManageRoles)) return message.reply({ embeds: [new EmbedBuilder().setDescription(`${client.translate.get(db.language, "Commands.roles.noPerms")}`).setColor(`#FF0000`)] });

        switch (args[0]?.toLowerCase()) {
            default: "help"
            case "help":
                const embed = new EmbedBuilder()
                    .setColor(`#A52F05`)
                    .setDescription(`**${client.translate.get(db.language, "Commands.roles.view")} ${client.translate.get(db.language, "Commands.roles.usage").replace("h", "H")}**\n\n**${client.translate.get(db.language, "Commands.roles.explain")}**\n${client.translate.get(db.language, "Commands.roles.explain2", { "prefix": db.prefix })}\n\n**${client.translate.get(db.language, "Commands.roles.create")}**\n\`${db.prefix}roles ${client.translate.get(db.language, "Commands.roles.createExample", { "type": "content | embed" })}\`\n\n**${client.translate.get(db.language, "Commands.roles.editing")}**\n\`${db.prefix}roles edit [${client.translate.get(db.language, "Commands.roles.msgId")} ID, e.g. ${message.id}]\`\n\n**${client.translate.get(db.language, "Commands.roles.viewing")}**\n\`${db.prefix}roles view\`\n\n**${client.translate.get(db.language, "Commands.roles.deleting")}**\n\`${db.prefix}roles delete [${client.translate.get(db.language, "Commands.roles.msgId")} ID, e.g. ${message.id}]\`\n\n**${client.translate.get(db.language, "Commands.roles.reactionFix")}**\n${client.translate.get(db.language, "Commands.roles.reactionFixExplain")}\n\`${db.prefix}roles fix [${client.translate.get(db.language, "Commands.roles.msgId")} ID, e.g. ${message.id}]\`\n\n**${client.translate.get(db.language, "Commands.roles.dm")}**\n\`${db.prefix}roles dm\``)

                setTimeout(() => client.used.delete(`${message.author.id}-roles`), 6000)
                message.reply({ embeds: [embed] })
                break;

            case "view":
                if (db.roles.length === 0) return message.reply({ embeds: [new EmbedBuilder().setDescription(`${client.translate.get(db.language, "Commands.roles.noRoles")}: \`${db.prefix}roles\``).setColor(`#FF0000`)] });
                const pages = new Paginator({ timeout: 5 * 2e4, user: message.author.id, client: client })
                let data;
                data = db.roles.map((msg, i) => `**ID**: ${msg.msgId}\n**${client.translate.get(db.language, "Commands.roles.roles")}**: ${msg.roles.length}\n[${client.translate.get(db.language, "Commands.roles.jump")}](https://fluxer.app/channels/${message.guildId}/${msg.chanId}/${msg.msgId})`);
                data = Array.from({ length: Math.ceil(data.length / 3) }, (a, r) => data.slice(r * 3, r * 3 + 3));
                Math.ceil(data.length / 3);
                data = data.map(e => pages.add(new EmbedBuilder().setDescription(`${client.translate.get(db.language, "Commands.roles.view")}\n\n${e.slice(0, 3).join("\n\n")}`).setColor("#A52F05")))
            
                setTimeout(() => client.used.delete(`${message.author.id}-roles`), 6000)
                pages.start(message.channel);
                break;

            case "delete":
              if (!args[1]) return message.reply({ embeds: [new EmbedBuilder().setDescription(`${client.translate.get(db.language, "Commands.roles.delete")}: \`${db.prefix}roles delete <messageId>\``).setColor(`#FF0000`)] });

              const msg = db.roles.find(e => e.msgId === args[1]);
              if (!msg) return message.reply({ embeds: [new EmbedBuilder().setDescription(`${client.translate.get(db.language, "Commands.roles.notFound")}`).setColor(`#FF0000`)] });

              try {
              const foundMsg = await (await client.channels.resolve(msg.chanId))?.messages?.fetch(msg.msgId);
              foundMsg?.delete();
              } catch { };
              await client.database.updateGuild(message.guildId, { roles: db.roles.filter(e => e.msgId !== args[1]) });
            
              setTimeout(() => client.used.delete(`${message.author.id}-roles`), 6000)
              message.reply({ embeds: [new EmbedBuilder().setDescription(`${client.translate.get(db.language, "Commands.roles.deleted")}`).setColor(`#A52F05`)] });
                break;
                
            case "fix":
            case "reactionsfix":
            case "reactionfix":
              if (!args[1]) return message.reply({ embeds: [new EmbedBuilder().setDescription(`${client.translate.get(db.language, "Commands.roles.fix")}:\n\`${db.prefix}roles fix <messageId>\``).setColor(`#FF0000`)] });
              if (!me.permissions.has(PermissionFlags.ManageMessages)) return message.reply({ embeds: [new EmbedBuilder().setDescription(client.translate.get(db.language, "Commands.roles.noPerms2")).setColor(`#FF0000`)] });

              const reactMsg = db.roles.find(e => e.msgId === args[1]);
              if (!reactMsg) return message.reply({ embeds: [new EmbedBuilder().setDescription(`${client.translate.get(db.language, "Commands.roles.notFound")}`).setColor(`#FF0000`)] });
              
              try {
              const foundFixMsg = await (await client.channels.resolve(reactMsg.chanId))?.messages?.fetch(reactMsg.msgId);
              await foundFixMsg.removeAllReactions();
              
              for (const reaction of reactMsg.roles) {
                  await foundFixMsg.react(reaction.emoji).catch(() => {});
              }
              } catch {
                return message.reply({ embeds: [new EmbedBuilder().setDescription(`${client.translate.get(db.language, "Commands.roles.reactionFixError")}`).setColor(`#FF0000`)] });
              }
            
              setTimeout(() => client.used.delete(`${message.author.id}-roles`), 6000)
              message.reply({ embeds: [new EmbedBuilder().setDescription(`${client.translate.get(db.language, "Commands.roles.reactionFixSuccess", { "message": `[${args[1]}](https://fluxer.app/channels/${db.id}/${reactMsg.chanId}/${reactMsg.msgId})` })}`).setColor(`#A52F05`)] });
                break;
          
            case "dm":
            case "dms":
              const dms = db.dm;
              await client.database.updateGuild(message.guildId, { dm: !dms });
            
              setTimeout(() => client.used.delete(`${message.author.id}-roles`), 6000)
              message.reply({ embeds: [new EmbedBuilder().setDescription(`${client.translate.get(db.language, "Commands.roles.dms")} **${dms ? client.translate.get(db.language, "Commands.roles.off") : client.translate.get(db.language, "Commands.roles.on")}**`).setColor(`#A52F05`)] });
                break;

            case "edit":
              if (client.messageCollector.has(message.author.id) || client.messageEdit.has(message.author.id)) return message.reply({ embeds: [new EmbedBuilder().setDescription(`${client.translate.get(db.language, "Commands.roles.already")}`).setColor(`#FF0000`)] });
              if (db.roles.length === 0) return message.reply({ embeds: [new EmbedBuilder().setDescription(`${client.translate.get(db.language, "Commands.roles.noRoles")}: \`${db.prefix}roles\``).setColor(`#FF0000`)] });
              if (!args[1]) return message.reply({ embeds: [new EmbedBuilder().setDescription(`${client.translate.get(db.language, "Commands.roles.edit")}: \`${db.prefix}roles edit <messageId>\``).setColor(`#FF0000`)] });

              const editmsg = db.roles.find(e => e.msgId === args[1]);
              if (!editmsg) return message.reply({ embeds: [new EmbedBuilder().setDescription(`${client.translate.get(db.language, "Commands.roles.notFound")}`).setColor(`#FF0000`)] });

              let type;
              const fetched = await (await client.channels.resolve(editmsg.chanId))?.messages?.fetch(editmsg.msgId);
              if (fetched.content.length > 0) type = "content"
              else type = "embed"

              let startText = extractRolesAndReplace(fetched.content);
              const editcoll = await client.messageEdit.set(message.author.id, {
                user: message.author.id,
                timeout: null,
                oldMessageId: fetched.id,
                botMessage: null,
                messageId: null,
                channelId: editmsg.chanId,
                type: type,
                rolesDone: [],
                roles: [],
                regex: [],
              });

              const edittimeout = setTimeout(async () => {
                if (!client.messageEdit.has(editcoll.user)) return;
                const ended = new EmbedBuilder().setDescription(`${client.translate.get(db.language, "Commands.roles.ended")}`).setColor(`#FF0000`);
                await (await client.channels.resolve(client.messageEdit.get(editcoll.user).channelId))?.messages?.fetch(client.messageEdit.get(editcoll.user).messageId)?.edit({ embeds: [ended] }).catch(() => { });
                client.messageEdit.delete(editcoll.user);
              }, 1500000);
            
              client.messageEdit.get(message.author.id).timeout = edittimeout;
              setTimeout(() => client.used.delete(`${message.author.id}-roles`), 6000)

              await message.guild.fetchChannels();
              const editchan = message.guild.channels.find(e => e.id === editmsg.chanId);
              if (editchan.id !== message.channel.id) {
                message.reply(`${client.translate.get(db.language, "Commands.roles.success")} <#${editchan.id}>`, { ping: false });
                await editchan.send({ embeds: [new EmbedBuilder().setDescription(`${client.translate.get(db.language, "Commands.roles.react")}\n\n\`\`\`txt\n${startText}\n\`\`\``).setColor(`#A52F05`)] })
                  .then(async (msg) => {
                    await msg.react(client.config.emojis.cross);
                    client.messageEdit.get(message?.author.id).botMessage = msg.id
                  });
              } else {
                await message.channel.send({ embeds: [new EmbedBuilder().setDescription(`${client.translate.get(db.language, "Commands.roles.react", {
                  "example": `\`\`\`
  **This is an example message**
  
  Color Roles:
  {role:Blue}
  {role:Red}
  {role:Purple}
  \`\`\`
  ` })}\n\n\`\`\`txt\n${startText}\n\`\`\``).setColor(`#A52F05`)] })
                  .then(async (msg) => {
                    await msg.react(client.config.emojis.check);
                    await msg.react(client.config.emojis.cross);
                    client.messageEdit.get(message?.author.id).botMessage = msg.id;
                  });
                }
                break;

            case "create":
              if (client.messageCollector.has(message.author.id)) return message.reply({ embeds: [new EmbedBuilder().setDescription(`${client.translate.get(db.language, "Commands.roles.already")}`).setColor(`#FF0000`)] });
              if (db.roles.length > 12) return message.reply({ embeds: [new EmbedBuilder().setDescription(`${client.translate.get(db.language, "Commands.roles.max")}`).setColor(`#FF0000`)] });

              let channel = message.channel;
              let content = args.slice(1).join(" ");

               if (regex.test(content)) {
                channel = message.guild.channels.find(e => e.id === content.match(regex).groups.id);

                if (!channel) return message.reply({ embeds: [new EmbedBuilder().setDescription(`${client.translate.get(db.language, "Commands.giveaway.validChannel")}: \`${db.prefix}roles (content OR embed) <#${channel.id}>\``).setColor(`#FF0000`)] });
                const chanPerms = me.permissionsIn(channel);
                if (!chanPerms.has(PermissionFlags.SendMessages)) return message.reply({ embeds: [new EmbedBuilder().setDescription(`${client.translate.get(db.language, "Commands.giveaway.noperms")}`).setColor(`#FF0000`)] });
                if (!chanPerms.has(PermissionFlags.ViewChannel)) return message.reply({ embeds: [new EmbedBuilder().setDescription(`${client.translate.get(db.language, "Commands.giveaway.noperms2")}`).setColor(`#FF0000`)] });
                if (!chanPerms.has(PermissionFlags.AddReactions)) return message.reply({ embeds: [new EmbedBuilder().setDescription(`${client.translate.get(db.language, "Commands.giveaway.noperms3")}`).setColor(`#FF0000`)] });
              }

              const picked = pick.map(e => content.includes(e));
              if (picked.filter(e => e).length === 2) return message.reply({ embeds: [new EmbedBuilder().setDescription(`${client.translate.get(db.language, "Commands.roles.pick")}\n\n${client.translate.get(db.language, "Commands.language.example")}: ${db.prefix}roles content <#${channel.id}>\n${client.translate.get(db.language, "Commands.language.example")}: ${db.prefix}roles embed <#${channel.id}>`).setColor(`#FF0000`)] });
              
              await message.delete().catch(() => {});
              
              const rr = new EmbedBuilder().setDescription(client.translate.get(db.language, "Commands.roles.react", {
                "example": `\`\`\`
**This is an example message**

Color Roles:
{role:Blue}
{role:Red}
{role:Purple}
\`\`\`
` })).setColor(`#A52F05`);
            
              if (channel.id !== message.channel.id) {
                message.reply(`${client.translate.get(db.language, "Commands.roles.success")} <#${channel.id}>`, { ping: false });
                await channel.send({ embeds: [rr]
              })
                  .then(async (msg) => { 
                    await msg.react(client.config.emojis.check);
                    await msg.react(client.config.emojis.cross);
                    const coll = await client.messageCollector.set(message.author.id, {
                      user: message.author.id,
                      timeout: null,
                      oldMessageId: msg.id,
                      messageId: null,
                      channelId: channel.id,
                      type: pick[picked.indexOf(true)] || "content",
                      rolesDone: [],
                      roles: [],
                      regex: [],
                    });
      
                    const timeout = setTimeout(async () => {
                      if (!client.messageCollector.has(coll.user)) return;
                      const ended = new EmbedBuilder().setDescription(`${client.translate.get(db.language, "Commands.roles.ended")}`).setColor(`#FF0000`);
                      try {
                        const newMsg = await (await client.channels.resolve(client.messageCollector.get(coll.user).channelId))?.messages?.fetch(client.messageCollector.get(coll.user).messageId).catch(() => { });
                        newMsg?.edit({ embeds: [ended] }).catch(() => { });
                      } catch {}
                      client.messageCollector.delete(coll.user);
                    }, 600000);
                  
                    client.messageCollector.get(message.author.id).timeout = timeout;
                    setTimeout(() => client.used.delete(`${message.author.id}-roles`), 6000)
                  });
              } else {
                await message.channel.send({
                  embeds: [rr]
                })
                  .then(async (msg) => {
                    await msg.react(client.config.emojis.check);
                    await msg.react(client.config.emojis.cross);
                    const coll = await client.messageCollector.set(message.author.id, {
                      user: message.author.id,
                      timeout: null,
                      oldMessageId: msg.id,
                      messageId: null,
                      channelId: channel.id,
                      type: pick[picked.indexOf(true)] || "content",
                      rolesDone: [],
                      roles: [],
                      regex: [],
                    });
      
                    const timeout = setTimeout(async () => {
                      if (!client.messageCollector.has(coll.user)) return;
                      const ended = new EmbedBuilder().setDescription(`${client.translate.get(db.language, "Commands.roles.ended")}`).setColor(`#FF0000`);
                      const newMsg = await (await client.channels.resolve(client.messageCollector.get(coll.user).channelId))?.messages?.fetch(client.messageCollector.get(coll.user).messageId).catch(() => { });
                      newMsg?.edit({ embeds: [ended] }).catch(() => { });
                      client.messageCollector.delete(coll.user);
                    }, 1500000);
                  
                    client.messageCollector.get(message.author.id).timeout = timeout;
                    setTimeout(() => client.used.delete(`${message.author.id}-roles`), 6000)
                  });
              }
            break;
        }
    }
};
