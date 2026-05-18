const { EmbedBuilder } = require("@erinjs/core");
const ScheduleCollector = require("../functions/scheduleCollector");

module.exports = async (client, message, userId, collector, reactionChan, reactionMsg, emojiId, event = "add") => {
    if (event === "remove") return;

    const isBotMessage = collector.botMessage === reactionMsg.id;
    if (!isBotMessage) return;

    const db = await client.database.getGuild(collector.guildId);

    if (emojiId === client.config.emojis.cross) {
        if (collector.editing && collector.editMode !== "menu") {
            await ScheduleCollector.showEditMenu(client, collector, message.guildId);
            return;
        }

        if (collector.userMessageId) {
            try {
                const userMsg = await reactionChan?.messages?.fetch(collector.userMessageId).catch(() => null);
                await userMsg?.delete().catch(() => {});
            } catch {}
        }

        client.scheduleCollector.delete(userId);
        clearTimeout(collector.timeout);

        try {
            await reactionMsg.removeAllReactions().catch(() => {});
            await reactionMsg.edit({ embeds: [new EmbedBuilder().setColor("#A52F05").setDescription(client.translate.get(db.language, "Commands.schedule.stopSuccess"))] }).catch(() => {});
        } catch {}

        return;
    }

    if (collector.editMode === "menu") {
        await reactionMsg.removeAllReactions().catch(() => {});

        if (emojiId === "1️⃣") {
            collector.editMode = "content";
            if (collector.type === "content") {
                const promptEmbed = new EmbedBuilder()
                    .setColor("#A52F05")
                    .setDescription(client.translate.get(db.language, "Commands.schedule.editMsgContent"));
                const contentEmbed = new EmbedBuilder()
                    .setColor("#A52F05")
                    .setDescription(
                        `**${client.translate.get(db.language, "Commands.schedule.msgContent")}:**\n\n${collector.content || client.translate.get(db.language, "Commands.schedule.noContent")}`
                    );
                await reactionMsg.edit({ embeds: [promptEmbed, contentEmbed] });
            } else {
                collector.currentStage = 0;
                const infoEmbed = new EmbedBuilder()
                    .setColor("#A52F05")
                    .setDescription(client.translate.get(db.language, "Commands.schedule.editMsgEmbed"));
                await reactionMsg.edit({ embeds: [infoEmbed] });
                await ScheduleCollector.updateEmbedPreview(client, collector, db);
                await reactionMsg.react(client.config.emojis.check);
                await reactionMsg.react(client.config.emojis.cross);
            }
        } else if (emojiId === "2️⃣") {
            collector.editMode = "time";
            collector.waitingForTime = true;
            const timeEmbed = new EmbedBuilder()
                .setColor("#A52F05")
                .setDescription(client.translate.get(db.language, "Commands.schedule.editSendTime", { time: `<t:${collector.timestamp}:f> (<t:${collector.timestamp}:R>)`, exampleTime: "(e.g. `2:30pm`, `in 30 minutes`, `6:00am`)" }));
            await reactionMsg.edit({ embeds: [timeEmbed] });
        } else if (emojiId === "3️⃣") {
            collector.editMode = "recurring";
            await ScheduleCollector.askRecurring(client, collector);
        } else if (emojiId === "4️⃣") {
            collector.editMode = "webhook";
            if (collector.webhook?.name) {
                const webhookEmbed = new EmbedBuilder()
                    .setColor("#A52F05")
                    .setDescription(client.translate.get(db.language, "Commands.schedule.editWebhookSettings", { name: collector.webhook.name, avatar: collector.webhook.avatarURL || client.translate.get(db.language, "Commands.schedule.default") }));
                await reactionMsg.edit({ embeds: [webhookEmbed] });
                collector.waitingForWebhook = true;
            } else {
                await ScheduleCollector.askWebhook(client, collector);
            }
        }
        return;
    }

    if (emojiId === client.config.emojis.check) {
        if (collector.editing && collector.editMode === "content") {
            await ScheduleCollector.saveEditChanges(client, collector, message.guildId);
            await ScheduleCollector.showEditMenu(client, collector, message.guildId);
            return;
        }

        if (collector.type === "content") {
            if (!collector.userMessageId) return;
        }

        if (collector.type === "embed") {
            const ed = collector.embedData;
            const hasContent = ed.title || ed.description || ed.footer?.text || ed.image || ed.author?.name || ed.url || ed.thumbnail;
            if (!hasContent) return;
        }

        await ScheduleCollector.askWebhook(client, collector).catch(() => {});
    }
};