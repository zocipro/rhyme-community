// `colloquial` lists the options that are popular spoken readings rather than dictionary ones.
export type Syllable = { char: string; pinyin: string; final: string; tone: number; options: string[]; colloquial?: string[] };
export type RhymeKind = 'final' | 'tone' | 'perfect' | 'mixed' | 'none';
export type Comparison = { n: number; kind: RhymeKind; points: number; valid: boolean; same: boolean; short: boolean; rows: { target: Syllable; answer?: Syllable; finalMatch: boolean; toneMatch: boolean }[] };
export const kindLabels: Record<RhymeKind, string> = { final: '韵母押', tone: '声调押', perfect: '完美押韵', mixed: '混合押韵', none: '尚未押上' };
// Explicit rhyme families: ignore medial differences, not arbitrary shared suffixes.
// Keep full dictionary finals in saved readings and in the pronunciation display.
const rhymeFamilies: readonly (readonly string[])[] = [
  ['a','ia','ua'], ['o','uo'], ['ai','uai'], ['ei','uei'],
  ['ao','iao'], ['ou','iou'], ['an','ian','uan','üan'],
  ['en','uen','ün'], ['ang','iang','uang'], ['eng','ueng'],
  ['ong','iong'], ['ie','üe'],
];
const rhymeKeys = new Map(rhymeFamilies.flatMap(group => group.map(final => [final, group[0]] as const)));
export function rhymeFinal(final: string): string { return rhymeKeys.get(final) ?? final; }
export function normalize(text: string): string {
  return text.normalize('NFKC').replace(/[\p{White_Space}\p{P}\p{Cf}\p{Default_Ignorable_Code_Point}]/gu, '');
}
export function validateText(text: string, minimum = 2): string {
  if (typeof text !== 'string') throw new Error('请输入文字');
  const key = normalize(text);
  if (!/^[\p{Script=Han}]+$/u.test(key)) throw new Error('请使用中文汉字，可包含空格和标点');
  if ([...key].length < minimum) throw new Error(`至少需要 ${minimum} 个汉字`);
  return key;
}
export function compare(target: Syllable[], answer: Syllable[]): Comparison {
  const n = target.length;
  const same = target.map(x => x.char).join('') === answer.map(x => x.char).join('');
  const short = answer.length < n;
  const tail = short ? answer : answer.slice(-n);
  const rows = target.map((t, i) => ({ target: t, answer: tail[i], finalMatch: !!tail[i] && !!t.final && !!tail[i].final && rhymeFinal(t.final) === rhymeFinal(tail[i].final), toneMatch: !!tail[i] && t.tone === tail[i].tone }));
  const finals = n >= 2 && !short && rows.every(x => x.finalMatch);
  const tones = n >= 2 && !short && rows.every(x => x.toneMatch);
  const mixed = n >= 2 && !short && rows.every(x => x.finalMatch || x.toneMatch);
  const kind: RhymeKind = finals && tones ? 'perfect' : finals ? 'final' : tones ? 'tone' : mixed ? 'mixed' : 'none';
  const valid = !same && kind !== 'none';
  return { n, kind, valid, same, short, points: valid ? n * (kind === 'perfect' ? 2 : 1) : 0, rows };
}
