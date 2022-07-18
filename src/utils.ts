import axios from "axios";
import fetch from "node-fetch";
import FormData from "form-data";
import { load } from "cheerio";
import crypto from "crypto-js";
import fs from "fs";
import path from "path";

import dayjs from "./services/dayjs";
import log from "./logger";

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
  fs.readFileSync(path.join(__dirname, "..", "settings.json"), "utf-8")
);

export const api = axios.create();

const MAX_REQUESTS_COUNT = 1;
const INTERVAL_MS = 1000 * 1;
let PENDING_REQUESTS = 0;

api.interceptors.request.use((config) => {
  return new Promise((resolve) => {
    const interval = setInterval(() => {
      if (PENDING_REQUESTS < MAX_REQUESTS_COUNT) {
        PENDING_REQUESTS += 1;

        clearInterval(interval);
        resolve(config);
      }
    }, INTERVAL_MS);
  });
});

export const encodeStr = (rawStr: string) =>
  rawStr.replace(/[\u00A0-\u9999<>\&]/g, function (i) {
    return "&#" + i.charCodeAt(0) + ";";
  });

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
  const response = await axios.get("http://api.ninjastic.space/posts", {
    params: {
      after_date: dayjs().subtract(1, "d").toISOString(),
      after: lastPostId,
    },
  });

  const posts: IPost[] = response.data.data.posts;
  lastPostId = posts[0]?.post_id || lastPostId;

  return posts;
};

export const authenticateForum = async () => {
  const bodyFormData = new FormData();

  bodyFormData.append("user", settings.auth.user);
  bodyFormData.append("passwrd", settings.auth.password);
  bodyFormData.append("cookieneverexp", "on");
  bodyFormData.append("hash_passwrd", "");

  const response = await fetch(
    `https://bitcointalk.org/index.php?action=login2;ccode=${settings.auth.captchaCode}`,
    { method: "POST", body: bodyFormData, redirect: "manual" }
  );

  const cookies = response.headers.raw()["set-cookie"];

  if (cookies && cookies[0]) {
    api.defaults.headers.common.Cookie = `${cookies[0]}; ${cookies[1]}`;

    return Promise.resolve("Authentication successed");
  }

  return Promise.reject("Authentication failed");
};

const getSesc = async () => {
  if (!api.defaults.headers.common.Cookie) {
    return Promise.reject("Missing cookies");
  }

  const response = await api.get(
    "https://bitcointalk.org/index.php?action=profile"
  );
  const $ = load(response.data);

  const logoutUrl = $(
    'td.maintab_back a[href*="index.php?action=logout;sesc="]'
  ).attr("href");

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
    return Promise.reject("Missing cookies");
  }

  const code = await getSesc();

  const data = {
    topic,
    icon: "xx",
    subject,
    message: encodeStr(message),
    sc: code,
  };

  const bodyFormData = new FormData();
  Object.entries(data).forEach(([key, entry]) =>
    bodyFormData.append(key, entry)
  );

  log("Creating post");

  const postResponse = await api.post(
    `https://bitcointalk.org/index.php?action=post2${
      board ? `;board=${board}` : ""
    }`,
    bodyFormData
  );

  const $ = load(postResponse.data);

  const idMatch = $("div[id^=subject_]")
    .last()
    .attr("id")
    ?.match(/subject_(\d+)/);

  if (idMatch && idMatch[1]) {
    log(`Created post ${idMatch[1]}`);
    return Number(idMatch[1]);
  }

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
    return Promise.reject("Missing cookies");
  }

  const code = await getSesc();

  const data = {
    topic,
    icon: "xx",
    subject,
    message: encodeStr(message),
    goback: 1,
    sc: code,
  };

  const bodyFormData = new FormData();
  Object.entries(data).forEach(([key, entry]) =>
    bodyFormData.append(key, entry)
  );

  log(`Editing post ${post}`);

  const postResponse = await api.post(
    `https://bitcointalk.org/index.php?action=post2;msg=${post}`,
    bodyFormData
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

interface ITopicData {
  author_uid: number | null;
  date: Date | null;
}

export const getTopicData = async (topicId: number) => {
  const response = await api.get(
    `https://bitcointalk.org/index.php?topic=${topicId}`
  );

  if (!response.data) {
    return Promise.reject("getTopicData request failed");
  }

  let topicData: ITopicData = {
    author_uid: null,
    date: null,
  };

  const $ = load(response.data);
  const post = $(
    "#quickModForm > table.bordercolor > tbody > tr > td > table > tbody > tr > td > table"
  ).first();

  if (!post) {
    return Promise.reject("Topic is invalid");
  }

  const authorAnchor = post.find("td.poster_info > b > a");
  const authorHref = authorAnchor.attr("href");

  const authorRegex = /;u=(\d+)/;
  const authorMatch = authorHref?.match(authorRegex);

  if (authorMatch) {
    const [_, authorUid] = authorMatch;
    topicData.author_uid = Number(authorUid);
  }

  const topicDateDiv = post
    .find("td.td_headerandpost table div:nth-child(2)")
    .first();
  topicDateDiv.children("span[class=editplain]").remove();

  const topicDateText = topicDateDiv
    .text()
    .replace("Today at", dayjs.utc().format("YYYY/MM/DD"));

  const tzOffset = dayjs().utcOffset();
  const topicDate = dayjs.utc(topicDateText).add(tzOffset, "m").toDate();

  if (topicDate) {
    topicData.date = topicDate;
  }

  return topicData;
};

export const generateGameSeed = () => {
  return crypto.SHA256(dayjs().unix().toString()).toString();
};

export const getCurrentBlock = async () => {
  const response = await axios.get<number>(
    "https://mempool.space/api/blocks/tip/height"
  );
  return response.data;
};

export const getBlockHash = async (height: number) => {
  const response = await axios.get<number>(
    `https://mempool.space/api/block-height/${height}`
  );
  return response.data;
};
