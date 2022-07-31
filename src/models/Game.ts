import { Schema, model } from 'mongoose';
import dayjs from '../services/dayjs';

export interface IGame {
  game_id: number;
  game_admin: number;
  topic_id: number;
  post_id: number;
  deadline: Date;
  number_winners: number;
  post_content: string;
  seed: string;
  finished: boolean;
  block_height: number;
  overview_post_id: number;
  winner_post_id: number;
  winners_entry_id: number[];
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
    block_height: { type: Number, required: true },
    overview_post_id: { type: Number, required: true },
    winner_post_id: { type: Number, required: true },
    winners_entry_id: { type: [Number], required: true },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  },
);

gameSchema.virtual('finished').get(function finished() {
  return dayjs().isAfter(dayjs(this.deadline));
});

export const Game = model('Game', gameSchema);
