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
    this.pollModel = require("../models/polls");
    this.giveawayModel = require("../models/giveaways");
    this.translationModel = require("../models/translations");
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
        if (!client?.isReady?.()) return;

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
    const oldData = await this.getUser(userId, createIfNotFound);
    if (!oldData) return null;

    const updates = { ...data };
    delete updates._id;
    delete updates.__v;
    delete updates.userId;

    if (Object.keys(updates).length === 0) return null;
    const result = await this.userModel.updateOne(
      { userId },
      { $set: updates },
    );

    if (result.matchedCount) this.userCache.delete(userId);
    return result;
  }

  async addUserReminder(userId, reminder) {
    const result = await this.userModel.updateOne(
      { userId },
      { $push: { reminders: reminder } },
    );

    if (result.matchedCount) this.userCache.delete(userId);
    return result;
  }

  async updateUserReminder(userId, reminderId, updates = {}) {
    const $set = {};
    if (updates.message !== undefined) $set['reminders.$.message'] = updates.message;
    if (updates.timestamp !== undefined) $set['reminders.$.timestamp'] = updates.timestamp;

    if (Object.keys($set).length === 0) return null;

    const result = await this.userModel.updateOne(
      { userId, 'reminders.id': reminderId },
      { $set },
    );

    if (result.matchedCount) this.userCache.delete(userId);
    return result;
  }

  async deleteUserReminder(userId, reminderId) {
    const result = await this.userModel.updateOne(
      { userId, 'reminders.id': reminderId },
      { $pull: { reminders: { id: reminderId } } },
    );

    if (result.matchedCount) this.userCache.delete(userId);
    return result;
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

  // Only use this from an explicit guild-removal flow, never a periodic sweep.
  async deleteGuild(guildId, onlyCache = false) {
    if (this.cache.has(guildId)) this.cache.delete(guildId);

    return !onlyCache ? this.guildModel.deleteMany({ id: guildId }) : true;
  }

  async updateGuild(guildId, data = {}, createIfNotFound = false) {
    const oldData = await this.getGuild(guildId, createIfNotFound);
    if (!oldData) return null;

    const updates = { ...data };
    delete updates._id;
    delete updates.__v;
    delete updates.id;

    if (Object.keys(updates).length === 0) return null;

    const result = await this.guildModel.updateOne(
      { id: guildId },
      { $set: updates },
    );

    if (result.matchedCount) this.cache.delete(guildId);
    return result;
  }

  async updateGuildAtomic(guildId, update, match = {}) {
    const result = await this.guildModel.updateOne(
      { id: guildId, ...match },
      update,
    );

    if (result.matchedCount) this.cache.delete(guildId);
    return result;
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
