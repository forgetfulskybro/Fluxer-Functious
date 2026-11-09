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
    this.pages.forEach((e, i = 0) => {
      const pageLabel = `Page ${i + 1} / ${this.pages.length}`;
      const footer = e.data.footer ?? {};
      e.data.footer = {
        ...footer,
        text: footer.text ? `${footer.text} • ${pageLabel}` : pageLabel,
      };
    });

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
      if (this.client.paginate.get(this.user)) {
        const msgId = this.client.paginate.get(this.user).message;
        const channelId = this.client.paginate.get(this.user).channel;
        
        try {
          this.client.channels.cache.get(channelId)?.messages.fetch(msgId).then((msg) => {
            msg.removeAllReactions().catch(() => {});
          });
        } catch {}
        this.client.paginate.delete(this.user);
      }
    }, this.timeout);
  }
}

module.exports = Paginator;
