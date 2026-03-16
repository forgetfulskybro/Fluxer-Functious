const { EmbedBuilder } = require("@fluxerjs/core");

module.exports = async (client, message, userId, editCollector, reactionChan, reactionMsg, emojiId) => {
    if (emojiId === client.config.emojis.check) {
        if (editCollector.roles.length === 0) {
            const db = await client.database.getGuild(message.guildId);
            const oldChan = await client.channels.resolve(editCollector.channelId).catch(() => {});
            const oldMsg = await oldChan?.messages?.fetch(editCollector?.oldMessageId).catch(() => {});
            const botChan = await client.channels.resolve(editCollector.channelId).catch(() => {});
            const botMsg = await botChan?.messages?.fetch(editCollector?.botMessage).catch(() => {});

            oldMsg?.delete().catch(() => {});
            botMsg?.delete().catch(() => {});

            const reactions = [...editCollector.rolesDone.map(e => e.emoji)];

            reactionMsg?.channel.send(
                editCollector.type === "content"
                    ? { content: reactionMsg.content }
                    : { embeds: [new EmbedBuilder().setColor("#A52F05").setDescription(reactionMsg.embeds[0].description)] }
            ).then(async msg => {
                for (const reaction of reactions) await msg.react(reaction).catch(() => {});
                db.roles = [
                    ...db.roles.filter(e => e.msgId !== editCollector.oldMessageId),
                    { msgId: msg.id, chanId: message.channelId, roles: [...editCollector.rolesDone] }
                ];
                await client.database.updateGuild(message.guildId, { roles: db.roles });
            }).catch(() => {});

            reactionMsg?.delete().catch(() => {});
            clearTimeout(client.messageEdit.get(userId)?.timeout);
            return client.messageEdit.delete(userId);
        }
        return;
    }

    if (emojiId === client.config.emojis.cross) {
        const db = await client.database.getGuild(message.guildId);
        client.messageEdit.delete(userId);
        reactionMsg?.delete({ silent: true }).catch(() => {});
        return reactionChan?.send({ embeds: [new EmbedBuilder().setColor("#A52F05").setDescription(client.translate.get(db.language, "Events.messageReactionAdd.deleteCollector"))] });
    }

    if (editCollector.roles.length === 0) return;
    const emote = message.emoji?.id ? `<:${emojiId}:${message.emoji.id}>` : emojiId;
    editCollector.rolesDone.push({ emoji: emote, role: editCollector.roles[0][0], name: editCollector.roles[0][1].name });

    reactionMsg?.edit(
        editCollector.type === "content"
            ? { content: reactionMsg.content.replace(`{role:${editCollector.regex[0]}}`, `${emote} ${editCollector.roles[0][1].name}`) }
            : { embeds: [new EmbedBuilder().setColor("#A52F05").setDescription(reactionMsg.embeds[0].description.replace(`{role:${editCollector.regex[0]}}`, `${emote} ${editCollector.roles[0][1].name}`))] }
    );

    editCollector.roles.shift();
    return editCollector.regex.shift();
};