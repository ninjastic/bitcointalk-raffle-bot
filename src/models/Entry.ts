import { Schema, model } from "mongoose";

export interface IEntry {
  entry_id: number;
  game_id: number;
  post_id: number;
  topic_id: number;
  author: string;
  author_uid: number;
}

const entrySchema = new Schema<IEntry>(
  {
    entry_id: { type: Number, required: true },
    game_id: { type: Number, required: true },
    post_id: { type: Number, required: true },
    topic_id: { type: Number, required: true },
    author: { type: String, required: true },
    author_uid: { type: Number, required: true },
  },
  {
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
  }
);

export const Entry = model("Entry", entrySchema);
