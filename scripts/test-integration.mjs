import { spawn, spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { randomUUID, scryptSync } from 'node:crypto';
import { createServer } from 'node:net';
import { createServer as createHttpServer } from 'node:http';
import path from 'node:path';
import os from 'node:os';

const state = await mkdtemp(path.join(os.tmpdir(), 'rhyme-test-'));
const project = process.cwd();
const wrangler = path.resolve('node_modules/wrangler/bin/wrangler.js');
const tsx = path.resolve('node_modules/tsx/dist/cli.mjs');
const config = path.join(state, 'wrangler.json');
const runId = randomUUID();
const database = 'rhyme-test-' + runId;
const bootstrapToken = randomUUID() + randomUUID();
const password = 'local-legacy-password-2026';
const salt = '000102030405060708090a0b0c0d0e0f';
const passwordHash = `scrypt:${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
const quote = value => `'${String(value).replaceAll("'", "''")}'`;
const rows = (table, columns, records) => records.map(record => `INSERT INTO ${table}(${columns.join(',')}) VALUES(${columns.map(column => quote(record[column])).join(',')});`).join('\n');

function run(args, env = {}, cwd = project) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd, stdio: 'inherit', env: { ...process.env, WRANGLER_SEND_METRICS: 'false', ...env } });
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolve() : reject(new Error(`检查失败 (${code})`)));
  });
}

async function freePort() {
  const listener = createServer();
  await new Promise((resolve, reject) => {
    listener.once('error', reject);
    listener.listen(0, '127.0.0.1', resolve);
  });
  const port = listener.address().port;
  await new Promise((resolve, reject) => listener.close(error => error ? reject(error) : resolve()));
  return port;
}

async function sessionBarrier() {
  // Hold real HTTP IO outside workerd: an unresolved Promise inside the Worker
  // would be canceled by its hung-request detector before we can release it.
  const gates=new Map();
  const listener=createHttpServer((request,response)=>{
    if(request.headers['x-rhyme-test-run']!==runId){response.writeHead(403).end();return;}
    const url=new URL(request.url,'http://127.0.0.1'), id=url.searchParams.get('id');
    if(url.pathname==='/wait') {gates.set(id,response);return;}
    if(url.pathname==='/release') {gates.get(id)?.writeHead(204).end();gates.delete(id);}
    response.setHeader('Content-Type','application/json');response.end(JSON.stringify({waiting:gates.has(id)}));
  });
  await new Promise((resolve,reject)=>{listener.once('error',reject);listener.listen(0,'127.0.0.1',resolve);});
  return {
    base:`http://127.0.0.1:${listener.address().port}`,
    close:async()=>{
      for(const response of gates.values())response.writeHead(503).end();
      gates.clear();listener.closeAllConnections();
      await new Promise((resolve,reject)=>listener.close(error=>error?reject(error):resolve()));
    }
  };
}

async function configure(barrierBase) {
  // No account, routes or remote bindings: this configuration only exists in the
  // temporary directory. The wrapper marks health responses from this exact run.
  await writeFile(path.join(state, 'worker.ts'), `import worker from ${JSON.stringify(path.join(project, 'worker/index.ts'))};
function guardedDatabase(database, gateId) {
  const statement = (prepared, sql) => new Proxy(prepared, { get(target, property) {
    if (property === 'bind') return (...values) => statement(target.bind(...values), sql);
    if (property === 'first' && /^INSERT INTO sessions\\b/.test(sql)) return async (...args) => {
      const pause = await fetch(${JSON.stringify(barrierBase)} + '/wait?id=' + encodeURIComponent(gateId), { headers: { 'X-Rhyme-Test-Run': ${JSON.stringify(runId)} } });
      if (!pause.ok) throw new Error('Isolated session barrier failed');
      return target.first(...args);
    };
    const value = Reflect.get(target, property); return typeof value === 'function' ? value.bind(target) : value;
  } });
  return new Proxy(database, { get(target, property) {
    if (property === 'prepare') return sql => statement(target.prepare(sql), sql);
    const value = Reflect.get(target, property); return typeof value === 'function' ? value.bind(target) : value;
  } });
}
export default { async fetch(request, env, ctx) {
  const url = new URL(request.url);
  const authorizedTest = request.headers.get('X-Rhyme-Test-Run') === ${JSON.stringify(runId)};
  const gateId = request.headers.get('X-Rhyme-Test-Gate');
  let bindings = env;
  if (authorizedTest && gateId && url.pathname === '/api/auth/login') {
    bindings = { ...env, DB: guardedDatabase(env.DB, gateId) };
  }
  const response = await worker.fetch(request, bindings, ctx);
  if (new URL(request.url).pathname !== '/api/health') return response;
  const marked = new Response(response.body, response);
  marked.headers.set('X-Rhyme-Test-Run', ${JSON.stringify(runId)});
  return marked;
} };
`);
  await writeFile(config, JSON.stringify({
    name: database, main: './worker.ts', compatibility_date: '2026-09-26', compatibility_flags: ['nodejs_compat'],
    d1_databases: [{ binding: 'DB', database_name: database, database_id: randomUUID(), migrations_dir: path.join(project, 'migrations') }],
  }));
  await writeFile(path.join(state, '.dev.vars'), `BOOTSTRAP_TOKEN=${bootstrapToken}\n`, { mode: 0o600 });
}
const localDb = args => run([wrangler, ...args, '--config', config, '--local', '--persist-to', state], {}, state);

