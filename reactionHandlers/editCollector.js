import { EmbedBuilder } from '@fluxerjs/core';

export default async (client, message, userId, editCollector, reactionChan, reactionMsg, emojiId, event = 'add') => {
	if (emojiId === client.config.emojis.check && editCollector.botMessage === reactionMsg.id) {
		if (editCollector.roles.length === 0) {
			const reactions = [...editCollector.rolesDone.map((e) => e.emoji)];
			let db, oldMsg, msg;
			db = await client.database.getGuild(message.guildId);
			msg = await reactionChan?.messages?.fetch(editCollector?.messageId).catch(() => {});
			try {
				oldMsg = await reactionChan?.messages?.fetch(editCollector?.oldMessageId).catch(() => {});
			} catch {}

			try {
				await oldMsg?.delete(), await reactionMsg?.delete();
			} catch {}

			try {
				const newMsg = await reactionMsg.channel.send(editCollector.type === 'content' ? { content: msg.content } : { embeds: [new EmbedBuilder().setColor('#A52F05').setDescription(bot.embeds[0].description)] });
				try {
					await msg.delete();
				} catch {}
				await Promise.all(reactions.map((reaction) => newMsg.react(reaction)));
				db.roles = [...db.roles.filter((e) => e.msgId !== editCollector.oldMessageId), { msgId: newMsg.id, chanId: message.channelId, roles: [...editCollector.rolesDone] }];
				await client.database.updateGuild(message.guildId, { roles: db.roles });
			} catch (error) {
				console.error(error);
			}

			clearTimeout(client.messageEdit.get(userId)?.timeout);
			return client.messageEdit.delete(userId);
		}
		return;
	}

	if (emojiId === client.config.emojis.cross && editCollector.botMessage === reactionMsg.id) {
		const db = await client.database.getGuild(message.guildId);
		client.messageEdit.delete(userId);
		reactionMsg?.delete({ silent: true }).catch(() => {});
		return reactionChan?.send({ embeds: [new EmbedBuilder().setColor('#A52F05').setDescription(client.translate.get(db.language, 'Events.messageReactionAdd.deleteCollector'))] });
	}

	if (event === 'remove') {
		const emote = message.emoji?.id ? `<:${emojiId}:${message.emoji.id}>` : emojiId;
		const emoji = editCollector.rolesDone.find((e) => e.emoji === emote);
		if (emoji) {
			editCollector.rolesDone = editCollector.rolesDone.filter((object) => object.emoji != emote);
			editCollector.roles.unshift([emoji.role, { name: emoji.name }]);
			editCollector.regex.unshift(emoji.name);

			const newMsg = await (await client.channels.resolve(message.channelId))?.messages?.fetch(message.messageId);
			return newMsg
				.edit(editCollector.type === 'content' ? { content: newMsg.content.replace(`${emote} ${emoji.name}`, `{role:${emoji.name}}`) } : { embeds: [new EmbedBuilder().setColor('#A52F05').setDescription(newMsg.embeds[0].description.replace(`${emote} ${emoji.name}`, `{role:${emoji.name}}`))] })
				.catch(() => {});
		}
		return;
	}

	if (editCollector.roles.length === 0) return;
	const emote = message.emoji?.id ? `<:${emojiId}:${message.emoji.id}>` : emojiId;
	editCollector.rolesDone.push({ emoji: emote, role: editCollector.roles[0][0], name: editCollector.roles[0][1].name });

	reactionMsg?.edit(
		editCollector.type === 'content'
			? { content: reactionMsg.content.replace(`{role:${editCollector.regex[0]}}`, `${emote} ${editCollector.roles[0][1].name}`) }
			: { embeds: [new EmbedBuilder().setColor('#A52F05').setDescription(reactionMsg.embeds[0].description.replace(`{role:${editCollector.regex[0]}}`, `${emote} ${editCollector.roles[0][1].name}`))] },
	);

	editCollector.roles.shift();
	return editCollector.regex.shift();
};
