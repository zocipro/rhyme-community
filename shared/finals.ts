import type { Syllable } from './rhyme-core';

// Pure syllable helpers shared by the dictionary loader and browser-side hints.
// No dictionary import here, so the main bundle can use it without loading pinyin-pro.

export function readingTone(reading: string): number {
  return Number(reading.match(/[0-5]$/)?.[0] ?? 0);
}

export function canonicalFinal(reading: string): string {
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

// 口语读音：字典只收规范读音，但这些字在说唱和日常口语里普遍这样读。
// 它们只是额外的可选读音：默认仍用字典读音，用户主动选择后才生效，
// 计分规则与其他合法读音完全相同。新增条目请保持“大众普遍这样读”的标准。
// 简体与繁体字形都列出，因为读音解析同时接受繁体。
export const COLLOQUIAL_READINGS: Readonly<Record<string, readonly string[]>> = {
  怂: ['song2'], 慫: ['song2'],
  危: ['wei2'],
  微: ['wei2'],
  档: ['dang3'], 檔: ['dang3'],
  框: ['kuang1'],
  较: ['jiao3'], 較: ['jiao3'],
  暂: ['zan3'], 暫: ['zan3'],
  质: ['zhi3'], 質: ['zhi3'],
  期: ['qi2'],
  剖: ['pao1'],
  惩: ['cheng3'], 懲: ['cheng3'],
};

// Re-read one syllable with another of its legal options.
export function withReading(syllable: Syllable, reading: string): Syllable {
  if (!syllable.options.includes(reading)) throw new Error(`“${syllable.char}”的读音选择无效`);
  return { ...syllable, pinyin: reading, final: canonicalFinal(reading), tone: readingTone(reading) };
}
