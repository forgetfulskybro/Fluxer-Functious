import { EmbedBuilder } from '@fluxerjs/core';
import getRoles from './getRoles';

async function Collector(client, message, db) {
	if (message.content === `${db.prefix}roles stop`) {
		client.messageCollector.delete(message.author.id);
		return message.reply({ embeds: [new EmbedBuilder().setColor('#A52F05').setDescription(client.translate.get(db.language, 'Commands.roles.stopped'))] });
	}

	const regex = /{role:(?: |)(.*?)}/;
	const regexAll = /{role:(?: |)(.*?)}/g;
	const collector = client.messageCollector.get(message.author.id);
	if (!message.content.match(regexAll) || message.content.match(regexAll)?.length === 0) {
		message
			.reply({ embeds: [new EmbedBuilder().setColor('#FF0000').setDescription(`${client.translate.get(db.language, 'Events.messageCreate.noRoles')}: \`{role:Red}\`\n\n${client.translate.get(db.language, 'Events.messageCreate.stop', { prefix: db.prefix })}`)] })
			.then(async (m) => {
				await m.delete().catch(() => {});
			})
			.catch(() => {});
		return message.react(client.config.emojis.cross).catch(() => {});
	}

	const roles = message.content.match(regexAll).map((r) => r?.match(regex)[1]);
	if (roles.length > 30) {
		message.reply({ embeds: [new EmbedBuilder().setColor('#FF0000').setDescription(client.translate.get(db.language, 'Events.messageCreate.maxRoles'))] }).catch(() => {});
		return message.react(client.config.emojis.cross).catch(() => {});
	}

	collector.regex = roles;
	const roleIds = await getRoles(roles, message, client, db);
	if (!roleIds) return;

	const cleanedContent = message.content.replace(/\{role:\s*(.*?)\}/g, '{role:$1}');
	message.delete().catch(() => {});
	collector.roles = roleIds;
	return message.channel.send(collector.type === 'content' ? { content: cleanedContent } : { embeds: [new EmbedBuilder().setDescription(cleanedContent).setColor('#A52F05')] }).then(async (msg) => {
		collector.messageId = msg.id;
	});
}

export default Collector;
