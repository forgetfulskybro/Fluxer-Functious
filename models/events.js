const { Schema, model } = require("mongoose");

const events = new Schema({
  guildId: { type: String, required: true, index: true },
  channelId: { type: String, required: true },
  messageId: { type: String, required: true, unique: true },
  hostId: { type: String, required: true },
  title: { type: String, required: true },
  description: { type: String, default: null },
  footer: { type: String, default: null },
  startAt: { type: Number, required: true, index: true },
  endAt: { type: Number, default: null },
  timezone: { type: String, default: "UTC" },
  location: { type: String, default: null },
  imageUrl: { type: String, default: null },
  color: { type: String, default: null },
  capacity: { type: Number, default: null },
  waitlistEnabled: { type: Boolean, default: true },
  attendeeRoleId: { type: String, default: null },
  signupCutoffAt: { type: Number, default: null },
  postAt: { type: Number, default: null, index: true },
  postedAt: { type: Number, default: null },
  rsvpOptions: {
    going: {
      emoji: { type: String, default: "✅" },
      label: { type: String, default: "Going" },
    },
    maybe: {
      emoji: { type: String, default: "❔" },
      label: { type: String, default: "Maybe" },
      enabled: { type: Boolean, default: true },
    },
    declined: {
      emoji: { type: String, default: "❌" },
      label: { type: String, default: "Not going" },
      enabled: { type: Boolean, default: true },
    },
  },
  reminders: {
    type: [{
      offsetMs: { type: Number, required: true },
      sent: { type: Boolean, default: false },
      mode: { type: String, enum: ["channel", "dm", "both"], default: "channel" },
      message: { type: String, default: null },
    }],
    default: [],
  },
  pingRoleId: { type: String, default: null },
  requiredRoleIds: { type: [String], default: [] },
  status: { type: String, enum: ["scheduled", "live", "ended", "cancelled"], default: "scheduled", index: true },
  recurrence: { type: Object, default: null },
  createdAt: { type: Number, default: Date.now },
  updatedAt: { type: Number, default: Date.now },
});

events.index({ guildId: 1, status: 1, startAt: 1 });

module.exports = model("events", events);
