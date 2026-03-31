import { EmbedBuilder } from '@fluxerjs/core';

export default async (client, message, userId, db, emojiId, event = 'add') => {
	if (event === 'remove') {
		if (client.reactions.get(userId)) return;
		if (emojiId === client.config.emojis.confetti && !db.ended) {
			if (!db.users.find((u) => u.userID === userId)) return;
			const filtered = db.users.filter((object) => object.userID != userId);
			db.users = filtered;
			const filtered2 = db.picking.filter((object) => object.userID != userId);
			db.picking = filtered2;
			db.save();

			client.reactions.set(userId, Date.now() + 3000);
			setTimeout(() => client.reactions.delete(userId), 3000);

			client.users
				.get(userId)
				?.createDM()
				.then((dm) =>
					dm.send(
						`${client.translate.get(db.language, 'Events.messageReactionRemove.left')} [${db.prize}](https://fluxer.app/channels/${db.serverId}/${db.channelId}/${db.messageId})!\n${client.translate.get(db.language, 'Events.messageReactionRemove.left2')} **${db.users.length}** ${client.translate.get(db.language, 'Events.messageReactionRemove.left3')}!`,
					),
				)
				.catch(() => {});
		}
		return;
	}

	if (emojiId === client.config.emojis.confetti && !db.ended) {
		if (client.reactions.get(userId)) return;
		if (db.users.find((u) => u.userID === userId)) return;

		db.users.push({ userID: userId });
		db.picking.push({ userID: userId });
		await db.save();

		client.reactions.set(userId, Date.now() + 3000);
		setTimeout(() => client.reactions.delete(userId), 3000);

		client.users
			.get(userId)
			?.createDM()
			.then((dm) =>
				dm.send(
					`${client.translate.get(db.lang, 'Events.messageReactionAdd.joined')} [${db.prize}](https://fluxer.app/channels/${db.serverId}/${db.channelId}/${db.messageId})!\n${client.translate.get(db.lang, 'Events.messageReactionAdd.joined2')} **${db.users.length}** ${client.translate.get(db.lang, 'Events.messageReactionAdd.joined3')}`,
				),
			)
			.catch(() => {});
		return;
	}

	if (emojiId === client.config.emojis.stop && db.owner === userId && !db.ended) {
		const endDate = Date.now();

		if (db.users.length === 0) {
			const noUsers = new EmbedBuilder()
				.setColor('#A52F05')
				.setTitle(db.prize)
				.setDescription(
					`${client.translate.get(db.lang, 'Events.messageReactionAdd.early')}\n${client.translate.get(db.lang, 'Events.messageReactionAdd.endNone')}!\n\n${client.translate.get(db.language, 'Events.messageReactionAdd.ended')}: <t:${Math.floor(endDate / 1000)}:R>\n${client.translate.get(db.language, 'Commands.giveaway.hosted')}: <@${db.owner}>\n${client.translate.get(db.lang, 'Events.messageReactionAdd.winnersNone')}${db.requirement ? `\n\n${client.translate.get(db.lang, 'Events.messageReactionAdd.reqs')}:\n${db.requirement}` : ''}`,
				);

			await db.updateOne({ ended: true, endDate });
			await db.save();
			const foundMsg = await (await client.channels.resolve(db.channelId))?.messages?.fetch(db.messageId);
			return foundMsg?.edit({ embeds: [noUsers] });
		}

		for (let i = 0; i < db.winners; i++) {
			const winner = db.picking[Math.floor(Math.random() * db.picking.length)];
			if (winner) {
				db.picking = db.picking.filter((obj) => obj.userID !== winner.userID);
				db.pickedWinners.push({ id: winner.userID });
			}
		}

		await db.updateOne({ ended: true, endDate });
		await db.save();

		const winnersEmbed = new EmbedBuilder()
			.setColor('#A52F05')
			.setTitle(db.prize)
			.setDescription(
				`${client.translate.get(db.lang, 'Events.messageReactionAdd.early')}\n\n${client.translate.get(db.lang, 'Events.messageReactionAdd.ended')}: <t:${Math.floor(endDate / 1000)}:R>\n${client.translate.get(db.language, 'Commands.giveaway.hosted')}: <@${db.owner}>\n${client.translate.get(db.lang, 'Events.messageReactionAdd.partici')}: ${db.users.length}\n${client.translate.get(db.lang, 'Events.messageReactionAdd.winners')}: ${db.pickedWinners.length ? db.pickedWinners.map((w) => `<@${w.id}>`).join(', ') : client.translate.get(db.lang, 'Events.messageReactionAdd.none')}${db.requirement ? `\n${client.translate.get(db.lang, 'Events.messageReactionAdd.reqs')}: ${db.requirement}` : ''}`,
			);

		const foundChannel = await client.channels.resolve(db.channelId);
		const foundMsg = await foundChannel?.messages?.fetch(db.messageId);
		foundMsg?.edit({ embeds: [winnersEmbed] }).catch(() => {});
		foundChannel
			?.send({
				content: `${client.translate.get(db.lang, 'Events.messageReactionAdd.congrats')} ${db.pickedWinners.map((w) => `<@${w.id}>`).join(', ')}! ${client.translate.get(db.lang, 'Events.messageReactionAdd.youWon')} **${db.prize}**\nhttps://fluxer.app/channels/${db.serverId}/${db.channelId}/${db.messageId}`,
			})
			.catch(() => {});

		client.reactions.set(userId, Date.now() + 3000);
		setTimeout(() => client.reactions.delete(userId), 3000);
	}
};
