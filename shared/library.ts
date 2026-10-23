import { bestSpokenComparison, trailingRhymes } from './spoken';
import { normalize, rhymeFinal } from './rhyme-core';
import type { RhymeKind, Syllable } from './rhyme-core';
import type { Word } from './lookup';

export type SearchWord = Omit<Word, 'pair_count'>;
// spoken: the match only holds with a common spoken reading (e.g. 怂 as song2).
export type SearchMatch = { word: SearchWord; pinyin: string[]; kind: RhymeKind; valid: boolean; tier: number; spoken?: boolean };
export type SearchTier = { tier: number; label: string; items: SearchMatch[]; total: number };
export type RhymeSearch = {
  query: { text: string; normalized: string; pinyin: string[]; ending: string } | null;
  error: string;
  exact: SearchWord | null;
  tiers: SearchTier[];
};
export type HotWord = { text: string };

// 韵脚 = rhyme family of the last syllable, using the same families as the scoring rules.
export function rhymeEnding(readings: readonly Syllable[]): string {
  const last = readings.at(-1);
  return last?.final ? rhymeFinal(last.final) : '';
}
export { trailingRhymes };
const tierNames = ['', '单押', '双押', '三押', '四押', '五押', '六押', '七押', '八押', '九押', '十押'];
export function tierLabel(tier: number): string {
  return tier <= 0 ? '只押声调' : tierNames[tier] ?? `${tier}押`;
}

export const TIER_LIMIT = 60;
export const searchWord = ({ id, text, normalized, n }: SearchWord): SearchWord => ({ id, text, normalized, n });

// Tier 0 holds tone-only matches that pass the submission rule without any shared final.
export function searchRhymes(query: { text: string; normalized: string; readings: Syllable[] }, words: readonly { word: Word; readings: Syllable[] }[]): Omit<RhymeSearch, 'error'> {
  const byTier = new Map<number, (SearchMatch & { popularity: number })[]>();
  let exact: SearchWord | null = null;
  for (const { word, readings } of words) {
    if (word.normalized === query.normalized) { exact = searchWord(word); continue; }
    const best = bestSpokenComparison(query.readings, readings), comparison = best.comparison;
    if (comparison.same) continue;
    const tier = trailingRhymes(comparison);
    if (!tier && !comparison.valid) continue;
    const match = { word: searchWord(word), pinyin: best.right.map(syllable => syllable.pinyin), kind: comparison.kind, valid: comparison.valid, tier, ...(best.spoken ? { spoken: true } : {}), popularity: word.pair_count };
    byTier.set(tier, [...(byTier.get(tier) ?? []), match]);
  }
  const quality = (a: SearchMatch & { popularity: number }, b: SearchMatch & { popularity: number }) =>
    Number(b.valid) - Number(a.valid) || Number(b.kind === 'perfect') - Number(a.kind === 'perfect') || b.popularity - a.popularity || a.word.n - b.word.n || a.word.normalized.localeCompare(b.word.normalized, 'zh-Hans-CN');
  const tiers = [...byTier].sort(([a], [b]) => (b || -1) - (a || -1)).map(([tier, items]) => ({
    tier, label: tierLabel(tier), total: items.length,
    items: items.sort(quality).slice(0, TIER_LIMIT).map(({ popularity: _, ...match }) => match),
  }));
  return { query: { text: query.text, normalized: query.normalized, pinyin: query.readings.map(syllable => syllable.pinyin), ending: rhymeEnding(query.readings) }, exact, tiers };
}

export const HOT_MIN_CHARS = 2, HOT_MAX_CHARS = 12;
// Only committed searches for plain Chinese words are counted; anything else is not a word anyone can rhyme with.
export function hotSearchKey(text: unknown): string | null {
  if (typeof text !== 'string' || text.length > 64) return null;
  const key = normalize(text), length = [...key].length;
  return /^[\p{Script=Han}]+$/u.test(key) && length >= HOT_MIN_CHARS && length <= HOT_MAX_CHARS ? key : null;
}
