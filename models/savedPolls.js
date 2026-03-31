import { Schema, model } from "mongoose";

const savedPolls = new Schema({
    owner: { type: String },
    desc: { type: String },
    options: { type: Object },
});

export default model("savedPolls", savedPolls); 
