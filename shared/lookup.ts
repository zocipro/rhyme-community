import { compareMutual } from './pairs';
import type { Comparison, RhymeKind, Syllable } from './rhyme';

export type Word = { id: string; text: string; normalized: string; n: number; pair_count: number };
export type PairWord = { word_id: string; text: string; normalized: string; readings: Syllable[] };
export type RhymePair = {
  id: string; left: PairWord; right: PairWord; n: number; kind: Exclude<RhymeKind, 'none'>; points: number;
  author: string; author_id: string; created_at: string; status: 'active' | 'withdrawn'; comparison: Comparison;
  likes?: number; liked?: boolean; // liked is only set where the request knows who is asking
};
export type RhymingWord = { word: Word; association: 'direct' | 'group'; pair: RhymePair };
export type ScoreEntry = {
  id: string; pair_id: string; user_id: string; points: number; status: 'active' | 'withdrawn';
  source: 'legacy' | 'submission'; source_id: string; created_at: string; left_text: string; right_text: string; active: boolean;
};

export function compareRecordedRhyme(left: Syllable[], right: Syllable[], reverse = false): Comparison {
  const result = compareMutual(reverse ? right : left, reverse ? left : right);
  return { ...result, points: 0 };
}
