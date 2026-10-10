import assert from 'node:assert/strict';
import { randomInt, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// This verifier only creates data in the isolated staging environment.
const base = 'https://rhyme-community-staging.shangqianbeibiantu.workers.dev';
const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const username = '互查测试' + randomUUID().slice(0, 8);
const password = randomUUID();
const alphabet = [...'天风云星山海江花光秋冬春雪松峰林'];
const prefix = Array.from({ length: 16 }, () => alphabet[randomInt(alphabet.length)]).join('');
const topicText = prefix + '说唱';
const answerText = prefix + '多样';
const n = [...topicText].length;
const expectedScore = 2 * n;
let user;
let registered = false;
let result;

function client() {
  let cookie = '';
  return async (path, body) => {
    const response = await fetch(base + '/api' + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const setCookie = response.headers.get('set-cookie');
    if (setCookie) cookie = setCookie.split(';')[0];
    return { status: response.status, data: await response.json() };
  };
}

const api = client();
const publicApi = client();
const normalizedQuery = text => '　' + [...text].join('，\u200b ') + '！';
const rowsText = (comparison, key) => comparison.rows.map(row => row[key].char).join('');

async function lookupWord(text, source, id) {
  const lookup = await publicApi('/words?q=' + encodeURIComponent(normalizedQuery(text)));
  assert.equal(lookup.status, 200);
  assert.equal(lookup.data.items.length, 1, '标准化查询应准确找到随机测试词');
  const word = lookup.data.items[0];
  assert.equal(word.text, text);
  assert.equal(word.normalized, text);
  assert.equal(word.source, source);
  assert.equal(word.id, id);
  assert.equal(word.n, n);
  return word;
}

async function lookupPair(word, opposite) {
  const lookup = await publicApi(`/words/${word.source}/${word.id}/rhymes`);
  assert.equal(lookup.status, 200);
  assert.equal(lookup.data.word.id, word.id);
  assert.equal(lookup.data.word.source, word.source);
  assert.equal(lookup.data.items.length, 1, '随机测试词只应有一条实际提交的押韵关系');
  const pair = lookup.data.items[0];
  assert.equal(pair.word.id, opposite.id);
  assert.equal(pair.word.source, opposite.source);
  assert.equal(pair.word.normalized, opposite.normalized);
  assert.equal(pair.kind, 'perfect');
  assert.equal(pair.points, expectedScore);
  assert.equal(pair.author, username);
  assert.equal(pair.author_id, user.id);
  assert.equal(pair.comparison.n, n);
  assert.equal(pair.comparison.kind, 'perfect');
  assert.equal(pair.comparison.valid, true);
  assert.equal(pair.comparison.points, 0, '查询已有押韵关系不会再次计分');
  assert.equal(rowsText(pair.comparison, 'target'), word.normalized);
  assert.equal(rowsText(pair.comparison, 'answer'), opposite.normalized);
  assert.ok(pair.comparison.rows.every(row => row.finalMatch && row.toneMatch));
  return pair;
}

try {
  const registration = await api('/auth/register', { username, password });
  assert.equal(registration.status, 201);
  registered = true;
  const me = await api('/me');
  assert.equal(me.status, 200);
  user = me.data.user;
  assert.equal(user.username, username);
  assert.equal(user.role, 'user');
  assert.equal(user.score, 0);

  const topic = await api('/topics', { text: topicText });
  assert.equal(topic.status, 201);
  const topicId = topic.data.id;
  assert.equal((await api('/me')).data.user.score, 0, '出题不加分');
  const submission = await api('/answers', { topicId, text: answerText, points: 999 });
  assert.equal(submission.status, 201);
  const answerId = submission.data.id;
  assert.equal(submission.data.kind, 'perfect');
  assert.equal(submission.data.points, expectedScore, '积分必须由服务器重新计算');
  assert.equal((await api('/me')).data.user.score, expectedScore);

  const topicWord = await lookupWord(topicText, 'topic', topicId);
  const answerWord = await lookupWord(answerText, 'answer', answerId);
  const forward = await lookupPair(topicWord, answerWord);
  const reverse = await lookupPair(answerWord, topicWord);
  for (const key of ['author', 'author_id', 'created_at', 'answer_id']) {
    assert.equal(reverse[key], forward[key], `正反查询的 ${key} 应保持首次押韵归属`);
  }
  assert.equal(forward.answer_id, answerId);
  assert.equal(forward.relation_id, answerId);
  assert.equal(reverse.relation_id, answerId);
  assert.deepEqual(reverse.comparison.rows, forward.comparison.rows.map(row => ({
    ...row, target: row.answer, answer: row.target,
  })), '反向查询只交换逐字对照方向');

  const profile = await api('/profile');
  assert.equal(profile.status, 200);
  const saved = profile.data.answers.find(answer => answer.id === answerId);
  assert.ok(saved);
  assert.equal(forward.created_at, saved.created_at);
  assert.equal(saved.kind, 'perfect');
  assert.equal(saved.points, expectedScore);
  assert.equal((await api('/me')).data.user.score, expectedScore, '所有查询均不会改变积分');

  const duplicate = await api('/answers', { topicId, text: '　' + answerText + '！' });
  assert.equal(duplicate.status, 409, '互查功能不能绕过全站答案查重');
  assert.equal((await api('/me')).data.user.score, expectedScore, '重复提交不会重复加分');
  assert.equal((await api('/auth/logout', {})).status, 200);
  assert.equal((await api('/me')).data.user, null);
  assert.equal((await api('/auth/login', { username, password })).status, 200);
  assert.equal((await api('/me')).data.user.score, expectedScore);
  const restored = await api('/profile');
  assert.equal(restored.status, 200);
  assert.ok(restored.data.topics.some(item => item.id === topicId));
  assert.ok(restored.data.answers.some(item => item.id === answerId && item.points === expectedScore));
  const restoredPair = await lookupPair(answerWord, topicWord);
  assert.equal(restoredPair.answer_id, answerId);
  assert.equal(restoredPair.created_at, saved.created_at);
  assert.equal((await api('/me')).data.user.score, expectedScore);
  result = { passed: true, userId: user.id, topicId, answerId };
} finally {
  if (registered) {
    // Disabling the test account must still run if session logout fails.
    try {
      await api('/auth/logout', {});
    } finally {
      assert.match(username, /^互查测试[a-f0-9]{8}$/);
      if (user) assert.match(user.id, /^[a-f0-9-]{36}$/);
      const identity = user ? `id='${user.id}'` : `username='${username}'`;
      const cleanup = spawnSync(process.execPath, [
        'node_modules/wrangler/bin/wrangler.js', 'd1', 'execute', 'DB',
        '--env', 'staging', '--remote', '--command',
        `UPDATE users SET disabled=1 WHERE ${identity} AND role='user';`,
      ], { cwd: projectRoot, encoding: 'utf8' });
      if (cleanup.error || cleanup.status !== 0) {
        throw new Error('Staging test account cleanup failed; content and attribution were retained.');
      }
    }
  }
}

console.log(JSON.stringify(result));
