import { EmbedBuilder, PermissionFlags } from '@fluxerjs/core';
import getRoles from '../functions/getRoles';

export const config = {
	name: 'autoroles',
	usage: true,
	cooldown: 2000,
	available: true,
	permissions: {
		name: 'Manage Guild',
		bitField: PermissionFlags.ManageGuild,
	},
	aliases: ['autorole', 'ar'],
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
	const me = message.guild?.members.me ?? (message.guild ? await message.guild.members.fetchMe() : null);
	if (!me?.permissions.has(PermissionFlags.ManageRoles)) return message.reply({ embeds: [new EmbedBuilder().setDescription(`${client.translate.get(db.language, 'Commands.roles.noPerms')}`).setColor(`#FF0000`)] });

	const options = args
		.join(` `)
		.replace(/sticky|join|add|remove/gi, '')
		.split(`,`)
		.map((x) => x.trim())
		.filter((x) => x);
	switch (args[0]?.toLowerCase()) {
		default:
			('help');
		case 'help':
			const embed = new EmbedBuilder()
				.setColor(`#A52F05`)
				.setTitle(client.translate.get(db.language, 'Commands.autoroles.help'))
				.setDescription(
					`${client.translate.get(db.language, 'Commands.autoroles.explanation')}\n\n${client.translate.get(db.language, 'Commands.autoroles.view')}\n\`${db.prefix}autoroles view\`\n\n${client.translate.get(db.language, 'Commands.autoroles.stickyRoles')}\n\`${db.prefix}autoroles sticky\`\n\n${client.translate.get(db.language, 'Commands.autoroles.joinRoles')}\n\`${db.prefix}autoroles join add [${client.translate.get(db.language, 'Commands.autoroles.roleNames')}, e.g. Member, Bot Updates]\`\n\`${db.prefix}autoroles join remove [${client.translate.get(db.language, 'Commands.autoroles.roleNames')}, e.g. Member, Bot Updates]\``,
				);

			message.reply({ embeds: [embed] });
			break;

		case 'view':
			const view = new EmbedBuilder()
				.setColor(`#A52F05`)
				.setTitle(`Viewing Autoroles`)
				.setDescription(`**Sticky Roles**: ${db.stickyRoles.enabled ? `On` : `Off`}\n**Join Roles**: ${db.joinRoles?.length > 0 ? `\n${db.joinRoles.map((r) => `<@&${r}>`)}` : client.translate.get(db.language, 'Events.messageReactionAdd.none')}`);

			message.reply({ embeds: [view] });
			break;

		case 'sticky':
			const sticky = !db.stickyRolesEnabled;
			await client.database.updateGuild(message.guildId, { stickyRolesEnabled: sticky });

			setTimeout(() => client.used.delete(`${message.author.id}-autoroles`), 6000);
			message.reply({ embeds: [new EmbedBuilder().setDescription(`${client.translate.get(db.language, 'Commands.autoroles.sticky')} **${sticky ? client.translate.get(db.language, 'Commands.roles.on') : client.translate.get(db.language, 'Commands.roles.off')}**`).setColor(`#A52F05`)] });
			break;

		case 'join':
			if (args[1] === 'add') {
				if (!options[0]) return message.reply({ embeds: [new EmbedBuilder().setDescription(`${client.translate.get(db.language, 'Commands.autoroles.noOptionsAdd')}: \`${db.prefix}autoroles join add Member, Color Roles\``).setColor(`#FF0000`)] });
				const roleIds = await getRoles(options, message, client, db, false, false);
				if (!roleIds) return;
				if (roleIds?.length > 20 || roleIds.length + db.joinRoles.length >= 21) return message.reply({ embeds: [new EmbedBuilder().setDescription(`${client.translate.get(db.language, 'Commands.autoroles.tooMany')}`).setColor(`#FF0000`)] });

				let duplicate = [];
				roleIds
					.map((c) => c[0])
					.map((r, i) => {
						i++;
						if (db.joinRoles.filter((e) => e === r).length > 0) duplicate.push(roleIds[i - 1]);
					});

				const errored = [];
				roleIds
					.map((r) => r[0])
					.map((r) => {
						if (db.joinRoles.includes(r)) errored.push(r);
					});

				const newRoles = db.joinRoles.concat(roleIds.filter((r) => !errored.includes(r[0])).map((r) => r[0]));
				if (newRoles.length === db.joinRoles.length && errored.length > 0) return message.reply({ embeds: [new EmbedBuilder().setDescription(`${client.translate.get(db.language, 'Commands.autoroles.roleErrorsAdd')} ${errored.map((r) => `<@&${r}>`)}`).setColor(`#FF0000`)] });

				await client.database.updateGuild(message.guild?.id, { joinRoles: newRoles });
				return message.reply({
					embeds: [
						new EmbedBuilder()
							.setDescription(
								`${client.translate.get(db.language, 'Commands.autoroles.completeAdd')} ${roleIds
									.map((r) => r[0])
									.filter((r) => !errored.includes(r))
									.map((r) => `<@&${r}>`)}${newRoles.length !== db.joinRoles.length && errored.length > 0 ? `\n\n${client.translate.get(db.language, 'Commands.autoroles.someRoleErrorsAdd')} ${errored.map((r) => `<@&${r}>`)}` : ''}`,
							)
							.setColor(`#A52F05`),
					],
				});
			} else if (args[1] === 'remove') {
				if (!options[0]) return message.reply({ embeds: [new EmbedBuilder().setDescription(`${client.translate.get(db.language, 'Commands.autoroles.noOptionsRemove')}: \`${db.prefix}autoroles join remove Member, Color Roles\``).setColor(`#FF0000`)] });
				const roleIds = await getRoles(options, message, client, db, false, false);
				if (!roleIds) return;

				const errored = [];
				roleIds
					.map((r) => r[0])
					.map((r) => {
						if (!db.joinRoles.includes(r)) errored.push(r);
					});

				const toRemove = db.joinRoles.filter((r) => !roleIds.map((r) => r[0]).includes(r));
				if (toRemove.length === db.joinRoles.length && errored.length > 0) return message.reply({ embeds: [new EmbedBuilder().setDescription(`${client.translate.get(db.language, 'Commands.autoroles.roleErrorsRemove')} ${errored.map((r) => `<@&${r}>`)}`).setColor(`#FF0000`)] });

				message.reply({
					embeds: [
						new EmbedBuilder()
							.setDescription(
								`${client.translate.get(db.language, 'Commands.autoroles.completeRemove')} ${roleIds
									.map((r) => r[0])
									.filter((r) => !errored.includes(r))
									.map((r) => `<@&${r}>`)}${toRemove.length !== db.joinRoles.length && errored.length > 0 ? `\n\n${client.translate.get(db.language, 'Commands.autoroles.someRoleErrorsRemove')} ${errored.map((r) => `<@&${r}>`)}` : ''}`,
							)
							.setColor(`#A52F05`),
					],
				});
				await client.database.updateGuild(message.guild?.id, { joinRoles: toRemove });
			} else {
				message.reply({ embeds: [new EmbedBuilder().setDescription(`${client.translate.get(db.language, 'Commands.autoroles.noOptionsAdd')}: \`${db.prefix}autoroles join add Member, Color Roles\``).setColor(`#FF0000`)] });
			}
			break;
	}
}
