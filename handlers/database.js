const { connect } = require("mongoose").set("strictQuery", true);
const color = require("../functions/colorCodes");

module.exports = class DatabaseHandler {
  constructor(connectionString) {
    this.cache = new Map();
    this.userCache = new Map();
    this.pollCache = new Map();
    this.giveawayCache = new Map();
    this.guildModel = require("../models/guilds");
    this.userModel = require("../models/users");
    this.pollModel = require("../models/polls");
    this.giveawayModel = require("../models/giveaways");
    this.connectionString = connectionString;
  }

  cacheSweeper(client) {
    setInterval(
      () => {
        const guilds = this.cache.values();
        for (const g of guilds) {
          if (!client?.guilds?.has(g?.id)) {
            this.cache.delete(g?.id);
          }
        }
        
        const users = this.userCache.values();
        for (const u of users) {
          if (!client?.users?.has(u?.userId)) {
            this.userCache.delete(u?.userId);
          }
        }
      },
      60 * 60 * 1000,
    );
  }

  guildSweeper(client) {
    setInterval(
      async () => {
        const guilds = await this.getAll();
        let i = 0;
        for (const g of guilds) {
          setTimeout(async () => {
            i++;
            if (!client?.guilds?.has(g?.id)) {
              this.cache.delete(g?.id);
              this.deleteGuild(g?.id);
            }
          }, i * 3000);
        }
      },
      180 * 180 * 1000,
    );
  }

  async connectToDatabase() {
    await connect(this.connectionString)
      .catch((err) => {
        console.log(color("%", `%4[Mongoose]%7 :: ${err}`));
      })
      .then(() =>
        console.log(color("%", "%6[Mongoose]%7 :: Connected to MongoDB")),
      );
  }

  async fetchUser(userId, createIfNotFound = false) {
    const fetched = await this.userModel.findOne({ userId });

    if (fetched) return fetched;
    if (!fetched && createIfNotFound) {
      return this.userModel.create({
        userId,
        reminders: [],
        timezone: null,
      });
    }
    return null;
  }

  async getUser(userId, createIfNotFound = true, force = false) {
    if (force) return this.fetchUser(userId, createIfNotFound);

    if (this.userCache.has(userId)) {
      return this.userCache.get(userId);
    }

    const fetched = await this.fetchUser(userId, createIfNotFound);
    if (fetched) {
      this.userCache.set(userId, fetched?.toObject() ?? fetched);
      return this.userCache.get(userId);
    }
    return null;
  }

  async updateUser(userId, data = {}, createIfNotFound = false) {
    let oldData = await this.getUser(userId, createIfNotFound);

    if (oldData) {
      if (oldData?._doc) oldData = oldData?._doc;

      data = { ...oldData, ...data };
      this.userCache.set(userId, data);

      return this.userModel.updateOne({ userId }, data);
    }
    return null;
  }

  async deleteUser(userId, onlyCache = false) {
    if (this.userCache.has(userId)) this.userCache.delete(userId);
    return !onlyCache ? this.userModel.deleteMany({ userId }) : true;
  }

  async getAllUsers() {
    return this.userModel.find();
  }

  async fetchGuild(guildId, createIfNotFound = false) {
    const fetched = await this.guildModel.findOne({ id: guildId });

    if (fetched) return fetched;
    if (!fetched && createIfNotFound) {
      await this.guildModel.create({
        id: guildId,
        language: "en_EN",
        botJoined: (Date.now() / 1000) | 0,
      });

      return this.guildModel.findOne({ id: guildId });
    }
    return null;
  }

  async getGuild(guildId, createIfNotFound = true, force = false) {
    if (force) return this.fetchGuild(guildId, createIfNotFound);

    if (this.cache.has(guildId)) {
      return this.cache.get(guildId);
    }

    const fetched = await this.fetchGuild(guildId, createIfNotFound);
    if (fetched) {
      this.cache.set(guildId, fetched?.toObject() ?? fetched);

      return this.cache.get(guildId);
    }
    return null;
  }

  async deleteGuild(guildId, onlyCache = false) {
    if (this.cache.has(guildId)) this.cache.delete(guildId);

    return !onlyCache ? this.guildModel.deleteMany({ id: guildId }) : true;
  }

  async updateGuild(guildId, data = {}, createIfNotFound = false) {
    let oldData = await this.getGuild(guildId, createIfNotFound);

    if (oldData) {
      if (oldData?._doc) oldData = oldData?._doc;

      data = { ...oldData, ...data };

      this.cache.set(guildId, data);

      return this.guildModel.updateOne(
        {
          id: guildId,
        },
        data,
      );
    }
    return null;
  }

  async getAll() {
    return this.guildModel.find();
  }

  async fetchPoll(messageId, createIfNotFound = false) {
    const fetched = await this.pollModel.findOne({ messageId });

    if (fetched) return fetched;
    if (!fetched && createIfNotFound) {
      return this.pollModel.create({ messageId });
    }
    return null;
  }

  async getPoll(messageId, createIfNotFound = true, force = false) {
    if (force) return this.fetchPoll(messageId, createIfNotFound);

    if (this.pollCache.has(messageId)) {
      return this.pollCache.get(messageId);
    }

    const fetched = await this.fetchPoll(messageId, createIfNotFound);
    if (fetched) {
      this.pollCache.set(messageId, fetched?.toObject() ?? fetched);
      return this.pollCache.get(messageId);
    }
    return null;
  }

  async updatePoll(messageId, data = {}, createIfNotFound = false) {
    let oldData = await this.getPoll(messageId, createIfNotFound);

    if (oldData) {
      if (oldData?._doc) oldData = oldData?._doc;

      data = { ...oldData, ...data };
      this.pollCache.set(messageId, data);

      return this.pollModel.updateOne({ messageId }, data);
    }
    return null;
  }

  async deletePoll(messageId, onlyCache = false) {
    if (this.pollCache.has(messageId)) this.pollCache.delete(messageId);
    return !onlyCache ? this.pollModel.deleteMany({ messageId }) : true;
  }

  async getAllPolls() {
    return this.pollModel.find();
  }

  async fetchGiveaway(messageId, createIfNotFound = false) {
    const fetched = await this.giveawayModel.findOne({ messageId });

    if (fetched) return fetched;
    if (!fetched && createIfNotFound) {
      return this.giveawayModel.create({ messageId });
    }
    return null;
  }

  async getGiveaway(messageId, createIfNotFound = true, force = false) {
    if (force) return this.fetchGiveaway(messageId, createIfNotFound);

    if (this.giveawayCache.has(messageId)) {
      return this.giveawayCache.get(messageId);
    }

    const fetched = await this.fetchGiveaway(messageId, createIfNotFound);
    if (fetched) {
      this.giveawayCache.set(messageId, fetched?.toObject() ?? fetched);
      return this.giveawayCache.get(messageId);
    }
    return null;
  }

  async updateGiveaway(messageId, data = {}, createIfNotFound = false) {
    let oldData = await this.getGiveaway(messageId, createIfNotFound);

    if (oldData) {
      if (oldData?._doc) oldData = oldData?._doc;

      data = { ...oldData, ...data };
      this.giveawayCache.set(messageId, data);

      return this.giveawayModel.updateOne({ messageId }, data);
    }
    return null;
  }

  async deleteGiveaway(messageId, onlyCache = false) {
    if (this.giveawayCache.has(messageId)) this.giveawayCache.delete(messageId);
    return !onlyCache ? this.giveawayModel.deleteMany({ messageId }) : true;
  }

  async getAllGiveaways() {
    return this.giveawayModel.find();
  }
};
