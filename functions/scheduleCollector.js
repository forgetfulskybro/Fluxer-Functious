const { EmbedBuilder } = require("@erinjs/core");
const { processTemplate } = require("./scheduleTemplateEngine");
const chrono = require("chrono-node");
const checkScheduled = require("./checkScheduledMessages");

const MAX_CONTENT_LENGTH = 1960;
const MAX_EMBED_TITLE = 236;
const MAX_EMBED_DESC = 4040;
const MAX_EMBED_FOOTER = 2024;
const MAX_EMBED_AUTHOR = 236;

const EMBED_STAGES = [
    "title", "description", "footer_text", "footer_icon",
    "image", "author_name", "author_icon", "author_url",
    "url", "color", "thumbnail", "setTimestamp"
];

async function clearBotMessageReactions(client, session) {
    try {
        if (session.botMessage) {
            const chan = await client.channels.resolve(session.channelId);
            const botMsg = await chan?.messages?.fetch(session.botMessage).catch(() => null);
            if (botMsg) {
                await botMsg.removeAllReactions().catch(() => {});
            }
        }
    } catch {}
}

async function updateEmbedPreview(client, session, db) {
    try {
        const chan = await client.channels.resolve(session.channelId);
        if (!chan) return;

        let botMsg = await chan.messages.fetch(session.botMessage).catch(() => null);
        if (!botMsg) return;

        const currentStageName = EMBED_STAGES[session.currentStage] || "done";

        let desc;
        if (session.editing && session.editMode === "content") {
            if (session.currentStage >= EMBED_STAGES.length) {
                desc = `${client.translate.get(db.language, "Functions.schedule.fieldsDone")}\n\n${client.translate.get(db.language, "Functions.schedule.menu")}`;
            } else {
                desc = `${client.translate.get(db.language, "Functions.schedule.editMode", { stage: currentStageName })}\n\n${client.translate.get(db.language, "Functions.schedule.menu")}`;
            }
        } else {
            desc = `${client.translate.get(db.language, "Functions.schedule.editMode", { stage: currentStageName })}\n\n${client.translate.get(db.language, "Functions.schedule.newMsg")}`;

            if (session.currentStage >= EMBED_STAGES.length) {
                desc = `${client.translate.get(db.language, "Functions.schedule.fieldsDone")}\n\n${client.translate.get(db.language, "Functions.schedule.newMsg")}`;
            }
        }

        const infoEmbed = new EmbedBuilder()
            .setColor("#A52F05")
            .setDescription(desc);

        const preview = new EmbedBuilder();
        const ed = session.embedData || {};

        const previewContext = {
            user: `<@${session.user.id}>`,
            username: session.user.username,
            server: session.guild?.name || "Server",
            members: session.guild?.members?.size || 0,
            channel: `<#${session.channelId}>`,
            time: new Date().toLocaleString(),
            timestamp: Math.floor(Date.now() / 1000),
            count: 1,
        };

        const safeProcess = (text) => {
            if (!text || typeof text !== 'string') return "";
            try {
                return processTemplate(text, { ...previewContext }) || text;
            } catch (e) {
                console.error("Template processing error:", e);
                return text;
            }
        };

        const isValidImageURL = (url) => {
            if (!url || typeof url !== 'string') return false;
            if (!url.startsWith('http://') && !url.startsWith('https://')) return false;
            try {
                new URL(url);
                return true;
            } catch {
                return false;
            }
        };

        if (ed.title) preview.setTitle(safeProcess(ed.title));
        if (ed.description) preview.setDescription(safeProcess(ed.description));

        if (ed.footer?.text) {
            const footerText = safeProcess(ed.footer.text);
            let footerIcon = undefined;

            if (ed.footer.iconURL) {
                const processedIcon = safeProcess(ed.footer.iconURL);
                if (isValidImageURL(processedIcon)) {
                    footerIcon = processedIcon;
                } else {
                }
            }

            preview.setFooter({ text: footerText, iconURL: footerIcon });
        }

        if (ed.image) {
            const processedImage = safeProcess(ed.image);
            if (isValidImageURL(processedImage)) {
                preview.setImage(processedImage);
            } else {
            }
        }

        if (ed.thumbnail) {
            const processedThumb = safeProcess(ed.thumbnail);
            if (isValidImageURL(processedThumb)) {
                preview.setThumbnail(processedThumb);
            } else {
            }
        }

        if (ed.author?.name) {
            const authorName = safeProcess(ed.author.name);
            let authorIcon = undefined;
            let authorUrl = undefined;

            if (ed.author.iconURL) {
                const processedIcon = safeProcess(ed.author.iconURL);
                if (isValidImageURL(processedIcon)) {
                    authorIcon = processedIcon;
                } else {
                }
            }

            if (ed.author.url) {
                const processedUrl = safeProcess(ed.author.url);
                try {
                    new URL(processedUrl);
                    authorUrl = processedUrl;
                } catch {
                }
            }

            preview.setAuthor({
                name: authorName,
                iconURL: authorIcon,
                url: authorUrl
            });
        }

        if (ed.url) {
            const processedUrl = safeProcess(ed.url);
            try {
                new URL(processedUrl);
                preview.setURL(processedUrl);
            } catch {
            }
        }

        if (ed.color) {
            try {
                preview.setColor(ed.color);
            } catch (e) {
            }
        }

        if (ed.useTimestamp) {
            preview.setTimestamp();
        }

        await botMsg.edit({ embeds: [infoEmbed, preview] });

    } catch (err) {
        console.error("Update embed preview error:", err);
    }
}

