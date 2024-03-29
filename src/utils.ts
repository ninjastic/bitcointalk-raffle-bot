import axios from 'axios';
import fetch from 'node-fetch';
import FormData from 'form-data';
import { load } from 'cheerio';
import crypto from 'crypto-js';
import fs from 'fs';
import path from 'path';
import iconv from 'iconv-lite';

import dayjs from './services/dayjs';
import log from './logger';

interface ISettings {
  mongoUrl: string;
  auth: {
    user: string;
    password: string;
    captchaCode: string;
  };
  botUserId: number;
  whitelistedCreators: number[];
  blacklistedParticipants: number[];
}

export const settings: ISettings = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'settings.json'), 'utf-8'),
);

export const api = axios.create({
  responseType: 'arraybuffer',
});

const MAX_REQUESTS_COUNT = 1;
const INTERVAL_MS = 1000 * 1;
let PENDING_REQUESTS = 0;

api.interceptors.request.use(
  (config) =>
    new Promise((resolve) => {
      const interval = setInterval(() => {
        if (PENDING_REQUESTS < MAX_REQUESTS_COUNT) {
          PENDING_REQUESTS += 1;

          clearInterval(interval);
          resolve(config);
        }
      }, INTERVAL_MS);
    }),
);

api.interceptors.response.use(
  (response) => {
    PENDING_REQUESTS = Math.max(0, PENDING_REQUESTS - 1);
    const utf8String = iconv.decode(response.data, 'ISO-8859-1');
    response.data = utf8String;

    return Promise.resolve(response);
  },
  (error) => {
    PENDING_REQUESTS = Math.max(0, PENDING_REQUESTS - 1);
    throw new Error(error);
  },
);

export const encodeStr = (rawStr: string) =>
  rawStr.replace(/[\u00A0-\u9999<>&]/g, (i) => `&#${i.charCodeAt(0)};`);

export interface IPost {
  post_id: number;
  topic_id: number;
  author: string;
  author_uid: number;
  content: string;
}

let lastPostId: number = 0;

export const getPosts = async () => {
  log(`Getting posts from ${lastPostId}`);
  const response = await axios.get('http://api.ninjastic.space/posts', {
    params: {
      after_date: dayjs().subtract(1, 'd').toISOString(),
      after: lastPostId,
      limit: 200,
    },
  });

  const { posts } = response.data.data;
  lastPostId = posts[0]?.post_id || lastPostId;

  return posts;
};

export const authenticateForum = async () => {
  const bodyFormData = new FormData();

  bodyFormData.append('user', settings.auth.user);
  bodyFormData.append('passwrd', settings.auth.password);
  bodyFormData.append('cookieneverexp', 'on');
  bodyFormData.append('hash_passwrd', '');

  const response = await fetch(
    `https://bitcointalk.org/index.php?action=login2;ccode=${settings.auth.captchaCode}`,
    { method: 'POST', body: bodyFormData, redirect: 'manual' },
  );

  const cookies = response.headers.raw()['set-cookie'];

  if (cookies && cookies[0]) {
    api.defaults.headers.common.Cookie = `${cookies[0]}; ${cookies[1]}`;

    return Promise.resolve('Authentication successed');
  }

  throw new Error('Authentication failed');
};

const getSesc = async () => {
  if (!api.defaults.headers.common.Cookie) {
    throw new Error('Missing cookies');
  }

  const response = await api.get(
    'https://bitcointalk.org/index.php?action=profile',
  );
  const $ = load(response.data);

  const logoutUrl = $(
    'td.maintab_back a[href*="index.php?action=logout;sesc="]',
  ).attr('href');

  const sescRegex = /sesc=(.*)/;
  const sesc = logoutUrl?.match(sescRegex);

  if (sesc && sesc[1]) {
    return sesc[1];
  }

  return null;
};

interface ICreatePostData {
  board?: number;
  topic: number;
  subject: string;
  message: string;
}

export const createPost = async ({
  board,
  topic,
  subject,
  message,
}: ICreatePostData) => {
  if (!api.defaults.headers.common.Cookie) {
    throw new Error('Missing cookies');
  }

  const code = await getSesc();

  const data = {
    topic,
    icon: 'xx',
    subject,
    message: encodeStr(message),
    sc: code,
    goback: 1,
    ns: 'NS',
  };

  const bodyFormData = new FormData();
  Object.entries(data).forEach(([key, entry]) =>
    bodyFormData.append(key, entry),
  );

  log('Creating post');

  const postResponse = await api.post(
    `https://bitcointalk.org/index.php?action=post2${
      board ? `;board=${board}` : ''
    }`,
    bodyFormData,
  );

  const $ = load(postResponse.data);

  const botUsername = $('#hellomember > b').text();

  const postsByUser = $(
    '#quickModForm > table.bordercolor > tbody > tr > td > table',
  )
    .toArray()
    .filter((el) => {
      const user = $(el).find('td.poster_info > b > a');
      return user.text() === botUsername;
    });

  const postIdMatch = $(postsByUser[postsByUser.length - 1])
    .find('div[id^=subject_]')
    .attr('id')
    ?.match(/subject_(\d+)/);

  if (postIdMatch && postIdMatch[1]) {
    log(`Created post ${postIdMatch[1]}`);
    return Number(postIdMatch[1]);
  }

  log(`New post not identified, returned ${postIdMatch}`);
  return null;
};

