import { readdirSync } from 'fs';
import color from '../functions/colorCodes';

export default (client) => {
	const events = readdirSync(`./events/`).filter((d) => d.endsWith('.js'));
	for (let file of events) {
		let evt = require(`../events/${file}`);
		client.event.set(file.split('.')[0], evt.bind(null, client));
		client.on(file.split('.')[0], evt.bind(null, client));
	}

	console.log(color('%', `%b[Event_Handler]%7 :: Loaded %e${client.event.size} %7events`));
};
