import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';

const base = 'https://ya.zoci.pro';
const before = JSON.parse(await readFile(new URL('../records/2026-10-05-pairs-production-before.json',import.meta.url),'utf8'));
async function get(path){const response=await fetch(base+'/api'+path);assert.equal(response.status,200);return response.json();}
async function post(path,body){const response=await fetch(base+'/api'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:response.status,data:await response.json()};}
async function lookup(id){const items=[];for(let page=0;page<10;page++){const response=await get(`/words/${id}/rhymes?page=${page}`);items.push(...response.items);if(!response.hasMore)return items;}throw new Error('Unexpected pagination');}
const topic=before.topics.find(row=>row.normalized==='嘻哈');
const expected=['嘻哈',...before.answers.filter(row=>row.topic_id===topic.id&&row.status==='active').map(row=>row.normalized)];
assert.equal(expected.length,10);
const checks=[];
for(const text of expected){
  const words=await get('/words?q='+encodeURIComponent('　'+[...text].join('，\u200b ')+'！'));
  const word=words.items.find(item=>item.normalized===text);assert.ok(word);
  const found=await lookup(word.id);
  assert.deepEqual(found.map(item=>item.word.normalized).sort(),expected.filter(item=>item!==text).sort());
  for(const item of found){const source=before.answers.find(row=>row.id===item.pair.id);assert.ok(source);assert.equal(item.pair.author_id,source.author_id);assert.equal(item.pair.created_at,source.created_at);assert.equal(item.pair.comparison.points,0);if(item.association==='direct')assert.equal(item.pair.left.word_id,word.id);else assert.ok([item.pair.left.normalized,item.pair.right.normalized].includes('嘻哈'));}
  checks.push({text,id:word.id,results:found.length,direct:found.filter(item=>item.association==='direct').length,group:found.filter(item=>item.association==='group').length});
}
const duplicate=await post('/rhymes/preview',{items:[{text:'嘻哈'},{text:'西瓜'}]});
assert.equal(duplicate.status,200);assert.equal(duplicate.data.valid,false);assert.ok(duplicate.data.pairs[0].duplicate);assert.equal(duplicate.data.totalPoints,0);
const valid=await post('/rhymes/preview',{items:[{text:'银乐',readings:['yin2','le4']},{text:'琴鹤'},{text:'林鹊'}]});
assert.equal(valid.status,200);assert.equal(valid.data.pairCount,3);assert.ok(valid.data.pairs.every(pair=>pair.comparison.valid));
for(const path of ['/topics','/answers'])assert.equal((await post(path,{})).status,410);
assert.equal((await post('/rhymes',{requestId:'readonly-anonymous-check',items:[{text:'银乐'},{text:'琴鹤'}]})).status,401);
const legacy=await get(`/words/answer/${before.answers.find(row=>row.normalized==='西瓜').id}/rhymes`);assert.equal(legacy.items.length,9);
const result={passed:true,date:'2026-10-05',url:base,contentWrites:0,counts:(await get('/words')).counts,groupChecks:checks,legacyLookup:true,oldWritersClosed:true,duplicatePreview:true,threeWordsThreePairsPreview:true,attributionMatchesArchive:true};
await writeFile(new URL('../records/2026-10-05-pairs-production-readonly.json',import.meta.url),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result));