interface IEditPostData {
  post: number;
  topic: number;
  subject: string;
  message: string;
}

export const editPost = async ({
  post,
  topic,
  subject,
  message,
}: IEditPostData) => {
  if (!api.defaults.headers.common.Cookie) {
    throw new Error('Missing cookies');
  }

  const code = await getSesc();

  const data = {
    topic,
    icon: 'xx',
    subject,
    message: encodeStr(message),
    goback: 1,
    sc: code,
    ns: 'NS',
  };

  const bodyFormData = new FormData();
  Object.entries(data).forEach(([key, entry]) =>
    bodyFormData.append(key, entry),
  );

  log(`Editing post ${post}`);

  const postResponse = await api.post(
    `https://bitcointalk.org/index.php?action=post2;msg=${post}`,
    bodyFormData,
  );

  const postIdMatchRegex = /#msg(\d+)/;
  const postIdMatch =
    postResponse.request.res.responseUrl.match(postIdMatchRegex);

  if (postIdMatch && postIdMatch[1]) {
    log(`Edited post ${postIdMatch[1]}`);
    return Number(postIdMatch[1]);
  }

  return null;
};

export interface ITopicData {
  topic_id: number;
  title: string | null;
  author_uid: number | null;
  date: Date | null;
  merits: Array<{
    user: string;
    amount: number;
  }>;
}

export const getTopicData = async (topicId: number): Promise<ITopicData> => {
  log('Getting topic data', topicId);
  const response = await api.get(
    `https://bitcointalk.org/index.php?topic=${topicId}`,
  );

  if (!response.data) {
    throw new Error('getTopicData request failed');
  }

  const topicData: ITopicData = {
    topic_id: topicId,
    title: null,
    author_uid: null,
    date: null,
    merits: [],
  };

  const $ = load(response.data);
  const post = $(
    '#quickModForm > table.bordercolor > tbody > tr > td > table > tbody > tr > td > table',
  ).first();

  if (!post) {
    throw new Error('Topic is invalid');
  }

  const title = post.find('div[id*=subject_] a').text();
  topicData.title = title;

  const authorAnchor = post.find('td.poster_info > b > a');
  const authorHref = authorAnchor.attr('href');

  const authorRegex = /;u=(\d+)/;
  const authorMatch = authorHref?.match(authorRegex);

  if (authorMatch) {
    const [, authorUid] = authorMatch;
    topicData.author_uid = Number(authorUid);
  }

  const topicDateDiv = post
    .find('td.td_headerandpost table div:nth-child(2)')
    .first();
  topicDateDiv.children('span[class=editplain]').remove();

  const topicDateText = topicDateDiv
    .text()
    .replace('Today at', dayjs.utc().format('YYYY/MM/DD'));

  const tzOffset = dayjs().utcOffset();
  const topicDate = dayjs.utc(topicDateText).add(tzOffset, 'm').toDate();

  if (topicDate) {
    topicData.date = topicDate;
  }

  const meritsDiv = post.find(
    'td.td_headerandpost > table > tbody > tr > td:nth-child(2) > div:nth-child(3)',
  );

  if (meritsDiv) {
    const merits = meritsDiv
      .html()
      ?.match(/\w+<\/a> \(\d+\)/g)
      ?.map((a) => {
        const [, user, amount] = a.match(
          /(.*)<\/a> \((\d+)\)/,
        ) as RegExpMatchArray;
        return { user, amount: Number(amount) };
      });

    topicData.merits = merits ?? [];
  }

  return topicData;
};

export const generateGameSeed = () =>
  crypto.SHA256(dayjs().unix().toString()).toString();

export const getCurrentBlock = async () => {
  const response = await axios.get<number>(
    'https://mempool.space/api/blocks/tip/height',
  );
  return response.data;
};

export const getBlockHash = async (height: number) => {
  const response = await axios.get<number>(
    `https://mempool.space/api/block-height/${height}`,
  );
  return response.data;
};

export const getTimeUntilDeadline = (deadline: Date): number => {
  const currentDate = dayjs();
  const deadlineDate = dayjs(deadline);
  return deadlineDate.diff(currentDate, 'minutes');
};
