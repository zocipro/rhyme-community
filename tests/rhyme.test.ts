import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compare, pronunciation, normalize, validateText, rhymeFinal } from '../shared/rhyme.ts';
const match=(a:string,b:string)=>compare(pronunciation(a),pronunciation(b));
test('介音不同的同韵部匹配，保留原韵母；不使用字符串包含查韵',()=>{
  const r=match('说唱','多样');
  assert.equal(r.kind,'perfect');assert.equal(r.points,4);
  assert.equal(r.rows[1].target.final,'ang');assert.equal(r.rows[1].answer?.final,'iang');
  assert.equal(r.rows[1].finalMatch,true);
  assert.equal(match('说唱','多光').kind,'final');assert.equal(match('说唱','多光').points,2);
  assert.equal(match('说唱','多羊').points,2);
  assert.equal(match('声波','灯多').points,4);
  for(const group of [['ang','iang','uang'],['a','ia','ua'],['an','ian','uan','üan'],['ao','iao'],['ou','iou'],['ei','uei'],['ie','üe']]) {
    assert.equal(new Set(group.map(rhymeFinal)).size,1);
  }
  for(const [a,b] of [['an','ang'],['in','ing'],['en','eng'],['a','ai'],['i','u'],['u','ü'],['e','ie'],['ang','ing']]) {
    assert.notEqual(rhymeFinal(a),rhymeFinal(b));
  }
  assert.equal(match('说唱','多景').valid,false); // second position has neither a matching rhyme nor tone
});
test('韵母押、声调押和完美押分别计分',()=>{
  assert.equal(match('山河','干渴').kind,'final');assert.equal(match('山河','干渴').points,2);
  assert.equal(match('山河','斑驳').kind,'tone');assert.equal(match('山河','斑驳').points,2);
  assert.equal(match('山河','丹泽').kind,'perfect');assert.equal(match('山河','丹泽').points,4);
});
test('从双押到超过六押，长答案比较末尾全文',()=>{
  const r=match('山河山河山河山','丹泽丹泽丹泽丹');assert.equal(r.n,7);assert.equal(r.points,14);
  assert.equal(match('山河','我的丹泽').points,4);
});
test('五字逐字混合押韵：三字声调押、两字韵母押，得五分',()=>{
  const r=match('山河天地人','风云星底任');
  assert.deepEqual(r.rows.map(x=>[x.finalMatch,x.toneMatch]),[[false,true],[false,true],[false,true],[true,false],[true,false]]);
  assert.equal(r.kind,'mixed');assert.equal(r.valid,true);assert.equal(r.points,5);
  assert.equal(match('山河天地人','我的风云星底任').points,5);
  const bad=match('山河天地人','风云月底任');
  assert.equal(bad.valid,false);assert.equal(bad.points,0);assert.equal(bad.kind,'none');
  assert.equal(match('山河天地人','风云星底').valid,false);
});
test('未匹配、过短和原题答案不能得分',()=>{
  assert.equal(match('山河','苹果').valid,false);assert.equal(match('山河','山').short,true);
  assert.equal(match('山河','山河').valid,false);assert.equal(match('山河','山河').points,0);
});
test('忽略标点、空白、宽度和不可见字符，保留汉字本身',()=>{
  assert.equal(normalize(' 山，\u200b河！ '),'山河');assert.equal(normalize('Ａ，Ｂ'),'AB');
  for(const invisible of ['\uFE0F','\u034F','\u2060','\u{E0100}']) {
    assert.equal(normalize(`山${invisible}河`),'山河');
    assert.equal(validateText(`山${invisible}河`),'山河');
  }
  assert.throws(()=>validateText('a山'),/汉字/);assert.throws(()=>validateText('山'),/至少/);
});
test('多音字仅接受合法读音，并保存用户选择',()=>{
  assert.equal(pronunciation('银行')[1].pinyin,'hang2');
  assert.equal(pronunciation('银行',['yin2','xing2'])[1].pinyin,'xing2');
  assert.throws(()=>pronunciation('银行',['yin2','fake1']),/无效/);
  assert.throws(()=>pronunciation('银行',['yin2','hang2','fake1']),/数量/);
  assert.throws(()=>pronunciation('银行',['yin2','']),/无效/);
});
test('轻声独立比较，不应用一、不变调；ü与u分开',()=>{
  assert.equal(pronunciation('妈妈')[1].tone,0);assert.equal(pronunciation('一天')[0].tone,1);
  assert.equal(pronunciation('绿色')[0].final,'ü');assert.equal(pronunciation('居住')[0].final,'ü');
  assert.notEqual(pronunciation('路')[0].final,pronunciation('绿')[0].final);
});

