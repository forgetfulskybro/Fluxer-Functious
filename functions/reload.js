import fs from 'fs';
import path from 'path';

function Reload(client, category, name) {
	if (category === 'events') {
		if (!name) return 'Provide an event name to reload!';
		try {
			const evtName = name;
			delete require.cache[require.resolve(`../events/${name}.js`)];
			const pull = require(`../events/${name}`);

			client.off(evtName, typeof client._events[evtName] == 'function' ? client._events[evtName] : client._events[evtName][0]);
			client.event.delete(evtName);

			client.on(evtName, pull.bind(null, client));
			client.event.set(evtName, pull.bind(null, client));
		} catch (e) {
			return `Couldn't reload: **${category}/${name}**\n**Error**: ${e.message}`;
		}
		return `Reloaded event: **${name}**.js`;
	}

	if (category === 'functions') {
		if (!name) return 'Provide a function name to reload!';
		try {
			const evtName = name;
			delete require.cache[require.resolve(`../functions/${name}.js`)];
			const pull = require(`../functions/${name}`);

			client.functions.delete(evtName);
			client.functions.set(evtName, pull);
		} catch (e) {
			return `Couldn't reload: **functions/${name}**\n**Error**: ${e.message}`;
		}
		return `Reloaded function: **${name}**.js`;
	}

	if (category === 'reactionHandlers') {
		if (!name) return 'Provide a reaction handler file name to reload!';
		try {
			const handlerName = name;
			delete require.cache[require.resolve(`../reactionHandlers/${name}.js`)];
			const pull = require(`../reactionHandlers/${name}`);

			client.reactionHandlers.delete(handlerName);
			client.reactionHandlers.set(handlerName, pull);
		} catch (e) {
			return `Couldn't reload: **reactionHandlers/${name}**\n**Error**: ${e.message}`;
		}
		return `Reloaded reaction handler: **${name}**.js`;
	}

	if (category === 'languages') {
		try {
			const languagesPath = path.join(__dirname, '../languages');
			const languageFiles = fs.readdirSync(languagesPath).filter((file) => file.endsWith('.json'));

			for (const file of languageFiles) {
				delete require.cache[require.resolve(path.join(languagesPath, file))];
			}

			if (client.translate && typeof client.translate.reload === 'function') {
				client.translate.reload();
			}

			return `Reloaded **${languageFiles.length}** language files`;
		} catch (e) {
			return `Couldn't reload languages\n**Error**: ${e.message}`;
		}
	}

	try {
		if (!category) return 'Provide a command name to reload!';

		delete require.cache[require.resolve(`../commands/${category}.js`)];
		const pull = require(`../commands/${category}.js`);

		if (client.commands.get(category).config.aliases) client.commands.get(category).config.aliases.forEach((a) => client.aliases.delete(a));
		client.commands.delete(category);
		client.commands.set(category, pull);

		if (client.commands.get(category).config.aliases) client.commands.get(category).config.aliases.forEach((a) => client.aliases.set(a, category));
		return `Reloaded command: **commands/${category}**.js`;
	} catch (e) {
		return `Couldn't reload: **commands/${category}**\n**Error**: ${e.message}`;
	}
}

export default Reload;
