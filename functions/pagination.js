const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class Paginator {
  constructor({ user, client, timeout }) {
    this.pages = [];
    this.client = client;
    this.user = user;
    this.page = 0;
    this.timeout = timeout;
    this.foundMsg;
  }

  add(page) {
    if (page.length) {
      page.forEach((x) => {
        this.pages.push(x);
      });
      return this;
    }
    this.pages.push(page);
    return this;
  }

  async start(channel) {
    if (!this.pages.length) return;
    const reactions = ["⏪", "⬅️", "➡️", "⏩"];
    this.pages.forEach(
      (e, i = 0) =>
        (e.data.description = `${e.data.description}\n\nPage ${i + 1} / ${this.pages.length}`),
    );

    await channel.send({ embeds: [this.pages[0]] }).then(async (msg) => {
      this.client.paginate.set(this.user, {
        pages: this.pages,
        page: this.page,
        message: msg?.id,
        channel: msg?.channelId,
      });

      for (const reaction of reactions) {
          await msg.react(reaction).catch(() => {});
      }
    });

    setTimeout(() => {
      if (this.client.paginate.get(this.user))
        this.client.paginate.delete(this.user);
    }, this.timeout);
  }
}

module.exports = Paginator;