async function askWebhook(client, session) {
    await clearBotMessageReactions(client, session);
    const db = await client.database.getGuild(session.guildId);
    const webhookEmbed = new EmbedBuilder()
        .setColor("#A52F05")
        .setDescription(client.translate.get(db.language, "Functions.schedule.askWebhook"));

    try {
        const chan = await client.channels.resolve(session.channelId);
        const botMsg = await chan?.messages?.fetch(session.botMessage).catch(() => null);
        if (botMsg) {
            await botMsg.edit({ embeds: [webhookEmbed] });
        }
        session.waitingForWebhook = true;
    } catch(e) {console.log(e)}
}

async function askWebhookName(client, session) {
    await clearBotMessageReactions(client, session);
    const db = await client.database.getGuild(session.guildId);
    const nameEmbed = new EmbedBuilder()
        .setColor("#A52F05")
        .setDescription(client.translate.get(db.language, "Functions.schedule.webhookName"));

    try {
        const chan = await client.channels.resolve(session.channelId);
        const botMsg = await chan?.messages?.fetch(session.botMessage).catch(() => null);
        if (botMsg) {
            await botMsg.edit({ embeds: [nameEmbed] });
        }
        session.waitingForWebhook = false;
        session.waitingForWebhookName = true;
    } catch {}
}

async function askWebhookAvatar(client, session) {
    await clearBotMessageReactions(client, session);
    const db = await client.database.getGuild(session.guildId);
    const avatarEmbed = new EmbedBuilder()
        .setColor("#A52F05")
        .setDescription(client.translate.get(db.language, "Functions.schedule.webhookURL"));

    try {
        const chan = await client.channels.resolve(session.channelId);
        const botMsg = await chan?.messages?.fetch(session.botMessage).catch(() => null);
        if (botMsg) {
            await botMsg.edit({ embeds: [avatarEmbed] });
        }
        session.waitingForWebhookName = false;
        session.waitingForWebhookAvatar = true;
    } catch {}
}

async function askRecurring(client, session) {
    await clearBotMessageReactions(client, session);
    const db = await client.database.getGuild(session.guildId);
    const recurringEmbed = new EmbedBuilder()
        .setColor("#A52F05")
        .setDescription(client.translate.get(db.language, "Functions.schedule.repeatOften"));

    try {
        const chan = await client.channels.resolve(session.channelId);
        const botMsg = await chan?.messages?.fetch(session.botMessage).catch(() => null);
        if (botMsg) {
            await botMsg.edit({ embeds: [recurringEmbed] });
        }
        session.waitingForWebhookAvatar = false;
        session.waitingForRecurring = true;
    } catch {}
}

