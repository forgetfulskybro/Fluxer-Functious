const { Schema, model } = require("mongoose");

const reminderSchema = new Schema({
  id: { type: String, required: true },
  timestamp: { type: Number, required: true },
  message: { type: String, required: true },
  channelId: { type: String },
  createdAt: { type: Number, required: true },
  type: { type: String, enum: ["guild", "dm"], required: true },
});

const userSchema = new Schema({
  userId: { type: String, required: true, unique: true },
  timezone: { type: String, default: null },
  reminders: { type: [reminderSchema], default: [] },
  birthday: {
    day: { type: Number, default: null },
    month: { type: Number, default: null },
    age: { type: Number, default: null },
    lastBirthday: { type: Number, default: null },
    ping: { type: Boolean, default: true },
    enabledGuilds: { type: [String], default: [] },
  },
});

module.exports = model("users", userSchema);
