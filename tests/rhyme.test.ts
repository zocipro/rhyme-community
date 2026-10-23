import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compare, pronunciation, normalize, validateText, rhymeFinal } from '../shared/rhyme.ts';
import * as rhymeCore from '../shared/rhyme-core.ts';
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

test('押韵搜索按押数分区：多押在前、只押声调最后，结果不带押韵对数',async()=>{
  const {hotSearchKey,rhymeEnding,searchRhymes,tierLabel,trailingRhymes}=await import('../shared/library.ts');
  const {compareMutual}=await import('../shared/pair-comparison.ts');
  assert.equal(rhymeEnding(pronunciation('月光')),'ang');assert.equal(rhymeEnding(pronunciation('希望')),'ang');assert.equal(rhymeEnding(pronunciation('从前')),'an');
  assert.equal(trailingRhymes(compareMutual(pronunciation('光芒'),pronunciation('苍茫'))),2);
  assert.equal(trailingRhymes(compareMutual(pronunciation('旋律'),pronunciation('情绪'))),1);
  assert.equal(trailingRhymes(compareMutual(pronunciation('飞翔'),pronunciation('温柔'))),0);
  assert.deepEqual([0,1,2,3,4,5,11].map(tierLabel),['只押声调','单押','双押','三押','四押','五押','11押']);
  const word=(id:string,text:string,pair_count:number)=>({word:{id,text,normalized:text,n:[...text].length,pair_count},readings:pronunciation(text)});
  const entries=[word('a','光芒',1),word('b','苍茫',3),word('c','匆忙',5),word('d','旋律',9),word('e','温柔',1),word('f','帮忙',1),word('g','闪闪发光芒',1)];
  const found=searchRhymes({text:'帮忙',normalized:'帮忙',readings:pronunciation('帮忙')},entries);
  assert.equal(found.exact?.text,'帮忙');assert.equal(found.query?.ending,'ang');
  assert.deepEqual(found.tiers.map(t=>t.label),['双押','单押','只押声调']);
  assert.deepEqual(found.tiers[2].items.map(x=>x.word.text),['温柔']);
  assert.deepEqual(found.tiers[0].items.map(x=>x.word.text),['苍茫','光芒','闪闪发光芒']);
  assert.deepEqual(found.tiers[1].items.map(x=>x.word.text),['匆忙']);
  assert.ok(found.tiers.flatMap(t=>t.items).every(x=>!('pair_count' in x.word)),'对外结果不暴露押韵对数');
  assert.ok(!found.tiers.flatMap(t=>t.items).some(x=>x.word.text==='旋律'));
  const tone=searchRhymes({text:'飞翔',normalized:'飞翔',readings:pronunciation('飞翔')},entries);
  assert.equal(tone.tiers.at(-1)?.tier,0);assert.ok(tone.tiers.at(-1)?.items.some(x=>x.word.text==='温柔'&&x.valid&&x.kind==='tone'));
  const long=searchRhymes({text:'灿烂光芒',normalized:'灿烂光芒',readings:pronunciation('灿烂光芒')},[word('h','斑斓光芒',1),...entries]);
  assert.equal(long.tiers[0].label,'四押');assert.equal(long.tiers[0].items[0].word.text,'斑斓光芒');
  assert.equal(searchRhymes({text:'忙',normalized:'忙',readings:pronunciation('忙')},entries).tiers[0].label,'单押');
  assert.equal(hotSearchKey(' 光芒！'),'光芒');
  for(const garbage of ['','光','abc','光芒abc','　',null,123,'光'.repeat(13),'光'.repeat(65)])assert.equal(hotSearchKey(garbage),null,String(garbage));
});

test('口语读音：怂可选 song2，默认仍是字典读音，能让认怂与不服押上',async()=>{
  const {resolvePairInputs,previewPairs,compareMutual}=await import('../shared/pairs.ts');
  const {spokenFixes,isSpoken}=await import('../shared/spoken.ts');
  const song=pronunciation('认怂');
  assert.equal(song[1].pinyin,'song3');assert.ok(song[1].options.includes('song2'));assert.ok(isSpoken('怂','song2'));
  assert.equal(compareMutual(song,pronunciation('不服')).valid,false);
  assert.deepEqual(spokenFixes(song,pronunciation('不服')),[{side:'left',position:1,char:'怂',reading:'song2'}]);
  const items=resolvePairInputs([{text:'认怂',readings:['ren4','song2']},{text:'不服'}]);
  assert.equal(items[0].readings[1].tone,2);assert.equal(items[0].readings[1].final,'ong');
  const [pair]=previewPairs(items);assert.equal(pair.comparison.valid,true);assert.equal(pair.comparison.kind,'tone');
  // Only listed characters gain spoken readings; no free tone choice.
  assert.throws(()=>pronunciation('不服',['bu4','fu3']),/无效/);
  assert.deepEqual(spokenFixes(pronunciation('山河'),pronunciation('苹果')),[]);
});
test('押韵搜索会尝试口语读音，并标记只按口语读音成立的结果',async()=>{
  const {searchRhymes}=await import('../shared/library.ts');
  const word=(id:string,text:string)=>({word:{id,text,normalized:text,n:[...text].length,pair_count:1},readings:pronunciation(text)});
  const found=searchRhymes({text:'不服',normalized:'不服',readings:pronunciation('不服')},[word('a','认怂',),word('b','山河')]);
  const match=found.tiers.flatMap(t=>t.items).find(x=>x.word.text==='认怂');
  assert.ok(match?.valid);assert.equal(match?.spoken,true);assert.deepEqual(match?.pinyin,['ren4','song2']);
  const plain=searchRhymes({text:'帮忙',normalized:'帮忙',readings:pronunciation('帮忙')},[word('c','光芒')]);
  assert.equal(plain.tiers[0].items[0].spoken,undefined);
});
test('拼音显示为声调符号，存储仍为数字调',()=>{
  const {markedPinyin}=rhymeCore;
  assert.deepEqual(['song2','gua4','liu2','gui4','lv4','lü3','nü3','xue2','ma0','er2','hng','ng2','m4'].map(markedPinyin),
    ['sóng','guà','liú','guì','lǜ','lǚ','nǚ','xué','ma','ér','hng','ńg','m̀'].map(x=>x.normalize('NFC')));
});
