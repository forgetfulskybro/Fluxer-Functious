import { Webhook, EmbedBuilder } from '@fluxerjs/core';
export default async (client, message, userId) => {
	const db = await client.database.getGuild(message.guildId);
	const userTimezone = db.userTimezones.find((u) => u.userId === userId);
	message.guild.fetchChannels();

	const channel = await client.channels.resolve(message.channelId);
	const msg = await channel.messages.fetch(message.messageId);
	const convert = client.functions.get('parseTime')(msg.content, userTimezone.timezone);
	const user = await client.users.fetch(userId);

	try {
		const webhook = await channel.createWebhook({ name: user?.globalName ? user.globalName : user.username });
		const found = Webhook.fromToken(client, webhook.id, webhook.token);
		await found
			.send({
				content: convert.message,
				username: user?.globalName ? user.globalName : user.username,
				avatar_url: user.displayAvatarURL({ dynamic: true }),
			})
			.then(async () => {
				try {
					await msg.delete();
				} catch {}
			});

		await found.delete();
	} catch (e) {
		channel
			.send({
				embeds: [
					new EmbedBuilder()
						.setColor('#A52F05')
						.setAuthor({ name: user?.globalName ? user.globalName : user.username, iconURL: user.displayAvatarURL({ dynamic: true }) })
						.setDescription(convert.message),
				],
			})
			.then(async () => {
				try {
					await msg.delete();
				} catch {}
			});
	}
};
