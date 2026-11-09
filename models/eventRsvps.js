const { Schema, model } = require("mongoose");

const eventRsvps = new Schema({
  eventId: { type: String, required: true, index: true },
  guildId: { type: String, required: true, index: true },
  userId: { type: String, required: true },
  response: { type: String, enum: ["going", "maybe", "declined"], required: true },
  waitlisted: { type: Boolean, default: false },
  createdAt: { type: Number, default: Date.now },
  updatedAt: { type: Number, default: Date.now },
});

eventRsvps.index({ eventId: 1, userId: 1 }, { unique: true });
eventRsvps.index({ eventId: 1, waitlisted: 1, createdAt: 1 });

module.exports = model("eventRsvps", eventRsvps);
