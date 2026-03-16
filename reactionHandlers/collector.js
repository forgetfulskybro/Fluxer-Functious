const { EmbedBuilder } = require("@fluxerjs/core");

module.exports = async (client, message, userId, collector, reactionChan, reactionMsg, emojiId) => {
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