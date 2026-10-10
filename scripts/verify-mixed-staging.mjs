import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
const base='https://rhyme-community-staging.shangqianbeibiantu.workers.dev';
const username='混合测试'+randomUUID().slice(0,8), password=randomUUID();
let cookie='';
async function api(path,body){
  const r=await fetch(base+'/api'+path,{method:body?'POST':'GET',headers:{...(body?{'Content-Type':'application/json'}:{}),...(cookie?{Cookie:cookie}:{})},body:body?JSON.stringify(body):undefined});
  if(r.headers.get('set-cookie'))cookie=r.headers.get('set-cookie').split(';')[0];
  return {status:r.status,data:await r.json()};
}
assert.equal((await api('/auth/register',{username,password})).status,201);
const user=(await api('/me')).data.user;
const existing=(await api('/topics?q='+encodeURIComponent('山河天地人'))).data.items.find(t=>t.text==='山河天地人');
const id=existing?.id || (await api('/topics',{text:'山河天地人'})).data.id;
const invalid=await api('/answers',{topicId:id,text:'风云月底任'});
assert.equal(invalid.status,422);assert.equal(invalid.data.comparison.kind,'none');
const prefix=Array.from({length:8},()=>String.fromCharCode(0x4e00+Math.floor(Math.random()*2000))).join('');
const text=prefix+'风云星底任';
const race=await Promise.all([api('/answers',{topicId:id,text,points:999}),api('/answers',{topicId:id,text})]);
assert.deepEqual(race.map(r=>r.status).sort(),[201,409]);
const answer=race.find(r=>r.status===201).data;
assert.equal(answer.kind,'mixed');assert.equal(answer.points,5);
assert.equal((await api('/me')).data.user.score,5);
await api('/auth/logout',{});assert.equal((await api('/auth/login',{username,password})).status,200);
assert.equal((await api('/me')).data.user.score,5);
const saved=(await api('/profile')).data.answers.find(a=>a.id===answer.id);
assert.equal(saved.kind,'mixed');assert.equal(saved.points,5);
console.log(JSON.stringify({passed:true,userId:user.id,username,topicId:id,answerId:answer.id}));
