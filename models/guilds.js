const { Schema, model } = require("mongoose");

const guilds = new Schema({
  id: { type: String },
  prefix: { type: String, default: "f!" },
  language: { type: String, default: "en_EN" },
  joined: { type: String, default: (Date.now() / 1000) | 0 },
  dm: { type: Boolean, default: true },
  roles: { type: Array, default: [] },
  joinRoles: { type: Array, default: [] },
  stickyRolesEnabled: { type: Boolean, default: false },
  stickyRoles: { type: Array, default: [] },
  bypassRoles: { type: Array, default: [] },
  timedRoles: { type: Array, default: [] },
  usersJoined: { type: Array, default: [] },
  timezoneConvert: { type: Boolean, default: false },
  userTimezones: { type: Array, default: [] },
  parentChannel: { type: String, default: null },
  childChannel: { type: String, default: null },
  tempChannels: { type: Array, default: [] },
  config: {
    channelName: { type: String, default: null },
    channelLimit: { type: Number, default: null },
    counting: { type: Boolean, default: false },
    customParent: { type: String, default: null },
    manage: { type: String, nullable: true, default: null },
    manageMessage: { type: String, nullable: true, default: null },
  },
});

module.exports = model("guilds", guilds);
