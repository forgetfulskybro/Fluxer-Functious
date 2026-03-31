import db from '../models/polls';
import Polls from './poll';

async function checkPolls(client) {
	let polls = await db.find();
	if (!polls || polls.length === 0) return;
	let i = 0;
	for (let poll of polls) {
		i++;
		setTimeout(async () => {
			const time = poll.now - (Date.now() - poll.time),
				users = poll.users,
				avatars = poll.avatars,
				votes = poll.votes,
				desc = poll.desc,
				name = poll.name,
				names = poll.options,
				owner = poll.owner,
				lang = poll.lang;
			const newPoll = new Polls({ time, client, name: { name: name, description: desc }, options: names, votes: votes, users: users, avatars: avatars, owner: owner, lang: lang });

			try {
				const msg = (await client.channels.resolve(poll.channelId))?.messages?.fetch(poll.messageId);
				if (msg) newPoll.start(msg, newPoll);
				polls.deleteOne({ messageId: poll.messageId });
			} catch (e) {
				await db.findOneAndDelete({ messageId: poll.messageId });
			}
		}, i * 700);
	}
}

export default checkPolls;
