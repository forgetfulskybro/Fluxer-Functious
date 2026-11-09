const { Schema, model } = require("mongoose");

const questionSchema = new Schema({
  id: { type: String, required: true },
  type: { type: String, enum: ["text", "paragraph", "choice"], default: "text" },
  prompt: { type: String, required: true },
  required: { type: Boolean, default: true },
  minLength: { type: Number, default: 0 },
  maxLength: { type: Number, default: 1000 },
  choices: {
    type: [{
      label: { type: String, required: true },
      emoji: { type: String, default: null },
    }],
    default: [],
  },
}, { _id: false });

const forms = new Schema({
  guildId: { type: String, required: true, index: true },
  name: { type: String, required: true },
  description: { type: String, default: null },
  status: { type: String, enum: ["draft", "open", "closed"], default: "draft", index: true },
  panelChannelId: { type: String, default: null },
  panelMessageId: { type: String, default: null },
  panelEmoji: { type: String, default: "📝" },
  reviewChannelId: { type: String, default: null },
  reviewerRoleIds: { type: [String], default: [] },
  reviewerPing: { type: Boolean, default: true },
  color: { type: String, default: null },
  imageUrl: { type: String, default: null },
  introMessage: { type: String, default: null },
  confirmationMessage: { type: String, default: null },
  acceptMessage: { type: String, default: null },
  declineMessage: { type: String, default: null },
  questions: { type: [questionSchema], default: [] },
  cooldownMs: { type: Number, default: 24 * 60 * 60 * 1000 },
  allowMultiple: { type: Boolean, default: false },
  maxSubmissions: { type: Number, default: 0 },
  dmApplicant: { type: Boolean, default: true },
  anonymous: { type: Boolean, default: false },
  requiredRoleIds: { type: [String], default: [] },
  createdBy: { type: String, required: true },
  createdAt: { type: Number, default: Date.now },
  updatedAt: { type: Number, default: Date.now },
});

forms.index({ guildId: 1, name: 1 });
forms.index({ panelMessageId: 1 });

module.exports = model("forms", forms);
