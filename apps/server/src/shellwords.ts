/**
 * Split a command line into argv without invoking a shell. Whitespace separates
 * words; '…' and "…" group them. No escape sequences, so Windows paths
 * (C:\Program Files\…) survive intact when quoted.
 */
export function splitCommand(input: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quote: '"' | "'" | null = null;
  let started = false;
  for (const ch of input) {
    if (quote) {
      if (ch === quote) quote = null;
      else cur += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      started = true;
    } else if (/\s/.test(ch)) {
      if (started || cur) out.push(cur);
      cur = '';
      started = false;
    } else {
      cur += ch;
      started = true;
    }
  }
  if (started || cur) out.push(cur);
  return out;
}

/**
 * The inverse of splitCommand for one word: the result splits back into exactly `word`, so a path
 * with spaces (/home/pi/My Car/deploy/focus-window.sh) survives being embedded in a command line.
 * Plain words are left alone; others use "…" (like the docs) or, when they contain a double quote,
 * '…' with each embedded ' written as '"'"' (adjacent quoted pieces join into one word).
 */
export function quoteWord(word: string): string {
  if (word !== '' && !/[\s"']/.test(word)) return word;
  if (!word.includes('"')) return `"${word}"`;
  return `'${word.replace(/'/g, `'"'"'`)}'`;
}

/** Build a command line that splitCommand turns back into exactly these words. */
export const joinCommand = (...words: string[]): string => words.map(quoteWord).join(' ');
