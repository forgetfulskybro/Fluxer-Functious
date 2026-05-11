const { EmbedBuilder, PermissionFlags } = require("@erinjs/core");
const Paginator = require("../functions/pagination");

const CHANNEL_MENTION_REGEX = /^<#(?<id>\d+)>/;
const TYPE_OPTIONS = ["content", "embed"];
const EMOJI_ESCAPE_REGEX = /[.*+?^${}()|[\]\\]/g;
const SETUP_TIMEOUT = 600000;
const COOLDOWN_MS = 7000;

function escapeRegex(str) {
    return str.replace(EMOJI_ESCAPE_REGEX, '\\$&');
}

function extractRolesAndReplace(text, roles) {
    const replacements = [];
    const processed = new Set();

    for (const roleData of roles || []) {
        const emoji = roleData.emoji;
        const roleName = roleData.name || roleData.roleName;

        if (!emoji || !roleName || processed.has(emoji)) continue;
        processed.add(emoji);

        const emojiRegex = new RegExp(
            escapeRegex(emoji) + '\\s*\\w*',
            'gi'
        );

        let match;
        while ((match = emojiRegex.exec(text)) !== null) {
            replacements.push({
                search: match[0],
                replace: `{role:${roleName}}`
            });
        }
    }

    let result = text;
    replacements
        .sort((a, b) => b.search.length - a.search.length)
        .forEach(({ search, replace }) => {
            result = result.replace(search, replace);
        });

    return result;
}

function clearCooldown(client, userId) {
    setTimeout(() => client.used.delete(`${userId}-roles`), COOLDOWN_MS);
}

