import { compareMutual } from './pair-comparison';
import { withReading } from './finals';
import type { Comparison, Syllable } from './rhyme-core';

export type ReadingHint = {
  wordIndex: number; charIndex: number; char: string;
  from: string; to: string; colloquial: boolean;
  fixes: number; // failing pairs this single change would make valid
};

const MAX_POSITIONS = 200;

// Find single-character reading changes that make failing pairs rhyme without breaking any passing pair.
// Only positions where both the final and the tone miss are considered, because only those can block a pair.
export function readingHints(words: readonly Syllable[][], limit = 3): ReadingHint[] {
  if (words.length < 2 || words.some(word => word.length < 2)) return [];
  const results = new Map<string, Comparison>();
  const key = (i: number, j: number) => `${Math.min(i, j)}:${Math.max(i, j)}`;
  for (let i = 0; i < words.length; i++) for (let j = i + 1; j < words.length; j++) results.set(key(i, j), compareMutual(words[i], words[j]));

  const positions = new Map<string, { wordIndex: number; charIndex: number }>();
  for (const [pairKey, result] of results) {
    if (result.valid || result.same) continue;
    const [i, j] = pairKey.split(':').map(Number);
    result.rows.forEach((row, k) => {
      if (row.finalMatch || row.toneMatch) return;
      for (const wordIndex of [i, j]) {
        const charIndex = words[wordIndex].length - result.n + k;
        if (words[wordIndex][charIndex].options.length > 1 && positions.size < MAX_POSITIONS) positions.set(`${wordIndex}:${charIndex}`, { wordIndex, charIndex });
      }
    });
  }

  const hints = new Map<string, ReadingHint>();
  for (const { wordIndex, charIndex } of positions.values()) {
    const current = words[wordIndex][charIndex];
    for (const to of current.options) {
      if (to === current.pinyin) continue;
      const changed = words[wordIndex].map((syllable, index) => index === charIndex ? withReading(syllable, to) : syllable);
      let fixes = 0, broken = 0;
      for (let other = 0; other < words.length; other++) {
        if (other === wordIndex) continue;
        const before = results.get(key(wordIndex, other))!;
        const after = wordIndex < other ? compareMutual(changed, words[other]) : compareMutual(words[other], changed);
        if (!before.valid && after.valid) fixes++;
        if (before.valid && !after.valid) broken++;
      }
      if (!fixes || broken) continue;
      const hint = { wordIndex, charIndex, char: current.char, from: current.pinyin, to, colloquial: !!current.colloquial?.includes(to), fixes };
      const id = `${wordIndex}:${charIndex}`, previous = hints.get(id);
      // Prefer the change that fixes more pairs; on a tie prefer a dictionary reading over a colloquial one.
      if (!previous || hint.fixes > previous.fixes || (hint.fixes === previous.fixes && previous.colloquial && !hint.colloquial)) hints.set(id, hint);
    }
  }
  return [...hints.values()]
    .sort((a, b) => b.fixes - a.fixes || Number(a.colloquial) - Number(b.colloquial) || a.wordIndex - b.wordIndex || a.charIndex - b.charIndex)
    .slice(0, limit);
}
