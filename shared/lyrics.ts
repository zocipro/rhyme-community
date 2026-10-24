import { compareMutual } from './pair-comparison';
import { normalize, rhymeFinal } from './rhyme-core';
import type { Syllable } from './rhyme-core';
import { spokenVariants, trailingRhymes } from './spoken';

// 歌词本: finds which lines rhyme and by how many syllables, using the same rules as submissions.
// Pure and dictionary-agnostic: the caller passes the (lazily loaded) pronunciation function.
export const LYRIC_TAIL = 6, LYRIC_LOOKBACK = 3, MAX_LYRIC_LINES = 300;

export type LyricLine = {
  index: number;          // line number in the original text (0-based)
  text: string;           // original line, untouched
  stanza: number;         // blank lines start a new stanza; rhymes are only looked for inside one
  ending: string;         // rhyme family of the last syllable, e.g. "ang"
  pinyin: string[];       // readings of the analysed tail
  partner: number | null; // nearest earlier line in the stanza with the most trailing rhymes
  rhymes: number;         // trailing syllables whose finals rhyme with the partner: 1 = 单押, 2 = 双押 …
  perfect: boolean;       // those syllables also match in tone
  spoken: boolean;        // only rhymes with a common spoken reading (e.g. 怂 as sóng)
  highlight: number;      // trailing Han characters to mark, from this line's own or a later line's rhyme
  error: string;          // set when the dictionary cannot read the line
};
export type LyricAnalysis = { lines: LyricLine[]; endings: { ending: string; lines: number }[]; rhymedLines: number; best: number; truncated: boolean };

const isHan = (char: string) => /\p{Script=Han}/u.test(char);

// The tail readings come from the whole line so polyphones get their context.
function tailReadings(han: string, pronounce: (text: string) => Syllable[]): Syllable[] {
  return pronounce(han).slice(-LYRIC_TAIL);
}

function bestRhyme(left: Syllable[], right: Syllable[]) {
  let best = { rhymes: 0, perfect: false, spoken: false };
  for (const [li, l] of spokenVariants(left).entries()) for (const [ri, r] of spokenVariants(right).entries()) {
    const comparison = compareMutual(l, r), rhymes = trailingRhymes(comparison);
    if (rhymes > best.rhymes) best = { rhymes, perfect: comparison.rows.slice(-rhymes).every(row => row.toneMatch), spoken: li > 0 || ri > 0 };
  }
  return best;
}

export function analyzeLyrics(text: string, pronounce: (text: string) => Syllable[]): LyricAnalysis {
  const raw = text.split(/\r?\n/), truncated = raw.length > MAX_LYRIC_LINES;
  const lines: LyricLine[] = [], readings = new Map<number, Syllable[]>();
  let stanza = 0, previousBlank = true;
  raw.slice(0, MAX_LYRIC_LINES).forEach((line, index) => {
    const han = [...normalize(line)].filter(isHan).join('');
    if (!line.trim()) { if (!previousBlank) stanza++; previousBlank = true; return; }
    previousBlank = false;
    // A line with no Han characters (e.g. "(Hook)") is kept in place but never rhymes.
    let tail: Syllable[] = [], error = '';
    if (han) { try { tail = tailReadings(han, pronounce); } catch (e) { error = (e as Error).message; } }
    readings.set(lines.length, tail);
    lines.push({ index, text: line, stanza, ending: tail.at(-1)?.final ? rhymeFinal(tail.at(-1)!.final) : '', pinyin: tail.map(s => s.pinyin), partner: null, rhymes: 0, perfect: false, spoken: false, highlight: 0, error });
  });
  lines.forEach((line, i) => {
    const mine = readings.get(i)!;
    if (!mine.length) return;
    for (let j = i - 1; j >= 0 && j >= i - LYRIC_LOOKBACK; j--) {
      const other = lines[j];
      if (other.stanza !== line.stanza) break;
      const theirs = readings.get(j)!;
      if (!theirs.length) continue;
      const found = bestRhyme(mine, theirs);
      // Nearest line wins ties, so ABAB still pairs A with A when the B line rhymes equally.
      if (found.rhymes > line.rhymes) Object.assign(line, found, { partner: j });
    }
    if (line.partner !== null) {
      line.highlight = Math.max(line.highlight, line.rhymes);
      lines[line.partner].highlight = Math.max(lines[line.partner].highlight, line.rhymes);
    }
  });
  const rhymed = lines.filter(line => line.highlight > 0);
  const counts = new Map<string, number>();
  for (const line of rhymed) counts.set(line.ending, (counts.get(line.ending) ?? 0) + 1);
  return {
    lines, truncated, rhymedLines: rhymed.length, best: Math.max(0, ...lines.map(line => line.rhymes)),
    endings: [...counts].sort((a, b) => b[1] - a[1]).map(([ending, n]) => ({ ending, lines: n })),
  };
}

// Splits a line so the last `count` Han characters (and anything between them) can be marked.
export function splitHighlight(text: string, count: number): [string, string, string] {
  if (count <= 0) return [text, '', ''];
  const chars = [...text], positions = chars.flatMap((char, i) => isHan(char) ? [i] : []);
  if (!positions.length) return [text, '', ''];
  const start = positions[Math.max(0, positions.length - count)], end = positions.at(-1)! + 1;
  return [chars.slice(0, start).join(''), chars.slice(start, end).join(''), chars.slice(end).join('')];
}

// The rhyming tail of a line as a word for 想押韵 (at least two characters, as submissions require).
export function rhymeWord(text: string, count: number): string {
  const han = [...normalize(text)].filter(isHan);
  return han.slice(-Math.max(2, count)).join('');
}