async function showEditMenu(client, session, guildId) {
    await clearBotMessageReactions(client, session);

    const db = await client.database.getGuild(guildId);
    const scheduled = db.scheduledMessages || [];
    const msgData = scheduled[session.editingIndex - 1];

  const menuEmbed = new EmbedBuilder()
    .setColor("#A52F05")
    .setTitle(`${client.translate.get(db.language, "Commands.schedule.editSchedMsg")} #${session.editingIndex}`)
    .setDescription(
      `**${client.translate.get(db.language, "Commands.schedule.editWhat")}**

1️⃣ **${client.translate.get(db.language, "Commands.schedule.msgContent")}** - ${msgData.type === "content" ? client.translate.get(db.language, "Commands.schedule.textMsg") : client.translate.get(db.language, "Commands.schedule.embedFields")}
2️⃣ **${client.translate.get(db.language, "Commands.schedule.sendTime")}** - ${client.translate.get(db.language, "Commands.schedule.currently")}: <t:${msgData.timestamp}:f> (<t:${msgData.timestamp}:R>)
3️⃣ **${client.translate.get(db.language, "Commands.schedule.recurring")}** - ${client.translate.get(db.language, "Commands.schedule.currently")}: ${msgData.recurring || client.translate.get(db.language, "Commands.schedule.none")}
4️⃣ **${client.translate.get(db.language, "Commands.schedule.webhook")}** - ${client.translate.get(db.language, "Commands.schedule.currently")}: ${msgData.webhook?.name || client.translate.get(db.language, "Commands.schedule.disabled")}

${client.translate.get(db.language, "Commands.schedule.editSchedLast")}`);
        

    try {
        const chan = await client.channels.resolve(session.channelId);
        const botMsg = await chan?.messages?.fetch(session.botMessage).catch(() => null);
        if (botMsg) {
            await botMsg.edit({ embeds: [menuEmbed] });
        }
        session.editMode = "menu";
        session.waitingForTime = false;
        session.waitingForWebhook = false;
        session.waitingForWebhookName = false;
        session.waitingForWebhookAvatar = false;
        session.waitingForRecurring = false;

        const updatedBotMsg = await chan?.messages?.fetch(session.botMessage).catch(() => null);
        if (updatedBotMsg) {
            await updatedBotMsg.react("1️⃣");
            await updatedBotMsg.react("2️⃣");
            await updatedBotMsg.react("3️⃣");
            await updatedBotMsg.react("4️⃣");
            await updatedBotMsg.react(client.config.emojis.cross);
        }
    } catch {}
}

async function saveEditChanges(client, session, guildId) {
    const db = await client.database.getGuild(guildId);
    const scheduled = db.scheduledMessages || [];
    const index = session.editingIndex - 1;

    const updatedData = {
        ...scheduled[index],
        content: session.content,
        embedData: session.embedData,
        timestamp: session.timestamp,
        webhook: session.webhook,
        recurring: session.recurring,
    };

    scheduled[index] = updatedData;
    await client.database.updateGuild(guildId, { scheduledMessages: scheduled });

    checkScheduled.handleEdit(guildId, updatedData.id, updatedData);
}

function isValidImageURL(url) {
    if (!url || typeof url !== 'string') return false;
    if (!url.startsWith('https://') && !url.startsWith('http://')) return false;
    try {
        new URL(url);
        return true;
    } catch {
        return false;
    }
}

