import { compareMutual } from './pair-comparison';
import { readingFinal, readingTone } from './rhyme-core';
import type { Comparison, Syllable } from './rhyme-core';

// Readings most people actually say that the dictionary does not list, e.g. 怂 is song3 in the
// dictionary but almost always said song2. They are offered as extra choices, never as defaults.
// Keep this list curated: allowing any tone on any character would let tone-only rhymes pass trivially.
const spokenReadings: Readonly<Record<string, readonly string[]>> = {
  怂: ['song2'], 慫: ['song2'],
  档: ['dang3'], 檔: ['dang3'],
  绕: ['rao3'], 繞: ['rao3'],
  暂: ['zan3'], 暫: ['zan3'],
  质: ['zhi3'], 質: ['zhi3'],
  潜: ['qian3'], 潛: ['qian3'],
  期: ['qi2'],
  危: ['wei2'],
  微: ['wei2'],
  室: ['shi3'],
  塑: ['suo4'],
  酵: ['xiao4'],
  堤: ['ti2'],
  拎: ['ling1'],
  粳: ['geng1'],
  骰: ['shai3'],
  寻: ['xin2'], 尋: ['xin2'],
};

export function spokenOptions(char: string): readonly string[] { return spokenReadings[char] ?? []; }
export function isSpoken(char: string, reading: string): boolean { return spokenOptions(char).includes(reading); }

function withReading(syllable: Syllable, reading: string): Syllable {
  const options = syllable.options.includes(reading) ? syllable.options : [...syllable.options, reading];
  return { ...syllable, pinyin: reading, final: readingFinal(reading), tone: readingTone(reading), options };
}

export type SpokenFix = { side: 'left' | 'right'; position: number; char: string; reading: string };

// One-character switches to a spoken reading that would make a failing pair pass.
// Only the compared tail (the last N characters of each word) can change the result.
export function spokenFixes(left: Syllable[], right: Syllable[]): SpokenFix[] {
  if (compareMutual(left, right).valid) return [];
  const n = Math.min(left.length, right.length), fixes: SpokenFix[] = [];
  for (const side of ['left', 'right'] as const) {
    const word = side === 'left' ? left : right;
    for (let position = word.length - n; position < word.length; position++) {
      const syllable = word[position];
      for (const reading of spokenOptions(syllable.char)) {
        if (reading === syllable.pinyin) continue;
        const changed = word.map((s, i) => i === position ? withReading(s, reading) : s);
        if (compareMutual(side === 'left' ? changed : left, side === 'left' ? right : changed).valid) fixes.push({ side, position, char: syllable.char, reading });
      }
    }
  }
  return fixes;
}

// The dictionary reading first, then each spoken reading on its own, then all of them together.
export function spokenVariants(readings: Syllable[], limit = 4): Syllable[][] {
  const swaps = readings.flatMap((syllable, position) => spokenOptions(syllable.char).filter(reading => reading !== syllable.pinyin).map(reading => ({ position, reading })));
  if (!swaps.length) return [readings];
  const apply = (list: typeof swaps) => readings.map((s, i) => { const swap = list.find(x => x.position === i); return swap ? withReading(s, swap.reading) : s; });
  const variants = [readings, ...swaps.map(swap => apply([swap]))];
  const positions = new Set(swaps.map(swap => swap.position));
  if (swaps.length > 1 && positions.size === swaps.length) variants.push(apply(swaps));
  return variants.slice(0, limit);
}

// Best comparison over spoken variants of both words: valid first, then more trailing rhymes, then perfect.
export function bestSpokenComparison(left: Syllable[], right: Syllable[]): { comparison: Comparison; left: Syllable[]; right: Syllable[]; spoken: boolean } {
  const leftVariants = spokenVariants(left), rightVariants = spokenVariants(right);
  const score = (c: Comparison) => [Number(c.valid), trailingRhymes(c), Number(c.kind === 'perfect')];
  let best = { comparison: compareMutual(left, right), left, right, spoken: false };
  for (const [li, l] of leftVariants.entries()) for (const [ri, r] of rightVariants.entries()) {
    if (!li && !ri) continue;
    const comparison = compareMutual(l, r), a = score(comparison), b = score(best.comparison);
    const better = a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
    if (better > 0) best = { comparison, left: l, right: r, spoken: true };
  }
  return best;
}
// Consecutive trailing positions whose finals share a rhyme family: 1 = 单押, 2 = 双押, ...
export function trailingRhymes(comparison: Comparison): number {
  let count = 0;
  for (let i = comparison.rows.length - 1; i >= 0 && comparison.rows[i].finalMatch; i--) count++;
  return count;
}
