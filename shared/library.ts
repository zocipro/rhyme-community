import { compareMutual } from './pair-comparison';
import { rhymeFinal } from './rhyme-core';
import type { Comparison, RhymeKind, Syllable } from './rhyme-core';
import type { Word } from './lookup';

// 韵脚 = rhyme family of the last syllable, using the same families as the scoring rules.
export function rhymeEnding(readings: readonly Syllable[]): string {
  const last = readings.at(-1);
  return last?.final ? rhymeFinal(last.final) : '';
}
// Consecutive trailing positions whose finals share a rhyme family: 1 = 单押, 2 = 双押, ...
export function trailingRhymes(comparison: Comparison): number {
  let count = 0;
  for (let i = comparison.rows.length - 1; i >= 0 && comparison.rows[i].finalMatch; i--) count++;
  return count;
}
const tierNames = ['', '单押', '双押', '三押', '四押', '五押'];
export function tierLabel(tier: number): string {
  return tier <= 0 ? '' : tierNames[tier] ?? '多押';
}

export type LibraryWord = Word & { ending: string; final: string; tail: string; tier: number };
export type LibraryGroup = { ending: string; finals: string[]; count: number; pair_count: number; items: LibraryWord[] };
export type LibraryMatch = { word: LibraryWord; kind: RhymeKind; valid: boolean; n: number; tier: number; points: number };
export type LibraryIndex = { groups: LibraryGroup[]; truncated: boolean };
export type LibrarySearch = {
  query: { text: string; normalized: string; pinyin: string[]; ending: string } | null;
  error: string;
  exact: LibraryWord | null;
  rhymes: LibraryMatch[];
  sameEnding: LibraryMatch[];
  contains: LibraryWord[];
  totals: { rhymes: number; sameEnding: number; contains: number };
};

export function libraryWord(word: Word, readings: readonly Syllable[], tier: number): LibraryWord {
  const last = readings.at(-1);
  return { ...word, ending: rhymeEnding(readings), final: last?.final ?? '', tail: last?.pinyin ?? '', tier };
}

// Pair-level tier for every word: the best 单押/双押/... it reaches in any active pair.
export function wordTiers(pairs: readonly { left: string; right: string; leftReadings: Syllable[]; rightReadings: Syllable[] }[]): Map<string, number> {
  const tiers = new Map<string, number>();
  for (const pair of pairs) {
    const tier = trailingRhymes(compareMutual(pair.leftReadings, pair.rightReadings));
    for (const id of [pair.left, pair.right]) tiers.set(id, Math.max(tiers.get(id) ?? 0, tier));
  }
  return tiers;
}

const byPopularity = (a: LibraryWord, b: LibraryWord) => b.pair_count - a.pair_count || b.tier - a.tier || a.n - b.n || a.normalized.localeCompare(b.normalized, 'zh-Hans-CN');

export function groupLibrary(words: readonly LibraryWord[]): LibraryGroup[] {
  const groups = new Map<string, LibraryWord[]>();
  for (const word of words) {
    const key = word.ending || '·';
    groups.set(key, [...(groups.get(key) ?? []), word]);
  }
  return [...groups].map(([ending, items]) => ({
    ending,
    finals: [...new Set(items.map(item => item.final).filter(Boolean))].sort(),
    count: items.length,
    pair_count: items.reduce((sum, item) => sum + item.pair_count, 0),
    items: [...items].sort(byPopularity),
  })).sort((a, b) => a.ending.localeCompare(b.ending));
}

export const SEARCH_LIMIT = 120;

export function searchLibrary(query: { text: string; normalized: string; readings: Syllable[] }, words: readonly { word: LibraryWord; readings: Syllable[] }[]): Omit<LibrarySearch, 'error'> {
  const rhymes: LibraryMatch[] = [], sameEnding: LibraryMatch[] = [], contains: LibraryWord[] = [];
  let exact: LibraryWord | null = null;
  for (const { word, readings } of words) {
    if (word.normalized === query.normalized) { exact = word; continue; }
    if (word.normalized.includes(query.normalized)) contains.push(word);
    const comparison = compareMutual(query.readings, readings);
    if (comparison.same) continue;
    const match = { word, kind: comparison.kind, valid: comparison.valid, n: comparison.n, tier: trailingRhymes(comparison), points: comparison.points };
    if (match.valid) rhymes.push(match);
    else if (match.tier > 0) sameEnding.push(match);
  }
  const quality = (a: LibraryMatch, b: LibraryMatch) => b.tier - a.tier || Number(b.kind === 'perfect') - Number(a.kind === 'perfect') || b.points - a.points || byPopularity(a.word, b.word);
  rhymes.sort(quality); sameEnding.sort(quality); contains.sort(byPopularity);
  return {
    query: { text: query.text, normalized: query.normalized, pinyin: query.readings.map(syllable => syllable.pinyin), ending: rhymeEnding(query.readings) },
    exact,
    rhymes: rhymes.slice(0, SEARCH_LIMIT), sameEnding: sameEnding.slice(0, SEARCH_LIMIT), contains: contains.slice(0, SEARCH_LIMIT),
    totals: { rhymes: rhymes.length, sameEnding: sameEnding.length, contains: contains.length },
  };
}
