import { Schema, model } from "mongoose";

export interface IGame {
  game_id: number;
  game_admin: number;
  topic_id: number;
  post_id: number;
  deadline: Date;
  number_winners: number;
  post_content: string;
  seed: string;
}

const gameSchema = new Schema<IGame>(
  {
    game_id: { type: Number, required: true },
    game_admin: { type: Number, required: true },
    topic_id: { type: Number, required: true },
    post_id: { type: Number, required: true },
    deadline: { type: Date, required: true },
    number_winners: { type: Number, required: true },
    post_content: { type: String, required: true },
    seed: { type: String, required: true },
  },
  {
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
  }
);

export const Game = model("Game", gameSchema);
