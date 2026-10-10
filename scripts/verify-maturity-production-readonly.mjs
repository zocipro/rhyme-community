import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

// No content-writing endpoint, migration, SQL mutation, or authentication is used.
// POST preview requests can update the server's operational rate-limit counters.
const mode = process.argv[2] || 'verify';
assert.ok(['baseline', 'verify'].includes(mode), 'Use baseline or verify explicitly.');
const expectedVersion = process.argv[3] || null;
if(expectedVersion) assert.match(expectedVersion, /^[a-f0-9-]{36}$/, 'Expected a Worker version ID.');
const root = fileURLToPath(new URL('..', import.meta.url));
const base = 'https://ya.zoci.pro';
const baselinePath = new URL('../records/2026-10-08-production-baseline.json', import.meta.url);
const archive = JSON.parse(await readFile(new URL('../records/2026-10-05-pairs-production-before.json', import.meta.url), 'utf8'));
const center = archive.topics.find(row => row.normalized === '嘻哈');
assert.ok(center, 'Historical group source is missing.');
const historicalMembers = [center.normalized, ...archive.answers.filter(row => row.topic_id === center.id && row.status === 'active').map(row => row.normalized)];
assert.equal(new Set(historicalMembers).size, 10, 'Expected the original ten-member group.');
const tables = ['words', 'rhyme_pairs', 'score_entries'];
const userFields = ['id', 'username', 'role', 'disabled', 'created_at'];
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const hash = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');

function query(sql) {
  assert.ok(/^(?:SELECT|PRAGMA)\b/i.test(sql.trim()), 'Only SELECT/PRAGMA are permitted.');
  const result = spawnSync(process.execPath, ['node_modules/wrangler/bin/wrangler.js', 'd1', 'execute', 'DB', '--env=', '--remote', '--json', '--command', sql], {
    cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
  });
  if (result.error || result.status !== 0) throw new Error(`Production D1 read failed (${result.status ?? 'process error'}).`);
  let data;
  try { data = JSON.parse(result.stdout); } catch { throw new Error('Production D1 did not return valid JSON.'); }
  assert.ok(data.every(item => item.success), 'Production D1 read was unsuccessful.');
  return data.map(item => item.results);
}

function capture() {
  const schemas = query(tables.map(table => `PRAGMA table_info(${table});`).join('\n'));
  const columns = Object.fromEntries(tables.map((table, i) => [table, schemas[i].map(column => column.name)]));
  for (const names of Object.values(columns)) assert.ok(names.every(name => /^[a-z_][a-z0-9_]*$/.test(name)), 'Unexpected schema identifier.');
  const fields = names => names.map(name => `'${name}',r.${name}`).join(',');
  const sections = tables.map(table => `'${table}',json((SELECT json_group_array(json_object(${fields(columns[table])})) FROM (SELECT * FROM ${table} ORDER BY id) r))`);
  sections.push(`'users',json((SELECT json_group_array(json_object(${fields(userFields)},'score',COALESCE((SELECT SUM(s.points) FROM score_entries s JOIN rhyme_pairs p ON p.id=s.pair_id WHERE s.user_id=r.id AND s.status='active' AND p.status='active'),0))) FROM (SELECT ${userFields.join(',')} FROM users ORDER BY id) r))`);
  // All content and account-score reads share one SQLite statement/snapshot.
  const [result] = query(`SELECT json_object('capturedAt',strftime('%Y-%m-%dT%H:%M:%fZ','now'),${sections.join(',')}) AS snapshot;`);
  assert.equal(result.length, 1);
  return { ...JSON.parse(result[0].snapshot), columns };
}

