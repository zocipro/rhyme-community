import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { compare, pronunciation } from '../shared/rhyme';
import { compareMutual } from '../shared/pairs';

const base = process.env.TEST_URL || 'http://127.0.0.1:8787';
const tag = randomUUID().slice(0, 8);
const password = 'test-only-password-2026';
const fixture = process.env.TEST_LEGACY_FIXTURE ? JSON.parse(process.env.TEST_LEGACY_FIXTURE) : null;
function client() {
  let cookie = '';
  const identity = randomUUID();
  const request = async (path: string, body?: unknown) => {
    const response = await fetch(base + '/api' + path, {
      headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(cookie ? { Cookie: cookie } : {}), 'CF-Connecting-IP': identity },
      method: body === undefined ? 'GET' : 'POST', body: body === undefined ? undefined : JSON.stringify(body),
    });
    const setCookie = response.headers.get('set-cookie');
    if (setCookie) cookie = setCookie.split(';')[0];
    return { status: response.status, data: await response.json() as Record<string, any>, headers: response.headers };
  };
  return Object.assign(request, { sessionCookie: () => cookie });
}
function db(sql: string, write = false) {
  assert.ok(process.env.TEST_D1_STATE, '通过 integration runner 提供独立临时数据库');
  assert.ok(new URL(base).hostname === '127.0.0.1', '数据库操作只允许 integration runner 的本地服务');
  const script = `import glob,json,sqlite3,sys
p=[x for x in glob.glob(sys.argv[1]+'/v3/d1/**/*.sqlite',recursive=True) if not x.endswith('/metadata.sqlite')]
assert len(p)==1,p
c=sqlite3.connect('file:'+p[0]+'?mode='+sys.argv[3],uri=True)
c.row_factory=sqlite3.Row
rows=[dict(r) for r in c.execute(sys.argv[2])]
c.commit()
print(json.dumps(rows,ensure_ascii=False))`;
  const result = spawnSync('python3', ['-c', script, process.env.TEST_D1_STATE!, sql, write ? 'rw' : 'ro'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout) as any[];
}
const quote = (value: string) => "'" + value.replaceAll("'", "''") + "'";
async function raw(path: string, init: RequestInit = {}) {
  const response = await fetch(base + '/api' + path, { ...init, headers: { 'CF-Connecting-IP': randomUUID(), ...init.headers } });
  return { status: response.status, data: await response.json() as Record<string, any>, headers: response.headers };
}
const dbState = () => db(`SELECT (SELECT COUNT(*) FROM words) AS words,(SELECT COUNT(*) FROM rhyme_pairs) AS pairs,(SELECT COUNT(*) FROM submissions) AS submissions,(SELECT COUNT(*) FROM score_entries) AS scores,(SELECT COALESCE(SUM(points),0) FROM score_entries WHERE status='active') AS points`)[0];
const batch = (texts: string[], requestId = randomUUID()) => ({ requestId, items: texts.map(text => ({ text })) });
const publicApi = client();
const admin = client();
const one = client();
const two = client();
async function word(text: string) {
  const response = await publicApi('/words?q=' + encodeURIComponent('　' + [...text].join('，\u200b ') + '！'));
  assert.equal(response.status, 200);
  const found = response.data.items.find((item: any) => item.normalized === text);
  assert.ok(found, `应能查询规范文本 ${text}`);
  assert.equal('source' in found, false, '统一词 ID 不暴露题目或答案来源');
  return found;
}
async function allRhymes(id: string) {
  const items: any[] = [];
  for (let page = 0; page < 100; page++) {
    const response = await publicApi(`/words/${id}/rhymes?page=${page}`);
    assert.equal(response.status, 200, JSON.stringify(response.data));
    items.push(...response.data.items);
    if (!response.data.hasMore) return items;
  }
  throw new Error('互查分页未终止');
}

// These checks read the migrated DB directly to catch partial writes and owners
// that a visually correct API could otherwise hide.
test('旧数据迁移保留首次词对作者、选定读音、撤回记录和每位用户的积分来源', async () => {
  assert.ok(fixture);
  const health = await publicApi('/health');
  assert.equal(health.status, 200);
  for (const user of fixture.users) {
    const old = client();
    assert.equal((await old('/auth/login', { username: user.username, password: fixture.password })).status, 200);
    assert.equal((await old('/me')).data.user.score, fixture.expectedScores[user.id]);
    const profile = await old('/profile');
    assert.equal(profile.status, 200);
    const expected = fixture.answers.filter((answer: any) => answer.author_id === user.id);
    assert.equal(profile.data.scoreEntries.length, expected.length);
    for (const answer of expected) {
      const entry = profile.data.scoreEntries.find((entry: any) => entry.source_id === answer.id);
      assert.ok(entry);
      assert.equal(entry.source, 'legacy');
      assert.equal(entry.user_id, answer.author_id);
      assert.equal(entry.points, answer.points);
      const sourceTopic = fixture.topics.find((topic: any) => topic.id === answer.topic_id);
      assert.equal(entry.active, answer.status === 'active' && sourceTopic.status === 'active');
    }
  }
  const river = await word('山河');
  const danze = await word('丹泽');
  const migrated = (await allRhymes(river.id)).find(item => item.word.normalized === '丹泽');
  assert.equal(migrated.association, 'direct');
  assert.equal(migrated.pair.id, 'old-first-withdrawn');
  assert.equal(migrated.pair.author_id, 'legacy-b', '最早撤回的记录仍持有首次归属');
  assert.equal(migrated.pair.created_at, '2025-01-03T00:00:00.000Z');
  assert.equal(migrated.pair.status, 'active', '仍有效的反向记录保留可查关系');
  assert.equal(migrated.pair.comparison.points, 0, '只读对照不生成积分');
  const reverse = (await allRhymes(danze.id)).find(item => item.word.id === river.id);
  assert.equal(reverse.pair.id, migrated.pair.id);
  assert.equal(migrated.pair.left.word_id, river.id);
  assert.equal(migrated.pair.right.word_id, danze.id);
  assert.equal(reverse.pair.left.word_id, danze.id);
  assert.equal(reverse.pair.right.word_id, river.id);
  assert.deepEqual(reverse.pair.comparison.rows.map((row: any) => row.target), reverse.pair.left.readings.slice(-reverse.pair.n));
  assert.deepEqual(reverse.pair.comparison.rows.map((row: any) => row.answer), reverse.pair.right.readings.slice(-reverse.pair.n));
  const longMigration = (await allRhymes((await word('长河')).id)).find(item => item.word.normalized === '黄泽').pair;
  assert.equal(longMigration.id, 'old-long-first');
  assert.equal(longMigration.author_id, 'legacy-b');
  assert.equal(longMigration.kind, 'perfect');
  assert.equal(longMigration.points, 4);
  assert.equal([...longMigration.left.readings, ...longMigration.right.readings].find((item: any) => item.char === '长').pinyin, 'chang2', '展示读音取仍有效的后来记录，首作者取最早撤回记录');
  assert.equal(db(`SELECT COUNT(*) AS count FROM rhyme_pairs WHERE id IN ('old-first-withdrawn','old-reverse-active')`)[0].count, 1);
  const musical = (await allRhymes((await word('音乐')).id)).find(item => item.word.normalized === '新课');
  const savedMusic = [...musical.pair.left.readings, ...musical.pair.right.readings].find((syllable: any) => syllable.char === '乐');
  assert.equal(savedMusic.pinyin, 'le4', '迁移保留合法的非默认多音字选择');
  assert.equal((await publicApi('/words?q=' + encodeURIComponent('孤题'))).data.items.length, 0);
  assert.equal((await publicApi('/words?q=' + encodeURIComponent('苹果'))).data.items.length, 0, '仅属于已撤回关系的词退出有效词库');
  assert.equal(db(`SELECT COUNT(*) AS count FROM topics WHERE id='old-topic-empty'`)[0].count, 1, '旧表保留内部归档');
  assert.equal(db(`SELECT COUNT(*) AS count FROM moderation WHERE id='old-withdrawal'`)[0].count, 1);
  assert.equal(db(`SELECT COUNT(*) AS count FROM score_entries`)[0].count, fixture.answers.length);
  assert.equal(db(`SELECT COALESCE(SUM(points),0) AS points FROM score_entries WHERE status='active'`)[0].points, Object.values(fixture.expectedScores).reduce((sum: number, points: any) => sum + points, 0));
  for (const selected of fixture.groupTexts) {
    const selectedWord = await word(selected);
    const result = await allRhymes(selectedWord.id);
    assert.equal(result.length, 9);
    assert.deepEqual(result.map(item => item.word.normalized).sort(), fixture.groupTexts.filter((text: string) => text !== selected).sort());
    assert.equal(result.filter(item => item.association === 'direct').length, selected === '嘻哈' ? 9 : 1);
    for (const item of result.filter(item => item.association === 'group')) {
      assert.ok(fixture.answers.some((answer: any) => answer.id === item.pair.id), '同组词只展示真实旧收录记录');
      const pairWords = [item.pair.left.word_id, item.pair.right.word_id];
      assert.ok(pairWords.includes(item.word.id));
      assert.equal(pairWords.includes(selectedWord.id), false, '未直接投稿的两个成员之间没有伪造词对');
      assert.equal(item.pair.comparison.points, 0);
    }
  }
  const compatibility = await publicApi('/words/answer/old-group-0/rhymes');
  assert.equal(compatibility.status, 200);
  assert.equal(compatibility.data.word.id, (await word('西瓜')).id);
});

test('登录、安全、原子批次、无向查重、请求重试和按关系撤回', async () => {
  assert.equal((await publicApi('/rhymes', batch(['说唱', '多样']))).status, 401);
  assert.equal((await publicApi('/topics', { text: '山河' })).status, 410);
  assert.equal((await publicApi('/answers', { text: '丹泽' })).status, 410);
  assert.equal((await admin('/setup', { token: 'wrong', username: '管理员' + tag, password })).status, 403);
  assert.equal((await admin('/setup', { token: process.env.TEST_BOOTSTRAP_TOKEN || 'local-test-initialization-token', username: '管理员' + tag, password })).status, 201);
  const registered = await one('/auth/register', { username: '作者' + tag, password, role: 'admin' });
  assert.equal(registered.status, 201);
  assert.match(registered.headers.get('set-cookie')!, /HttpOnly/i);
  assert.match(registered.headers.get('set-cookie')!, /SameSite=Lax/i);
  assert.equal((await two('/auth/register', { username: '作者乙' + tag, password })).status, 201);
  assert.equal((await one('/me')).data.user.role, 'user');
  assert.equal((await one('/admin/records')).status, 403);
  assert.equal((await one('/auth/register', { username: '作者' + tag, password })).status, 409);
  const initial = dbState();
  for (const items of [[{ text: '说唱' }], [{ text: '说唱' }, { text: ' 多，\u200b样！' }, { text: '多样' }], [{ text: '说唱' }, { text: '字' }], [{ text: '说唱' }, { text: '多样', readings: ['fake1', 'yang4'] }]]) {
    assert.equal((await publicApi('/rhymes/preview', { items })).status, 400);
    assert.equal((await one('/rhymes', { requestId: randomUUID(), items })).status, 400);
    assert.deepEqual(dbState(), initial);
  }
  const invalid = batch(['山河天地人', '风云月底任', '云山星底任']);
  assert.equal((await publicApi('/rhymes/preview', invalid)).data.valid, false);
  assert.equal((await one('/rhymes', invalid)).status, 422);
  assert.deepEqual(dbState(), initial, '任意一对未押上，连新词也不写入');
  assert.equal((await one('/rhymes', batch(['音乐', '新课', '宾客']))).status, 409, '其中一对已收录时整批失败');
  assert.deepEqual(dbState(), initial, '已有关系不能造成其他词对或孤立词先被写入');
  assert.equal((await one('/rhymes', batch(['说唱', '多样'], ''))).status, 400);
  const acceptedBody = batch(['说唱', '多样', '锅烫']);
  const preview = await publicApi('/rhymes/preview', acceptedBody);
  assert.equal(preview.status, 200);
  assert.equal(preview.data.valid, true);
  assert.equal(preview.data.pairCount, 3);
  assert.equal(preview.data.pairs.length, 3);
  assert.equal(preview.data.totalPoints, 12);
  assert.ok(preview.data.pairs.every((pair: any) => pair.comparison.kind === 'perfect'));
  const accepted = await one('/rhymes', { ...acceptedBody, points: 999 });
  assert.equal(accepted.status, 201, JSON.stringify(accepted.data));
  assert.equal(accepted.data.pairs.length, 3);
  assert.equal(accepted.data.points, 12);
  assert.equal((await one('/me')).data.user.score, 12, '分数由服务器重新计算');
  const replayState = dbState();
  const replay = await one('/rhymes', acceptedBody);
  assert.ok([200, 201].includes(replay.status));
  assert.equal(replay.data.replayed, true);
  assert.equal(replay.data.id, accepted.data.id);
  assert.equal(replay.data.points, accepted.data.points);
  assert.deepEqual(replay.data.pairs.map((pair: any) => pair.id).sort(), accepted.data.pairs.map((pair: any) => pair.id).sort());
  assert.deepEqual(dbState(), replayState);
  assert.equal((await one('/rhymes', { ...acceptedBody, items: [{ text: '说唱' }, { text: '波浪' }] })).status, 409, '同 requestId 不允许换内容');
  assert.deepEqual(dbState(), replayState);
  const dup = await two('/rhymes', batch([' 多，\u200b样！', '　说唱']));
  assert.equal(dup.status, 409, '正反词对与标准化文本不能占第二个名额');
  assert.deepEqual(dbState(), replayState);
  const badDupBatch = await two('/rhymes', batch(['说唱', '多样', '播唱']));
  assert.equal(badDupBatch.status, 409);
  assert.deepEqual(dbState(), replayState);
  assert.equal((await one('/rhymes', batch(['说唱', '波浪']))).status, 201, '词语可以参与新的组合');
  const pairWord = await word('多样');
  const linked = await allRhymes(pairWord.id);
  assert.deepEqual(linked.map(item => item.word.normalized).sort(), ['说唱', '锅烫', '波浪'].sort(), '通过共同词递归扩展有效关系');
  const indirect = linked.find(item => item.word.normalized === '波浪');
  assert.equal(indirect.association, 'group');
  assert.equal(indirect.pair.author, '作者' + tag);
  const indirectWords = [indirect.pair.left.normalized, indirect.pair.right.normalized];
  assert.deepEqual(indirectWords.sort(), ['说唱', '波浪'].sort(), '间接结果展示已有实际关系，而非多样与波浪的新投稿');
  assert.equal(indirect.pair.comparison.points, 0);
  const beforeLookup = (await one('/me')).data.user.score;
  await allRhymes(pairWord.id);
  assert.equal((await one('/me')).data.user.score, beforeLookup, '互查没有自动生成积分');
  const savedPair = accepted.data.pairs.find((pair: any) => [pair.left.normalized, pair.right.normalized].includes('多样') && [pair.left.normalized, pair.right.normalized].includes('说唱'));
  assert.ok(savedPair);
  assert.equal(savedPair.author, '作者' + tag);
  const profile = await one('/profile');
  assert.equal(profile.status, 200);
  assert.equal(profile.data.pairs.length, 4);
  assert.equal(profile.data.scoreEntries.filter((entry: any) => entry.active).length, 4);
  assert.equal((await one('/admin/withdraw', { type: 'pair', id: savedPair.id, reason: '权限测试' })).status, 403);
  assert.equal((await admin('/admin/withdraw', { type: 'pair', id: savedPair.id, reason: '批次撤回测试' })).status, 200);
  assert.equal((await one('/me')).data.user.score, beforeLookup - savedPair.points);
  const afterWithdrawal = dbState();
  assert.equal((await two('/rhymes', batch(['多样', '说唱', '破帐']))).status, 409, '已撤回的词对也不能重新抢首次');
  assert.deepEqual(dbState(), afterWithdrawal);
  assert.equal(db(`SELECT author_id,created_at,status FROM rhyme_pairs WHERE id='${savedPair.id}'`)[0].status, 'withdrawn');
  assert.equal((await one('/auth/logout', {})).status, 200);
  assert.equal((await one('/me')).data.user, null);
  assert.equal((await one('/auth/login', { username: '作者' + tag, password })).status, 200);
  assert.equal((await one('/me')).data.user.score, beforeLookup - savedPair.points);
  const csrf = await fetch(base + '/api/rhymes', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://evil.invalid' }, body: JSON.stringify(batch(['星河', '清澈'])) });
  assert.equal(csrf.status, 403);
  assert.ok((await admin('/admin/records')).data.logs.length > 0);
});

test('逐字规则、长短词、多音字、并发批次和撤回桥接关系', async () => {
  const kinds = [
    ['山河天地人', '风云星底任', 'mixed', 5],
    ['星河山', '听着看', 'final', 3],
    ['青山', '风灯', 'tone', 2],
  ] as const;
  for (const [left, right, kind, points] of kinds) {
    const preview = await publicApi('/rhymes/preview', batch([left, right]));
    assert.equal(preview.status, 200);
    assert.equal(preview.data.valid, true, JSON.stringify(preview.data));
    assert.equal(preview.data.pairs[0].comparison.kind, kind);
    assert.equal(preview.data.totalPoints, points);
    const saved = await one('/rhymes', batch([left, right]));
    assert.equal(saved.status, 201);
    assert.equal(saved.data.points, points);
  }
  const long = await one('/rhymes', batch(['光明山河', '山河']));
  assert.equal(long.status, 201, JSON.stringify(long.data));
  assert.equal(long.data.pairs[0].n, 2);
  assert.equal(long.data.points, 4, '不同完整词拥有相同末尾 N 字也可以完美押韵');
  const longPair = (await allRhymes((await word('光明山河')).id)).find(item => item.word.normalized === '山河').pair;
  assert.equal(longPair.comparison.n, 2);
  assert.equal(longPair.comparison.rows.map((row: any) => row.target.char).join(''), '山河');
  assert.equal(longPair.comparison.rows.map((row: any) => row.answer.char).join(''), '山河');
  const poly = { requestId: randomUUID(), items: [{ text: '银乐', readings: ['yin2', 'le4'] }, { text: '琴鹤' }, { text: '林色' }] };
  const polySaved = await one('/rhymes', poly);
  assert.equal(polySaved.status, 201, JSON.stringify(polySaved.data));
  assert.equal(polySaved.data.points, 12);
  for (const pair of polySaved.data.pairs) {
    const reading = [...pair.left.readings, ...pair.right.readings].find((item: any) => item.char === '乐');
    if (reading) assert.equal(reading.pinyin, 'le4', '批次中一个词的读音在每对中一致');
  }
  const polyPair = (await allRhymes((await word('银乐')).id)).find(item => item.word.normalized === '琴鹤').pair;
  assert.equal([...polyPair.left.readings, ...polyPair.right.readings].find((item: any) => item.char === '乐').pinyin, 'le4');
  const reusedPoly = await one('/rhymes', { requestId: randomUUID(), items: [{ text: '银乐', readings: ['yin2', 'yue4'] }, { text: '情月' }] });
  assert.equal(reusedPoly.status, 201);
  assert.equal([...reusedPoly.data.pairs[0].left.readings, ...reusedPoly.data.pairs[0].right.readings].find((item: any) => item.char === '乐').pinyin, 'yue4', '已有词的新词对仍保存本次选定读音');
  assert.equal((await one('/rhymes', batch(['风云星山清溪河', '登云星山清溪河']))).data.points, 14, '七字及更长词按全文比较');
  const light = await publicApi('/rhymes/preview', batch(['妈妈', '巴巴']));
  assert.equal(light.status, 200);
  assert.equal(light.data.items[0].readings[1].tone, 0, '轻声保留字典声调');
  const check = compareMutual(pronunciation('说唱'), pronunciation('多样'));
  assert.equal(check.kind, 'perfect');
  assert.equal(check.rows[1].target.final, 'ang');
  assert.equal(check.rows[1].answer!.final, 'iang');
  assert.equal(check.rows[1].finalMatch, true);
  assert.equal(compare(pronunciation('山河天地人'), pronunciation('风云月底任')).valid, false);
  const beforeRace = dbState();
  const oneScore = (await one('/me')).data.user.score;
  const twoScore = (await two('/me')).data.user.score;
  const race = await Promise.all([one('/rhymes', batch(['清瓜', '星纱', '冰花'])), two('/rhymes', batch(['星纱', '清瓜', '春茶']))]);
  assert.deepEqual(race.map(result => result.status).sort(), [201, 409]);
  const winning = race.find(result => result.status === 201)!;
  const losingOnlyWord = race[0].status === 201 ? '春茶' : '冰花';
  assert.equal((await publicApi('/words?q=' + encodeURIComponent(losingOnlyWord))).data.items.length, 0);
  assert.equal(dbState().words, beforeRace.words + 3, '并发失败批次连孤立新词都完整回滚');
  assert.equal(dbState().pairs, beforeRace.pairs + 3);
  assert.equal(dbState().submissions, beforeRace.submissions + 1);
  assert.equal(dbState().scores, beforeRace.scores + 3);
  const expectedOne = race[0].status === 201 ? winning.data.points : 0;
  const expectedTwo = race[1].status === 201 ? winning.data.points : 0;
  assert.equal((await one('/me')).data.user.score, oneScore + expectedOne);
  assert.equal((await two('/me')).data.user.score, twoScore + expectedTwo);
  const leftBridge = await one('/rhymes', batch(['红花', '融沙']));
  const rightBridge = await one('/rhymes', batch(['融沙', '龙茶']));
  assert.equal(leftBridge.status, 201); assert.equal(rightBridge.status, 201);
  assert.deepEqual((await allRhymes((await word('红花')).id)).map(item => item.word.normalized).sort(), ['融沙', '龙茶'].sort());
  const bridgeScore = (await one('/me')).data.user.score;
  assert.equal((await admin('/admin/withdraw', { type: 'pair', id: rightBridge.data.pairs[0].id, reason: '桥接关系测试' })).status, 200);
  assert.equal((await one('/me')).data.user.score, bridgeScore - rightBridge.data.points);
  assert.deepEqual((await allRhymes((await word('红花')).id)).map(item => item.word.normalized), ['融沙']);
  assert.equal((await publicApi('/words?q=' + encodeURIComponent('龙茶'))).data.items.length, 0);
  const legacyBeforeA = db(`SELECT COALESCE(SUM(points),0) AS score FROM score_entries WHERE user_id='legacy-a' AND status='active'`)[0].score;
  assert.equal((await admin('/admin/withdraw', { type: 'pair', id: 'old-first-withdrawn', reason: '历史积分来源扣回' })).status, 200);
  assert.equal(db(`SELECT COALESCE(SUM(points),0) AS score FROM score_entries WHERE user_id='legacy-a' AND status='active'`)[0].score, legacyBeforeA - 4, '扣回实际历史得分者而非首次作者');
  assert.equal(db(`SELECT COALESCE(SUM(points),0) AS score FROM score_entries WHERE user_id='legacy-b' AND status='active'`)[0].score, fixture.expectedScores['legacy-b']);
});

test('50 个词生成 1225 对，整批提交和分页不超过 D1 查询上限', async () => {
  const bulk = client();
  assert.equal((await bulk('/auth/register', { username: '批量作者' + tag, password })).status, 201);
  const prefixes = [...new Set([...'春风花山天星光峰松江川溪湾滩波霜秋冬君军金晶京经惊精鹰英樱莺婴音阴冰兵丁盯灯登东中钟忠终宗踪棕工公功宫弓攻空通葱聪封丰锋蜂飞非芬分奔温'])].filter(char => pronunciation(char)[0].tone === 1).slice(0, 50);
  assert.equal(prefixes.length, 50);
  const words = prefixes.map(prefix => prefix + '西瓜');
  const payload = batch(words);
  const preview = await publicApi('/rhymes/preview', payload);
  assert.equal(preview.status, 200);
  assert.equal(preview.data.valid, true);
  assert.equal(preview.data.pairCount, 1225);
  const before = dbState();
  const saved = await bulk('/rhymes', payload);
  assert.equal(saved.status, 201, JSON.stringify(saved.data));
  assert.equal(saved.data.pairs.length, 1225);
  assert.equal(saved.data.points, preview.data.totalPoints);
  assert.equal(dbState().pairs, before.pairs + 1225);
  assert.equal(dbState().scores, before.scores + 1225);
  assert.equal(dbState().submissions, before.submissions + 1);
  assert.equal((await bulk('/me')).data.user.score, saved.data.points);
  const selected = await word(words[0]);
  const page0 = await publicApi(`/words/${selected.id}/rhymes?page=0`);
  const page1 = await publicApi(`/words/${selected.id}/rhymes?page=1`);
  assert.equal(page0.data.items.length, 30);
  assert.equal(page0.data.hasMore, true);
  assert.equal(page1.data.items.length, 19);
  assert.equal(page1.data.hasMore, false);
  const members = [...page0.data.items, ...page1.data.items];
  assert.equal(new Set(members.map(item => item.word.id)).size, 49);
  assert.ok(members.every(item => item.association === 'direct' && item.pair.comparison.points === 0));
  const profilePairs: any[] = [], profileScores: any[] = [];
  for (let page = 0; page < 100; page++) {
    const profile = await bulk('/profile?page=' + page);
    assert.equal(profile.status, 200);
    assert.ok(profile.data.pairs.length <= 30 && profile.data.scoreEntries.length <= 30);
    profilePairs.push(...profile.data.pairs); profileScores.push(...profile.data.scoreEntries);
    if (!profile.data.hasMore) break;
    assert.ok(page < 99, '个人记录分页应终止');
  }
  assert.equal(profilePairs.length, 1225);
  assert.equal(profileScores.length, 1225);
  assert.equal(new Set(profilePairs.map(pair => pair.id)).size, 1225, '全部个人关系不丢失、不重复');
  assert.equal(new Set(profileScores.map(entry => entry.id)).size, 1225, '全部积分明细不丢失、不重复');
  assert.deepEqual(profilePairs.map(pair => pair.id).sort(), saved.data.pairs.map((pair: any) => pair.id).sort());
  assert.deepEqual(profileScores.map(entry => entry.pair_id).sort(), saved.data.pairs.map((pair: any) => pair.id).sort());
  assert.ok(profileScores.every(entry => entry.active));
  assert.equal(profileScores.reduce((sum, entry) => sum + entry.points, 0), saved.data.points);
  const managed: Record<'pairs' | 'users' | 'logs', any[]> = { pairs: [], users: [], logs: [] };
  for (let page = 0; page < 100; page++) {
    const records = await admin('/admin/records?page=' + page);
    assert.equal(records.status, 200);
    for (const key of ['pairs', 'users', 'logs'] as const) {
      assert.ok(records.data[key].length <= 30);
      managed[key].push(...records.data[key]);
    }
    if (!records.data.hasMore) break;
    assert.ok(page < 99, '管理记录分页应终止');
  }
  for (const [key, table] of [['pairs', 'rhyme_pairs'], ['users', 'users'], ['logs', 'moderation']] as const) {
    const ids = managed[key].map(record => record.id);
    assert.equal(new Set(ids).size, ids.length, `管理 ${key} 分页不重复`);
    assert.deepEqual(ids.sort(), db(`SELECT id FROM ${table}`).map(row => row.id).sort(), `管理 ${key} 分页不遗漏，包括撤回历史`);
  }
  const after = dbState();
  const replay = await bulk('/rhymes', payload);
  assert.equal(replay.data.replayed, true);
  assert.deepEqual(dbState(), after);
  assert.equal((await publicApi('/rhymes/preview', batch([...words, '新西瓜']))).status, 400);
  const wordPages: any[] = [];
  let counts;
  for (let page = 0; page < 10; page++) {
    const response = await publicApi('/words?page=' + page);
    wordPages.push(...response.data.items); counts = response.data.counts;
    if (!response.data.hasMore) break;
  }
  assert.equal(new Set(wordPages.map(item => item.normalized)).size, wordPages.length);
  assert.equal(counts.words, wordPages.length);
  assert.equal((await bulk('/me')).data.user.score, saved.data.points);
});

test('同账号并发重试只保存一次；请求结果仅向当前投稿账号开放', async () => {
  const writer = client(), stranger = client();
  assert.equal((await writer('/auth/register', { username: '重试作者' + tag, password })).status, 201);
  assert.equal((await stranger('/auth/register', { username: '隔离作者' + tag, password })).status, 201);
  const payload = batch(['雾灯', '树峰']);
  const requestPath = '/rhymes/requests/' + payload.requestId;
  assert.equal((await publicApi(requestPath)).status, 401);
  assert.deepEqual((await writer(requestPath)).data, { found: false });
  const before = dbState();
  const results = await Promise.all([writer('/rhymes', payload), writer('/rhymes', payload)]);
  assert.deepEqual(results.map(result => result.status).sort(), [200, 201]);
  assert.equal(results[0].data.id, results[1].data.id);
  assert.equal(results.filter(result => result.data.replayed === true).length, 1);
  assert.deepEqual(dbState(), { words: before.words + 2, pairs: before.pairs + 1, submissions: before.submissions + 1, scores: before.scores + 1, points: before.points + 4 });
  assert.equal((await writer('/me')).data.user.score, 4);
  const resolved = await writer(requestPath);
  assert.equal(resolved.status, 200);
  assert.equal(resolved.data.found, true);
  assert.equal(resolved.data.id, results[0].data.id);
  assert.equal(resolved.data.points, 4);
  assert.equal(resolved.data.replayed, true);
  assert.deepEqual(resolved.data.pairs.map((pair: any) => pair.id), results[0].data.pairs.map((pair: any) => pair.id));
  assert.deepEqual((await stranger(requestPath)).data, { found: false }, '别的账号不能发现同一请求标识对应的私人提交结果');
  const after = dbState();
  await writer(requestPath);
  assert.deepEqual(dbState(), after, '读取已保存请求不会新增积分');
});

test('同账号同标识并发不同内容只保存胜出批次，失败批次没有残留', async () => {
  const writer = client();
  assert.equal((await writer('/auth/register', { username: '标识作者' + tag, password })).status, 201);
  const requestId = randomUUID();
  const payloads = [batch(['海浪', '彩唱'], requestId), batch(['沙龙', '花虫'], requestId)];
  const before = dbState();
  const results = await Promise.all(payloads.map(payload => writer('/rhymes', payload)));
  assert.deepEqual(results.map(result => result.status).sort(), [201, 409]);
  const winnerIndex = results.findIndex(result => result.status === 201);
  const winning = results[winnerIndex];
  assert.equal(winning.data.points, 4);
  assert.deepEqual(dbState(), { words: before.words + 2, pairs: before.pairs + 1, submissions: before.submissions + 1, scores: before.scores + 1, points: before.points + 4 });
  for (const item of payloads[1 - winnerIndex].items) assert.equal(db(`SELECT COUNT(*) AS count FROM words WHERE normalized=${quote(item.text)}`)[0].count, 0);
  const resolved = await writer('/rhymes/requests/' + requestId);
  assert.equal(resolved.data.id, winning.data.id);
  assert.equal(resolved.data.pairs.length, 1);
  assert.equal((await writer('/me')).data.user.score, 4);
});

test('管理员重置密码撤销已有会话；旧密码失效，新密码可重新登录', async () => {
  const owner = client(), anotherDevice = client();
  const username = '会话作者' + tag;
  assert.equal((await owner('/auth/register', { username, password })).status, 201);
  assert.equal((await anotherDevice('/auth/login', { username, password })).status, 200);
  const id = (await owner('/me')).data.user.id;
  const firstCookie = owner.sessionCookie(), secondCookie = anotherDevice.sessionCookie();
  const newPassword = 'changed-test-password-2026';
  assert.equal((await two('/admin/reset-password', { id, password: newPassword })).status, 403);
  assert.equal((await admin('/admin/reset-password', { id: (await admin('/me')).data.user.id, password: newPassword })).status, 400);
  assert.equal((await admin('/admin/reset-password', { id, password: newPassword })).status, 200);
  assert.equal(db(`SELECT COUNT(*) AS count FROM sessions WHERE user_id=${quote(id)}`)[0].count, 0);
  for (const cookie of [firstCookie, secondCookie]) {
    assert.equal((await raw('/me', { headers: { Cookie: cookie } })).data.user, null);
    assert.equal((await raw('/profile', { headers: { Cookie: cookie } })).status, 401);
  }
  assert.equal((await owner('/auth/login', { username, password })).status, 401);
  assert.equal((await owner('/auth/login', { username, password: newPassword })).status, 200);
  assert.equal((await owner('/me')).data.user.id, id);
  const logs = db(`SELECT entity_type,entity_id,action FROM moderation WHERE entity_id=${quote(id)}`);
  assert.deepEqual(logs, [{ entity_type: 'user', entity_id: id, action: 'reset-password' }]);
  db(`UPDATE sessions SET expires_at=0 WHERE user_id=${quote(id)}`, true);
  assert.equal((await owner('/me')).data.user, null, '过期会话不可登录');
  assert.equal((await owner('/rhymes', batch(['微光', '飞霜']))).status, 401);
});

test('同 IP 登录额度耗尽仍可退出；清 Cookie 并撤销当前会话，保留来源和 JSON 校验', async () => {
  const owner=client(), otherDevice=client();
  const username='退出作者'+tag;
  assert.equal((await owner('/auth/register',{username,password})).status,201);
  assert.equal((await otherDevice('/auth/login',{username,password})).status,200);
  const id=(await owner('/me')).data.user.id, cookie=owner.sessionCookie();
  assert.equal(db(`SELECT COUNT(*) AS count FROM sessions WHERE user_id=${quote(id)}`)[0].count,2);
  const identity=randomUUID();
  const headers={'Content-Type':'application/json','CF-Connecting-IP':identity};
  const invalidLogin=JSON.stringify({username:'未知退出'+tag,password});
  for(let attempt=0;attempt<12;attempt++) {
    assert.equal((await raw('/auth/login',{method:'POST',headers,body:invalidLogin})).status,401);
  }
  assert.equal((await raw('/auth/login',{method:'POST',headers,body:invalidLogin})).status,429,'确认相同 IP 的认证额度确实耗尽');
  assert.equal((await raw('/auth/logout',{method:'POST',headers:{...headers,Cookie:cookie,Origin:'https://evil.invalid'},body:'{}'})).status,403);
  assert.equal((await raw('/auth/logout',{method:'POST',headers:{...headers,Cookie:cookie},body:'null'})).status,400);
  assert.equal((await raw('/auth/logout',{method:'POST',headers:{...headers,Cookie:cookie},body:'{invalid'})).status,400);
  assert.equal((await raw('/auth/logout',{method:'POST',headers:{...headers,Cookie:cookie,'Content-Type':'text/plain'},body:'{}'})).status,415);
  assert.equal((await raw('/me',{headers:{Cookie:cookie}})).data.user.id,id,'无效退出请求不能撤销有效会话');
  const anonymous=await raw('/auth/logout',{method:'POST',headers,body:'{}'});
  assert.equal(anonymous.status,200);assert.equal(anonymous.data.ok,true);
  assert.match(anonymous.headers.get('set-cookie')!,/rhyme_session=;/);
  assert.equal(db(`SELECT COUNT(*) AS count FROM sessions WHERE user_id=${quote(id)}`)[0].count,2,'无 Cookie 退出不撤销其他设备会话');
  const logout=await raw('/auth/logout',{method:'POST',headers:{...headers,Cookie:cookie},body:'{}'});
  assert.equal(logout.status,200);assert.equal(logout.data.ok,true);
  assert.match(logout.headers.get('set-cookie')!,/rhyme_session=;/);
  assert.match(logout.headers.get('set-cookie')!,/Max-Age=0/i);
  assert.equal(db(`SELECT COUNT(*) AS count FROM sessions WHERE user_id=${quote(id)}`)[0].count,1);
  assert.equal((await raw('/me',{headers:{Cookie:cookie}})).data.user,null);
  assert.equal((await raw('/profile',{headers:{Cookie:cookie}})).status,401);
  assert.equal((await otherDevice('/me')).data.user.id,id,'退出仅撤销当前 Cookie 的会话');
});

test('错误 JSON、非对象请求、错误类型与超限输入返回明确错误且不写内容', async () => {
  const before = dbState();
  for (const endpoint of ['/auth/register', '/auth/login', '/setup', '/rhymes/preview', '/rhymes']) {
    const response = await one(endpoint, null);
    assert.equal(response.status, 400, `${endpoint} 应拒绝 JSON null：${JSON.stringify(response.data)}`);
    assert.match(response.data.error, /格式|对象|JSON/);
  }
  const malformed = await raw('/rhymes/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{invalid' });
  assert.equal(malformed.status, 400); assert.match(malformed.data.error, /格式/);
  const contentType = await raw('/rhymes/preview', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(batch(['微光', '飞霜'])) });
  assert.equal(contentType.status, 415); assert.match(contentType.data.error, /JSON/);
  const oversized = await raw('/rhymes/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'x'.repeat(2 * 1024 * 1024 + 1) }) });
  assert.equal(oversized.status, 413); assert.match(oversized.data.error, /太长/);
  assert.deepEqual(dbState(), before);
});

test('事务中途保存异常完全回滚；修复后原 requestId 可安全重试', async () => {
  const writer = client();
  assert.equal((await writer('/auth/register', { username: '回滚作者' + tag, password })).status, 201);
  const payload = batch(['微光', '飞霜']);
  const before = dbState();
  db("CREATE TRIGGER integration_fail_score BEFORE INSERT ON score_entries BEGIN SELECT RAISE(ABORT,'D1_TEST_FORCED_FAILURE'); END", true);
  try {
    const failed = await writer('/rhymes', payload);
    assert.equal(failed.status, 503, JSON.stringify(failed.data));
    assert.match(failed.data.error, /暂时不可用/);
    assert.deepEqual(dbState(), before, '第四条积分 SQL 报错时，词、关系和批次必须全部回滚');
    assert.deepEqual((await writer('/rhymes/requests/' + payload.requestId)).data, { found: false });
  } finally {
    db('DROP TRIGGER integration_fail_score', true);
  }
  const retry = await writer('/rhymes', payload);
  assert.equal(retry.status, 201, JSON.stringify(retry.data));
  assert.equal(retry.data.points, 4);
  const replay = await writer('/rhymes', payload);
  assert.equal(replay.status, 200); assert.equal(replay.data.id, retry.data.id);
  assert.equal((await writer('/me')).data.user.score, 4);
});

test('管理接口匿名、过期和退出会话返回 401，普通账号仍 403，拒绝请求不执行管理写入', async () => {
  const manager=client(), target=client();
  const adminAccount={username:'管理员'+tag,password};
  const ordinaryAccount={username:'权限作者'+tag,password};
  assert.equal((await manager('/auth/login',adminAccount)).status,200);
  assert.equal((await manager('/admin/records')).status,200);
  assert.equal((await target('/auth/register',ordinaryAccount)).status,201);
  const targetId=(await target('/me')).data.user.id;
  const pairId=db("SELECT id FROM rhyme_pairs WHERE status='active' ORDER BY id LIMIT 1")[0].id;
  const state=()=>({
    content:dbState(),
    auditCount:db('SELECT COUNT(*) AS count FROM moderation')[0].count,
    targetSessions:db(`SELECT COUNT(*) AS count FROM sessions WHERE user_id=${quote(targetId)}`)[0].count,
  });
  const before=state();
  const denied=async(headers:Record<string,string>,expected:number)=>{
    const records=await raw('/admin/records',{headers});assert.equal(records.status,expected);
    if(expected===401)assert.match(records.data.error,/登录/);
    for(const [endpoint,body] of [
      ['/admin/withdraw',{type:'pair',id:pairId,reason:'被拒绝的撤回请求'}],
      ['/admin/reset-password',{id:targetId,password:'never-applied-password-2026'}],
    ] as const){
      const response=await raw(endpoint,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
      assert.equal(response.status,expected);
    }
    assert.deepEqual(state(),before,'拒绝管理请求不能撤回关系、扣分、生成处理记录或撤销目标用户会话');
  };
  await denied({},401);
  await denied({Cookie:'rhyme_session=invalid-session'},401);
  const expiredCookie=manager.sessionCookie();
  const tokenHash=createHash('sha256').update(expiredCookie.slice('rhyme_session='.length)).digest('hex');
  db(`UPDATE sessions SET expires_at=0 WHERE token_hash=${quote(tokenHash)}`,true);
  assert.equal((await manager('/me')).data.user,null);
  await denied({Cookie:expiredCookie},401);
  assert.equal((await manager('/auth/login',adminAccount)).status,200);
  const loggedOutCookie=manager.sessionCookie();
  assert.equal((await manager('/auth/logout',{})).status,200);
  await denied({Cookie:loggedOutCookie},401);
  await denied({Cookie:target.sessionCookie()},403);
  assert.equal((await client()('/auth/login',ordinaryAccount)).status,200,'未授权重置不能改变目标用户密码');
});
