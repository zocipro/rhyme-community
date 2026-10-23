import { pinyin } from 'pinyin-pro';
import { normalize, readingFinal, readingTone } from './rhyme-core';
import type { Syllable } from './rhyme-core';
import { spokenOptions } from './spoken';

export function pronunciation(text: string, choices: string[] = []): Syllable[] {
  const chars = [...normalize(text)];
  if (choices.length > chars.length) throw new Error('读音数量不能超过汉字数量');
  if (!chars.length) return [];
  const defaults = pinyin(chars.join(''), { type: 'all', toneType: 'num', toneSandhi: false, traditional: true });
  return chars.map((char, i) => {
    const candidates = pinyin(char, { multiple: true, type: 'array', toneType: 'num', toneSandhi: false, traditional: true });
    const fallback = defaults[i]?.pinyin;
    if (!fallback || !defaults[i]?.isZh || !candidates.length) throw new Error(`暂时无法识别“${char}”的读音`);
    // Spoken readings are extra choices; the dictionary reading stays the default.
    const options = [...new Set([...candidates, fallback, ...spokenOptions(char)])];
    const selected = choices[i] ?? fallback;
    if (!options.includes(selected)) throw new Error(`“${char}”的读音选择无效`);
    return { char, pinyin: selected, final: readingFinal(selected), tone: readingTone(selected), options };
  });
}
