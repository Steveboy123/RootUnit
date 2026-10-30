/** Best scores kept in the browser. A convenience only: if storage is blocked or full the game still plays, it just forgets. */

type Store = Pick<Storage, 'getItem' | 'setItem'>;

const key = (game: string) => `hu.arcade.best.${game}`;

export function readBest(game: string, store: Store | null = safeStore()): number {
  try {
    const n = Number(store?.getItem(key(game)));
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  } catch {
    return 0;
  }
}

/** Remember `score` if it beats the stored best. Returns the best after the call. */
export function recordBest(game: string, score: number, store: Store | null = safeStore()): number {
  const best = readBest(game, store);
  if (!(score > best)) return best;
  try {
    store?.setItem(key(game), String(Math.floor(score)));
  } catch {
    /* storage blocked: the best only lasts while the page is open */
  }
  return Math.floor(score);
}

function safeStore(): Store | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}
