export default async (client, message, paginateCheck, reactionMsg, emojiId) => {
	const pages = paginateCheck.pages;
	let page = paginateCheck.page;

	switch (emojiId) {
		case '⏪':
			if (page !== 0) {
				await reactionMsg?.edit({ embeds: [pages[0]] });
				return (paginateCheck.page = 0);
			}
			return;
		case '⬅️':
			if (pages[page - 1]) {
				await reactionMsg?.edit({ embeds: [pages[--page]] });
				return (paginateCheck.page = paginateCheck.page - 1);
			}
			return;
		case '➡️':
			if (pages[page + 1]) {
				await reactionMsg?.edit({ embeds: [pages[++page]] });
				return (paginateCheck.page = paginateCheck.page + 1);
			}
			return;
		case '⏩':
			if (page !== pages.length - 1) {
				await reactionMsg?.edit({ embeds: [pages[pages.length - 1]] });
				return (paginateCheck.page = pages.length - 1);
			}
			return;
	}
};