function publicPair(row, snapshot) {
  const words = new Map(snapshot.words.map(word => [word.id, word]));
  const users = new Map(snapshot.users.map(user => [user.id, user]));
  return {
    id: row.id,
    left: { word_id: row.left_word_id, text: row.left_text, normalized: words.get(row.left_word_id).normalized, readings: JSON.parse(row.left_readings) },
    right: { word_id: row.right_word_id, text: row.right_text, normalized: words.get(row.right_word_id).normalized, readings: JSON.parse(row.right_readings) },
    n: row.n, kind: row.kind, points: row.points, author_id: row.author_id, author: users.get(row.author_id).username, created_at: row.created_at, status: row.status,
  };
}
function apiPair(pair) {
  const { id, left, right, n, kind, points, author_id, author, created_at, status } = pair;
  return { id, left: left.word_id < right.word_id ? left : right, right: left.word_id < right.word_id ? right : left, n, kind, points, author_id, author, created_at, status };
}
function counts(snapshot) {
  const activePairs = snapshot.rhyme_pairs.filter(pair => pair.status === 'active');
  return { words: snapshot.words.length, pairs: snapshot.rhyme_pairs.length, activeWords: new Set(activePairs.flatMap(pair => [pair.left_word_id, pair.right_word_id])).size, activePairs: activePairs.length, scoreEntries: snapshot.score_entries.length, users: snapshot.users.length, totalScore: snapshot.users.reduce((sum, user) => sum + user.score, 0) };
}
function redact(snapshot) {
  const content = Object.fromEntries(tables.map(table => {
    const rows = snapshot[table].map(row => ({ id: row.id, hash: hash(row), ...(table === 'rhyme_pairs' ? { publicHash: hash(publicPair(row, snapshot)) } : {}) }));
    return [table, { columns: snapshot.columns[table], count: rows.length, hash: hash(rows), rows }];
  }));
  return { format: 1, date: '2026-10-08', environment: 'production', url: base, capturedAt: snapshot.capturedAt, contentWrites: 0,
    counts: counts(snapshot), tables: content, users: snapshot.users.map(user => ({ id: user.id, metadataHash: hash(Object.fromEntries(userFields.map(field => [field, user[field]]))), scoreHash: hash({ id: user.id, score: user.score }) })),
    historicalGroup: historicalMembers.map(text => { const word = snapshot.words.find(row => row.normalized === text); assert.ok(word, 'Missing historical word.'); return { id: word.id, normalizedHash: hash(text) }; }),
  };
}

function verifyData(before, snapshot) {
  for (const table of tables) {
    assert.equal(hash(snapshot.columns[table]), hash(before.tables[table].columns), `Schema changed for ${table}.`);
    const current = new Map(snapshot[table].map(row => [row.id, row]));
    for (const row of before.tables[table].rows) {
      assert.ok(current.has(row.id), `Missing ${table} ID ${row.id}.`);
      assert.equal(hash(current.get(row.id)), row.hash, `Persistent fields changed for ${table} ID ${row.id}.`);
    }
  }
  const oldEntryIds = new Set(before.tables.score_entries.rows.map(row => row.id));
  const activePairIds = new Set(snapshot.rhyme_pairs.filter(row => row.status === 'active').map(row => row.id));
  const oldScores = new Map();
  for (const row of snapshot.score_entries) if (oldEntryIds.has(row.id) && row.status === 'active' && activePairIds.has(row.pair_id)) oldScores.set(row.user_id, (oldScores.get(row.user_id) || 0) + row.points);
  const currentUsers = new Map(snapshot.users.map(user => [user.id, user]));
  for (const old of before.users) {
    const user = currentUsers.get(old.id); assert.ok(user, `Missing user ID ${old.id}.`);
    assert.equal(hash(Object.fromEntries(userFields.map(field => [field, user[field]]))), old.metadataHash, `Account metadata changed for ID ${old.id}.`);
    assert.equal(hash({ id: user.id, score: oldScores.get(user.id) || 0 }), old.scoreHash, `Existing score sources changed for user ID ${old.id}.`);
  }
  return { existingPersistentRowsUnchanged: true, existingPerUserScoreSourcesUnchanged: true, newWords: snapshot.words.length - before.counts.words, newPairs: snapshot.rhyme_pairs.length - before.counts.pairs, newScoreEntries: snapshot.score_entries.length - before.counts.scoreEntries, newUsers: snapshot.users.length - before.counts.users };
}

