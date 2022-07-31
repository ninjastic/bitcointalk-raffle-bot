import { stripIndents } from 'common-tags';
import sha256 from 'crypto-js/sha256';
import { Game } from '../../models/Game';
import { Entry, IEntry } from '../../models/Entry';
import { createPost, getBlockHash, getCurrentBlock } from '../../utils';

const jobs = {
  raffleSecondStage: async (gameId: number) => {
    const game = await Game.findOne({ game_id: gameId });
    if (!game) {
      throw new Error('Game not found');
    }

    if (game.overview_post_id) {
      throw new Error('Game already has overview post');
    }

    const entries = await Entry.find({ game_id: game.game_id });

    const entryGroups = entries.reduce((groups, entry) => {
      const authorGroupIndex = groups.findIndex(
        (group) => group.author === entry.author,
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

    let lastTicketNumber = 0;

    const entryRowText = entryGroups
      .map((group) => {
        const topicsNumber = group.entries.length;
        lastTicketNumber += topicsNumber;
        const ticketsRange = [lastTicketNumber + 1, lastTicketNumber];

        return `[tr][td][b]${group.author}[/b][/td][td]${topicsNumber}[/td][td]${ticketsRange[0]} ~ ${ticketsRange[1]}[/td][/tr]`;
      })
      .reduce(
        (text, row, i, array) =>
          text + row + (i === array.length - 1 ? '' : '\n'),
        '',
      );

    const entriesTableText = stripIndents`
        [table]
        ${entries.length ? entryTableHeadText : ''}
        ${entries.length ? entryRowText : '[tr][td]...[/td][/tr]'}
        ${entries.length ? `\nTotal de Tickets: ${entries.length}` : ''}
        [/table]
      `;

    const blockHeight = (await getCurrentBlock()) + 6;

    const message = stripIndents`
      Sorteio fechado para novas entradas!

      [hr]

      [b]Bloco escolhido:[/b]
      [glow=lightgreen,2,300][size=16pt][b]${blockHeight}[/b][/size][/glow]

      [b]Seed:[/b] ${game.seed}

      [hr]

      [b]Como será escolhido cada número vencedor:[/b]
      [pre]1. Concatenação do GAME SEED + HASH DO BLOCO + NONCE;
      2. Geração do hash SHA256 utilizando a string formada anteriormente;
      3. Conversão dos 10 primeiros bits do hex gerado anteriormente para forma decimal;
      4. O modulo da forma decimal anterior com o número de tickets totais (${entries.length}), somado à 1.[/pre]

      [hr]

      [b]Total de tickets:[/b] ${entries.length}
      [quote]${entriesTableText}[/quote]

      [hr]

      Para verificar o hash do bloco: https://mempool.space/api/block-height/${blockHeight}
    `;

    const newPostId = await createPost({
      topic: game.topic_id,
      subject: 'Sorteio fechado',
      message,
    });

    if (newPostId) {
      game.block_height = blockHeight;
      game.overview_post_id = newPostId;
      await game.save();
    }
  },
  raffleThirdStage: async (gameId: number) => {
    const game = await Game.findOne({ game_id: gameId });
    if (!game) {
      throw new Error('Game not found');
    }

    if (!game.block_height) {
      throw new Error('Game already has no block height');
    }

    const blockHash = await getBlockHash(game.block_height);

    const ticketsDrawn = Array(game.number_winners)
      .fill(null)
      .map((_, nonce) => {
        const concat = `${game.seed}${blockHash}${nonce}`;
        const hash = sha256(concat).toString();
        const ticket = parseInt(hash.slice(0, 10), 16);
        return (ticket % game.number_winners) + 1;
      });

    const entries = await Entry.find({ game_id: game.game_id });
    const winners: IEntry[] = ticketsDrawn.map(
      (ticket: any) => entries[ticket - 1],
    );

    const message = stripIndents`
      E rufem os tambores...

      [hr]

      [b]Seed:[/b] ${game.seed}
      [b]Hash do Bloco:[/b] ${blockHash} ([url=https://mempool.space/api/block-height/${
      game.block_height
    }]verificar[/url])

      [hr]

      [b]${winners.length > 1 ? 'Vencedores' : 'Vencedor'}[/b]

      ${winners.map(
        (winner, index, array) =>
          `${ticketsDrawn[index]} - ${winner.author}${
            index === array.length - 1 ? '' : '\n'
          }`,
      )}

      [hr]

      [b]Como verificar o(s) vencedor(es):[/b]
      [pre]1. Concatenação do GAME SEED + HASH DO BLOCO + NONCE;
      2. Geração do hash SHA256 utilizando a string formada anteriormente;
      3. Conversão dos 10 primeiros bits do hex gerado anteriormente para forma decimal;
      4. O modulo da forma decimal anterior com o número de tickets totais (${
        entries.length
      }), somado à 1.[/pre]
    `;

    const newPostId = await createPost({
      topic: game.topic_id,
      subject: 'Sorteio finalizado',
      message,
    });

    if (newPostId) {
      game.winner_post_id = newPostId;
      game.winners_entry_id = winners.map((winner) => winner.entry_id);
      await game.save();
    }
  },
  raffleStatusCheck: async (gameId: number) => {
    const game = await Game.findOne({ game_id: gameId });
    if (!game) {
      throw new Error('Game not found');
    }

    if (game.finished && !game.overview_post_id) {
      await jobs.raffleSecondStage(game.game_id);
    }

    if (game.finished && game.overview_post_id && !game.winner_post_id) {
      const currentBlock = await getCurrentBlock();
      if (currentBlock >= game.block_height) {
        await jobs.raffleThirdStage(game.game_id);
      }
    }
  },
  index: async () => {
    const games = await Game.find();

    await Promise.allSettled(
      games.map(async (game) => jobs.raffleStatusCheck(game.game_id)),
    );
  },
};

export default jobs;
