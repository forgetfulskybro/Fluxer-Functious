module.exports = async (
  client,
  message,
  paginateCheck,
  reactionMsg,
  emojiId,
  userId,
) => {
  const pages = paginateCheck.pages;
  let page = paginateCheck.page;

  const removeReaction = async () => {
    await reactionMsg.removeReaction(emojiId, userId).catch(() => {});
  };

  switch (emojiId) {
    case "⏪":
      if (page !== 0) {
        await reactionMsg?.edit({ embeds: [pages[0]] });
        await removeReaction();
        return (paginateCheck.page = 0);
      }
      await removeReaction();
      return;
    case "⬅️":
      if (pages[page - 1]) {
        await reactionMsg?.edit({ embeds: [pages[--page]] });
        await removeReaction();
        return (paginateCheck.page = paginateCheck.page - 1);
      }
      await removeReaction();
      return;
    case "➡️":
      if (pages[page + 1]) {
        await reactionMsg?.edit({ embeds: [pages[++page]] });
        await removeReaction();
        return (paginateCheck.page = paginateCheck.page + 1);
      }
      await removeReaction();
      return;
    case "⏩":
      if (page !== pages.length - 1) {
        await reactionMsg?.edit({ embeds: [pages[pages.length - 1]] });
        await removeReaction();
        return (paginateCheck.page = pages.length - 1);
      }
      await removeReaction();
      return;
  }
};