let transportRetries = 0;
const transportFailures = [];
async function requestJson(path, options = {}, checkName = path) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetch(base + '/api' + path, { ...options, headers: { Connection: 'close', ...options.headers }, signal: AbortSignal.timeout(15_000) });
      return { status: response.status, data: await response.json() };
    } catch (error) {
      // Retry transport interruptions only. HTTP failures and failed assertions remain visible.
      const transient = error instanceof TypeError || ['TimeoutError', 'AbortError'].includes(error.name);
      transportFailures.push({ checkName, path, attempt, error: error.name, code: error.cause?.code || null });
      const repeatedLargePreviewFailure = checkName === 'fifty-words-fifteen-characters-preview' && attempt >= 2;
      if (!transient || attempt === 3 || repeatedLargePreviewFailure) throw new Error(`Read-only HTTP request failed for ${checkName} (${path}, attempt ${attempt}).`, { cause: error });
      transportRetries++;
      await new Promise(resolve => setTimeout(resolve, attempt * 250));
    }
  }
}
async function get(path) { const response = await requestJson(path); assert.equal(response.status, 200, `GET ${path} failed.`); return response.data; }
async function postPreview(body, checkName) { return requestJson('/rhymes/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, checkName); }
async function resourceBytes(path) {
  for(let attempt=1;attempt<=3;attempt++) {
    try {
      const response=await fetch(base+path,{headers:{Connection:'close','Cache-Control':'no-cache'},signal:AbortSignal.timeout(15_000)});
      assert.equal(response.status,200,`Static resource failed for ${path}.`);
      return Buffer.from(await response.arrayBuffer());
    } catch(error) {
      transportFailures.push({checkName:'static-resource',path,attempt,error:error.name,code:error.cause?.code||null});
      if(!(error instanceof TypeError||['TimeoutError','AbortError'].includes(error.name))||attempt===3)throw new Error(`Static resource request failed for ${path}.`,{cause:error});
      transportRetries++;
      await new Promise(resolve=>setTimeout(resolve,attempt*250));
    }
  }
}
async function verifyResources() {
  const html=await resourceBytes('/');
  const paths=[...html.toString().matchAll(/\b(?:src|href)=["'](\/assets\/[a-zA-Z0-9_.-]+\.(?:js|css))["']/g)].map(match=>match[1]);
  assert.ok(paths.some(path=>path.endsWith('.js'))&&paths.some(path=>path.endsWith('.css')),'Missing production JS/CSS references.');
  const resources=[{path:'/',bytes:html.length,sha256:createHash('sha256').update(html).digest('hex')}];
  for(const path of new Set(paths)) {
    const bytes=await resourceBytes(path);const sha256=createHash('sha256').update(bytes).digest('hex');
    const local=await readFile(new URL('../dist'+path,import.meta.url));
    assert.equal(sha256,createHash('sha256').update(local).digest('hex'),`Published asset differs from current build for ${path}.`);
    resources.push({path,bytes:bytes.length,sha256,localBuildMatches:true});
  }
  return resources;
}
function currentDeployment() {
  const result=spawnSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','deployments','list','--env=','--json'],{cwd:root,encoding:'utf8',maxBuffer:1024*1024,env:{...process.env,WRANGLER_SEND_METRICS:'false'}});
  if(result.error||result.status!==0)throw new Error('Production deployment metadata read failed.');
  const latest=JSON.parse(result.stdout).sort((left,right)=>left.created_on.localeCompare(right.created_on)).at(-1);
  assert.ok(latest,'No production deployment found.');
  assert.equal(latest.versions.length,1,'Expected one active production version.');
  assert.equal(latest.versions[0].percentage,100,'Expected production version at 100% traffic.');
  const version=latest.versions[0].version_id;if(expectedVersion)assert.equal(version,expectedVersion,'Production version changed during verification.');
  return {id:latest.id,createdAt:latest.created_on,version,percentage:100};
}
async function lookup(id) {
  const items = [];
  for (let page = 0; page < 1000; page++) { const result = await get(`/words/${id}/rhymes?page=${page}`); items.push(...result.items); if (!result.hasMore) return items; }
  throw new Error('Group pagination exceeded safety limit.');
}
async function verifyApi(before) {
  assert.equal((await get('/health')).ok, true);
  const expectedPairs = new Map(before.tables.rhyme_pairs.rows.map(row => [row.id, row.publicHash]));
  const checks = [];
  const verifiedPairIds = new Set();
  for (const text of historicalMembers) {
    const words = await get('/words?q=' + encodeURIComponent('　' + [...text].join('，\uFE0F ') + '！'));
    const word = words.items.find(item => item.normalized === text); assert.ok(word, 'Historical word search failed.');
    const found = await lookup(word.id); const foundTexts = new Set(found.map(item => item.word.normalized));
    for (const expected of historicalMembers.filter(other => other !== text)) assert.ok(foundTexts.has(expected), 'Historical group member missing.');
    for (const item of found) {
      assert.equal(item.pair.comparison.points, 0, 'Lookup manufactured score.');
      if (expectedPairs.has(item.pair.id)) { assert.equal(hash(apiPair(item.pair)), expectedPairs.get(item.pair.id), `Public attribution/readings changed for pair ID ${item.pair.id}.`); verifiedPairIds.add(item.pair.id); }
      if (item.association === 'direct') assert.equal(item.pair.left.word_id, word.id);
      else { assert.equal(item.association, 'group'); assert.ok([item.pair.left.word_id, item.pair.right.word_id].includes(item.word.id), 'Indirect member has no supporting actual relation.'); }
    }
    checks.push({ id: word.id, results: found.length, historicalOtherMembersPresent: 9, direct: found.filter(item => item.association === 'direct').length });
  }
  for (const row of before.tables.rhyme_pairs.rows) {
    const result = await get(`/rhymes/${row.id}`);
    assert.equal(hash(apiPair(result.pair)), row.publicHash, `Record API changed pair ID ${row.id}.`);
    verifiedPairIds.add(row.id);
  }
  const duplicate = await postPreview({ items: [{ text: '嘻哈' }, { text: '西瓜' }] }, 'duplicate-preview');
  assert.equal(duplicate.status, 200); assert.equal(duplicate.data.valid, false); assert.ok(duplicate.data.pairs[0].duplicate); assert.equal(duplicate.data.totalPoints, 0);
  const invisible = await postPreview({ items: [{ text: '山\uFE0F河' }, { text: '丹\u034F泽' }] }, 'invisible-normalization-preview');
  assert.equal(invisible.status, 200); assert.equal(invisible.data.items[0].normalized, '山河'); assert.equal(invisible.data.items[1].normalized, '丹泽'); assert.equal(invisible.data.pairs[0].comparison.kind, 'perfect');
  const nasal = await postPreview({ items: [{ text: '唔唔', readings: ['n2', 'n2'] }, { text: '呒呒', readings: ['m2', 'm2'] }] }, 'syllabic-nasal-preview');
  assert.equal(nasal.status, 200); assert.equal(nasal.data.pairs[0].comparison.kind, 'tone'); assert.equal(nasal.data.pairs[0].comparison.points, 2);
  const extra = await postPreview({ items: [{ text: '山河', readings: ['shan1', 'he2', 'fake1'] }, { text: '丹泽' }] }, 'extra-reading-preview'); assert.equal(extra.status, 400); assert.match(extra.data.error, /读音数量/);
  const invalid = await postPreview(null, 'null-json-preview'); assert.equal(invalid.status, 400); assert.match(invalid.data.error, /JSON 对象/);
  const budget = await postPreview({ items: Array.from({ length: 50 }, (_, i) => ({ text: '山'.repeat(16) + String.fromCodePoint(0x4e00 + i) })) }, 'comparison-budget-preview'); assert.equal(budget.status, 400); assert.match(budget.data.error, /20,000/);
  const characterBudget = await postPreview({ items: [{ text: '山'.repeat(5001) }, { text: '丹'.repeat(5000) }] }, 'character-budget-preview'); assert.equal(characterBudget.status, 400); assert.match(characterBudget.data.error, /10,000/);
  const supported = await postPreview({ items: Array.from({ length: 50 }, (_, i) => ({ text: '山'.repeat(14) + String.fromCodePoint(0x4e00 + i) })) }, 'fifty-words-fifteen-characters-preview'); assert.equal(supported.status, 200); assert.equal(supported.data.pairCount, 1225);
  for (const path of ['/topics', '/answers']) {
    const response = await requestJson(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); assert.equal(response.status, 410);
  }
  for (const path of ['/rhymes/requests/readonly-never-submitted', '/profile', '/admin/records']) {
    const response = await requestJson(path); assert.equal(response.status, 401);
  }
  return { historicalGroupChecks: checks, existingApiPairRecordsVerified: verifiedPairIds.size, duplicatePreview: true, invisibleNormalization: true, syllabicNasalScoring: true, strictReadingLength: true, jsonObjectValidation: true, workloadBudgets: true, fiftyWordsFifteenCharactersPreview: true, legacyWritersClosed: true, anonymousStatusAndProfileRejected: true, anonymousAdminRejected: true };
}

await mkdir(new URL('../records/', import.meta.url), { recursive: true });
if (mode === 'baseline') {
  const baseline = redact(capture());
  await writeFile(baselinePath, JSON.stringify(baseline, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ mode, passed: true, counts: baseline.counts, hashes: Object.fromEntries(tables.map(table => [table, baseline.tables[table].hash])), record: fileURLToPath(baselinePath) }));
} else {
  const before = JSON.parse(await readFile(baselinePath, 'utf8'));
  verifyData(before, capture());
  const api = await verifyApi(before);
  const resources=await verifyResources();const deployment=currentDeployment();
  const latest = capture(); const data = verifyData(before, latest);
  const result = { passed: true, date: '2026-10-08', checkedAt: latest.capturedAt, url: base, deployment, resources, contentWrites: 0, transportRetries, transportFailures, rawContentOrCredentialsRecorded: false, baselineCapturedAt: before.capturedAt, counts: counts(latest), data, api };
  const output = new URL(`../records/2026-10-08-maturity-production-readonly-${new Date().toISOString().replace(/[:.]/g, '-')}.json`, import.meta.url);
  await writeFile(output, JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ passed: result.passed, version:deployment.version,resources,counts: result.counts, data, transportRetries, groupMembers: api.historicalGroupChecks.length, verifiedPairRecords: api.existingApiPairRecordsVerified, record: fileURLToPath(output) }));
}
