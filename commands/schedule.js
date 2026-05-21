const { EmbedBuilder, PermissionFlags } = require("@erinjs/core");
const Paginator = require("../functions/pagination");
const checkScheduled = require("../functions/checkScheduledMessages");

const CHANNEL_MENTION_REGEX = /^<#(?<id>\d+)>/;
const SETUP_TIMEOUT = 600000;
const COOLDOWN_MS = 3000;
const MAX_SCHEDULED = 10;

function clearCooldown(client, userId) {
    setTimeout(() => client.used.delete(`${userId}-schedule`), COOLDOWN_MS);
}

module.exports = {
    config: {
        name: "schedule",
        usage: "help",
        cooldown: 3000,
        available: true,
        permissions: { name: "Manage Guild", bitField: PermissionFlags.ManageGuild },
        aliases: ["sched", "scheduler"],
    },
  run: async (client, message, args, db) => {
      // Dumb fluxer
        // const botMember = (message.guild?.members.me ?? (message.guild ? await message.guild.members.fetchMe() : null));
        // if (!botMember?.permissions.has(PermissionFlags.ManageMessages)) return message.reply({ embeds: [new EmbedBuilder().setDescription(client.translate.get(db.language, "Commands.schedule.permissionCheck")).setColor("#FF0000")] });

        switch (args[0]?.toLowerCase()) {
            case "help":
            default: {
                const prefix = db.prefix;
                const pages = new Paginator({ timeout: 60000, user: message.author.id, client: client });

                pages.add(
                    new EmbedBuilder()
                        .setColor("#A52F05")
                        .setTitle(client.translate.get(db.language, "Commands.schedule.schedCmd"))
                        .setDescription(
                            `**${client.translate.get(db.language, "Commands.schedule.description")}**

**${client.translate.get(db.language, "Commands.schedule.getStarted")}:**
┕ \`${prefix}schedule content #channel\` — ${client.translate.get(db.language, "Commands.schedule.textMsg")}
┕ \`${prefix}schedule embed #channel\` — ${client.translate.get(db.language, "Commands.schedule.richEmbed")}

**${client.translate.get(db.language, "Commands.schedule.managing")}:**
┕ \`${prefix}schedule view\` — ${client.translate.get(db.language, "Commands.schedule.listUpcome")}
┕ \`${prefix}schedule view <num>\` — ${client.translate.get(db.language, "Commands.schedule.viewDetails")}
┕ \`${prefix}schedule edit <num>\` — ${client.translate.get(db.language, "Commands.schedule.editExist")}
┕ \`${prefix}schedule delete <num>\` — ${client.translate.get(db.language, "Commands.schedule.delete")}
┕ \`${prefix}schedule stop\` — ${client.translate.get(db.language, "Commands.schedule.cancel")}`
                        )
                );

                pages.add(
                    new EmbedBuilder()
                        .setColor("#A52F05")
                        .setTitle(client.translate.get(db.language, "Commands.schedule.dynamicTemp"))
                        .setDescription(client.translate.get(db.language, "Commands.schedule.dynamicDesc"))
                );

                pages.add(
                    new EmbedBuilder()
                        .setColor("#A52F05")
                        .setTitle(client.translate.get(db.language, "Commands.schedule.webRecur"))
                        .setDescription(client.translate.get(db.language, "Commands.schedule.webRecurDesc"))
                );

                pages.add(
                    new EmbedBuilder()
                        .setColor("#A52F05")
                        .setTitle(client.translate.get(db.language, "Commands.schedule.embedTips"))
                        .setDescription(client.translate.get(db.language, "Commands.schedule.embedTipsDesc", { "prefix": db.prefix }))
                );

                clearCooldown(client, message.author.id);
                pages.start(message.channel);
                break;
            }

            case "stop": {
                if (!client.scheduleCollector.get(message.author.id)) {
                    return message.reply({ embeds: [new EmbedBuilder().setDescription(client.translate.get(db.language, "Commands.schedule.stopError")).setColor("#FF0000")] });
                }
                const session = client.scheduleCollector.get(message.author.id);
                clearTimeout(session.timeout);
                client.scheduleCollector.delete(message.author.id);

                try {
                    const chan = await client.channels.resolve(session.channelId);
                    const msg = await chan?.messages?.fetch(session.botMessage);
                    if (msg) {
                        await msg.removeAllReactions().catch(() => {});
                        await msg.edit({ embeds: [new EmbedBuilder().setColor("#A52F05").setDescription(client.translate.get(db.language, "Commands.schedule.stopSuccess"))] });
                    }
                } catch {}

                break;
            }

            case "view": {
                const scheduled = db.scheduledMessages || [];
                if (scheduled.length === 0) {
                    return message.reply({ embeds: [new EmbedBuilder().setDescription(client.translate.get(db.language, "Commands.schedule.noSchedMsgs", { "prefix": db.prefix })).setColor("#FF0000")] });
                }

                if (args[1]) {
                    const index = parseInt(args[1], 10);
                    if (isNaN(index) || index < 1 || index > scheduled.length) {
                        return message.reply({ embeds: [new EmbedBuilder().setDescription(client.translate.get(db.language, "Commands.schedule.invalidNum", { "number": scheduled.length })).setColor("#FF0000")] });
                    }

                    const msgData = scheduled[index - 1];
                    const infoEmbed = new EmbedBuilder()
                        .setColor("#A52F05")
                        .setDescription(
                            `**#${index} ${client.translate.get(db.language, "Commands.schedule.viewMsg")}**

**${client.translate.get(db.language, "Commands.schedule.type")}:** ${msgData.type === "content" ? client.translate.get(db.language, "Commands.schedule.content") : client.translate.get(db.language, "Commands.schedule.embed")}
**${client.translate.get(db.language, "Commands.schedule.sendsTo")}:** <#${msgData.channelId}>
**${client.translate.get(db.language, "Commands.schedule.time")}:** <t:${msgData.timestamp}:f> (<t:${msgData.timestamp}:R>)
${msgData.recurring && msgData.recurring !== "none" ? `**${client.translate.get(db.language, "Commands.schedule.repeats")}:** ${msgData.recurring}\n` : ""}${msgData.webhook?.name ? `**${client.translate.get(db.language, "Commands.schedule.webhook")}:** ${msgData.webhook.name}\n` : ""}
**${client.translate.get(db.language, "Commands.schedule.schedMsgContent")}:**`
                        );

                    const embedsToSend = [infoEmbed];

                    if (msgData.type === "content") {
                        const contentEmbed = new EmbedBuilder()
                            .setColor("#A52F05")
                            .setDescription(msgData.content || client.translate.get(db.language, "Commands.schedule.noContent"));
                        embedsToSend.push(contentEmbed);
                    } else {
                        const ed = msgData.embedData || {};
                        const contentEmbed = new EmbedBuilder()
                            .setColor(ed.color || "#A52F05");
                        if (ed.title) contentEmbed.setTitle(ed.title);
                        if (ed.description) contentEmbed.setDescription(ed.description);
                        if (ed.footer?.text) contentEmbed.setFooter({ text: ed.footer.text, iconURL: ed.footer.iconURL || undefined });
                        if (ed.image) contentEmbed.setImage(ed.image);
                        if (ed.author?.name) contentEmbed.setAuthor({ name: ed.author.name, iconURL: ed.author.iconURL || undefined, url: ed.author.url || undefined });
                        if (ed.url) contentEmbed.setURL(ed.url);
                        if (ed.thumbnail) contentEmbed.setThumbnail(ed.thumbnail);
                        if (ed.useTimestamp) contentEmbed.setTimestamp();
                        embedsToSend.push(contentEmbed);
                    }

                    message.reply({ embeds: embedsToSend, allowedMentions: { parse: [] } });
                    break;
                }

                const pages = new Paginator({ timeout: 300000, user: message.author.id, client: client });
                const items = scheduled.map((msg, i) => {
                    let extra = "";
                    if (msg.recurring && msg.recurring !== "none") extra += " 🔁";
                    if (msg.webhook?.name) extra += " 🕸";
                    return `**#${i + 1}**${extra}\n**${client.translate.get(db.language, "Commands.schedule.type")}:** ${msg.type === "content" ? client.translate.get(db.language, "Commands.schedule.content") : client.translate.get(db.language, "Commands.schedule.embed")}\n**${client.translate.get(db.language, "Commands.schedule.channel")}:** <#${msg.channelId}>\n**${client.translate.get(db.language, "Commands.schedule.time")}:** <t:${msg.timestamp}:R>`;
                });
                const chunks = Array.from({ length: Math.ceil(items.length / 3) }, (_, i) => items.slice(i * 3, i * 3 + 3));
                const legend = `🔁 = ${client.translate.get(db.language, "Commands.schedule.recurring")}  •  🕸 = ${client.translate.get(db.language, "Commands.schedule.webhook")}`;
                chunks.forEach(chunk => {
                    pages.add(
                        new EmbedBuilder()
                            .setColor("#A52F05")
                            .setDescription(`${chunk.join("\n\n")}\n\n${legend}`)
                    );
                });

                clearCooldown(client, message.author.id);
                pages.start(message.channel);
                break;
            }

            case "edit": {
                const scheduled = db.scheduledMessages || [];
                if (scheduled.length === 0) {
                    return message.reply({ embeds: [new EmbedBuilder().setDescription(client.translate.get(db.language, "Commands.schedule.editError")).setColor("#FF0000")] });
                }

                if (!args[1]) {
                    return message.reply({ embeds: [new EmbedBuilder().setDescription(`${client.translate.get(db.language, "Commands.schedule.usage")}: \`${db.prefix}schedule edit [number]\` - ${client.translate.get(db.language, "Commands.schedule.usageUse", { "prefix": db.prefix })}.`).setColor("#FF0000")] });
                }

                const index = parseInt(args[1], 10);
                if (isNaN(index) || index < 1 || index > scheduled.length) {
                    return message.reply({ embeds: [new EmbedBuilder().setDescription(client.translate.get(db.language, "Commands.schedule.invalidNum", { "number": scheduled.length })).setColor("#FF0000")] });
                }

                const msgData = scheduled[index - 1];
                const userId = message.author.id;

                if (client.scheduleCollector.has(userId)) {
                    return message.reply({ embeds: [new EmbedBuilder().setDescription(client.translate.get(db.language, "Commands.schedule.alreadyError")).setColor("#FF0000")] });
                }

                const menuEmbed = new EmbedBuilder()
                    .setColor("#A52F05")
                    .setTitle(`${client.translate.get(db.language, "Commands.schedule.editSchedMsg")} #${index}`)
                    .setDescription(
                        `**${client.translate.get(db.language, "Commands.schedule.editWhat")}**

1️⃣ **${client.translate.get(db.language, "Commands.schedule.msgContent")}** - ${msgData.type === "content" ? client.translate.get(db.language, "Commands.schedule.textMsg") : client.translate.get(db.language, "Commands.schedule.embedFields")}
2️⃣ **${client.translate.get(db.language, "Commands.schedule.sendTime")}** - ${client.translate.get(db.language, "Commands.schedule.currently")}: <t:${msgData.timestamp}:f> (<t:${msgData.timestamp}:R>)
3️⃣ **${client.translate.get(db.language, "Commands.schedule.recurring")}** - ${client.translate.get(db.language, "Commands.schedule.currently")}: ${msgData.recurring || client.translate.get(db.language, "Commands.schedule.none")}
4️⃣ **${client.translate.get(db.language, "Commands.schedule.webhook")}** - ${client.translate.get(db.language, "Commands.schedule.currently")}: ${msgData.webhook?.name || client.translate.get(db.language, "Commands.schedule.disabled")}

${client.translate.get(db.language, "Commands.schedule.editSchedLast")}`
                    );

                const setupMsg = await message.channel.send({ embeds: [menuEmbed] });
                await setupMsg.react("1️⃣");
                await setupMsg.react("2️⃣");
                await setupMsg.react("3️⃣");
                await setupMsg.react("4️⃣");
                await setupMsg.react(client.config.emojis.cross);

                const session = {
                    user: userId,
                    timeout: null,
                    botMessage: setupMsg.id,
                    channelId: message.channel.id,
                    guildId: message.guildId,
                    targetChannelId: msgData.channelId,
                    type: msgData.type,
                    content: msgData.content,
                    embedData: msgData.type === "embed" ? { ...msgData.embedData } : null,
                    currentStage: 0,
                    waitingForTime: false,
                    done: false,
                    userMessageId: null,
                    confirmationMessageId: null,
                    editingIndex: index,
                    editingOriginal: msgData,
                    waitingForWebhook: false,
                    waitingForWebhookName: false,
                    waitingForWebhookAvatar: false,
                    waitingForRecurring: false,
                    webhook: msgData.webhook || null,
                    recurring: msgData.recurring || "none",
                    editMode: "menu",
                    editing: true,
                    timestamp: msgData.timestamp,
                };

                client.scheduleCollector.set(userId, session);

                const createTimeout = setTimeout(async () => {
                    if (!client.scheduleCollector.has(userId)) return;

                    const sess = client.scheduleCollector.get(userId);
                    const endedEmbed = new EmbedBuilder()
                        .setDescription(client.translate.get(db.language, "Commands.schedule.schedEditTimeout"))
                        .setColor("#FF0000");

                    try {
                        const chan = await client.channels.resolve(sess.channelId);
                        const msg = await chan?.messages?.fetch(sess.botMessage);
                        await msg?.edit({ embeds: [endedEmbed] });
                        await msg?.reactions?.removeAll();
                    } catch {}

                    client.scheduleCollector.delete(userId);
                }, SETUP_TIMEOUT);

                client.scheduleCollector.get(userId).timeout = createTimeout;
                clearCooldown(client, userId);
                break;
            }

            case "delete": {
                const scheduled = db.scheduledMessages || [];
                if (scheduled.length === 0) {
                    return message.reply({ embeds: [new EmbedBuilder().setDescription(client.translate.get(db.language, "Commands.schedule.deleteError")).setColor("#FF0000")] });
                }

                if (!args[1]) {
                    return message.reply({ embeds: [new EmbedBuilder().setDescription(`${client.translate.get(db.language, "Commands.schedule.usage")}: \`${db.prefix}schedule delete [number]\` - ${client.translate.get(db.language, "Commands.schedule.usageUse")}`).setColor("#FF0000")] });
                }

                const index = parseInt(args[1], 10);
                if (isNaN(index) || index < 1 || index > scheduled.length) {
                    return message.reply({ embeds: [new EmbedBuilder().setDescription(client.translate.get(db.language, "Commands.schedule.invalidNum", { "number": scheduled.length })).setColor("#FF0000")] });
                }

                const msgData = scheduled[index - 1];
                checkScheduled.handleDelete(message.guildId, msgData.id);

                const updated = scheduled.filter((_, i) => i !== index - 1);
                await client.database.updateGuild(message.guildId, { scheduledMessages: updated });

                message.reply({ embeds: [new EmbedBuilder().setDescription(client.translate.get(db.language, "Commands.schedule.deleteSuccess", { "number": index })).setColor("#A52F05")] });
                break;
            }

            case "content":
            case "embed": {
                const userId = message.author.id;

                if (client.scheduleCollector.has(userId)) {
                    return message.reply({ embeds: [new EmbedBuilder().setDescription(client.translate.get(db.language, "Commands.schedule.alreadyError", { "prefix": db.prefix })).setColor("#FF0000")] });
                }

                const currentCount = (db.scheduledMessages || []).length;
                if (currentCount >= MAX_SCHEDULED) {
                    return message.reply({ embeds: [new EmbedBuilder().setDescription(client.translate.get(db.language, "Commands.schedule.maxSched", { "max": MAX_SCHEDULED })).setColor("#FF0000")] });
                }

                const messageType = args[0].toLowerCase();
                let targetChannel = message.channel;
                let content = args.slice(1).join(" ");

                if (CHANNEL_MENTION_REGEX.test(content)) {
                    const channelId = content.match(CHANNEL_MENTION_REGEX).groups.id;
                    const channels = await message.guild.fetchChannels();
                    targetChannel = channels.find((c) => c.id === channelId)

                    if (targetChannel?.type === 2 || targetChannel?.type === 4) {
                        targetChannel = message.channel;
                    }

                    if (!targetChannel) {
                        return message.reply({ embeds: [new EmbedBuilder().setDescription(`${client.translate.get(db.language, "Commands.schedule.invalidChannel")} ${client.translate.get(db.language, "Commands.schedule.usage")}: \`${db.prefix}schedule ${messageType} #channel\``).setColor("#FF0000")] });
                    }

                    const me = message.guild?.members.me ?? (message.guild ? await message.guild.members.fetchMe() : null);
                    const chanPerms = me.permissionsIn(targetChannel);
                    if (!chanPerms.has(PermissionFlags.SendMessages)) {
                        return message.reply({ embeds: [new EmbedBuilder().setDescription(client.translate.get(db.language, "Commands.schedule.permCheck")).setColor("#FF0000")] });
                    }
                    if (!chanPerms.has(PermissionFlags.ViewChannel)) {
                        return message.reply({ embeds: [new EmbedBuilder().setDescription(client.translate.get(db.language, "Commands.schedule.permCheck2")).setColor("#FF0000")] });
                    }
                }

                await message.delete().catch(() => {});

                let setupEmbed;
                let embedData = null;

                if (messageType === "content") {
                    setupEmbed = new EmbedBuilder()
                        .setColor("#A52F05")
                        .setDescription(client.translate.get(db.language, "Commands.schedule.contentMsg"));
                } else {
                    embedData = {
                        title: null,
                        description: null,
                        footer: null,
                        image: null,
                        author: null,
                        url: null,
                        color: null,
                        thumbnail: null,
                        useTimestamp: null
                    };

                    setupEmbed = new EmbedBuilder()
                        .setColor("#A52F05")
                        .setDescription(client.translate.get(db.language, "Commands.schedule.embedStage"));
                }

                const setupMsg = messageType === "content"
                    ? await message.channel.send({ embeds: [setupEmbed] })
                    : await message.channel.send({ embeds: [setupEmbed, new EmbedBuilder().setColor("#A52F05")] });

                if (messageType === "embed") {
                    await setupMsg.react(client.config.emojis.check);
                    await setupMsg.react(client.config.emojis.cross);
                }

                const session = {
                    user: userId,
                    timeout: null,
                    botMessage: setupMsg.id,
                    channelId: message.channel.id,
                    guildId: message.guildId,
                    targetChannelId: targetChannel.id,
                    type: messageType,
                    content: null,
                    embedData: embedData,
                    currentStage: 0,
                    waitingForTime: false,
                    done: false,
                    userMessageId: null,
                    confirmationMessageId: null,
                    waitingForWebhook: false,
                    waitingForWebhookName: false,
                    waitingForWebhookAvatar: false,
                    waitingForRecurring: false,
                    webhook: null,
                    recurring: "none",
                    editingIndex: null,
                    editingOriginal: null,
                };

                client.scheduleCollector.set(userId, session);

                const createTimeout = setTimeout(async () => {
                    if (!client.scheduleCollector.has(userId)) return;

                    const sess = client.scheduleCollector.get(userId);
                    const endedEmbed = new EmbedBuilder()
                        .setDescription(client.translate.get(db.language, "Commands.schedule.schedTimeout"))
                        .setColor("#FF0000");

                    try {
                        const chan = await client.channels.resolve(sess.channelId);
                        const msg = await chan?.messages?.fetch(sess.botMessage);
                        await msg?.edit({ embeds: [endedEmbed] });
                        await msg?.reactions?.removeAll();
                    } catch {}

                    client.scheduleCollector.delete(userId);
                }, SETUP_TIMEOUT);

                client.scheduleCollector.get(userId).timeout = createTimeout;
                clearCooldown(client, userId);
                break;
            }
        }
    }
};