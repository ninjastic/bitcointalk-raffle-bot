import { load } from "cheerio";

import "./services/db";
import log from "./logger";
import dayjs from "./services/dayjs";
import {
  api,
  authenticateForum,
  createPost,
  generateGameSeed,
  settings,
  getPosts,
  IPost,
  getTopicData,
} from "./utils";
import { generateContent, refreshPostContent } from "./messages";
import { Entry } from "./models/Entry";
import { Game } from "./models/Game";

const commands = [
  {
    name: "Starts a game",
    regex: /\+sorteio (\d{4}\/\d{2}\/\d{2}) \[(\d+)\]/i,
    function: async (regexMatches: RegExpMatchArray, post: IPost) => {
      const hasWhiteList = settings.whitelistedCreators.length;
      const isAuthorWhitelisted = settings.whitelistedCreators.includes(
        post.author_uid
      );
      if (!hasWhiteList || isAuthorWhitelisted) {
        let game = await Game.findOne({ topic_id: post.topic_id });

        if (game) {
          return Promise.resolve();
        }

        const gameId = (await Game.count()) + 1;
        const deadline = dayjs.tz(regexMatches[1], "UTC").toISOString();
        const numberOfWinners = Number(regexMatches[2]);
        const gameSeed = generateGameSeed();

        game = new Game({
          game_id: gameId,
          game_admin: post.author_uid,
          post_id: 0,
          topic_id: post.topic_id,
          deadline,
          number_winners: numberOfWinners,
          post_content: "",
          seed: gameSeed,
        });

        const message = await generateContent(game);

        const postId = await createPost({
          topic: post.topic_id,
          subject: `Sorteio #${gameId}`,
          message: message,
        });

        if (!postId) {
          return Promise.reject("Post could not be created");
        }

        game.post_id = postId;
        game.post_content = message;

        await game.save();
      }
    },
  },
  {
    name: "Inserts a game entry",
    regex: /\+entrada .*?bitcointalk\.org\/index\.php\?topic=(\d+)/gi,
    function: async (regexMatches: RegExpMatchArray, post: IPost) => {
      log(`Found new entry request`, post.post_id, post.author);
      const game = await Game.findOne({ topic_id: post.topic_id });

      if (!game) {
        return Promise.resolve();
      }

      if (!regexMatches?.length || post.author_uid == settings.botUserId) {
        return Promise.resolve();
      }

      let shouldUpdate = false;

      await Promise.allSettled(
        regexMatches.map(async (postEntry) => {
          const postEntryMatchRegex =
            /\+entrada .*bitcointalk\.org\/index\.php\?topic=(\d+)/i;
          const postEntryMatch = postEntry.match(postEntryMatchRegex);

          if (postEntryMatch && game?.game_id) {
            const [_, topicId] = postEntryMatch;

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
        })
      );

      if (shouldUpdate) {
        await refreshPostContent(game.game_id);
      }

      return Promise.resolve();
    },
  },
  {
    name: "Sets the number of winners",
    regex: /\+definir vencedores (\d+)/i,
    function: async (regexMatches: RegExpMatchArray, post: IPost) => {
      const game = await Game.findOne({ topic: post.topic_id });

      if (!game) {
        return Promise.reject("Game not found");
      }

      if (game.game_admin !== post.author_uid) {
        return Promise.reject("User is not game admin");
      }

      game.number_winners = Number(regexMatches[1]);
      await game.save();
      await refreshPostContent(game.game_id);
    },
  },
  {
    name: "Sets the deadline",
    regex: /\+definir data (\d{4}\/\d{2}\/\d{2})/i,
    function: async (regexMatches: RegExpMatchArray, post: IPost) => {
      const game = await Game.findOne({ topic: post.topic_id });

      if (!game) {
        return Promise.reject("Game not found");
      }

      if (game.game_admin !== post.author_uid) {
        return Promise.reject("User is not game admin");
      }

      game.deadline = dayjs.tz(regexMatches[1], "UTC").toDate();
      await game.save();
      await refreshPostContent(game.game_id);
    },
  },
];

const checkForMatches = async () => {
  const posts = await getPosts();

  const promises = posts.map((post) =>
    commands.map(async (command) => {
      const $ = load(post.content);
      const data = $("body");
      data.children("div.quoteheader").remove();
      data.children("div.quote").remove();
      const regexMatches = data.text().match(command.regex);

      if (regexMatches) {
        await command
          .function(regexMatches, post)
          .catch((error) =>
            log("MATCH ERROR:", `"${command.name}"`, post.post_id, error)
          );
      }
    })
  );

  return Promise.allSettled(promises);
};

async function main() {
  if (!api.defaults.headers.common.Cookie) {
    await authenticateForum();
    await checkForMatches();

    setInterval(async () => {
      try {
        await checkForMatches();
      } catch (error) {
        log("checkForMatches FAILED:", error);
      }
    }, 1000 * 30);
  }
}

main();
