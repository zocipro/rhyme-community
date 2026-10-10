import { compare, normalize } from './rhyme-core';
import type { Comparison, Syllable } from './rhyme-core';

export const MAX_PAIR_CHARACTERS = 10_000;
export const MAX_PAIR_COMPARISON_POSITIONS = 20_000;
export type PairWorkload = { characterCount: number; comparisonPositions: number };

// Limit the whole batch's cost without imposing fixed rhyme-length tiers.
// This runs before dictionary parsing and can also be used for client drafts.
export function validatePairWorkload(texts: readonly string[]): PairWorkload {
  const lengths = texts.map(text => [...normalize(text)].length).sort((a, b) => a - b);
  const characterCount = lengths.reduce((sum, n) => sum + n, 0);
  if (characterCount > MAX_PAIR_CHARACTERS) throw new Error('这次填写的汉字总量超过 10,000 字，请缩短词语或分批填写');
  const comparisonPositions = lengths.reduce((sum, n, i) => sum + n * (lengths.length - i - 1), 0);
  if (comparisonPositions > MAX_PAIR_COMPARISON_POSITIONS) throw new Error('这次逐对核验的总字数超过 20,000 字，请减少词语或缩短后重试');
  return { characterCount, comparisonPositions };
}

export function compareMutual(left: Syllable[], right: Syllable[]): Comparison {
  const n = Math.min(left.length, right.length);
  const result = compare(left.slice(-n), right.slice(-n));
  // Different full words may share an identical tail; that is a valid perfect rhyme.
  const same = left.map(x => x.char).join('') === right.map(x => x.char).join('');
  const valid = !same && n >= 2 && result.kind !== 'none';
  return { ...result, same, valid, points: valid ? n * (result.kind === 'perfect' ? 2 : 1) : 0 };
}

