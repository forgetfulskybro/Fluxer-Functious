const { connect } = require("mongoose").set("strictQuery", true);
const color = require("../functions/colorCodes");

const GUILD_CACHE_MAX = 5000;
const USER_CACHE_MAX = 20000;

module.exports = class DatabaseHandler {
  constructor(connectionString) {
    this.cache = new Map();
    this.userCache = new Map();
    this.guildCacheMax = GUILD_CACHE_MAX;
    this.userCacheMax = USER_CACHE_MAX;
    this.guildModel = require("../models/guilds");
    this.userModel = require("../models/users");
    this.connectionString = connectionString;
  }

  setBounded(map, key, value, max) {
    if (map.has(key)) map.delete(key);
    map.set(key, value);
    while (map.size > max) {
      const oldest = map.keys().next().value;
      map.delete(oldest);
    }
  }

  cacheSweeper(client) {
    const interval = setInterval(
      () => {
        const guilds = [...this.cache.keys()];
        for (const gid of guilds) {
          if (!client?.guilds?.has(gid)) {
            this.cache.delete(gid);
          }
        }
      },
      60 * 60 * 1000,
    );
    if (interval.unref) interval.unref();
  }

  guildSweeper(client) {
    const delay = (ms) => new Promise((resolve) => {
      const t = setTimeout(resolve, ms);
      if (t.unref) t.unref();
    });

    const interval = setInterval(
      async () => {
        try {
          const guilds = await this.guildModel.find({}, { id: 1 }).lean();
          for (const g of guilds) {
            if (!client?.guilds?.has(g?.id)) {
              this.cache.delete(g?.id);
              await this.deleteGuild(g?.id).catch(() => {});
              await delay(3000);
            }
          }
        } catch {}
      },
      180 * 180 * 1000,
    );
    if (interval.unref) interval.unref();
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
      const cachedUser = this.userCache.get(userId);
      this.userCache.delete(userId);
      this.userCache.set(userId, cachedUser);
      return cachedUser;
    }

    const fetched = await this.fetchUser(userId, createIfNotFound);
    if (fetched) {
      this.setBounded(this.userCache, userId, fetched?.toObject() ?? fetched, this.userCacheMax);
      return this.userCache.get(userId);
    }
    return null;
  }

  async updateUser(userId, data = {}, createIfNotFound = false) {
    let oldData = await this.getUser(userId, createIfNotFound);

    if (oldData) {
      if (oldData?._doc) oldData = oldData?._doc;

      data = { ...oldData, ...data };
      this.setBounded(this.userCache, userId, data, this.userCacheMax);

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
      const cachedGuild = this.cache.get(guildId);
      this.cache.delete(guildId);
      this.cache.set(guildId, cachedGuild);
      return cachedGuild;
    }

    const fetched = await this.fetchGuild(guildId, createIfNotFound);
    if (fetched) {
      this.setBounded(this.cache, guildId, fetched?.toObject() ?? fetched, this.guildCacheMax);

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

      this.setBounded(this.cache, guildId, data, this.guildCacheMax);

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

  async getPoll(messageId, createIfNotFound = true) {
    return this.fetchPoll(messageId, createIfNotFound);
  }

  async updatePoll(messageId, data = {}, createIfNotFound = false) {
    const oldData = await this.fetchPoll(messageId, false);

    if (oldData) {
      return this.pollModel.updateOne({ messageId }, { ...oldData.toObject(), ...data });
    }
    return null;
  }

  async deletePoll(messageId) {
    return this.pollModel.deleteMany({ messageId });
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

  async getGiveaway(messageId, createIfNotFound = true) {
    return this.fetchGiveaway(messageId, createIfNotFound);
  }

  async updateGiveaway(messageId, data = {}, createIfNotFound = false) {
    const oldData = await this.fetchGiveaway(messageId, false);

    if (oldData) {
      return this.giveawayModel.updateOne({ messageId }, { ...oldData.toObject(), ...data });
    }
    return null;
  }

  async deleteGiveaway(messageId) {
    return this.giveawayModel.deleteMany({ messageId });
  }

  async getAllGiveaways() {
    return this.giveawayModel.find();
  }
};
