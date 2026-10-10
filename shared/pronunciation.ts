import { pinyin } from 'pinyin-pro';
import { normalize } from './rhyme-core';
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
    const options = [...new Set([...candidates, fallback])];
    const selected = choices[i] ?? fallback;
    if (!options.includes(selected)) throw new Error(`“${char}”的读音选择无效`);
    const final = canonicalFinal(selected);
    return { char, pinyin: selected, final, tone: Number(selected.match(/[0-5]$/)?.[0] ?? 0), options };
  });
}
function canonicalFinal(reading: string): string {
  const p = reading.replace(/[0-5]$/, '').replace(/v/g, 'ü');
  // Syllabic nasals are complete sounds, rather than initials to strip.
  if (/^(m|n|ng)$/.test(p)) return p;
  if (p === 'hng') return 'ng';
  const y: Record<string,string> = { yi:'i',yin:'in',ying:'ing',ya:'ia',yan:'ian',yang:'iang',yao:'iao',ye:'ie',you:'iou',yong:'iong',yu:'ü',yue:'üe',yun:'ün',yuan:'üan' };
  const w: Record<string,string> = { wu:'u',wa:'ua',wo:'uo',wan:'uan',wang:'uang',wei:'uei',wen:'uen',weng:'ueng' };
  if(y[p] || w[p])return y[p] || w[p];
  let final=p.replace(/^(zh|ch|sh|[bpmfdtnlgkhjqxrzcsyw])/, '');
  if (/^[jqx]u/.test(p))final=final.replace(/^u/,'ü');
  if(final==='iu')final='iou';
  if(final==='ui')final='uei';
  if(final==='un')final='uen';
  return final;
}
