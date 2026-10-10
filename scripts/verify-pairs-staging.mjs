import assert from 'node:assert/strict';
import { randomInt, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Deliberately fixed: generated QA users and records can never reach production.
const base = 'https://rhyme-community-staging.shangqianbeibiantu.workers.dev';
const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const alphabet = [...'天风云星山海江花光秋冬春雪松峰林'];
const prefix = Array.from({ length: 12 }, () => alphabet[randomInt(alphabet.length)]).join('');
const normalizedQuery = text => '　' + [...text].join('，\u200b ') + '！';
const batch = texts => ({ requestId: randomUUID(), items: texts.map(text => ({ text })) });
const accounts = [];

function client() {
  let cookie = '';
  return async (path, body) => {
    const response = await fetch(base + '/api' + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(cookie ? { Cookie: cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const setCookie = response.headers.get('set-cookie');
    if (setCookie) cookie = setCookie.split(';')[0];
    return { status: response.status, data: await response.json() };
  };
}
const publicApi = client();
async function createAccount() {
  const account = { username: '词对测试' + randomUUID().slice(0, 8), password: randomUUID(), api: client() };
  const registration = await account.api('/auth/register', { username: account.username, password: account.password });
  assert.equal(registration.status, 201);
  // Register cleanup immediately, even if the following profile request fails.
  accounts.push(account);
  account.user = (await account.api('/me')).data.user;
  assert.equal(account.user.role, 'user');
  assert.equal(account.user.score, 0);
  return account;
}
async function word(text) {
  const response = await publicApi('/words?q=' + encodeURIComponent(normalizedQuery(text)));
  assert.equal(response.status, 200);
  const found = response.data.items.find(item => item.normalized === text);
  assert.ok(found, '标准化搜索应能找到已成功提交的词');
  assert.equal('source' in found, false);
  return found;
}
async function rhymes(id) {
  const items = [];
  for (let page = 0; page < 10; page++) {
    const response = await publicApi(`/words/${id}/rhymes?page=${page}`);
    assert.equal(response.status, 200);
    items.push(...response.data.items);
    if (!response.data.hasMore) return items;
  }
  throw new Error('Staging rhyme pagination did not terminate');
}

let result;
try {
  const one = await createAccount();
  const two = await createAccount();
  assert.equal((await one.api('/topics', { text: prefix + '旧题' })).status, 410);
  assert.equal((await one.api('/answers', { text: prefix + '旧答' })).status, 410);
  assert.equal((await one.api('/admin/records')).status, 403);

  const members = ['说唱', '多样', '锅烫'].map(text => prefix + text);
  const payload = batch(members);
  const preview = await publicApi('/rhymes/preview', payload);
  assert.equal(preview.status, 200);
  assert.equal(preview.data.valid, true);
  assert.equal(preview.data.pairCount, 3);
  const n = [...members[0]].length;
  assert.equal(preview.data.totalPoints, 6 * n);
  const saved = await one.api('/rhymes', { ...payload, points: 999 });
  assert.equal(saved.status, 201);
  assert.equal(saved.data.pairs.length, 3);
  assert.equal(saved.data.points, preview.data.totalPoints);
  for (const pair of saved.data.pairs) {
    assert.equal(pair.author_id, one.user.id);
    assert.equal(pair.author, one.username);
    assert.equal(pair.kind, 'perfect');
    assert.equal(pair.n, n);
    assert.equal(pair.points, 2 * n);
  }
  assert.equal((await one.api('/me')).data.user.score, saved.data.points);
  const replay = await one.api('/rhymes', payload);
  assert.ok([200, 201].includes(replay.status));
  assert.equal(replay.data.replayed, true);
  assert.equal(replay.data.id, saved.data.id);
  assert.equal((await one.api('/me')).data.user.score, saved.data.points);
  const altered = await one.api('/rhymes', { ...payload, items: [{ text: members[0] }, { text: prefix + '波浪' }] });
  assert.equal(altered.status, 409);
  const duplicate = await two.api('/rhymes', batch([normalizedQuery(members[1]), normalizedQuery(members[0])]));
  assert.equal(duplicate.status, 409);
  assert.equal((await two.api('/me')).data.user.score, 0);
  const withDuplicate = await two.api('/rhymes', batch([...members, prefix + '播唱']));
  assert.equal(withDuplicate.status, 409);
  assert.equal((await publicApi('/words?q=' + encodeURIComponent(prefix + '播唱'))).data.items.length, 0);
  assert.equal((await two.api('/me')).data.user.score, 0);
  const invalid = await two.api('/rhymes', batch([prefix + '多景', prefix + '播唱']));
  assert.equal(invalid.status, 422);
  assert.equal((await publicApi('/words?q=' + encodeURIComponent(prefix + '多景'))).data.items.length, 0);

  for (const selected of members) {
    const found = await rhymes((await word(selected)).id);
    assert.deepEqual(found.map(item => item.word.normalized).sort(), members.filter(text => text !== selected).sort());
    assert.ok(found.every(item => item.association === 'direct'));
    for (const item of found) {
      const pair = saved.data.pairs.find(pair => pair.id === item.pair.id);
      assert.ok(pair);
      assert.equal(item.pair.author_id, one.user.id);
      assert.equal(item.pair.created_at, pair.created_at);
      assert.equal(item.pair.comparison.points, 0);
      assert.ok(item.pair.comparison.rows.every(row => row.finalMatch && row.toneMatch));
    }
  }
  const bridge = await one.api('/rhymes', batch([members[0], prefix + '波浪']));
  assert.equal(bridge.status, 201, '已有词可以提交新词对');
  const withIndirect = await rhymes((await word(members[1])).id);
  const indirect = withIndirect.find(item => item.word.normalized === prefix + '波浪');
  assert.ok(indirect);
  assert.equal(indirect.association, 'group');
  assert.equal(indirect.pair.id, bridge.data.pairs[0].id);
  assert.deepEqual([indirect.pair.left.normalized, indirect.pair.right.normalized].sort(), [members[0], prefix + '波浪'].sort());

  const race = await Promise.all([
    one.api('/rhymes', batch([prefix + '清瓜', prefix + '星纱', prefix + '冰花'])),
    two.api('/rhymes', batch([prefix + '星纱', prefix + '清瓜', prefix + '春茶'])),
  ]);
  assert.deepEqual(race.map(item => item.status).sort(), [201, 409]);
  const winner = race.find(item => item.status === 201);
  const losingOnlyWord = prefix + (race[0].status === 201 ? '春茶' : '冰花');
  assert.equal((await publicApi('/words?q=' + encodeURIComponent(losingOnlyWord))).data.items.length, 0);
  const oneBeforeBulk = saved.data.points + bridge.data.points + (race[0].status === 201 ? winner.data.points : 0);
  const twoScore = race[1].status === 201 ? winner.data.points : 0;
  assert.equal((await one.api('/me')).data.user.score, oneBeforeBulk);
  assert.equal((await two.api('/me')).data.user.score, twoScore);

  // Exercise Cloudflare's actual D1 limits, not just SQLite in local emulation.
  const toneOnePrefixes = [...'春风花山天星光峰松江川溪湾滩波霜秋冬君军金晶京经惊精鹰英樱莺婴音阴冰兵丁盯灯登东中钟忠终宗踪棕工公功'].slice(0, 50);
  assert.equal(toneOnePrefixes.length, 50);
  const bulkTexts = toneOnePrefixes.map(char => prefix + char + '西瓜');
  const bulkPayload = batch(bulkTexts);
  const bulkPreview = await publicApi('/rhymes/preview', bulkPayload);
  assert.equal(bulkPreview.status, 200);
  assert.equal(bulkPreview.data.valid, true);
  assert.equal(bulkPreview.data.pairCount, 1225);
  const bulk = await one.api('/rhymes', bulkPayload);
  assert.equal(bulk.status, 201);
  assert.equal(bulk.data.pairs.length, 1225);
  assert.equal(bulk.data.points, bulkPreview.data.totalPoints);
  const bulkSelected = await word(bulkTexts[0]);
  const bulkFound = await rhymes(bulkSelected.id);
  assert.equal(bulkFound.length, 49);
  assert.equal(new Set(bulkFound.map(item => item.word.id)).size, 49);
  assert.ok(bulkFound.every(item => item.association === 'direct' && item.pair.author_id === one.user.id));
  const expectedScore = oneBeforeBulk + bulk.data.points;
  assert.equal((await one.api('/me')).data.user.score, expectedScore);
  assert.equal((await one.api('/auth/logout', {})).status, 200);
  assert.equal((await one.api('/me')).data.user, null);
  assert.equal((await one.api('/auth/login', { username: one.username, password: one.password })).status, 200);
  assert.equal((await one.api('/me')).data.user.score, expectedScore);
  const profile = await one.api('/profile');
  assert.equal(profile.status, 200);
  assert.equal(profile.data.hasMore, true);
  assert.ok(profile.data.scoreEntries.every(entry => entry.source === 'submission' && entry.active));
  await rhymes((await word(members[1])).id);
  assert.equal((await one.api('/me')).data.user.score, expectedScore);
  result = { passed: true, userIds: accounts.map(account => account.user.id), submissionId: saved.data.id, batchPairs: 3, bulkSubmissionId: bulk.data.id, bulkWords: 50, bulkPairs: 1225, concurrentWinnerPairs: 3, score: expectedScore };
} finally {
  const failures = [];
  for (const account of accounts) {
    try {
      await account.api('/auth/logout', {});
    } catch {
      // Cleanup still disables the test user even if the logout network fails.
    }
    assert.match(account.username, /^词对测试[a-f0-9]{8}$/);
    if (account.user) assert.match(account.user.id, /^[a-f0-9-]{36}$/);
    const identity = account.user ? `id='${account.user.id}'` : `username='${account.username}'`;
    const cleanup = spawnSync(process.execPath, ['node_modules/wrangler/bin/wrangler.js', 'd1', 'execute', 'DB', '--env', 'staging', '--remote', '--command', `UPDATE users SET disabled=1 WHERE ${identity} AND role='user'; DELETE FROM sessions WHERE user_id IN(SELECT id FROM users WHERE ${identity} AND role='user');`], { cwd: projectRoot, encoding: 'utf8' });
    if (cleanup.error || cleanup.status !== 0) failures.push(account.username);
  }
  if (failures.length) throw new Error('Staging test account cleanup failed; retained records need cleanup for ' + failures.join(', '));
}

console.log(JSON.stringify(result));