test('成音节鼻音保留完整韵母，空韵母不能制造完美押韵',()=>{
  const n=pronunciation('唔唔',['n2','n2']);const m=pronunciation('呒呒',['m2','m2']);
  assert.equal(n[0].final,'n');assert.equal(m[0].final,'m');
  assert.equal(pronunciation('嗯')[0].final,'ng');
  assert.equal(pronunciation('哼',['hng'])[0].final,'ng');
  const nasal=compare(n,m);assert.equal(nasal.kind,'tone');assert.equal(nasal.points,2);
  assert.ok(nasal.rows.every(row=>!row.finalMatch&&row.toneMatch));
  const empty=compare(n.map(s=>({...s,final:''})),m.map(s=>({...s,final:''})));
  assert.equal(empty.kind,'tone');assert.equal(empty.points,2);
});

test('互相押韵按较短词末尾 N 字比较，两端方向一致',async()=>{
  const {compareMutual}=await import('../shared/pairs.ts');
  const left=pronunciation('山河');const right=pronunciation('我的丹泽');
  assert.equal(compareMutual(left,right).points,4);
  assert.equal(compareMutual(right,left).points,4);
  assert.equal(compareMutual(right,left).n,2);
  assert.deepEqual(compareMutual(right,left).rows.map(row=>row.target.char),['丹','泽']);
  assert.equal(compareMutual(pronunciation('山河'),pronunciation('我的山河')).points,4);
  assert.equal(compareMutual(left,left).valid,false);
});
test('批次逐对核验，重复文本及非法读音不能进入批次',async()=>{
  const {resolvePairInputs,previewPairs}=await import('../shared/pairs.ts');
  const items=resolvePairInputs([{text:'山河'},{text:'丹泽'},{text:'单泽'}]);
  const pairs=previewPairs(items);
  assert.equal(pairs.length,3);assert.ok(pairs.every(pair=>pair.comparison.valid));
  assert.equal(pairs.reduce((sum,pair)=>sum+pair.comparison.points,0),12);
  assert.throws(()=>resolvePairInputs([{text:'山河'},{text:'山，河！'}]),/重复/);
  assert.throws(()=>resolvePairInputs([{text:'山河'},{text:'银行',readings:['yin2','fake1']}]),/无效/);
  assert.throws(()=>resolvePairInputs([{text:'山河'},{text:'银行',readings:['yin2','hang2','fake1']}]),/数量/);
  assert.throws(()=>resolvePairInputs([{text:'山河'},{text:'山\uFE0F河'}]),/重复/);
  assert.throws(()=>resolvePairInputs([{text:'山河'}]),/2–50/);
  assert.throws(()=>resolvePairInputs(Array.from({length:51},()=>({text:'山河'}))),/2–50/);
});

test('批次预算保留 50 个长词和两词长句，按较短尾部累计比较量',async()=>{
  const {resolvePairInputs,previewPairs,validatePairWorkload}=await import('../shared/pairs.ts');
  const words=Array.from({length:50},(_,i)=>'山'.repeat(14)+String.fromCodePoint(0x4e00+i));
  assert.deepEqual(validatePairWorkload(words),{characterCount:750,comparisonPositions:18_375});
  assert.equal(previewPairs(resolvePairInputs(words.map(text=>({text})))).length,1225);
  assert.deepEqual(validatePairWorkload(['山'.repeat(5000),'丹'.repeat(5000)]),{characterCount:10_000,comparisonPositions:5000});
  assert.deepEqual(validatePairWorkload(['山河','我的丹泽',' 山\uFE0F，河！ ']),{characterCount:8,comparisonPositions:6});
  const long=resolvePairInputs([{text:'山'.repeat(99)+'河'},{text:'丹'.repeat(99)+'泽'}]);
  assert.equal(previewPairs(long)[0].comparison.points,200);
  assert.throws(()=>validatePairWorkload(['山'.repeat(5001),'丹'.repeat(5000)]),/总量超过 10,000/);
  assert.throws(()=>validatePairWorkload(Array(50).fill('山'.repeat(17))),/总字数超过 20,000/);
});

