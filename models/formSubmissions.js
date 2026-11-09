const { Schema, model } = require("mongoose");

const submissions = new Schema({
  formId: { type: String, required: true, index: true },
  guildId: { type: String, required: true, index: true },
  userId: { type: String, required: true, index: true },
  status: {
    type: String,
    enum: ["in_progress", "pending", "accepted", "declined", "withdrawn", "expired"],
    default: "in_progress",
    index: true,
  },
  answers: {
    type: [{
      questionId: { type: String, required: true },
      value: { type: String, default: "" },
    }],
    default: [],
  },
  currentQuestionIndex: { type: Number, default: 0 },
  dmChannelId: { type: String, default: null },
  promptMessageId: { type: String, default: null },
  reviewChannelId: { type: String, default: null },
  reviewMessageId: { type: String, default: null, index: true },
  reviewPage: { type: Number, default: 0 },
  reviewerId: { type: String, default: null },
  reviewState: { type: String, enum: ["none", "awaiting_reason", "done"], default: "none" },
  reason: { type: String, default: null },
  reviewedAt: { type: Number, default: null },
  createdAt: { type: Number, default: Date.now },
  updatedAt: { type: Number, default: Date.now },
  submittedAt: { type: Number, default: null },
  expiresAt: { type: Number, default: null },
});

submissions.index({ formId: 1, userId: 1, status: 1 });
submissions.index(
  { formId: 1, userId: 1 },
  { unique: true, partialFilterExpression: { status: "in_progress" } }
);
submissions.index({ guildId: 1, formId: 1, status: 1 });
submissions.index({ promptMessageId: 1 });

module.exports = model("formSubmissions", submissions);