module.exports = {
    config: {
        name: "roles",
        usage: "help",
        cooldown: 7000,
        available: true,
        permissions: { name: "Manage Guild", bitField: PermissionFlags.ManageGuild },
        aliases: ["reactionroles", "reactions", "reactroles", "reactionrole", "rr"],
    },
    run: async (client, message, args, db) => {
      const me = (message.guild?.members.me ?? (message.guild ? await message.guild.members.fetchMe() : null));
        if (!me.permissions.has(PermissionFlags.ManageRoles)) return message.reply({ embeds: [new EmbedBuilder().setDescription(`${client.translate.get(db.language, "Commands.roles.noPerms")}`).setColor(`#FF0000`)] });

        switch (args[0]?.toLowerCase()) {
          case "help":
          default:
            const embed = new EmbedBuilder()
              .setColor(`#A52F05`)
              .setDescription(`**${client.translate.get(db.language, "Commands.roles.view")}**\n\n**${client.translate.get(db.language, "Commands.roles.explain")}**\n${client.translate.get(db.language, "Commands.roles.explain2", { "prefix": db.prefix })}\n\n**${client.translate.get(db.language, "Commands.roles.create")}**\n\`${db.prefix}roles ${client.translate.get(db.language, "Commands.roles.createExample", { "type": "content | embed" })}\`\n\n**${client.translate.get(db.language, "Commands.roles.editing")}**\n\`${db.prefix}roles edit [${client.translate.get(db.language, "Commands.roles.msgId")} ID, e.g. ${message.id}]\`\n\n**${client.translate.get(db.language, "Commands.roles.viewing")}**\n\`${db.prefix}roles view\`\n\n**${client.translate.get(db.language, "Commands.roles.deleting")}**\n\`${db.prefix}roles delete [${client.translate.get(db.language, "Commands.roles.msgId")} ID, e.g. ${message.id}]\`\n\n**${client.translate.get(db.language, "Commands.roles.reactionFix")}**\n${client.translate.get(db.language, "Commands.roles.reactionFixExplain")}\n\`${db.prefix}roles fix [${client.translate.get(db.language, "Commands.roles.msgId")} ID, e.g. ${message.id}]\`\n\n**${client.translate.get(db.language, "Commands.roles.dm")}**\n\`${db.prefix}roles dm\`\n\n**${client.translate.get(db.language, "Commands.roles.exclusiveTitle")}**\n${client.translate.get(db.language, "Commands.roles.exclusiveExplain")}\n\`${db.prefix}roles exclusive [${client.translate.get(db.language, "Commands.roles.msgId")} ID, e.g. ${message.id}]\``)

            clearCooldown(client, message.author.id);
            message.reply({ embeds: [embed] });
             break;
                
          case "stop":
            if (!client.messageCollector.get(message.author.id)) return message.reply({ embeds: [new EmbedBuilder().setDescription(`${client.translate.get(db.language, "Commands.roles.notStarted")}`).setColor(`#FF0000`)] });
            client.messageCollector.delete(message.author.id);
            message.reply({ embeds: [new EmbedBuilder().setDescription(`${client.translate.get(db.language, "Commands.roles.stopped")}`).setColor(`#A52F05`)] });
             break;
             
          case "view":
            if (db.roles.length === 0) return message.reply({ embeds: [new EmbedBuilder().setDescription(`${client.translate.get(db.language, "Commands.roles.noRoles")}: \`${db.prefix}roles\``).setColor(`#FF0000`)] });
            const pages = new Paginator({ timeout: 5 * 2e4, user: message.author.id, client: client })
            let data;
            data = db.roles.map((msg, i) => `**ID**: ${msg.msgId}\n**${client.translate.get(db.language, "Commands.roles.roles")}**: ${msg.roles.length}${msg.exclusive ? `| **${client.translate.get(db.language, "Commands.roles.exclusiveView")}**: ${client.translate.get(db.language, "Commands.roles.on")}` : ''}\n[${client.translate.get(db.language, "Commands.roles.jump")}](https://fluxer.app/channels/${message.guildId}/${msg.chanId}/${msg.msgId})`);
            data = Array.from({ length: Math.ceil(data.length / 3) }, (a, r) => data.slice(r * 3, r * 3 + 3));
            Math.ceil(data.length / 3);
            data = data.map(e => pages.add(new EmbedBuilder().setDescription(`${client.translate.get(db.language, "Commands.roles.view")}\n\n${e.slice(0, 3).join("\n\n")}`).setColor("#A52F05")))
            
            clearCooldown(client, message.author.id);
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

          clearCooldown(client, message.author.id);
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
            
            clearCooldown(client, message.author.id);
            message.reply({ embeds: [new EmbedBuilder().setDescription(`${client.translate.get(db.language, "Commands.roles.reactionFixSuccess", { "message": `[${args[1]}](https://fluxer.app/channels/${db.id}/${reactMsg.chanId}/${reactMsg.msgId})` })}`).setColor(`#A52F05`)] });
            break;
          
          case "dm":
          case "dms":
            const dms = db.dm;
            await client.database.updateGuild(message.guildId, { dm: !dms });

            clearCooldown(client, message.author.id);
            message.reply({ embeds: [new EmbedBuilder().setDescription(`${client.translate.get(db.language, "Commands.roles.dms")} **${dms ? client.translate.get(db.language, "Commands.roles.off") : client.translate.get(db.language, "Commands.roles.on")}**`).setColor(`#A52F05`)] });
            break;

          case "exclusive":
            if (!args[1]) return message.reply({ embeds: [new EmbedBuilder().setDescription(`${client.translate.get(db.language, "Commands.roles.exclusive")}: \`${db.prefix}roles exclusive <messageId>\``).setColor(`#FF0000`)] });

            const exclusiveMsg = db.roles.find(e => e.msgId === args[1]);
            if (!exclusiveMsg) return message.reply({ embeds: [new EmbedBuilder().setDescription(`${client.translate.get(db.language, "Commands.roles.notFound")}`).setColor(`#FF0000`)] });

            const isExclusive = exclusiveMsg.exclusive ?? false;
            const updatedExclusiveRoles = db.roles.map(e => {
              if (e.msgId === args[1]) {
                return { ...e, exclusive: isExclusive ? null : true };
              }
              return e;
            });

            await client.database.updateGuild(message.guildId, { roles: updatedExclusiveRoles });

            clearCooldown(client, message.author.id);
            message.reply({ embeds: [new EmbedBuilder().setDescription(`${client.translate.get(db.language, "Commands.roles.exclusiveSuccess", { "message": `[${args[1]}](https://fluxer.app/channels/${db.id}/${exclusiveMsg.chanId}/${exclusiveMsg.msgId})`, "option": `**${isExclusive ? client.translate.get(db.language, "Commands.roles.off") : client.translate.get(db.language, "Commands.roles.on")}**` })}`).setColor(`#A52F05`)] });
            break;

            case "edit": {
                if (client.messageCollector.has(message.author.id) || client.messageEdit.has(message.author.id)) {
                    return message.reply({ embeds: [new EmbedBuilder().setDescription(`${client.translate.get(db.language, "Commands.roles.already", { "prefix": db.prefix })}`).setColor(`#FF0000`)] });
                }
                if (db.roles.length === 0) {
                    return message.reply({ embeds: [new EmbedBuilder().setDescription(`${client.translate.get(db.language, "Commands.roles.noRoles")}: \`${db.prefix}roles\``).setColor(`#FF0000`)] });
                }
                if (!args[1]) {
                    return message.reply({ embeds: [new EmbedBuilder().setDescription(`${client.translate.get(db.language, "Commands.roles.edit")}: \`${db.prefix}roles edit <messageId>\``).setColor(`#FF0000`)] });
                }

                const editMsg = db.roles.find(e => e.msgId === args[1]);
                if (!editMsg) {
                    return message.reply({ embeds: [new EmbedBuilder().setDescription(`${client.translate.get(db.language, "Commands.roles.notFound")}`).setColor(`#FF0000`)] });
                }

                const fetched = await (await client.channels.resolve(editMsg.chanId))?.messages?.fetch(editMsg.msgId).catch(() => null);
                if (!fetched) {
                    return message.reply({ embeds: [new EmbedBuilder().setDescription(`${client.translate.get(db.language, "Commands.roles.notFound")}`).setColor(`#FF0000`)] });
                }

                const type = fetched.content.length > 0 ? "content" : "embed";
                const startText = extractRolesAndReplace(fetched.content, editMsg.roles);
                const userId = message.author.id;

                const channels = await message.guild.fetchChannels();
                const targetChannel = channels.find(e => e.id === editMsg.chanId);
                const isDifferentChannel = targetChannel.id !== message.channel.id;

                const setupEmbed = isDifferentChannel
                    ? new EmbedBuilder().setDescription(`${client.translate.get(db.language, "Commands.roles.react")}\n\n\`\`\`txt\n${startText}\n\`\`\``).setColor(`#A52F05`)
                    : new EmbedBuilder().setVideo("https://i.imgur.com/TxuKLjb.mp4").setDescription(`${client.translate.get(db.language, "Commands.roles.react", {
                        "example": `\`\`\`
**This is an example message**

Color Roles:
{role:Blue}
{role:Red}
{role:Purple}
\`\`\`` })}\n\n\`\`\`txt\n${startText}\n\`\`\``).setColor(`#A52F05`);

                const sendChannel = isDifferentChannel ? targetChannel : message.channel;
                if (isDifferentChannel) {
                    message.reply(`${client.translate.get(db.language, "Commands.roles.success")} <#${targetChannel.id}>`, false);
                }

                const setupMsg = await sendChannel.send({ embeds: [setupEmbed] });
                if (isDifferentChannel) {
                    await setupMsg.react(client.config.emojis.cross);
                } else {
                    await setupMsg.react(client.config.emojis.check);
                    await setupMsg.react(client.config.emojis.cross);
                }

                client.messageEdit.set(userId, {
                    user: userId,
                    timeout: null,
                    oldMessageId: fetched.id,
                    botMessage: setupMsg.id,
                    messageId: null,
                    channelId: editMsg.chanId,
                    type: type,
                    rolesDone: [],
                    roles: [],
                    regex: [],
                });

                const editTimeout = setTimeout(async () => {
                    if (!client.messageEdit.has(userId)) return;

                    const session = client.messageEdit.get(userId);
                    const endedEmbed = new EmbedBuilder()
                        .setDescription(`${client.translate.get(db.language, "Commands.roles.ended")}`)
                        .setColor(`#FF0000`);

                    try {
                        const chan = await client.channels.resolve(session.channelId);
                        const msg = await chan?.messages?.fetch(session.botMessage);
                        await msg?.edit({ embeds: [endedEmbed] });
                        await msg?.reactions?.removeAll();
                    } catch { }

                    client.messageEdit.delete(userId);
                }, SETUP_TIMEOUT);

                client.messageEdit.get(userId).timeout = editTimeout;
                clearCooldown(client, userId);
                break;
            }

            case "create": {
                const userId = message.author.id;

                if (client.messageCollector.has(userId)) {
                    return message.reply({ embeds: [new EmbedBuilder().setDescription(`${client.translate.get(db.language, "Commands.roles.already", { "prefix": db.prefix })}`).setColor(`#FF0000`)] });
                }
                if (db.roles.length > 12) {
                    return message.reply({ embeds: [new EmbedBuilder().setDescription(`${client.translate.get(db.language, "Commands.roles.max")}`).setColor(`#FF0000`)] });
                }

                let targetChannel = message.channel;
                let content = args.slice(1).join(" ");

                if (CHANNEL_MENTION_REGEX.test(content)) {
                    const channelId = content.match(CHANNEL_MENTION_REGEX).groups.id;
                    targetChannel = message.guild.channels.find(e => e.id === channelId);

                    if (targetChannel?.type === 2 || targetChannel?.type === 4) {
                        targetChannel = message.channel;
                    }

                    if (!targetChannel) {
                        return message.reply({ embeds: [new EmbedBuilder().setDescription(`${client.translate.get(db.language, "Commands.giveaway.validChannel")}: \`${db.prefix}roles (content OR embed) <#channel>\``).setColor(`#FF0000`)] });
                    }

                    const chanPerms = me.permissionsIn(targetChannel);
                    if (!chanPerms.has(PermissionFlags.SendMessages)) {
                        return message.reply({ embeds: [new EmbedBuilder().setDescription(`${client.translate.get(db.language, "Commands.giveaway.noperms")}`).setColor(`#FF0000`)] });
                    }
                    if (!chanPerms.has(PermissionFlags.ViewChannel)) {
                        return message.reply({ embeds: [new EmbedBuilder().setDescription(`${client.translate.get(db.language, "Commands.giveaway.noperms2")}`).setColor(`#FF0000`)] });
                    }
                    if (!chanPerms.has(PermissionFlags.AddReactions)) {
                        return message.reply({ embeds: [new EmbedBuilder().setDescription(`${client.translate.get(db.language, "Commands.giveaway.noperms3")}`).setColor(`#FF0000`)] });
                    }
                }

                const pickedTypes = TYPE_OPTIONS.filter(e => content.includes(e));
                if (pickedTypes.length > 1) {
                    return message.reply({ embeds: [new EmbedBuilder().setDescription(`${client.translate.get(db.language, "Commands.roles.pick")}\n\n${client.translate.get(db.language, "Commands.language.example")}: ${db.prefix}roles content <#channel>\n${client.translate.get(db.language, "Commands.language.example")}: ${db.prefix}roles embed <#channel>`).setColor(`#FF0000`)] });
                }

                const isDifferentChannel = targetChannel.id !== message.channel.id;

                const setupEmbed = new EmbedBuilder()
                    .setVideo("https://i.imgur.com/TxuKLjb.mp4")
                    .setDescription(client.translate.get(db.language, "Commands.roles.react", {
                        "example": `\`\`\`
**This is an example message**

Color Roles:
{role:Blue}
{role:Red}
{role:Purple}
\`\`\`
` }))
                    .setColor(`#A52F05`);
                
                await message.delete().catch(() => { });

                const setupMsg = await message.channel.send({ embeds: [setupEmbed] });
                await setupMsg.react(client.config.emojis.check);
                await setupMsg.react(client.config.emojis.cross);

                const messageType = pickedTypes[0] || "content";

                client.messageCollector.set(userId, {
                    user: userId,
                    timeout: null,
                    oldMessageId: setupMsg.id,
                    botMessage: setupMsg.id,
                    messageId: null,
                    channelId: message.channel.id,
                    targetChannelId: targetChannel.id,
                    type: messageType,
                    rolesDone: [],
                    roles: [],
                    regex: [],
                });

                const createTimeout = setTimeout(async () => {
                    if (!client.messageCollector.has(userId)) return;

                    const session = client.messageCollector.get(userId);
                    const endedEmbed = new EmbedBuilder()
                        .setDescription(`${client.translate.get(db.language, "Commands.roles.ended")}`)
                        .setColor(`#FF0000`);

                    try {
                        const chan = await client.channels.resolve(session.channelId);
                        const msg = await chan?.messages?.fetch(session.botMessage);
                        await msg?.edit({ embeds: [endedEmbed] });
                        await msg?.reactions?.removeAll();
                    } catch { }

                    client.messageCollector.delete(userId);
                }, SETUP_TIMEOUT);

                client.messageCollector.get(userId).timeout = createTimeout;
                clearCooldown(client, userId);
                break;
            }
        }
    }
};
