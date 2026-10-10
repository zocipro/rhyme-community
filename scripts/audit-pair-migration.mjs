import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const [environment, phase] = process.argv.slice(2);
assert.ok(['staging','production'].includes(environment), 'Choose staging or production explicitly.');
assert.ok(['before','after'].includes(phase), 'Choose before or after.');
const root = fileURLToPath(new URL('..', import.meta.url));
function query(sql) {
  const result = spawnSync(process.execPath, ['node_modules/wrangler/bin/wrangler.js','d1','execute','DB','--env',environment === 'staging' ? 'staging' : '', '--remote','--json','--command',sql], {cwd:root,encoding:'utf8',maxBuffer:8*1024*1024});
  if (result.error || result.status !== 0) throw new Error('D1 migration audit query failed: ' + (result.stderr || result.error?.message || result.status));
  const data = JSON.parse(result.stdout);
  assert.ok(data.every(item => item.success));
  return data.map(item => item.results);
}
const sql = `SELECT id,text,normalized,readings,n,author_id,status,created_at FROM topics ORDER BY id;
SELECT id,topic_id,text,normalized,readings,kind,points,author_id,status,created_at FROM answers ORDER BY id;
SELECT u.id,u.username,COALESCE(SUM(CASE WHEN a.status='active' AND t.status='active' THEN a.points ELSE 0 END),0) AS score FROM users u LEFT JOIN answers a ON a.author_id=u.id LEFT JOIN topics t ON t.id=a.topic_id GROUP BY u.id ORDER BY u.id;`;
const [topics, answers, scores] = query(sql);
const snapshotPath = new URL(`../records/2026-10-05-pairs-${environment}-before.json`, import.meta.url);
await mkdir(new URL('../records/',import.meta.url),{recursive:true});
if (phase === 'before') {
  const snapshot = {environment,topics,answers,scores};
  await writeFile(snapshotPath,JSON.stringify(snapshot,null,2)+'\n');
  console.log(JSON.stringify({environment,phase,topics:topics.length,answers:answers.length,totalScore:scores.reduce((sum,row)=>sum+row.score,0)}));
} else {
  const before = JSON.parse(await readFile(snapshotPath,'utf8'));
  assert.deepEqual(topics,before.topics,'Legacy topic fields changed during migration.');
  assert.deepEqual(answers,before.answers,'Legacy answer fields changed during migration.');
  // This compares only pre-existing users so isolated QA accounts can be audited later.
  assert.deepEqual(scores.filter(row=>before.scores.some(old=>old.id===row.id)),before.scores,'Legacy score calculation changed.');
  const [pairs,entries,newScores,counts] = query(`SELECT p.*,lw.normalized AS left_normalized,rw.normalized AS right_normalized FROM rhyme_pairs p JOIN words lw ON lw.id=p.left_word_id JOIN words rw ON rw.id=p.right_word_id ORDER BY p.id;
SELECT * FROM score_entries WHERE source='legacy' ORDER BY source_id;
SELECT u.id,u.username,COALESCE(SUM(CASE WHEN s.status='active' AND p.status='active' THEN s.points ELSE 0 END),0) AS score FROM users u LEFT JOIN score_entries s ON s.user_id=u.id LEFT JOIN rhyme_pairs p ON p.id=s.pair_id GROUP BY u.id ORDER BY u.id;
SELECT (SELECT COUNT(*) FROM rhyme_pairs WHERE status='active') AS pairs,(SELECT COUNT(*) FROM words w WHERE EXISTS(SELECT 1 FROM rhyme_pairs p WHERE p.status='active' AND (p.left_word_id=w.id OR p.right_word_id=w.id))) AS words;`);
  assert.deepEqual(newScores.filter(row=>before.scores.some(old=>old.id===row.id)),before.scores,'New ledger changed an existing user score.');
  const topicMap=new Map(before.topics.map(row=>[row.id,row]));
  const groups=new Map();
  const key=(a,b)=>JSON.stringify([a,b].sort());
  for(const answer of before.answers){const topic=topicMap.get(answer.topic_id);const k=key(topic.normalized,answer.normalized);if(!groups.has(k))groups.set(k,[]);groups.get(k).push({answer,topic,active:answer.status==='active'&&topic.status==='active'});}
  for(const history of groups.values()){
    history.sort((a,b)=>a.answer.created_at.localeCompare(b.answer.created_at)||a.answer.id.localeCompare(b.answer.id));
    const first=history[0],payload=history.find(row=>row.active)||first,pair=pairs.find(row=>row.id===first.answer.id);
    assert.ok(pair,'Missing historical pair.');
    assert.equal(key(pair.left_normalized,pair.right_normalized),key(first.topic.normalized,first.answer.normalized));
    assert.equal(pair.author_id,first.answer.author_id);assert.equal(pair.created_at,first.answer.created_at);
    assert.equal(pair.status,history.some(row=>row.active)?'active':'withdrawn');
    assert.equal(pair.n,payload.topic.n);assert.equal(pair.kind,payload.answer.kind);assert.equal(pair.points,payload.answer.points);
    const leftIsTopic=pair.left_normalized===payload.topic.normalized;
    assert.equal(pair.left_text,leftIsTopic?payload.topic.text:payload.answer.text);assert.equal(pair.right_text,leftIsTopic?payload.answer.text:payload.topic.text);
    assert.equal(pair.left_readings,leftIsTopic?payload.topic.readings:payload.answer.readings);assert.equal(pair.right_readings,leftIsTopic?payload.answer.readings:payload.topic.readings);
  }
  assert.equal(entries.length,before.answers.length,'Every old answer must retain its score source.');
  for(const answer of before.answers){const entry=entries.find(row=>row.source_id===answer.id),topic=topicMap.get(answer.topic_id);assert.ok(entry);assert.equal(entry.user_id,answer.author_id);assert.equal(entry.points,answer.points);assert.equal(entry.created_at,answer.created_at);assert.equal(entry.status,answer.status==='active'&&topic.status==='active'?'active':'withdrawn');}
  const result={environment,phase,legacyFieldsUnchanged:true,firstAuthorsTimesReadingsUnchanged:true,perUserScoresUnchanged:true,legacyScoreEntries:entries.length,migratedPairs:groups.size,totalScore:before.scores.reduce((sum,row)=>sum+row.score,0),counts:counts[0]};
  await writeFile(new URL(`../records/2026-10-05-pairs-${environment}-audit.json`,import.meta.url),JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify(result));
}
