import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
const base='https://rhyme-community-staging.shangqianbeibiantu.workers.dev';
const username='同韵测试'+randomUUID().slice(0,8), password=randomUUID();
let cookie='', user;
async function api(path,body){
  const r=await fetch(base+'/api'+path,{method:body?'POST':'GET',headers:{...(body?{'Content-Type':'application/json'}:{}),...(cookie?{Cookie:cookie}:{})},body:body?JSON.stringify(body):undefined});
  if(r.headers.get('set-cookie'))cookie=r.headers.get('set-cookie').split(';')[0];
  return {status:r.status,data:await r.json()};
}
try {
  assert.equal((await api('/auth/register',{username,password})).status,201);
  user=(await api('/me')).data.user;
  const existing=(await api('/topics?q='+encodeURIComponent('说唱'))).data.items.find(t=>t.text==='说唱');
  const id=existing?.id || (await api('/topics',{text:'说唱'})).data.id;
  const invalid=await api('/answers',{topicId:id,text:'多景'});
  assert.equal(invalid.status,422);assert.equal(invalid.data.comparison.rows[1].finalMatch,false);
  const alphabet=[...'天地风云星河山海'];
  const prefix=Array.from({length:16},()=>alphabet[Math.floor(Math.random()*alphabet.length)]).join('');
  const text=prefix+'多样';
  const race=await Promise.all([api('/answers',{topicId:id,text,points:999}),api('/answers',{topicId:id,text})]);
  assert.deepEqual(race.map(r=>r.status).sort(),[201,409]);
  const answer=race.find(r=>r.status===201).data;
  assert.equal(answer.kind,'perfect');assert.equal(answer.points,4);
  assert.equal((await api('/me')).data.user.score,4);
  await api('/auth/logout',{});assert.equal((await api('/auth/login',{username,password})).status,200);
  assert.equal((await api('/me')).data.user.score,4);
  const saved=(await api('/profile')).data.answers.find(a=>a.id===answer.id);
  assert.equal(saved.kind,'perfect');assert.equal(saved.points,4);assert.equal(saved.readings.at(-1).final,'iang');
  console.log(JSON.stringify({passed:true,userId:user.id,topicId:id,answerId:answer.id}));
} finally {
  if(user){
    await api('/auth/logout',{});
    assert.match(user.id,/^[a-f0-9-]{36}$/);
    const r=spawnSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','d1','execute','DB','--env','staging','--remote','--command',`UPDATE users SET disabled=1 WHERE id='${user.id}' AND role='user';`],{encoding:'utf8'});
    if(r.status!==0)throw new Error('Staging test account cleanup failed: '+r.stderr);
  }
}
