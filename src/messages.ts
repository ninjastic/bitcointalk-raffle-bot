import { stripIndent, stripIndents } from "common-tags";

import dayjs from "./services/dayjs";
import { editPost } from "./utils";
import { Game, IGame } from "./models/Game";
import { Entry, IEntry } from "./models/Entry";

export const refreshPostContent = async (gameId: number) => {
  const game = await Game.findOne({ game_id: gameId });

  if (!game) {
    throw new Error("Game not found");
  }

  const newMessage = await generateContent(game);

  await editPost({
    post: game.post_id,
    topic: game.topic_id,
    subject: `[Aberto] Sorteio #${game.game_id}`,
    message: newMessage,
  });

  game.post_content = newMessage;
  await game.updateOne();
};

export const generateContent = async (game: IGame) => {
  const { deadline, number_winners, topic_id, post_id, seed } = game;

  const entries = await Entry.find({ game_id: game.game_id });

  const entryGroups = entries.reduce((groups, entry) => {
    const authorGroupIndex = groups.findIndex(
      (group) => group.author === entry.author
    );
    if (authorGroupIndex !== -1) {
      groups[authorGroupIndex].entries.push(entry);
    } else {
      groups.push({ author: entry.author, entries: [entry] });
    }
    return groups;
  }, [] as Array<{ author: string; entries: IEntry[] }>);

  const entryTableHeadText = stripIndents`
      [tr]
      [td][b]Usuário[/b][/td]
      [td][b]Tickets[/b][/td]
      [td][b]Tópicos[/b][/td]
      [/tr]
      [tr]
      [td]________________[/td]
      [td]________________[/td]
      [td]________________[/td]
      [/tr]
    `;

  const entryRowTopicText = (entry: IEntry, i: number) =>
    stripIndent`[url=https://bitcointalk.org/index.php?topic=${
      entry.topic_id
    }]${i + 1}[/url]
    `.trim();

  const entryRowText = entryGroups
    .map((group) => {
      const topicsNumber = group.entries.length;
      return `[tr][td][b]${
        group.author
      }[/b][/td][td]${topicsNumber}[/td][td]${group.entries
        .map(entryRowTopicText)
        .join(", ")}[/td][/tr]`;
    })
    .reduce(
      (text, row, i, array) =>
        text + row + (i === array.length - 1 ? "" : "\n"),
      ""
    );

  const entriesTableText = stripIndents`
      [table]
      ${entries.length ? entryTableHeadText : ""}
      ${entries.length ? entryRowText : `[tr][td]...[/td][/tr]`}
      [/table]
    `;

  return stripIndents`
      [size=12pt][b]Sorteio #1[/b][/size]
  
      [list]
      [li]Data final: ${dayjs
        .tz(deadline, "UTC")
        .format("DD/MM/YYYY HH:mm:ss z")}[/li]
      [li]Total de Ganhadores: ${number_winners}[/li]
      [/list]
  
      [hr]
  
      [b]Como participar:[/b]
  
        -> Poste o link completo de cada tópico junto à +entrada, um por linha, em um novo post
        -> Exemplo:
      
      [quote author=satoshi link=topic=${topic_id}.msg${post_id}#msg${post_id} date=${dayjs().unix()}]
      Muito obrigado pelo sorteio!
      
      +entrada https://bitcointalk.org/index.php?topic=5248878
      +entrada https://bitcointalk.org/index.php?topic=8844433
      [/quote]
  
      [hr]
  
      Seed: ${seed}
  
      [hr]
  
      [b][glow=lightgreen,2,300]Entradas:[/glow][/b]
  
      ${entriesTableText}
    `;
};
