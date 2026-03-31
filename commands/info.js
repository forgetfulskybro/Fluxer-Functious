import { EmbedBuilder } from '@fluxerjs/core';
import Giveaway from '../models/giveaways';
import SavedPolls from '../models/savedPolls';
import { dependencies } from '../package.json';
export const config = {
	name: 'info',
	usage: false,
	cooldown: 15000,
	available: true,
	permissions: {},
	aliases: ['stats'],
};
/**
 *
 * @param {import('@fluxerjs/core').Client} client
 * @param {import('@fluxerjs/core').Message} message
 * @param {string[]} args
 * @param {*} db
 * @returns
 */
export async function run(client, message, args, db) {
	function memory() {
		const used = process.memoryUsage().heapUsed;
		return Number((used / 1048576).toFixed(2));
	}

	const unixstamp = client.functions.get('fetchTime')(Math.floor(process.uptime() * 1000), client, db.language, true);

	async function Database() {
		let beforeCall = Date.now();
		const polls = await SavedPolls.find();
		return { ping: Date.now() - beforeCall, polls };
	}

	async function botPing() {
		try {
			const start = Date.now();
			await client.rest.get('/gateway/bot');
			return Date.now() - start;
		} catch {
			return '502 bad Gateway';
		}
	}

	const dbPing = await Database();
	const embed = new EmbedBuilder()
		.setDescription(
			`**${client.translate.get(db.language, 'Commands.info.start')}**\n${client.translate.get(db.language, 'Commands.info.servers')}: \`${client.guilds.size.toLocaleString()}\`\n${client.translate.get(db.language, 'Commands.info.giveaways')}: \`${(await Giveaway.find()).length.toLocaleString()}\`\n${client.translate.get(db.language, 'Commands.info.polls')}: \`${dbPing.polls.length.toLocaleString()}\`\n${client.translate.get(db.language, 'Commands.info.uptime')}: \`${unixstamp}\`\n\n${client.translate.get(db.language, 'Commands.info.ping')}: \`${!isNaN(await botPing()) ? `${await botPing()}ms` : '502 Bad Gateway'}\`\n${client.translate.get(db.language, 'Commands.info.memory')}: \`${memory()}mb\`\n${client.translate.get(db.language, 'Commands.info.database')}: \`${dbPing.ping}ms\`\n${client.translate.get(db.language, 'Commands.info.library')}: [Fluxer.js](https://fluxer.js.org) | ${dependencies['@fluxerjs/core']}\n\n${client.translate.get(db.language, 'Commands.info.links')}\n[${client.translate.get(db.language, 'Commands.info.links2')}](https://web.fluxer.app/oauth2/authorize?client_id=1475548817821799084&scope=bot&permissions=13510799704222800) | [${client.translate.get(db.language, 'Commands.info.links3')}](https://fluxer.gg/YnINU09E) | [GitHub](https://github.com/forgetfulskybro/Fluxer-Functious) | [Crowdin](https://crowdin.com/project/functious)`,
		)
		.setColor(`#A52F05`);

	message.reply({ embeds: [embed], mentions: false });
}
