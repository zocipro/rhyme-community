import { pinyin } from 'pinyin-pro';
import { normalize } from './rhyme-core';
import { COLLOQUIAL_READINGS, canonicalFinal, readingTone } from './finals';
import type { Syllable } from './rhyme-core';

export function pronunciation(text: string, choices: string[] = []): Syllable[] {
  const chars = [...normalize(text)];
  if (choices.length > chars.length) throw new Error('读音数量不能超过汉字数量');
  if (!chars.length) return [];
  const defaults = pinyin(chars.join(''), { type: 'all', toneType: 'num', toneSandhi: false, traditional: true });
  return chars.map((char, i) => {
    const candidates = pinyin(char, { multiple: true, type: 'array', toneType: 'num', toneSandhi: false, traditional: true });
    const fallback = defaults[i]?.pinyin;
    if (!fallback || !defaults[i]?.isZh || !candidates.length) throw new Error(`暂时无法识别“${char}”的读音`);
    // Colloquial readings are extra options only; the dictionary reading stays the default.
    const colloquial = (COLLOQUIAL_READINGS[char] ?? []).filter(reading => reading !== fallback && !candidates.includes(reading));
    const options = [...new Set([...candidates, fallback, ...colloquial])];
    const selected = choices[i] ?? fallback;
    if (!options.includes(selected)) throw new Error(`“${char}”的读音选择无效`);
    return { char, pinyin: selected, final: canonicalFinal(selected), tone: readingTone(selected), options, ...(colloquial.length ? { colloquial } : {}) };
  });
}
