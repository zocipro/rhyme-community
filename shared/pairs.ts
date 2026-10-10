import { validateText } from './rhyme-core';
import { pronunciation } from './pronunciation';
import { compareMutual, validatePairWorkload } from './pair-comparison';
import type { Comparison, Syllable } from './rhyme-core';

export { compareMutual, validatePairWorkload, MAX_PAIR_CHARACTERS, MAX_PAIR_COMPARISON_POSITIONS } from './pair-comparison';
export type { PairWorkload } from './pair-comparison';

export type PairInput = { text: string; readings?: string[] };
export type ResolvedWord = { text: string; normalized: string; readings: Syllable[] };
export type PairPreview = { leftIndex: number; rightIndex: number; comparison: Comparison };
export function resolvePairInputs(value: unknown): ResolvedWord[] {
  if (!Array.isArray(value) || value.length < 2 || value.length > 50) throw new Error('每次请填写 2–50 个词');
  const seen = new Set<string>();
  const inputs = value.map(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('词语格式不正确');
    const { text, readings } = item as PairInput;
    const normalized = validateText(text);
    if (seen.has(normalized)) throw new Error('这次填写的词语有重复，请保留一个');
    seen.add(normalized);
    if (readings !== undefined && (!Array.isArray(readings) || readings.some(x => typeof x !== 'string'))) throw new Error('读音格式不正确');
    if (readings && readings.length > [...normalized].length) throw new Error('读音数量不能超过汉字数量');
    return { text: text.trim(), normalized, choices: readings };
  });
  validatePairWorkload(inputs.map(item => item.normalized));
  return inputs.map(({ text, normalized, choices }) => ({ text, normalized, readings: pronunciation(text, choices) }));
}

export function previewPairs(items: ResolvedWord[]): PairPreview[] {
  return items.flatMap((left, leftIndex) => items.slice(leftIndex + 1).map((right, offset) => ({
    leftIndex, rightIndex: leftIndex + offset + 1, comparison: compareMutual(left.readings, right.readings),
  })));
}
