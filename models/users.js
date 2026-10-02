const { Schema, model } = require("mongoose");

const reminderSchema = new Schema({
  id: { type: String, required: true },
  timestamp: { type: Number, required: true },
  message: { type: String, required: true },
  channelId: { type: String },
  sourceMessageId: { type: String },
  createdAt: { type: Number, required: true },
  type: { type: String, enum: ["guild", "dm"], required: true },
});

const reactionReminderSchema = new Schema({
  id: { type: String, required: true },
  guildId: { type: String, required: true },
  guildName: { type: String, default: "" },
  channelId: { type: String, required: true },
  channelName: { type: String, default: "" },
  sourceMessageId: { type: String, required: true },
  sourceAuthorId: { type: String },
  sourceType: { type: String, enum: ["content", "embed", "attachment"], default: "content" },
  fingerprint: { type: String, required: true },
  sample: { type: String, default: "" },
  reminderMessage: { type: String, default: "" },
  attachmentNames: { type: [String], default: [] },
  durationSeconds: { type: Number, required: true },
  language: { type: String, default: "en_EN" },
  createdAt: { type: Number, required: true },
});

const userSchema = new Schema({
  userId: { type: String, required: true, unique: true },
  timezone: { type: String, default: null },
  reminders: { type: [reminderSchema], default: [] },
  reactionReminders: { type: [reactionReminderSchema], default: [] },
  birthday: {
    day: { type: Number, default: null },
    month: { type: Number, default: null },
    age: { type: Number, default: null },
    lastBirthday: { type: Number, default: null },
    ping: { type: Boolean, default: true },
    enabledGuilds: { type: [String], default: [] },
  },
});

userSchema.index({ "reactionReminders.channelId": 1 });
userSchema.index({ "reactionReminders.guildId": 1 });

module.exports = model("users", userSchema);
