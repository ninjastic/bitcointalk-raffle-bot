import { load } from 'cheerio';
import dayjs from '../../services/dayjs';
import log from '../../logger';
import { generateContent, refreshPostContent } from './messages';
import { Entry } from '../../models/Entry';
import { Game } from '../../models/Game';
import {
  createPost,
  generateGameSeed,
  settings,
  IPost,
  getTopicData,
} from '../../utils';

const commands = [
  {
    name: 'startGame',
    regex: /\+\s?sorteio/i,
    function: async (regexMatches: RegExpMatchArray, post: IPost) => {
      const hasWhiteList = settings.whitelistedCreators.length;
      const isAuthorWhitelisted = settings.whitelistedCreators.includes(
        post.author_uid,
      );

      if (!hasWhiteList || isAuthorWhitelisted) {
        let game = await Game.findOne({ topic_id: post.topic_id });

        if (game) {
          return Promise.resolve('Game already exists');
        }

        const $ = load(post.content);
        const codeSettings = $('div.code').html();

        const numberOfWinnersMatch = codeSettings
          ?.match(/vencedores:\s+?(\d+)/i)
          ?.at(1);
        const deadlineMatch = codeSettings
          ?.match(/deadline:\s+?(\d{4}\/\d{2}\/\d{2})/i)
          ?.at(1);

        if (!numberOfWinnersMatch || !deadlineMatch) {
          throw new Error('Missing raffle parameters');
        }

        const gameId = (await Game.count()) + 1;
        const deadline = dayjs.tz(deadlineMatch, 'UTC').toISOString();
        const numberOfWinners = Number(numberOfWinnersMatch);
        const gameSeed = generateGameSeed();

        game = new Game({
          game_id: gameId,
          game_admin: post.author_uid,
          post_id: 0,
          topic_id: post.topic_id,
          deadline,
          number_winners: numberOfWinners,
          post_content: '',
          seed: gameSeed,
        });

        const message = await generateContent(game);

        const postId = await createPost({
          topic: post.topic_id,
          subject: `Sorteio #${gameId}`,
          message,
        });

        if (!postId) {
          throw new Error('Post could not be created');
        }

        game.post_id = postId;
        game.post_content = message;

        return game.save();
      }

      return Promise.resolve();
    },
  },
  {
    name: 'newGameEntry',
    regex: /\+\s?entrada .*?bitcointalk\.org\/index\.php\?topic=(\d+)/gi,
    function: async (regexMatches: RegExpMatchArray, post: IPost) => {
      log('Found new entry request', post.post_id, post.author);
      const game = await Game.findOne({ topic_id: post.topic_id });

      if (!game) {
        return Promise.resolve();
      }

      if (game.finished) {
        return Promise.resolve();
      }

      if (!regexMatches?.length || post.author_uid === settings.botUserId) {
        return Promise.resolve();
      }

      let shouldUpdate = false;

      await Promise.allSettled(
        regexMatches.map(async (postEntry) => {
          const postEntryMatchRegex =
            /\+entrada .*bitcointalk\.org\/index\.php\?topic=(\d+)/i;
          const postEntryMatch = postEntry.match(postEntryMatchRegex);

          if (postEntryMatch && game?.game_id) {
            const [, topicId] = postEntryMatch;

            const entryExists = await Entry.findOne({
              topic_id: Number(topicId),
            });

            if (!entryExists) {
              const topicData = await getTopicData(Number(topicId));

              if (
                topicData.author_uid === post.author_uid &&
                dayjs(game.deadline).isAfter(topicData.date)
              ) {
                const nextEntryId = (await Entry.count()) + 1;
                const entry = new Entry({
                  entry_id: nextEntryId,
                  post_id: post.post_id,
                  topic_id: Number(topicId),
                  author: post.author,
                  author_uid: post.author_uid,
                  game_id: game.game_id,
                });

                await entry.save();
                shouldUpdate = true;
              }
            }
          }
        }),
      );

      if (shouldUpdate) {
        await refreshPostContent(game.game_id);
      }

      return Promise.resolve();
    },
  },
  {
    name: 'changeNumberWinners',
    regex: /\+\s?definir vencedores (\d+)/i,
    function: async (regexMatches: RegExpMatchArray, post: IPost) => {
      const game = await Game.findOne({ topic_id: post.topic_id });

      if (!game) {
        throw new Error('Game not found');
      }

      if (game.game_admin !== post.author_uid) {
        throw new Error('User is not game admin');
      }

      if (game.finished) {
        throw new Error('Game has finished');
      }

      game.number_winners = Number(regexMatches[1]);
      await game.save();
      return refreshPostContent(game.game_id);
    },
  },
  {
    name: 'changeDeadline',
    regex: /\+\s?definir data (\d{4}\/\d{2}\/\d{2})/i,
    function: async (regexMatches: RegExpMatchArray, post: IPost) => {
      const game = await Game.findOne({ topic_id: post.topic_id });

      if (!game) {
        throw new Error('Game not found');
      }

      if (game.game_admin !== post.author_uid) {
        throw new Error('User is not game admin');
      }

      if (game.finished) {
        throw new Error('Game has finished');
      }

      game.deadline = dayjs.tz(regexMatches[1], 'UTC').toDate();
      await game.save();
      return refreshPostContent(game.game_id);
    },
  },
];

export default commands;