function localSql(sql) {
  const python = `import glob,json,sqlite3,sys
p=[x for x in glob.glob(sys.argv[1]+'/v3/d1/**/*.sqlite',recursive=True) if not x.endswith('/metadata.sqlite')]
assert len(p)==1,p
c=sqlite3.connect(p[0]);c.row_factory=sqlite3.Row
cursor=c.execute(sys.argv[2]);result=[dict(row) for row in cursor.fetchall()];c.commit()
print(json.dumps(result,ensure_ascii=False))`;
  const result=spawnSync('python3',['-c',python,state,sql],{encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
  return JSON.parse(result.stdout);
}

async function authConcurrencyRegression(base,barrierBase) {
  const tag=runId.slice(0,8), username='会话原子'+tag, adminName='临时管理员'+tag;
  const originalPassword=randomUUID()+randomUUID(), changedPassword=randomUUID()+randomUUID();
  const request=async (endpoint,body,cookie='',headers={}) => {
    const response=await fetch(base+'/api'+endpoint,{method:body===undefined?'GET':'POST',headers:{...(body===undefined?{}:{'Content-Type':'application/json'}),...(cookie?{Cookie:cookie}:{}),'CF-Connecting-IP':randomUUID(),...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});
    return {status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]||null};
  };
  const stateCounts=()=>localSql("SELECT (SELECT COUNT(*) FROM users) AS users,(SELECT COUNT(*) FROM sessions) AS sessions,(SELECT COUNT(*) FROM settings WHERE key='admin_initialized') AS initialized")[0];
  const before=stateCounts();
  const register={username,password:originalPassword}, setup={token:bootstrapToken,username:adminName,password:originalPassword};
  localSql("CREATE TRIGGER integration_fail_session BEFORE INSERT ON sessions BEGIN SELECT RAISE(ABORT,'D1_TEST_FORCED_SESSION_FAILURE'); END");
  try {
    for(const [endpoint,body] of [['/auth/register',register],['/setup',setup]]) {
      const failed=await request(endpoint,body);assert.equal(failed.status,503);assert.equal(failed.cookie,null);
      assert.deepEqual(stateCounts(),before,`${endpoint}: session failure must roll back all account/settings writes`);
    }
  } finally { localSql('DROP TRIGGER integration_fail_session'); }
  const registered=await request('/auth/register',register);assert.equal(registered.status,201);assert.ok(registered.cookie);
  const owner=(await request('/me',undefined,registered.cookie)).data.user;assert.equal(owner.role,'user');
  const initialized=await request('/setup',setup);assert.equal(initialized.status,201);assert.ok(initialized.cookie);
  const administrator=(await request('/me',undefined,initialized.cookie)).data.user;assert.equal(administrator.role,'admin');
  assert.equal(localSql("SELECT COUNT(*) AS count FROM settings WHERE key='admin_initialized'")[0].count,1);
  const gatedLogin=async (beforeRelease, loginPassword=originalPassword)=>{
    const gateId=randomUUID();
    const pending=request('/auth/login',{username,password:loginPassword},'',{'X-Rhyme-Test-Run':runId,'X-Rhyme-Test-Gate':gateId});
    pending.catch(()=>{});
    let waiting=false;
    for(let attempt=0;attempt<100;attempt++) {
      const response=await fetch(barrierBase+'/status?id='+gateId,{headers:{'X-Rhyme-Test-Run':runId}});
      if((await response.json()).waiting){waiting=true;break;}
      await new Promise(resolve=>setTimeout(resolve,25));
    }
    assert.ok(waiting,'Verified-password login did not reach the isolated session gate');
    try { await beforeRelease(); }
    finally { await fetch(barrierBase+'/release?id='+gateId,{headers:{'X-Rhyme-Test-Run':runId}}); }
    return pending;
  };
  try {
    const late=await gatedLogin(async()=>{
      const reset=await request('/admin/reset-password',{id:owner.id,password:changedPassword},initialized.cookie);assert.equal(reset.status,200);
      assert.equal(localSql(`SELECT COUNT(*) AS count FROM sessions WHERE user_id=${quote(owner.id)}`)[0].count,0);
    });
    assert.equal(late.status,401,'An in-flight old-password login must not create a session after reset');assert.equal(late.cookie,null);
    assert.equal(localSql(`SELECT COUNT(*) AS count FROM sessions WHERE user_id=${quote(owner.id)}`)[0].count,0);
    assert.equal((await request('/me',undefined,registered.cookie)).data.user,null);
    assert.equal((await request('/auth/login',register)).status,401);
    const fresh=await request('/auth/login',{username,password:changedPassword});assert.equal(fresh.status,200);assert.ok(fresh.cookie);
    assert.equal((await request('/me',undefined,fresh.cookie)).data.user.id,owner.id);
    const sessionCount=localSql(`SELECT COUNT(*) AS count FROM sessions WHERE user_id=${quote(owner.id)}`)[0].count;
    const denied=await gatedLogin(async()=>localSql(`UPDATE users SET disabled=1 WHERE id=${quote(owner.id)}`),changedPassword);
    assert.equal(denied.status,401);assert.equal(denied.cookie,null);
    assert.equal(localSql(`SELECT COUNT(*) AS count FROM sessions WHERE user_id=${quote(owner.id)}`)[0].count,sessionCount);
  } finally {
    for(const sql of [
      `DELETE FROM moderation WHERE admin_id=${quote(administrator.id)}`,
      `DELETE FROM sessions WHERE user_id IN (${quote(owner.id)},${quote(administrator.id)})`,
      `DELETE FROM settings WHERE key='admin_initialized' AND value=${quote(administrator.id)}`,
      `DELETE FROM users WHERE id IN (${quote(owner.id)},${quote(administrator.id)})`,
    ])localSql(sql);
  }
  assert.deepEqual(stateCounts(),before,'Auth regression fixtures must leave the legacy fixture intact');
  console.log('✔ 注册与初始化的 session 故障全回滚、原参数重试成功；旧密码登录与重置/禁用交错均无新会话');
}

// Apply the new migration to genuine old data, rather than only an empty DB.
async function legacyFixture() {
  const texts = ['山河', '丹泽', '嘻哈', '西瓜', '青蛙', '披纱', '溪沙', '低洼', '批发', '滴答', '踢踏', '稀疤', '孤题', '音乐', '新课', '星火', '苹果', '长河', '黄泽'];
  const command = `import {pronunciation,compare} from './shared/rhyme.ts'; const texts=${JSON.stringify(texts)}; const readings=Object.fromEntries(texts.map(text=>[text,pronunciation(text,text==='音乐'?['yin1','le4']:[])])); readings.longFirst=pronunciation('长河',['zhang3','he2']); console.log(JSON.stringify({readings,comparisons:Object.fromEntries(texts.map(text=>[text,compare(readings['嘻哈'],readings[text])]))}));`;
  const generated = spawnSync(process.execPath, [tsx, '-e', command], { encoding: 'utf8' });
  if (generated.status !== 0) throw new Error(generated.stderr || '旧数据读音生成失败');
  const { readings, comparisons } = JSON.parse(generated.stdout);
  const users = ['a', 'b', 'topic'].map(key => ({ id: `legacy-${key}`, username: `旧作者${key}`, password_hash: passwordHash, role: 'user', created_at: '2025-01-01T00:00:00.000Z' }));
  const topic = (id, text, status = 'active') => ({ id, text, normalized: text, readings: JSON.stringify(readings[text]), n: [...text].length, author_id: 'legacy-topic', status, created_at: '2025-01-02T00:00:00.000Z' });
  const topics = [topic('old-topic-river', '山河'), topic('old-topic-reverse', '丹泽'), topic('old-topic-group', '嘻哈'), topic('old-topic-empty', '孤题'), topic('old-topic-poly', '音乐'), topic('old-topic-withdrawn', '星火', 'withdrawn'), { ...topic('old-topic-long-first', '长河'), readings: JSON.stringify(readings.longFirst) }, topic('old-topic-long-reverse', '黄泽')];
  const answer = (id, topic_id, text, author_id, kind, points, status, created_at) => ({ id, topic_id, text, normalized: text, readings: JSON.stringify(readings[text]), author_id, kind, points, status, created_at });
  const answers = [
    answer('old-first-withdrawn', 'old-topic-river', '丹泽', 'legacy-b', 'perfect', 4, 'withdrawn', '2025-01-03T00:00:00.000Z'),
    answer('old-reverse-active', 'old-topic-reverse', '山河', 'legacy-a', 'perfect', 4, 'active', '2025-01-04T00:00:00.000Z'),
    answer('old-poly-active', 'old-topic-poly', '新课', 'legacy-b', 'perfect', 4, 'active', '2025-01-05T00:00:00.000Z'),
    answer('old-long-first', 'old-topic-long-first', '黄泽', 'legacy-b', 'final', 2, 'withdrawn', '2025-01-03T02:00:00.000Z'),
    answer('old-long-reverse', 'old-topic-long-reverse', '长河', 'legacy-a', 'perfect', 4, 'active', '2025-01-04T02:00:00.000Z'),
    answer('old-topic-withdrawal-answer', 'old-topic-withdrawn', '苹果', 'legacy-b', 'perfect', 4, 'active', '2025-01-06T00:00:00.000Z'),
  ];
  for (const [index, text] of texts.slice(3, 12).entries()) {
    const comparison = comparisons[text];
    if (!comparison.valid) throw new Error(`旧互查组 fixture 无效：${text}`);
    answers.push(answer(`old-group-${index}`, 'old-topic-group', text, 'legacy-a', comparison.kind, comparison.points, 'active', `2025-02-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`));
  }
  const expectedScores = Object.fromEntries(users.map(user => [user.id, answers.filter(answer => answer.author_id === user.id && answer.status === 'active' && topics.find(topic => topic.id === answer.topic_id).status === 'active').reduce((sum, answer) => sum + answer.points, 0)]));
  const fixture = { password, users, topics, answers, expectedScores, groupTexts: ['嘻哈', ...texts.slice(3, 12)] };
  const sql = [
    'CREATE TABLE d1_migrations(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT UNIQUE,applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL);',
    "INSERT INTO d1_migrations(name) VALUES('0001_initial.sql'),('0002_mixed_rhyme.sql');",
    rows('users', ['id', 'username', 'password_hash', 'role', 'created_at'], users),
    rows('topics', ['id', 'text', 'normalized', 'readings', 'n', 'author_id', 'status', 'created_at'], topics),
    rows('answers', ['id', 'topic_id', 'text', 'normalized', 'readings', 'kind', 'points', 'author_id', 'status', 'created_at'], answers),
    "INSERT INTO moderation(id,entity_type,entity_id,admin_id,reason,action,created_at) VALUES('old-withdrawal','answer','old-first-withdrawn','legacy-topic','旧处理记录','withdraw','2025-01-03T01:00:00.000Z');",
  ].join('\n');
  const filename = path.join(state, 'legacy-fixture.sql');
  await writeFile(filename, sql);
  await localDb(['d1', 'execute', database, '--file', path.join(project, 'migrations/0001_initial.sql')]);
  await localDb(['d1', 'execute', database, '--file', path.join(project, 'migrations/0002_mixed_rhyme.sql')]);
  await localDb(['d1', 'execute', database, '--file', filename]);
  return fixture;
}

let server,barrier;
try {
  barrier=await sessionBarrier();
  await configure(barrier.base);
  const fixture = await legacyFixture();
  await localDb(['d1', 'migrations', 'apply', database]);
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, [wrangler, 'dev', '--config', config, '--port', String(port), '--ip', '127.0.0.1', '--persist-to', state], { cwd: state, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, WRANGLER_SEND_METRICS: 'false' } });
  let errors = '';
  server.on('error', error => errors += error.message);
  server.stderr.on('data', chunk => errors += chunk.toString());
  server.stdout.resume();
  let ready = false;
  for (let i = 0; i < 60; i++) {
    if (server.exitCode !== null || server.signalCode !== null) break;
    try {
      const response = await fetch(base + '/api/health', { signal: AbortSignal.timeout(1000) });
      if (response.ok && response.headers.get('X-Rhyme-Test-Run') === runId && (await response.json()).ok === true) { ready = true; break; }
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  if (!ready) throw new Error('测试服务未启动：' + errors);
  console.log(`已确认独立测试服务 ${base}，临时配置和 D1：${state}`);
  await authConcurrencyRegression(base,barrier.base);
  await run([tsx, '--test', 'tests/api.test.ts'], { TEST_URL: base, TEST_D1_STATE: state, TEST_BOOTSTRAP_TOKEN: bootstrapToken, TEST_LEGACY_FIXTURE: JSON.stringify(fixture) });
} finally {
  await barrier?.close();
  if (server && server.exitCode === null) {
    server.kill('SIGTERM');
    await new Promise(resolve => server.once('exit', resolve));
  }
  await rm(state, { recursive: true, force: true });
}
