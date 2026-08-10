const { EmbedBuilder, PermissionFlags } = require("@fluxerjs/core");
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
┕ \`${prefix}schedule content #channel\` - ${client.translate.get(db.language, "Commands.schedule.textMsg")}
┕ \`${prefix}schedule embed #channel\` - ${client.translate.get(db.language, "Commands.schedule.richEmbed")}
┕ \`${prefix}schedule poll <time> | <title> | <option1> | <option2>...\` - Schedule a poll
┕ \`${prefix}schedule giveaway <time> | <winners> | <prize>\` - Schedule a giveaway
┕ \`${prefix}schedule remind <time> <message>\` - Schedule a reminder

**${client.translate.get(db.language, "Commands.schedule.managing")}:**
┕ \`${prefix}schedule view\` - ${client.translate.get(db.language, "Commands.schedule.listUpcome")}
┕ \`${prefix}schedule view <num>\` - ${client.translate.get(db.language, "Commands.schedule.viewDetails")}
┕ \`${prefix}schedule edit <num>\` - ${client.translate.get(db.language, "Commands.schedule.editExist")}
┕ \`${prefix}schedule delete <num>\` - ${client.translate.get(db.language, "Commands.schedule.delete")}
┕ \`${prefix}schedule stop\` - ${client.translate.get(db.language, "Commands.schedule.cancel")}`
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
                    let typeDisplay;
                    if (msgData.type === "content") {
                        typeDisplay = client.translate.get(db.language, "Commands.schedule.content");
                    } else if (msgData.type === "embed") {
                        typeDisplay = client.translate.get(db.language, "Commands.schedule.embed");
                    } else if (msgData.type === "command") {
                        typeDisplay = `Command: ${msgData.commandName}`;
                    } else {
                        typeDisplay = msgData.type;
                    }

                    const infoEmbed = new EmbedBuilder()
                        .setColor("#A52F05")
                        .setDescription(
                            `**#${index} ${client.translate.get(db.language, "Commands.schedule.viewMsg")}**

**${client.translate.get(db.language, "Commands.schedule.type")}:** ${typeDisplay}
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
                    } else if (msgData.type === "embed") {
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
                    } else if (msgData.type === "command") {
                        const commandEmbed = new EmbedBuilder()
                            .setColor("#A52F05")
                            .setDescription(`**Command:** ${msgData.commandName}\n**Arguments:** ${msgData.commandArgs.join(" | ")}`);
                        embedsToSend.push(commandEmbed);
                    }

                    message.reply({ embeds: embedsToSend, allowedMentions: { parse: [] } });
                    break;
                }

                const pages = new Paginator({ timeout: 300000, user: message.author.id, client: client });
                const items = scheduled.map((msg, i) => {
                    let extra = "";
                    if (msg.recurring && msg.recurring !== "none") extra += " 🔁";
                    if (msg.webhook?.name) extra += " 🕸";

                    let typeDisplay;
                    if (msg.type === "content") {
                        typeDisplay = client.translate.get(db.language, "Commands.schedule.content");
                    } else if (msg.type === "embed") {
                        typeDisplay = client.translate.get(db.language, "Commands.schedule.embed");
                    } else if (msg.type === "command") {
                        typeDisplay = `Command: ${msg.commandName}`;
                    } else {
                        typeDisplay = msg.type;
                    }

                    return `**#${i + 1}**${extra}\n**${client.translate.get(db.language, "Commands.schedule.type")}:** ${typeDisplay}\n**${client.translate.get(db.language, "Commands.schedule.channel")}:** <#${msg.channelId}>\n**${client.translate.get(db.language, "Commands.schedule.time")}:** <t:${msg.timestamp}:R>`;
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

${msgData.type === "command" ? "1️⃣ **Command Arguments**" : `1️⃣ **${client.translate.get(db.language, "Commands.schedule.msgContent")}** - ${msgData.type === "content" ? client.translate.get(db.language, "Commands.schedule.textMsg") : client.translate.get(db.language, "Commands.schedule.embedFields")}`}
${msgData.type === "command" ? "2️⃣" : "2️⃣"} **${client.translate.get(db.language, "Commands.schedule.sendTime")}** - ${client.translate.get(db.language, "Commands.schedule.currently")}: <t:${msgData.timestamp}:f> (<t:${msgData.timestamp}:R>)
${msgData.type === "command" ? "3️⃣" : "3️⃣"} **${client.translate.get(db.language, "Commands.schedule.recurring")}** - ${client.translate.get(db.language, "Commands.schedule.currently")}: ${msgData.recurring || client.translate.get(db.language, "Commands.schedule.none")}
${msgData.type === "command" ? "" : `4️⃣ **${client.translate.get(db.language, "Commands.schedule.webhook")}** - ${client.translate.get(db.language, "Commands.schedule.currently")}: ${msgData.webhook?.name || client.translate.get(db.language, "Commands.schedule.disabled")}`}

${client.translate.get(db.language, "Commands.schedule.editSchedLast")}`
                    );

                const setupMsg = await message.channel.send({ embeds: [menuEmbed] });
                await setupMsg.react("1️⃣");
                await setupMsg.react("2️⃣");
                await setupMsg.react("3️⃣");
                if (msgData.type !== "command") {
                    await setupMsg.react("4️⃣");
                }
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
                    waitingForCommandArgs: false,
                    webhook: msgData.webhook || null,
                    recurring: msgData.recurring || "none",
                    editMode: "menu",
                    editing: true,
                    timestamp: msgData.timestamp,
                    commandName: msgData.commandName || null,
                    commandArgs: msgData.commandArgs || null,
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

                const indices = args[1].split(',').map(s => parseInt(s.trim(), 10));
                const validIndices = [];
                const invalidIndices = [];

                for (const index of indices) {
                    if (isNaN(index) || index < 1 || index > scheduled.length) {
                        invalidIndices.push(index);
                    } else if (!validIndices.includes(index)) {
                        validIndices.push(index);
                    }
                }

                if (validIndices.length === 0) {
                    return message.reply({ embeds: [new EmbedBuilder().setDescription(client.translate.get(db.language, "Commands.schedule.invalidNum", { "number": scheduled.length })).setColor("#FF0000")] });
                }

                const deletedIds = [];
                for (const index of validIndices.sort((a, b) => b - a)) {
                    const msgData = scheduled[index - 1];
                    checkScheduled.handleDelete(message.guildId, msgData.id);
                    deletedIds.push(index);
                }

                const updated = scheduled.filter((_, i) => !validIndices.includes(i + 1));
                await client.database.updateGuild(message.guildId, { scheduledMessages: updated });

                const deletedList = deletedIds.sort((a, b) => a - b).join(', ');
                message.reply({ embeds: [new EmbedBuilder().setDescription(client.translate.get(db.language, "Commands.schedule.deleteSuccess", { "number": deletedList })).setColor("#A52F05")] });
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

            case "poll":
            case "giveaway":
            case "remind": {
                const userId = message.author.id;
                const commandType = args[0].toLowerCase();

                if (client.scheduleCollector.has(userId)) {
                    return message.reply({ embeds: [new EmbedBuilder().setDescription(client.translate.get(db.language, "Commands.schedule.alreadyError", { "prefix": db.prefix })).setColor("#FF0000")] });
                }

                const currentCount = (db.scheduledMessages || []).length;
                if (currentCount >= MAX_SCHEDULED) {
                    return message.reply({ embeds: [new EmbedBuilder().setDescription(client.translate.get(db.language, "Commands.schedule.maxSched", { "max": MAX_SCHEDULED })).setColor("#FF0000")] });
                }

                let targetChannel = message.channel;
                let commandArgs = args.slice(1).join(" ");

                if (CHANNEL_MENTION_REGEX.test(commandArgs)) {
                    const channelId = commandArgs.match(CHANNEL_MENTION_REGEX).groups.id;
                    const channels = await message.guild.fetchChannels();
                    targetChannel = channels.find((c) => c.id === channelId);

                    if (targetChannel?.type === 2 || targetChannel?.type === 4) {
                        targetChannel = message.channel;
                    }

                    if (!targetChannel) {
                        return message.reply({ embeds: [new EmbedBuilder().setDescription(`${client.translate.get(db.language, "Commands.schedule.invalidChannel")}`).setColor("#FF0000")] });
                    }

                    const me = message.guild?.members.me ?? (message.guild ? await message.guild.members.fetchMe() : null);
                    const chanPerms = me.permissionsIn(targetChannel);
                    if (!chanPerms.has(PermissionFlags.SendMessages)) {
                        return message.reply({ embeds: [new EmbedBuilder().setDescription(client.translate.get(db.language, "Commands.schedule.permCheck")).setColor("#FF0000")] });
                    }
                    if (!chanPerms.has(PermissionFlags.ViewChannel)) {
                        return message.reply({ embeds: [new EmbedBuilder().setDescription(client.translate.get(db.language, "Commands.schedule.permCheck2")).setColor("#FF0000")] });
                    }

                    commandArgs = commandArgs.replace(CHANNEL_MENTION_REGEX, "").trim();
                }

                let parsedArgs;
                if (commandType === "poll" || commandType === "giveaway") {
                    parsedArgs = commandArgs.split("|").map(x => x.trim()).filter(x => x);
                } else if (commandType === "remind") {
                    parsedArgs = [commandArgs.trim()];
                } else {
                    parsedArgs = [commandArgs];
                }

                if (!parsedArgs[0]) {
                    let exampleText = "";
                    if (commandType === "poll") {
                        exampleText = `Example: \`${db.prefix}schedule poll 5m | What's your favorite color? | Red | Blue | Green\``;
                    } else if (commandType === "giveaway") {
                        exampleText = `Example: \`${db.prefix}schedule giveaway 20m | 3 | A t-shirt\``;
                    } else if (commandType === "remind") {
                        exampleText = `Example: \`${db.prefix}schedule remind 1h30m Don't forget the meeting\``;
                    }
                    return message.reply({ embeds: [new EmbedBuilder().setDescription(`Please provide the command arguments.\n${exampleText}`).setColor("#FF0000")] });
                }

                const setupEmbed = new EmbedBuilder()
                    .setColor("#A52F05")
                    .setDescription(client.translate.get(db.language, "Functions.schedule.whenSent", { exampleTime: "(e.g. `2:30pm`, `in 30 minutes`, `6:00am`)", prefix: db.prefix }));

                const setupMsg = await message.channel.send({ embeds: [setupEmbed] });

                const session = {
                    user: userId,
                    timeout: null,
                    botMessage: setupMsg.id,
                    channelId: message.channel.id,
                    guildId: message.guildId,
                    targetChannelId: targetChannel.id,
                    type: "command",
                    commandName: commandType === "poll" ? "polls" : commandType,
                    commandArgs: parsedArgs,
                    currentStage: 0,
                    waitingForTime: true,
                    done: false,
                    userMessageId: null,
                    confirmationMessageId: null,
                    waitingForWebhook: false,
                    waitingForWebhookName: false,
                    waitingForWebhookAvatar: false,
                    waitingForRecurring: false,
                    waitingForCommandArgs: false,
                    webhook: null,
                    recurring: "none",
                    editingIndex: null,
                    editingOriginal: null,
                    timestamp: null,
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