test('超预算在读音识别之前拒绝，避免词对和读音展开',async()=>{
  const {resolvePairInputs}=await import('../shared/pairs.ts');
  const words=Array.from({length:50},(_,i)=>({text:'山'.repeat(31)+String.fromCodePoint(0x4e00+i)}));
  // This Han character has no dictionary reading; workload rejection must win.
  words[0]={text:String.fromCodePoint(0x31350).repeat(32)};
  assert.throws(()=>pronunciation(words[0].text),/无法识别/);
  assert.throws(()=>resolvePairInputs(words),/总字数超过 20,000/);
});

test('词库按末字韵部分组，组内按押韵对数排序，并标注单押/双押/三押',async()=>{
  const {groupLibrary,libraryWord,rhymeEnding,searchLibrary,tierLabel,trailingRhymes,wordTiers}=await import('../shared/library.ts');
  const {compareMutual}=await import('../shared/pair-comparison.ts');
  assert.equal(rhymeEnding(pronunciation('月光')),'ang');assert.equal(rhymeEnding(pronunciation('希望')),'ang');assert.equal(rhymeEnding(pronunciation('从前')),'an');
  assert.equal(trailingRhymes(compareMutual(pronunciation('光芒'),pronunciation('苍茫'))),2);
  assert.equal(trailingRhymes(compareMutual(pronunciation('旋律'),pronunciation('情绪'))),1);
  assert.equal(trailingRhymes(compareMutual(pronunciation('光芒'),pronunciation('锋芒'))),1);
  assert.equal(trailingRhymes(compareMutual(pronunciation('天空'),pronunciation('笑容'))),1);
  assert.deepEqual([0,1,2,3,4,5,6].map(tierLabel),['','单押','双押','三押','四押','五押','多押']);
  const word=(id:string,text:string,pair_count:number)=>({id,text,normalized:text,n:[...text].length,pair_count});
  const tiers=wordTiers([{left:'a',right:'b',leftReadings:pronunciation('光芒'),rightReadings:pronunciation('苍茫')},{left:'a',right:'c',leftReadings:pronunciation('光芒'),rightReadings:pronunciation('锋芒')}]);
  assert.equal(tiers.get('a'),2);assert.equal(tiers.get('c'),1);
  const entries=[word('a','光芒',2),word('b','苍茫',1),word('c','锋芒',1),word('d','旋律',1),word('e','情绪',3)].map(w=>({word:libraryWord(w,pronunciation(w.text),tiers.get(w.id)??0),readings:pronunciation(w.text)}));
  const groups=groupLibrary(entries.map(x=>x.word));
  assert.deepEqual(groups.map(g=>g.ending),['ang','ü']);
  assert.deepEqual(groups[0].items.map(x=>x.text),['光芒','苍茫','锋芒']);
  assert.deepEqual(groups[1].items.map(x=>x.text),['情绪','旋律']);
  assert.deepEqual(groups[0].finals,['ang']);
  const found=searchLibrary({text:'匆忙',normalized:'匆忙',readings:pronunciation('匆忙')},entries);
  assert.equal(found.exact,null);assert.equal(found.query?.ending,'ang');
  assert.deepEqual(found.rhymes.map(x=>x.word.text),['光芒','苍茫','锋芒']);
  assert.ok(found.rhymes.every(x=>x.valid));
  const single=searchLibrary({text:'忙',normalized:'忙',readings:pronunciation('忙')},entries);
  assert.equal(single.rhymes.length,0);assert.deepEqual(single.sameEnding.map(x=>x.tier),[1,1,1]);
  const exact=searchLibrary({text:'光芒',normalized:'光芒',readings:pronunciation('光芒')},entries);
  assert.equal(exact.exact?.text,'光芒');assert.ok(!exact.rhymes.some(x=>x.word.text==='光芒'));
  assert.deepEqual(searchLibrary({text:'光',normalized:'光',readings:pronunciation('光')},entries).contains.map(x=>x.text),['光芒']);
});
