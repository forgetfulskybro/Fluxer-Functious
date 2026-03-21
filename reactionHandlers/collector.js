const { EmbedBuilder } = require("@fluxerjs/core");

module.exports = async (client, message, userId, collector, reactionChan, reactionMsg, emojiId, event = "add") => {
    if (emojiId === client.config.emojis.check) {
        if (collector.roles.length === 0) {
            const db = await client.database.getGuild(message.guildId);
            const oldChan = await client.channels.resolve(collector.channelId).catch(() => {});
            const oldMsg = await oldChan?.messages?.fetch(collector?.oldMessageId).catch(() => {});
            oldMsg?.delete().catch(() => {});

            const reactions = [...collector.rolesDone.map(e => e.emoji)];

            reactionMsg?.channel.send(
                collector.type === "content"
                    ? { content: reactionMsg.content }
                    : { embeds: [new EmbedBuilder().setColor("#A52F05").setDescription(reactionMsg.embeds[0].description)] }
            ).then(async m => {
                for (const reaction of reactions) await m.react(reaction).catch(() => {});
                db.roles.push({ msgId: m.id, chanId: message.channelId, roles: [...collector.rolesDone] });
                await client.database.updateGuild(message.guildId, { roles: db.roles });
            });

            reactionMsg?.delete().catch(() => {});
            clearTimeout(client.messageCollector.get(userId)?.timeout);
            return client.messageCollector.delete(userId);
        }
        return;
    }

    if (emojiId === client.config.emojis.cross) {
        const db = await client.database.getGuild(message.guildId);
        client.messageCollector.delete(userId);
        reactionMsg?.delete({ silent: true }).catch(() => {});
        return reactionChan?.send({ embeds: [new EmbedBuilder().setColor("#A52F05").setDescription(client.translate.get(db.language, "Events.messageReactionAdd.deleteCollector"))] });
    }

    if (event === "remove") {
        const emote = message.emoji?.id ? `<:${emojiId}:${message.emoji.id}>` : emojiId;
        const emoji = collector.rolesDone.find(e => e.emoji === emote);
        if (emoji) {
            collector.rolesDone = collector.rolesDone.filter(object => object.emoji != emote);
            collector.roles.unshift([emoji.role, { name: emoji.name }]);
            collector.regex.unshift(emoji.name);

            const newMsg = await (await client.channels.resolve(message.channelId))?.messages?.fetch(message.messageId)
            return newMsg.edit(collector.type === "content" ? { content: newMsg.content.replace(`${emote} ${emoji.name}`, `{role:${emoji.name}}`) } : { embeds: [new EmbedBuilder().setColor("#A52F05").setDescription(newMsg.embeds[0].description.replace(`${emote} ${emoji.name}`, `{role:${emoji.name}}`))] }).catch(() => { });
        }
        return;
    }

    if (collector.roles.length === 0) return;
    const emote = message.emoji?.id ? `<:${emojiId}:${message.emoji.id}>` : emojiId;
    collector.rolesDone.push({ emoji: emote, role: collector.roles[0][0], name: collector.roles[0][1].name });

    reactionMsg?.edit(
        collector.type === "content"
            ? { content: reactionMsg.content.replace(`{role:${collector.regex[0]}}`, `${emote} ${collector.roles[0][1].name}`) }
            : { embeds: [new EmbedBuilder().setColor("#A52F05").setDescription(reactionMsg.embeds[0].description.replace(`{role:${collector.regex[0]}}`, `${emote} ${collector.roles[0][1].name}`))] }
    );

    collector.roles.shift();
    return collector.regex.shift();
};