async function ScheduleCollector(client, message, db) {
    const session = client.scheduleCollector.get(message.author.id);
    if (!session) return;

    const isCancel = message.content.toLowerCase() === `${db.prefix}schedule stop` || message.content.toLowerCase() === 'cancel';

    if (isCancel) {
        if (session.editMode && session.editMode !== "menu") {
            message.delete().catch(() => {});
            await showEditMenu(client, session, message.guildId);
            return;
        }

        if (session.userMessageId) {
            try {
                const chan = await client.channels.resolve(session.channelId);
                const userMsg = await chan?.messages?.fetch(session.userMessageId).catch(() => null);
                await userMsg?.delete().catch(() => {});
            } catch {}
        }
        client.scheduleCollector.delete(message.author.id);
        clearTimeout(session.timeout);
        try {
            const chan = await client.channels.resolve(session.channelId);
            const botMsg = await chan?.messages?.fetch(session.botMessage).catch(() => null);
            if (botMsg) {
                await botMsg.removeAllReactions().catch(() => {});
                await botMsg.edit({ embeds: [new EmbedBuilder().setColor("#A52F05").setDescription(client.translate.get(db.language, "Commands.schedule.stopSuccess"))] });
            }
        } catch {}
        return;
    }

    if (session.waitingForWebhookName) {
        const name = message.content.trim().slice(0, 80);
        session.webhook = session.webhook || {};
        session.webhook.name = name.toLowerCase() === 'skip' ? null : name;

        message.delete().catch(() => {});

        if (session.editMode === "webhook") {
            return askWebhookAvatar(client, session);
        }
        return askWebhookAvatar(client, session);
    }

    if (session.waitingForWebhookAvatar) {
        const url = message.content.trim();
        if (url.toLowerCase() === 'skip') {
            session.webhook = session.webhook || {};
            session.webhook.avatarURL = null;
            message.delete().catch(() => {});

            if (session.editMode === "webhook") {
                await saveEditChanges(client, session, message.guildId);
                await showEditMenu(client, session, message.guildId);
                return;
            }
            return askRecurring(client, session);
        }

        if (!isValidImageURL(url)) {
            message.reply({
                embeds: [new EmbedBuilder().setColor("#FF0000").setDescription(client.translate.get(db.language, "Functions.schedule.invalidURL"))]
            }).then(m => setTimeout(() => m.delete().catch(() => {}), 5000));
            return;
        }

        try {
            const response = await fetch(url, { method: 'HEAD' });
            const contentType = response.headers.get('content-type');
            if (!contentType || !contentType.startsWith('image/')) {
                message.reply({
                    embeds: [new EmbedBuilder().setColor("#FF0000").setDescription(client.translate.get(db.language, "Functions.schedule.invalidURL"))]
                }).then(m => setTimeout(() => m.delete().catch(() => {}), 5000));
                return;
            }
        } catch {
            message.reply({
                embeds: [new EmbedBuilder().setColor("#FF0000").setDescription(client.translate.get(db.language, "Functions.schedule.invalidURL"))]
            }).then(m => setTimeout(() => m.delete().catch(() => {}), 5000));
            return;
        }

        session.webhook = session.webhook || {};
        session.webhook.avatarURL = url;
        message.delete().catch(() => {});

        if (session.editMode === "webhook") {
            await saveEditChanges(client, session, message.guildId);
            await showEditMenu(client, session, message.guildId);
            return;
        }
        return askRecurring(client, session);
    }

    if (session.waitingForWebhook) {
        const choice = message.content.trim().toLowerCase();
        if (choice === 'yes' || choice === 'y') {
            session.webhook = {};
            message.delete().catch(() => {});
            return askWebhookName(client, session);
        } else if (choice === 'no' || choice === 'n') {
            session.webhook = null;
            session.waitingForWebhook = false;
            message.delete().catch(() => {});

            if (session.editMode === "webhook") {
                await saveEditChanges(client, session, message.guildId);
                await showEditMenu(client, session, message.guildId);
                return;
            }
            return askRecurring(client, session);
        } else if (choice === 'edit') {
            session.webhook = {};
            message.delete().catch(() => {});
            return askWebhookName(client, session);
        } else if (choice === 'remove') {
            session.webhook = null;
            session.waitingForWebhook = false;
            message.delete().catch(() => {});
            await saveEditChanges(client, session, message.guildId);
            await showEditMenu(client, session, message.guildId);
            return;
        } else if (choice === 'cancel') {
            message.delete().catch(() => {});
            await showEditMenu(client, session, message.guildId);
            return;
        } else {
            return message.reply({
                embeds: [new EmbedBuilder().setColor("#FF0000").setDescription(client.translate.get(db.language, "Functions.schedule.correctReply"))]
            }).then(m => setTimeout(() => m.delete().catch(() => {}), 5000));
        }
    }

    if (session.waitingForRecurring) {
        const choice = message.content.trim().toLowerCase();
        const validOptions = ['none', 'daily', 'weekly', 'monthly'];

        if (choice === 'cancel') {
            message.delete().catch(() => {});
            if (session.editMode === "recurring") {
                await showEditMenu(client, session, message.guildId);
                return;
            }
            client.scheduleCollector.delete(message.author.id);
            clearTimeout(session.timeout);
            try {
                const chan = await client.channels.resolve(session.channelId);
                const botMsg = await chan?.messages?.fetch(session.botMessage).catch(() => null);
                if (botMsg) {
                    await botMsg.removeAllReactions().catch(() => {});
                    await botMsg.edit({ embeds: [new EmbedBuilder().setColor("#A52F05").setDescription(client.translate.get(db.language, "Commands.schedule.stopSuccess"))] });
                }
            } catch {}
            return;
        }

        if (validOptions.includes(choice)) {
            session.recurring = choice;
        } else if (choice.startsWith('cron:')) {
            const cronParts = choice.slice(5).trim().split(/\s+/);
            if (cronParts.length !== 5) {
                return message.reply({
                  embeds: [new EmbedBuilder().setColor("#FF0000").setDescription(client.translate.get(db.language, "Functions.schedule.invalidCron"))]
                }).then(m => setTimeout(() => m.delete().catch(() => {}), 5000));
            }

            const minField = cronParts[0];
            if (minField.startsWith('*/')) {
                const step = parseInt(minField.slice(2), 10);
                if (!isNaN(step) && step < 10) {
                    return message.reply({
                        embeds: [new EmbedBuilder().setColor("#FF0000").setDescription(client.translate.get(db.language, "Functions.schedule.miniCron"))]
                    }).then(m => setTimeout(() => m.delete().catch(() => {}), 5000));
                }
            } else if (/^[0-9]+(?:,[0-9]+)*$/.test(minField)) {
                const minutes = minField.split(',').map(Number);
                const sorted = [...new Set(minutes)].sort((a, b) => a - b);
                if (sorted.length > 1) {
                    const gaps = [];
                    for (let i = 1; i < sorted.length; i++) {
                        gaps.push(sorted[i] - sorted[i-1]);
                    }
                    const minGap = Math.min(...gaps);
                    if (minGap < 10) {
                        return message.reply({
                            embeds: [new EmbedBuilder().setColor("#FF0000").setDescription(client.translate.get(db.language, "Functions.schedule.miniCron"))]
                        }).then(m => setTimeout(() => m.delete().catch(() => {}), 5000));
                    }
                }
            } else if (minField !== '*' && minField !== '0') {
                const minuteVal = parseInt(minField, 10);
                if (!isNaN(minuteVal) && minuteVal < 10) {
                    const hourField = cronParts[1];
                    if (hourField === '*' || (hourField.startsWith('*/') && parseInt(hourField.slice(2)) >= 1)) {
                    }
                }
            }
            session.recurring = choice;
        } else {
            return message.reply({
                embeds: [new EmbedBuilder().setColor("#FF0000").setDescription(client.translate.get(db.language, "Functions.schedule.invalidOption"))]
            }).then(m => setTimeout(() => m.delete().catch(() => {}), 5000));
        }

        message.delete().catch(() => {});
        session.waitingForRecurring = false;

        if (session.editMode === "recurring") {
            await saveEditChanges(client, session, message.guildId);
            await showEditMenu(client, session, message.guildId);
            return;
        }

        session.waitingForTime = true;

        const timeEmbed = new EmbedBuilder()
            .setColor("#A52F05")
            .setDescription(client.translate.get(db.language, "Functions.schedule.whenSent", { exampleTime: "(e.g. \`2:30pm\`, \`in 30 minutes\`, \`6:00am\`)", prefix: db.prefix }));

        try {
            const chan = await client.channels.resolve(session.channelId);
            const botMsg = await chan?.messages?.fetch(session.botMessage).catch(() => null);
            if (botMsg) {
                await botMsg.removeAllReactions().catch(() => {});
                await botMsg.edit({ embeds: [timeEmbed] });
            }
        } catch {}
        return;
    }

    if (session.waitingForTime) {
        let tz = null;
        try {
            const userData = await client.database.getUser(message.author.id, false);
            if (userData?.timezone) tz = userData.timezone;
        } catch {}

        const refDate = new Date();
        const parsedResults = tz
            ? chrono.parse(message.content, refDate, { forwardDate: true, timezone: tz })
            : chrono.parse(message.content, refDate, { forwardDate: true });
        let timestamp = null;

        if (parsedResults && parsedResults.length > 0) {
            const parsedDate = parsedResults[0].start.date();
            timestamp = Math.floor(parsedDate.getTime() / 1000);
        }

        if (!timestamp) {
          return message.reply({ embeds: [new EmbedBuilder().setColor("#FF0000").setDescription(`${client.translate.get(db.language, "Functions.schedule.invalidTime")} \`2:30pm\`, \`in 3 minutes\`, or \`tomorrow at 5pm\`.`)] }).then(m => {
                setTimeout(() => m.delete().catch(() => {}), 5000);
            });
        }

        const now = Math.floor(Date.now() / 1000);
        if (timestamp <= now) {
            return message.reply({ embeds: [new EmbedBuilder().setColor("#FF0000").setDescription(client.translate.get(db.language, "Functions.schedule.futureTime"))] }).then(m => {
                setTimeout(() => m.delete().catch(() => {}), 5000);
            });
        }

        session.timestamp = timestamp;
        session.waitingForTime = false;

        if (session.editMode === "time") {
            await saveEditChanges(client, session, message.guildId);
            await showEditMenu(client, session, message.guildId);
            message.delete().catch(() => {});
            return;
        }

        let content = session.content;
        let embedData = session.embedData;

        if (session.type === "content" && session.userMessageId) {
            try {
                const chan = await client.channels.resolve(session.channelId);
                const userMsg = await chan?.messages?.fetch(session.userMessageId).catch(() => null);
                if (userMsg) {
                    content = userMsg.content.slice(0, MAX_CONTENT_LENGTH);
                }
            } catch {}
        }

        const msgData = {
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            channelId: session.targetChannelId,
            type: session.type,
            timestamp: timestamp,
            content: content || null,
            embedData: embedData || null,
            createdAt: Math.floor(Date.now() / 1000),
            createdBy: message.author.id,
            webhook: session.webhook || null,
            recurring: session.recurring || "none",
            sendCount: 1,
        };

        const guildData = await client.database.getGuild(message.guildId);
        const updated = [...(guildData.scheduledMessages || []), msgData];
        await client.database.updateGuild(message.guildId, { scheduledMessages: updated });

        checkScheduled.handleNew(message.guildId, msgData);
        client.scheduleCollector.delete(message.author.id);
        clearTimeout(session.timeout);

        let responseText = client.translate.get(db.language, "Functions.schedule.success", { time: `<t:${timestamp}:R>`, channel: `<#${session.targetChannelId}>` });
        if (session.webhook?.name) {
            responseText += `\n${client.translate.get(db.language, "Functions.schedule.webhookAddon")}: ${session.webhook.name}`;
        }
        if (session.recurring && session.recurring !== "none") {
            responseText += `\n${client.translate.get(db.language, "Commands.schedule.repeats")}: ${session.recurring}`;
        }

        message.reply({ embeds: [new EmbedBuilder().setColor("#A52F05").setDescription(responseText)] });

        const chan = await client.channels.resolve(session.channelId);
        const botMsg = await chan?.messages?.fetch(session.botMessage).catch(() => null);
        if (botMsg) {
            await botMsg.delete().catch(() => {});
        }        
        return;
    }

    if (session.type === "content") {
        if (session?.editMode === "content") {
            session.content = message.content.slice(0, MAX_CONTENT_LENGTH);
            message.delete().catch(() => {});
            await saveEditChanges(client, session, message.guildId);
            await showEditMenu(client, session, message.guildId);
            return;
        }

        if (session.userMessageId) return;
        session.userMessageId = message.id;

        return askWebhook(client, session);
    }

    if (session.type === "embed") {
        const db = await client.database.getGuild(message.guildId);
        const content = message.content;
        let handled = false;

        if (session.editMode === "content" && content.toLowerCase() === "done") {
            message.delete().catch(() => {});
            await saveEditChanges(client, session, message.guildId);
            await showEditMenu(client, session, message.guildId);
            return;
        }

        const editChecks = [
            { regex: /^\{(?:title|t):(.+)\}$/i, apply: (v) => { session.embedData.title = v.slice(0, MAX_EMBED_TITLE); } },
            { regex: /^\{(?:desc|description|d):(.+)\}$/i, apply: (v) => { session.embedData.description = v.slice(0, MAX_EMBED_DESC); } },
            { regex: /^\{(?:footer|f|foot):(.+)\}$/i, apply: (v) => { session.embedData.footer = session.embedData.footer || {}; session.embedData.footer.text = v.slice(0, MAX_EMBED_FOOTER); } },
            { regex: /^\{(?:footer_icon|ficon|footericon):(.+)\}$/i, apply: (v) => { session.embedData.footer = session.embedData.footer || {}; session.embedData.footer.iconURL = v; } },
            { regex: /^\{(?:thumb|thumbnail):(.+)\}$/i, apply: (v) => { session.embedData.thumbnail = v; } },
            { regex: /^\{(?:image|img|i):(.+)\}$/i, apply: (v) => { session.embedData.image = v; } },
            { regex: /^\{(?:author|a):(.+)\}$/i, apply: (v) => { session.embedData.author = session.embedData.author || {}; session.embedData.author.name = v.slice(0, MAX_EMBED_AUTHOR); } },
            { regex: /^\{(?:author_icon|aicon|authoricon):(.+)\}$/i, apply: (v) => { session.embedData.author = session.embedData.author || {}; session.embedData.author.iconURL = v; } },
            { regex: /^\{(?:author_url|aurl|authorurl):(.+)\}$/i, apply: (v) => { session.embedData.author = session.embedData.author || {}; session.embedData.author.url = v; } },
            { regex: /^\{(?:url|link):(.+)\}$/i, apply: (v) => { session.embedData.url = v; } },
            { regex: /^\{(?:color|c):(.+)\}$/i, apply: (v) => { session.embedData.color = v; } },
        ];

        for (const check of editChecks) {
            const match = content.match(check.regex);
            if (match) {
                check.apply(match[1].trim());
                handled = true;
                message.delete().catch(() => {});
                await updateEmbedPreview(client, session, db);
                break;
            }
        }

        if (handled) return;

        if (content.toLowerCase() === "skip") {
            message.delete().catch(() => {});
            session.currentStage++;
            if (session.currentStage >= EMBED_STAGES.length) {
                session.currentStage = EMBED_STAGES.length - 1;
            }
            await updateEmbedPreview(client, session, db);
            return;
        }

        const currentStage = EMBED_STAGES[session.currentStage];
        if (!currentStage) {
            message.delete().catch(() => {});
            return;
        }

        message.delete().catch(() => {});

        switch (currentStage) {
            case "title":
                session.embedData.title = content.slice(0, MAX_EMBED_TITLE);
                break;
            case "description":
                session.embedData.description = content.slice(0, MAX_EMBED_DESC);
                break;
            case "footer_text":
                session.embedData.footer = session.embedData.footer || {};
                session.embedData.footer.text = content.slice(0, MAX_EMBED_FOOTER);
                break;
            case "footer_icon":
                session.embedData.footer = session.embedData.footer || {};
                session.embedData.footer.iconURL = content;
                break;
            case "image":
                session.embedData.image = content;
                break;
            case "author_name":
                session.embedData.author = session.embedData.author || {};
                session.embedData.author.name = content.slice(0, MAX_EMBED_AUTHOR);
                break;
            case "author_icon":
                session.embedData.author = session.embedData.author || {};
                session.embedData.author.iconURL = content;
                break;
            case "author_url":
                session.embedData.author = session.embedData.author || {};
                session.embedData.author.url = content;
                break;
            case "url":
                session.embedData.url = content;
                break;
            case "color":
                session.embedData.color = content;
                break;
            case "thumbnail":
                session.embedData.thumbnail = content;
                break;
            case "setTimestamp":
                session.embedData.useTimestamp = content.toLowerCase() === "yes" || content.toLowerCase() === "y";
                break;
        }

        session.currentStage++;
        if (session.currentStage >= EMBED_STAGES.length) {
            session.currentStage = EMBED_STAGES.length - 1;
        }

        await updateEmbedPreview(client, session, db);
    }
}

module.exports = ScheduleCollector;
module.exports.clearBotMessageReactions = clearBotMessageReactions;
module.exports.askWebhook = askWebhook;
module.exports.askWebhookName = askWebhookName;
module.exports.askWebhookAvatar = askWebhookAvatar;
module.exports.askRecurring = askRecurring;
module.exports.showEditMenu = showEditMenu;
module.exports.saveEditChanges = saveEditChanges;
module.exports.updateEmbedPreview = updateEmbedPreview;