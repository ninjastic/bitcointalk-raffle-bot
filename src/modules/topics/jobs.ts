import { stripIndents } from 'common-tags';
import cryptojs from 'crypto-js';
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
        [/tr]
        [tr]
        [td]________________[/td]
        [td]________________[/td]
        [/tr]
      `;

    let lastTicketNumber = 0;

    const entryRowText = entryGroups
      .map((group) => {
        const numberOfTickets = group.entries.length;
        const ticketsRange = [
          lastTicketNumber + 1,
          lastTicketNumber + numberOfTickets,
        ];
        lastTicketNumber += numberOfTickets;

        const tickets =
          numberOfTickets === 1
            ? lastTicketNumber
            : `${ticketsRange[0]} ~ ${ticketsRange[1]}`;

        return `[tr][td][b]${group.author}[/b][/td][td]${tickets}[/td][/tr]`;
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
    const entries = await Entry.find({ game_id: game.game_id });

    const generateTicket = (nonce: number) => {
      const concat = `${game.seed}${blockHash}${nonce}`;
      const hash = cryptojs.SHA256(concat).toString(cryptojs.enc.Hex);
      const decimal = parseInt(hash.slice(0, 10), 16);
      return (decimal % entries.length) + 1;
    };

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

    const ticketsDrawn = Array(entries.length)
      .fill(Math.random())
      .map((_, nonce) => generateTicket(nonce));

    const winnersList = ticketsDrawn.map((ticketNumber) => {
      let lastNumber = 0;
      const { author } = entryGroups.find((entryGroup) => {
        lastNumber += entryGroup.entries.length;
        if (lastNumber >= ticketNumber) {
          return true;
        }
        return false;
      }) as { author: string; entries: IEntry[] };

      return { author, ticket: ticketNumber };
    }) as Array<{ author: string; ticket: number }>;

    const winners = winnersList
      .reduce((_winners, winner) => {
        if (_winners.find((_winner) => _winner.author === winner.author)) {
          return _winners;
        }
        return [..._winners, { author: winner.author, ticket: winner.ticket }];
      }, [] as Array<{ author: string; ticket: number }>)
      .slice(0, game.number_winners);

    const message = stripIndents`
      E rufem os tambores...

      [hr]

      [b]Seed:[/b] ${game.seed}
      [b]Hash do Bloco:[/b] ${blockHash} ([url=https://mempool.space/api/block-height/${
      game.block_height
    }]verificar[/url])

      [hr]

      [b]Tickets Sorteados:[/b]
      [code]${ticketsDrawn}[/code]

      [b]${winners.length > 1 ? 'Vencedores:' : 'Vencedor:'}[/b]

      ${winners
        .map(
          (winner, index, array) =>
            `${winner.ticket} - ${winner.author}${
              index === array.length - 1 ? '' : '\n'
            }`,
        )
        .join('')}

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
      game.tickets_drawn = ticketsDrawn;
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
