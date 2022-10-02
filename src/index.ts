import { load } from 'cheerio';

import './services/db';
import log from './logger';
import { api, authenticateForum, getPosts } from './utils';
import topics from './modules/topics';

const modules = [topics];

const checkForMatches = async () => {
  const posts = await getPosts();

  await Promise.allSettled(
    posts.map((post: any) =>
      modules
        .reduce(
          (_commands, module) => [..._commands, ...module.commands],
          [] as any[],
        )
        .map(async (command) => {
          const $ = load(post.content);
          const data = $('body');
          data.children('div.quoteheader').remove();
          data.children('div.quote').remove();
          const regexMatches = data.text().match(command.regex);

          if (regexMatches) {
            await command
              .function(regexMatches, post)
              .catch((error: any) =>
                log('MATCH ERROR:', `"${command.name}"`, post.post_id, error),
              );
          }
        }),
    ),
  );
};

const checkForJobs = async () => {
  await Promise.allSettled(modules.map(async (module) => module.jobs.index()));
};

async function main() {
  if (!api.defaults.headers.common.Cookie) {
    await authenticateForum();
    await checkForMatches();
    await checkForJobs();

    let isCheckingForJobs = false;
    let isCheckingForMatches = false;

    setInterval(async () => {
      try {
        if (!isCheckingForMatches) {
          isCheckingForMatches = true;
          await checkForMatches();
          isCheckingForMatches = false;
        }
      } catch (error) {
        log('checkForMatches FAILED:', error);
      }
    }, 1000 * 30);

    setInterval(async () => {
      try {
        if (!isCheckingForJobs) {
          isCheckingForJobs = true;
          await checkForJobs();
          isCheckingForJobs = false;
        }
      } catch (error) {
        log('checkForJobs FAILED:', error);
      }
    }, 1000 * 60 * 1);
  }
}

main();
