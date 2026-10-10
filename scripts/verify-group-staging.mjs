import assert from 'node:assert/strict';
import { randomInt, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Keep all generated accounts, words, and submissions in isolated staging.
const base = 'https://rhyme-community-staging.shangqianbeibiantu.workers.dev';
const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const username = '同组测试' + randomUUID().slice(0, 8);
const password = randomUUID();
const alphabet = [...'天风云星山海江花光秋冬春雪松峰林'];
const prefix = Array.from({ length: 16 }, () => alphabet[randomInt(alphabet.length)]).join('');
const topicText = prefix + '嘻哈';
const answerTexts = ['西瓜', '披纱', '溪沙', '低洼', '批发', '滴答', '踢踏', '稀疤', '青蛙'].map(text => prefix + text);
const n = [...topicText].length;
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

async function searchWord(text, source, id) {
  const response = await publicApi('/words?q=' + encodeURIComponent(normalizedQuery(text)));
  assert.equal(response.status, 200);
  assert.equal(response.data.items.length, 1, '每个随机词经过标点和空白标准化后都应能单独搜到');
  const word = response.data.items[0];
  assert.equal(word.text, text);
  assert.equal(word.normalized, text);
  assert.equal(word.source, source);
  assert.equal(word.id, id);
  assert.equal(word.n, n);
  return word;
}

async function checkGroup(selected, members, topicWord, savedAnswers) {
  const response = await publicApi(`/words/${selected.source}/${selected.id}/rhymes`);
  assert.equal(response.status, 200);
  assert.equal(response.data.word.id, selected.id);
  assert.equal(response.data.word.source, selected.source);
  assert.equal(response.data.hasMore, false);
  assert.equal(response.data.items.length, 9, '题目和九个答案中的任意词都应查到另外九个词');
  const expectedMembers = members.filter(member => member.normalized !== selected.normalized);
  assert.deepEqual(
    response.data.items.map(item => item.word.normalized).sort(),
    expectedMembers.map(member => member.normalized).sort(),
    '同组查询不能遗漏其他答案、重复词或者包含当前词本身',
  );
  for (const item of response.data.items) {
    const other = expectedMembers.find(member => member.normalized === item.word.normalized);
    assert.ok(other);
    assert.equal(item.word.id, other.id);
    assert.equal(item.word.source, other.source);
    const isDirect = selected.source === 'topic' || other.source === 'topic';
    assert.equal(item.association, isDirect ? 'direct' : 'group');
    assert.deepEqual(item.via_topic, { id: topicWord.id, text: topicWord.text });
    // Sibling results describe their saved original submission, never a new
    // inferred sibling submission or an invented author for such a pair.
    const saved = savedAnswers.get(other.source === 'topic' ? selected.id : other.id);
    assert.ok(saved);
    assert.equal(item.author, username);
    assert.equal(item.author_id, user.id);
    assert.equal(item.created_at, saved.created_at);
    assert.equal(item.answer_id, saved.id);
    assert.equal(item.relation_id, saved.id);
    assert.equal(item.kind, saved.kind);
    assert.equal(item.points, saved.points);
    assert.equal(item.comparison.n, n);
    assert.equal(item.comparison.kind, saved.kind);
    assert.equal(item.comparison.valid, true);
    assert.equal(item.comparison.points, 0, '查看同组词不会获得新的积分');
    const reverse = other.source === 'topic';
    assert.deepEqual(item.comparison.rows.map(row => row.target), reverse ? saved.readings : topicWord.readings);
    assert.deepEqual(item.comparison.rows.map(row => row.answer), reverse ? topicWord.readings : saved.readings);
    assert.ok(item.comparison.rows.every(row => row.finalMatch || row.toneMatch));
  }
  return response.data.items;
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
  const submissions = [];
  for (const text of answerTexts) {
    const submission = await api('/answers', { topicId, text, points: 999 });
    assert.equal(submission.status, 201, `测试答案 ${text.slice(-2)} 应通过逐字押韵校验`);
    assert.ok(['perfect', 'final', 'tone', 'mixed'].includes(submission.data.kind));
    assert.equal(submission.data.points, n * (submission.data.kind === 'perfect' ? 2 : 1));
    submissions.push({ text, ...submission.data });
  }
  const expectedScore = submissions.reduce((sum, answer) => sum + answer.points, 0);
  assert.equal((await api('/me')).data.user.score, expectedScore, '只按服务器保存的九条答案计分');
  const profile = await api('/profile');
  assert.equal(profile.status, 200);
  const savedAnswers = new Map(profile.data.answers.map(answer => [answer.id, answer]));
  for (const submission of submissions) {
    const saved = savedAnswers.get(submission.id);
    assert.ok(saved);
    assert.equal(saved.kind, submission.kind);
    assert.equal(saved.points, submission.points);
  }

  const topicWord = await searchWord(topicText, 'topic', topicId);
  const members = [topicWord];
  for (const submission of submissions) members.push(await searchWord(submission.text, 'answer', submission.id));
  for (const member of members) await checkGroup(member, members, topicWord, savedAnswers);
  assert.equal((await api('/me')).data.user.score, expectedScore, '搜索十个词及浏览九十条同组结果后积分保持不变');

  const duplicate = await api('/answers', { topicId, text: '　' + submissions[0].text + '！' });
  assert.equal(duplicate.status, 409, '同组互查不能绕过全站答案查重');
  assert.equal((await api('/me')).data.user.score, expectedScore);
  assert.equal((await api('/auth/logout', {})).status, 200);
  assert.equal((await api('/me')).data.user, null);
  assert.equal((await api('/auth/login', { username, password })).status, 200);
  assert.equal((await api('/me')).data.user.score, expectedScore);
  const restored = await api('/profile');
  assert.equal(restored.status, 200);
  assert.ok(restored.data.topics.some(item => item.id === topicId));
  assert.equal(restored.data.answers.filter(item => savedAnswers.has(item.id)).length, 9);
  await checkGroup(members[1], members, topicWord, savedAnswers);
  assert.equal((await api('/me')).data.user.score, expectedScore);
  result = { passed: true, userId: user.id, topicId, topicText, answerIds: submissions.map(answer => answer.id), members: 10, resultsPerMember: 9, score: expectedScore };
} finally {
  if (registered) {
    try {
      await api('/auth/logout', {});
    } finally {
      assert.match(username, /^同组测试[a-f0-9]{8}$/);
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
