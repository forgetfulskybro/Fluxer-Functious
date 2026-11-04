const { Schema, model } = require("mongoose");

const noteSchema = new Schema(
  {
    id: { type: String, required: true },
    userId: { type: String, required: true },
    text: { type: String, required: true },
    createdAt: { type: Number, default: Date.now },
  },
  { _id: false },
);

const previousSchema = new Schema(
  {
    value: { type: String, default: "" },
    status: { type: String, enum: ["pending", "approved"], default: "approved" },
    updatedBy: { type: String, default: null },
    updatedAt: { type: Number, default: 0 },
  },
  { _id: false },
);

const translationSchema = new Schema({
  language: { type: String, required: true },
  key: { type: String, required: true },
  value: { type: String, default: "" },
  base: { type: String, default: "" },
  status: { type: String, enum: ["pending", "approved"], default: "pending" },
  updatedBy: { type: String, default: null },
  translatedBy: { type: String, default: null },
  translatedAt: { type: Number, default: null },
  updatedAt: { type: Number, default: 0 },
  approvedAt: { type: Number, default: null },
  editedAt: { type: Number, default: null },
  previous: { type: previousSchema, default: null },
  notes: { type: [noteSchema], default: [] },
});

translationSchema.index({ language: 1, key: 1 }, { unique: true });
translationSchema.index({ language: 1, status: 1 });
translationSchema.index({ updatedBy: 1 });

module.exports = model("translations", translationSchema);
