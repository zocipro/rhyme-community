import { Hono } from 'hono';
import type { Context } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { bodyLimit } from 'hono/body-limit';
import { normalize, pronunciation, validateText } from '../shared/rhyme';
import type { Syllable } from '../shared/rhyme';
import { compareRecordedRhyme } from '../shared/lookup';
import { previewPairs, resolvePairInputs, validatePairWorkload } from '../shared/pairs';
import type { ResolvedWord } from '../shared/pairs';
import type { RhymingWord, Word, RhymePair } from '../shared/lookup';
import { groupLibrary, libraryWord, searchLibrary, SEARCH_LIMIT, wordTiers } from '../shared/library';
import type { LibraryIndex, LibrarySearch } from '../shared/library';
import { digest, hashPassword, verifyPassword, validateAccount } from './auth';

type User = { id: string; username: string; role: 'user' | 'admin'; disabled: number };
type AppEnv = { Bindings: Env; Variables: { user: User | null; pairReady: boolean } };
const app = new Hono<AppEnv>();
const topicSelect = `SELECT t.*,u.username AS author,(SELECT COUNT(*) FROM answers a WHERE a.topic_id=t.id AND a.status='active') AS answer_count FROM topics t JOIN users u ON u.id=t.author_id`;
const legacyScoreSql = `SELECT COALESCE(SUM(a.points),0) AS score FROM answers a JOIN topics t ON t.id=a.topic_id WHERE a.author_id=? AND a.status='active' AND t.status='active'`;
const pairSelect = `SELECT p.*,l.normalized AS left_normalized,r.normalized AS right_normalized,u.username AS author FROM rhyme_pairs p JOIN words l ON l.id=p.left_word_id JOIN words r ON r.id=p.right_word_id JOIN users u ON u.id=p.author_id`;
const activeWord = `EXISTS(SELECT 1 FROM rhyme_pairs active_pair WHERE active_pair.status='active' AND (active_pair.left_word_id=w.id OR active_pair.right_word_id=w.id))`;
const wordSelect = `SELECT w.*,(SELECT COUNT(*) FROM rhyme_pairs count_pair WHERE count_pair.status='active' AND (count_pair.left_word_id=w.id OR count_pair.right_word_id=w.id)) AS pair_count FROM words w`;
const scoreSql = `SELECT COALESCE(SUM(s.points),0) AS score FROM score_entries s JOIN rhyme_pairs p ON p.id=s.pair_id WHERE s.user_id=? AND s.status='active' AND p.status='active'`;
const pageNumber = (value?: string) => {
  const parsed = Number(value || 0);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
};
const now = () => new Date().toISOString();
const publicTopic = (t: Record<string, unknown>) => ({ ...t, readings: JSON.parse(String(t.readings)) as Syllable[] });
const publicAnswer = publicTopic;
const publicWord = (row: Record<string, unknown>): Word => ({ id: String(row.id), text: String(row.text), normalized: String(row.normalized), n: Number(row.n), pair_count: Number(row.pair_count) });
const publicPair = (row: Record<string, unknown>, reverse = false): RhymePair => {
  const left = { word_id: String(row.left_word_id), text: String(row.left_text), normalized: String(row.left_normalized), readings: JSON.parse(String(row.left_readings)) as Syllable[] };
  const right = { word_id: String(row.right_word_id), text: String(row.right_text), normalized: String(row.right_normalized), readings: JSON.parse(String(row.right_readings)) as Syllable[] };
  return { id: String(row.id), left: reverse ? right : left, right: reverse ? left : right, n: Number(row.n), kind: row.kind as RhymePair['kind'], points: Number(row.points), author: String(row.author), author_id: String(row.author_id), created_at: String(row.created_at), status: row.status as RhymePair['status'], comparison: compareRecordedRhyme(left.readings, right.readings, reverse) };
};
const pausedError = { error: '正在更新押韵收录功能，输入已保留，请稍后重试' };
async function jsonObject(c: Context<AppEnv>): Promise<Record<string, any>> {
  const value: unknown = await c.req.json();
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('提交格式不正确，请使用 JSON 对象');
  return value as Record<string, any>;
}
function validateRequestId(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !value.trim() || value.length > 128) throw new Error('请提供有效的提交标识');
}
app.use('/api/*', bodyLimit({ maxSize: 2 * 1024 * 1024, onError: c => c.json({ error: '这次输入太长，请缩短后重试' }, 413) }));
app.use('/api/*', async (c, next) => {
  c.header('Cache-Control', 'no-store'); c.header('X-Content-Type-Options', 'nosniff'); c.header('Referrer-Policy', 'same-origin');
  if (!['GET','HEAD','OPTIONS'].includes(c.req.method)) {
    const origin = c.req.header('Origin');
    if (origin && origin !== new URL(c.req.url).origin) return c.json({ error: '请求来源不正确，请刷新后重试' }, 403);
    if (c.req.header('Sec-Fetch-Site') === 'cross-site') return c.json({ error: '请求来源不正确' }, 403);
    if (!c.req.header('Content-Type')?.includes('application/json')) return c.json({ error: '请使用 JSON 提交' }, 415);
  }
  c.set('pairReady', (await c.env.DB.prepare("SELECT value FROM settings WHERE key='pair_model_ready'").first<{value:string}>())?.value === '1');
  c.set('user', null);
  const token = getCookie(c, 'rhyme_session');
  if (token) {
    const user = await c.env.DB.prepare(`SELECT u.id,u.username,u.role,u.disabled FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>? AND u.disabled=0`).bind(await digest(token), Date.now()).first<User>();
    c.set('user', user);
  }
  await next();
});
app.use('/api/*', async (c, next) => {
  if (c.req.method === 'POST' && ['/api/topics','/api/answers','/api/rhymes','/api/admin/withdraw'].includes(c.req.path)) {
    const paused = await c.env.DB.prepare("SELECT value FROM settings WHERE key='content_write_paused'").first<{value:string}>();
    if (paused?.value === '1') return c.json(pausedError,503);
  }
  await next();
});
app.use('/api/*', async (c, next) => {
  // A consumed sign-in allowance must never block revoking an existing session.
  // Logout still passes the source/JSON checks and deletes only its own token.
  if ((c.req.method === 'POST' || c.req.method === 'PATCH') && c.req.path !== '/api/auth/logout') {
    const auth = /\/auth\/|\/setup/.test(c.req.path);
    const preview = ['/api/preview','/api/rhymes/preview'].includes(c.req.path);
    const bucket = Math.floor(Date.now() / 60000);
    const identity = auth ? c.req.header('CF-Connecting-IP') || 'local' : c.get('user')?.id || c.req.header('CF-Connecting-IP') || 'local';
    const key = `${auth ? 'auth' : preview ? 'preview' : 'write'}:${await digest(identity)}:${bucket}`;
    const row = await c.env.DB.prepare(`INSERT INTO rate_limits(key,count,reset_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1 RETURNING count`).bind(key, (bucket+1)*60000).first<{ count: number }>();
    c.executionCtx.waitUntil(c.env.DB.prepare(`DELETE FROM rate_limits WHERE reset_at<?`).bind(Date.now()-60000).run());
    if ((row?.count || 0) > (auth ? 12 : preview ? 120 : 60)) return c.json({ error: '提交太频繁，请一分钟后重试' }, 429);
  }
  await next();
});
app.use('/api/admin/*', async (c, next) => {
  const user=c.get('user');
  if (!user) return c.json({ error: '登录状态已失效，请重新登录' }, 401);
  if (user.role !== 'admin') return c.json({ error: '仅管理员可操作' }, 403);
  await next();
});
async function newSession() {
  const token = crypto.randomUUID() + crypto.randomUUID();
  return { token, tokenHash: await digest(token), expiresAt: Date.now()+30*86400000 };
}
function sessionCookie(c: Context<AppEnv>, session: Awaited<ReturnType<typeof newSession>>) {
  setCookie(c, 'rhyme_session', session.token, { httpOnly: true, secure: new URL(c.req.url).protocol === 'https:', sameSite: 'Lax', path: '/', maxAge: 30*86400 });
}
async function createSession(c: Context<AppEnv>, user: User, verifiedPasswordHash: string) {
  const session = await newSession();
  // The credential check and insert must be one SQL statement. A reset either
  // deletes this session afterward or changes the hash before it can be created.
  const inserted = await c.env.DB.prepare(`INSERT INTO sessions(token_hash,user_id,expires_at)
    SELECT ?,id,? FROM users WHERE id=? AND password_hash=? AND disabled=0 RETURNING token_hash`)
    .bind(session.tokenHash,session.expiresAt,user.id,verifiedPasswordHash).first();
  if (!inserted) return false;
  sessionCookie(c,session);
  return true;
}
app.get('/api/health', async c => { await c.env.DB.prepare('SELECT 1').first(); return c.json({ ok: true }); });
app.get('/api/me', async c => {
  const user = c.get('user');
  if (!user) return c.json({ user: null });
  const score = await c.env.DB.prepare(c.get('pairReady') ? scoreSql : legacyScoreSql).bind(user.id).first<{score:number}>();
  return c.json({ user: { id: user.id, username: user.username, role: user.role, score: score?.score || 0 } });
});
app.post('/api/auth/register', async c => {
  const body = await jsonObject(c); const {username,password} = validateAccount(body.username,body.password);
  const user: User = { id: crypto.randomUUID(), username, role: 'user', disabled: 0 };
  const session = await newSession();
  await c.env.DB.batch([
    c.env.DB.prepare(`INSERT INTO users(id,username,password_hash,role,created_at) VALUES(?,?,?,'user',?)`).bind(user.id,username,await hashPassword(password),now()),
    c.env.DB.prepare(`INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)`).bind(session.tokenHash,user.id,session.expiresAt)
  ]);
  sessionCookie(c,session); return c.json({ ok:true },201);
});
app.post('/api/auth/login', async c => {
  const body = await jsonObject(c); const {username,password} = validateAccount(body.username,body.password);
  const row = await c.env.DB.prepare(`SELECT * FROM users WHERE username=? COLLATE NOCASE`).bind(username).first<User & {password_hash:string}>();
  if (!row || row.disabled || !await verifyPassword(password,row.password_hash)) return c.json({ error:'用户名或密码不正确' },401);
  if (!await createSession(c,row,row.password_hash)) return c.json({ error:'用户名或密码不正确' },401);
  return c.json({ok:true});
});
app.post('/api/auth/logout', async c => {
  await jsonObject(c);
  const token = getCookie(c,'rhyme_session'); if(token) await c.env.DB.prepare('DELETE FROM sessions WHERE token_hash=?').bind(await digest(token)).run();
  deleteCookie(c,'rhyme_session',{path:'/'});return c.json({ok:true});
});
app.get('/api/setup', async c => c.json({ initialized: !!await c.env.DB.prepare(`SELECT value FROM settings WHERE key='admin_initialized'`).first() }));
app.post('/api/setup', async c => {
  const body = await jsonObject(c);
  if (!c.env.BOOTSTRAP_TOKEN || typeof body.token !== 'string' || await digest(body.token) !== await digest(c.env.BOOTSTRAP_TOKEN)) return c.json({error:'初始化凭证无效'},403);
  if (await c.env.DB.prepare(`SELECT value FROM settings WHERE key='admin_initialized'`).first()) return c.json({error:'管理员已经初始化'},409);
  const {username,password} = validateAccount(body.username,body.password);
  const user:User={id:crypto.randomUUID(),username,role:'admin',disabled:0};
  const session = await newSession();
  await c.env.DB.batch([
    c.env.DB.prepare(`INSERT INTO settings(key,value) VALUES('admin_initialized',?)`).bind(user.id),
    c.env.DB.prepare(`INSERT INTO users(id,username,password_hash,role,created_at) VALUES(?,?,?,'admin',?)`).bind(user.id,username,await hashPassword(password),now()),
    c.env.DB.prepare(`INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)`).bind(session.tokenHash,user.id,session.expiresAt)
  ]);
  sessionCookie(c,session); return c.json({ok:true},201);
});


// Legacy writers are intentionally closed even before the new model is ready.
app.post('/api/topics', c => c.json({error:'已取消出题，请使用“我来想一个押韵”直接收录词对'},410));
app.post('/api/answers', c => c.json({error:'已取消答题，请使用“我来想一个押韵”直接收录词对'},410));
app.post('/api/preview', async c => {
  const body=await jsonObject(c);validateText(body.text);
  if(body.readings!==undefined && (!Array.isArray(body.readings)||body.readings.some((x:unknown)=>typeof x!=='string')))throw new Error('读音格式不正确');
  validatePairWorkload([body.text]);
  return c.json({readings:pronunciation(body.text,body.readings)});
});
// Read-only legacy URLs keep resolving, including during the migration freeze.
app.get('/api/topics', async c => {
  const page=pageNumber(c.req.query('page'));const q=normalize(c.req.query('q')||'');
  const {results}=await c.env.DB.prepare(`${topicSelect} WHERE t.status='active' AND (?='' OR instr(t.normalized,?)>0) ORDER BY t.created_at DESC,t.id DESC LIMIT 31 OFFSET ?`).bind(q,q,page*30).all();
  return c.json({items:results.slice(0,30).map(publicTopic),hasMore:results.length>30});
});
app.get('/api/topics/:id', async c => {
  if(c.get('pairReady')) {
    const mapping=await c.env.DB.prepare("SELECT word_id FROM legacy_word_mapping WHERE source='topic' AND legacy_id=?").bind(c.req.param('id')).first<{word_id:string}>();
    if(!mapping)return c.json({error:'这个旧记录没有已收录的押韵'},404);
    return c.redirect(`/api/words/${mapping.word_id}/rhymes?page=${pageNumber(c.req.query('page'))}`,302);
  }
  const topic=await c.env.DB.prepare(`${topicSelect} WHERE t.id=? AND t.status='active'`).bind(c.req.param('id')).first();
  if(!topic)return c.json({error:'记录不存在或已撤回'},404);
  const {results}=await c.env.DB.prepare('SELECT a.*,u.username AS author FROM answers a JOIN users u ON u.id=a.author_id WHERE a.topic_id=? AND a.status=\'active\' ORDER BY a.created_at DESC LIMIT 31 OFFSET ?').bind(c.req.param('id'),pageNumber(c.req.query('page'))*30).all();
  return c.json({topic:publicTopic(topic),answers:results.slice(0,30).map(publicAnswer),hasMore:results.length>30});
});
app.get('/api/words/:source/:id/rhymes', async c => {
  if(!c.get('pairReady'))return c.json(pausedError,503);
  if(!['topic','answer'].includes(c.req.param('source')))return c.json({error:'旧词语来源不正确'},400);
  const mapping=await c.env.DB.prepare('SELECT word_id FROM legacy_word_mapping WHERE source=? AND legacy_id=?').bind(c.req.param('source'),c.req.param('id')).first<{word_id:string}>();
  if(!mapping)return c.json({error:'这个旧记录没有已收录的押韵'},404);
  return c.redirect(`/api/words/${mapping.word_id}/rhymes?page=${pageNumber(c.req.query('page'))}`,302);
});
app.get('/api/words', async c => {
  if(!c.get('pairReady'))return c.json(pausedError,503);
  const q=normalize(c.req.query('q')||'');const page=pageNumber(c.req.query('page'));
  const [words,counts]=await Promise.all([
    c.env.DB.prepare(`${wordSelect} WHERE ${activeWord} AND (?='' OR instr(w.normalized,?)>0) ORDER BY w.created_at DESC,w.id DESC LIMIT 31 OFFSET ?`).bind(q,q,page*30).all(),
    c.env.DB.prepare(`SELECT (SELECT COUNT(*) FROM words w WHERE ${activeWord}) AS words,(SELECT COUNT(*) FROM rhyme_pairs WHERE status='active') AS pairs`).first()
  ]);
  return c.json({items:words.results.slice(0,30).map(publicWord),counts,hasMore:words.results.length>30});
});
const LIBRARY_LIMIT = 5000;
async function libraryWords(db: D1Database) {
  const [words, pairs, counts] = await Promise.all([
    db.prepare(`${wordSelect} WHERE ${activeWord} ORDER BY pair_count DESC,w.created_at DESC,w.id DESC LIMIT ?`).bind(LIBRARY_LIMIT + 1).all(),
    db.prepare(`SELECT left_word_id,right_word_id,left_readings,right_readings FROM rhyme_pairs WHERE status='active'`).all(),
    db.prepare(`SELECT (SELECT COUNT(*) FROM words w WHERE ${activeWord}) AS words,(SELECT COUNT(*) FROM rhyme_pairs WHERE status='active') AS pairs`).first(),
  ]);
  const tiers = wordTiers(pairs.results.map(pair => ({ left: String(pair.left_word_id), right: String(pair.right_word_id), leftReadings: JSON.parse(String(pair.left_readings)) as Syllable[], rightReadings: JSON.parse(String(pair.right_readings)) as Syllable[] })));
  const entries = words.results.slice(0, LIBRARY_LIMIT).map(row => {
    const readings = JSON.parse(String(row.readings)) as Syllable[];
    return { word: libraryWord(publicWord(row), readings, tiers.get(String(row.id)) ?? 0), readings };
  });
  return { entries, counts, truncated: words.results.length > LIBRARY_LIMIT };
}
app.get('/api/library', async c => {
  if(!c.get('pairReady'))return c.json(pausedError,503);
  const { entries, counts, truncated } = await libraryWords(c.env.DB);
  return c.json({ groups: groupLibrary(entries.map(entry => entry.word)), truncated, counts } satisfies LibraryIndex & { counts: unknown });
});
app.get('/api/library/search', async c => {
  if(!c.get('pairReady'))return c.json(pausedError,503);
  const text = (c.req.query('q') || '').slice(0, 64), normalized = normalize(text);
  const { entries, counts } = await libraryWords(c.env.DB);
  const empty: LibrarySearch = { query: null, error: '', exact: null, rhymes: [], sameEnding: [], contains: [], totals: { rhymes: 0, sameEnding: 0, contains: 0 } };
  if (!normalized) return c.json({ search: empty, counts });
  let readings: Syllable[];
  try { validateText(text, 1); readings = pronunciation(text); }
  catch (e) {
    const contains = entries.filter(entry => entry.word.normalized.includes(normalized)).map(entry => entry.word);
    return c.json({ search: { ...empty, error: (e as Error).message, contains: contains.slice(0, SEARCH_LIMIT), totals: { ...empty.totals, contains: contains.length } }, counts });
  }
  return c.json({ search: { ...searchLibrary({ text, normalized, readings }, entries), error: '' } satisfies LibrarySearch, counts });
});
app.get('/api/words/:id/rhymes', async c => {
  if(!c.get('pairReady'))return c.json(pausedError,503);
  const id=c.req.param('id');const page=pageNumber(c.req.query('page'));
  const row=await c.env.DB.prepare(`${wordSelect} WHERE w.id=? AND ${activeWord}`).bind(id).first();
  if(!row)return c.json({error:'词语不存在或没有有效的押韵'},404);
  const {results}=await c.env.DB.prepare(`WITH RECURSIVE component(id) AS (
    SELECT ? UNION SELECT CASE WHEN p.left_word_id=c.id THEN p.right_word_id ELSE p.left_word_id END
    FROM rhyme_pairs p JOIN component c ON p.left_word_id=c.id OR p.right_word_id=c.id WHERE p.status='active'
  ), candidates AS (
    SELECT w.id AS candidate_word_id,p.id AS candidate_pair_id,
      CASE WHEN p.left_word_id=? OR p.right_word_id=? THEN 'direct' ELSE 'group' END AS association,
      ROW_NUMBER() OVER (PARTITION BY w.id ORDER BY CASE WHEN p.left_word_id=? OR p.right_word_id=? THEN 0 ELSE 1 END,p.created_at,p.id) AS candidate_rank
    FROM words w JOIN component c ON c.id=w.id JOIN rhyme_pairs p ON (p.left_word_id=w.id OR p.right_word_id=w.id) AND p.status='active'
    WHERE w.id<>?
  ) SELECT p.*,l.normalized AS left_normalized,r.normalized AS right_normalized,u.username AS author,
    w.id AS word_id,w.text AS word_text,w.normalized AS word_normalized,w.n AS word_n,c.association,
    (SELECT COUNT(*) FROM rhyme_pairs count_pair WHERE count_pair.status='active' AND (count_pair.left_word_id=w.id OR count_pair.right_word_id=w.id)) AS pair_count
  FROM candidates c JOIN rhyme_pairs p ON p.id=c.candidate_pair_id JOIN words l ON l.id=p.left_word_id JOIN words r ON r.id=p.right_word_id
    JOIN users u ON u.id=p.author_id JOIN words w ON w.id=c.candidate_word_id
  WHERE c.candidate_rank=1 ORDER BY p.created_at,p.id,w.id LIMIT 31 OFFSET ?`).bind(id,id,id,id,id,id,page*30).all();
  const items:RhymingWord[]=results.slice(0,30).map(record=>({
    word:{id:String(record.word_id),text:String(record.word_text),normalized:String(record.word_normalized),n:Number(record.word_n),pair_count:Number(record.pair_count)},
    association:record.association as RhymingWord['association'],pair:publicPair(record,record.association==='direct' && record.right_word_id===id)
  }));
  return c.json({word:publicWord(row),items,hasMore:results.length>30});
});
app.get('/api/rhymes/requests/:requestId',async c=>{
  const user=c.get('user');if(!user)return c.json({error:'请先登录'},401);
  const requestId=c.req.param('requestId');validateRequestId(requestId);
  const submission=await c.env.DB.prepare('SELECT id,payload_hash,points FROM submissions WHERE user_id=? AND request_id=?').bind(user.id,requestId).first<{id:string;payload_hash:string;points:number}>();
  if(!submission)return c.json({found:false});
  return c.json({found:true,...await submissionResult(c,submission,true),payloadHash:submission.payload_hash});
});
app.get('/api/rhymes/:id',async c=>{
  if(!c.get('pairReady'))return c.json(pausedError,503);
  const row=await c.env.DB.prepare(`${pairSelect} WHERE p.id=?`).bind(c.req.param('id')).first();
  if(!row)return c.json({error:'押韵记录不存在'},404);
  return c.json({pair:publicPair(row)});
});
async function findDuplicates(c:Context<AppEnv>,items:ResolvedWord[],pairs:ReturnType<typeof previewPairs>) {
  const requested=pairs.map(pair=>({left:items[pair.leftIndex].normalized,right:items[pair.rightIndex].normalized,leftIndex:pair.leftIndex,rightIndex:pair.rightIndex}));
  const {results}=await c.env.DB.prepare(`WITH requested AS (
    SELECT json_extract(value,'$.left') AS left_norm,json_extract(value,'$.right') AS right_norm,json_extract(value,'$.leftIndex') AS left_index,json_extract(value,'$.rightIndex') AS right_index FROM json_each(?)
  ) SELECT p.*,l.normalized AS left_normalized,r.normalized AS right_normalized,u.username AS author,q.left_index,q.right_index
  FROM requested q JOIN words first_word ON first_word.normalized=q.left_norm JOIN words second_word ON second_word.normalized=q.right_norm
    JOIN rhyme_pairs p ON p.left_word_id=CASE WHEN first_word.id<second_word.id THEN first_word.id ELSE second_word.id END AND p.right_word_id=CASE WHEN first_word.id<second_word.id THEN second_word.id ELSE first_word.id END
    JOIN words l ON l.id=p.left_word_id JOIN words r ON r.id=p.right_word_id JOIN users u ON u.id=p.author_id`).bind(JSON.stringify(requested)).all();
  return new Map(results.map(row=>[`${row.left_index}:${row.right_index}`,publicPair(row)]));
}
async function makePreview(c:Context<AppEnv>,value:unknown,resolved?:ResolvedWord[]) {
  const items=resolved || resolvePairInputs(value);const pairs=previewPairs(items);const duplicates=await findDuplicates(c,items,pairs);
  const rows=pairs.map(pair=>({...pair,...(duplicates.has(`${pair.leftIndex}:${pair.rightIndex}`)?{duplicate:duplicates.get(`${pair.leftIndex}:${pair.rightIndex}`)}:{})}));
  return {items,pairs:rows,valid:rows.every(pair=>pair.comparison.valid&&!pair.duplicate),totalPoints:rows.reduce((sum,pair)=>sum+(pair.comparison.valid&&!pair.duplicate?pair.comparison.points:0),0),pairCount:rows.length};
}
app.post('/api/rhymes/preview',async c=>{
  if(!c.get('pairReady'))return c.json(pausedError,503);
  const body=await jsonObject(c);return c.json(await makePreview(c,body.items));
});
async function submissionResult(c:Context<AppEnv>,submission:{id:string;points:number},replayed:boolean) {
  const {results}=await c.env.DB.prepare(`${pairSelect} WHERE p.submission_id=? ORDER BY p.id`).bind(submission.id).all();
  return {id:submission.id,pairs:results.map(row=>publicPair(row)),points:submission.points,replayed};
}
app.post('/api/rhymes',async c=>{
  if(!c.get('pairReady'))return c.json(pausedError,503);
  const user=c.get('user');if(!user)return c.json({error:'请先登录'},401);
  const body=await jsonObject(c);
  validateRequestId(body.requestId);
  const items=resolvePairInputs(body.items);
  const payloadHash=await digest(JSON.stringify(items.map(item=>({text:item.text,normalized:item.normalized,readings:item.readings.map(x=>x.pinyin)}))));
  const existing=await c.env.DB.prepare('SELECT id,payload_hash,points FROM submissions WHERE user_id=? AND request_id=?').bind(user.id,body.requestId).first<{id:string;payload_hash:string;points:number}>();
  if(existing) {
    if(existing.payload_hash!==payloadHash)return c.json({error:'这个提交标识已用于其他内容，请重新提交'},409);
    return c.json(await submissionResult(c,existing,true));
  }
  const preview=await makePreview(c,body.items,items);
  if(!preview.valid)return c.json({error:preview.pairs.some(pair=>pair.duplicate)?'这批词中有词对已经被收录或撤回，请删除重复组合后重试':'有词对尚未押上，每个位置的声调或韵母至少需要匹配一项',preview},preview.pairs.some(pair=>pair.duplicate)?409:422);
  const id=crypto.randomUUID();const createdAt=now();
  const wordRows=items.map(item=>({id:crypto.randomUUID(),...item,n:item.readings.length}));
  const pairRows=preview.pairs.map(pair=>({id:crypto.randomUUID(),leftIndex:pair.leftIndex,rightIndex:pair.rightIndex,n:pair.comparison.n,kind:pair.comparison.kind,points:pair.comparison.points}));
  try {
    await c.env.DB.batch([
      c.env.DB.prepare('INSERT INTO submissions(id,user_id,request_id,payload_hash,pair_count,points,created_at) VALUES(?,?,?,?,?,?,?)').bind(id,user.id,body.requestId,payloadHash,preview.pairCount,preview.totalPoints,createdAt),
      c.env.DB.prepare(`INSERT INTO words(id,text,normalized,readings,n,created_at)
        SELECT json_extract(value,'$.id'),json_extract(value,'$.text'),json_extract(value,'$.normalized'),json_extract(value,'$.readings'),json_extract(value,'$.n'),? FROM json_each(?) WHERE 1
        ON CONFLICT(normalized) DO NOTHING`).bind(createdAt,JSON.stringify(wordRows)),
      c.env.DB.prepare(`INSERT INTO rhyme_pairs(id,left_word_id,right_word_id,left_text,right_text,left_readings,right_readings,n,kind,points,author_id,status,created_at,submission_id)
        SELECT json_extract(j.value,'$.id'),CASE WHEN l.id<r.id THEN l.id ELSE r.id END,CASE WHEN l.id<r.id THEN r.id ELSE l.id END,
          CASE WHEN l.id<r.id THEN json_extract(lv.value,'$.text') ELSE json_extract(rv.value,'$.text') END,
          CASE WHEN l.id<r.id THEN json_extract(rv.value,'$.text') ELSE json_extract(lv.value,'$.text') END,
          CASE WHEN l.id<r.id THEN json_extract(lv.value,'$.readings') ELSE json_extract(rv.value,'$.readings') END,
          CASE WHEN l.id<r.id THEN json_extract(rv.value,'$.readings') ELSE json_extract(lv.value,'$.readings') END,
          json_extract(j.value,'$.n'),json_extract(j.value,'$.kind'),json_extract(j.value,'$.points'),?,'active',?,?
        FROM json_each(?) j JOIN json_each(?) lv ON lv.key=json_extract(j.value,'$.leftIndex') JOIN json_each(?) rv ON rv.key=json_extract(j.value,'$.rightIndex')
          JOIN words l ON l.normalized=json_extract(lv.value,'$.normalized') JOIN words r ON r.normalized=json_extract(rv.value,'$.normalized')`).bind(user.id,createdAt,id,JSON.stringify(pairRows),JSON.stringify(wordRows),JSON.stringify(wordRows)),
      c.env.DB.prepare(`INSERT INTO score_entries(id,pair_id,user_id,points,status,source,source_id,created_at) SELECT 'score-'||id,id,author_id,points,'active','submission',id,created_at FROM rhyme_pairs WHERE submission_id=?`).bind(id)
    ]);
  } catch(error) {
    // A concurrent replay is successful; every other unique collision remains an all-or-nothing duplicate.
    if(error instanceof Error && /UNIQUE constraint failed/.test(error.message)) {
      const replay=await c.env.DB.prepare('SELECT id,payload_hash,points FROM submissions WHERE user_id=? AND request_id=?').bind(user.id,body.requestId).first<{id:string;payload_hash:string;points:number}>();
      if(replay?.payload_hash===payloadHash)return c.json(await submissionResult(c,replay,true));
      return c.json({error:replay?'这个提交标识已用于其他内容':'已有用户先收录了这批词中的词对，整批内容未保存，请重新核验',...(!replay?{preview:await makePreview(c,body.items,items)}:{})},409);
    }
    throw error;
  }
  return c.json(await submissionResult(c,{id,points:preview.totalPoints},false),201);
});
app.get('/api/profile',async c=>{
  const user=c.get('user');if(!user)return c.json({error:'请先登录'},401);
  if(!c.get('pairReady'))return c.json(pausedError,503);
  const page=pageNumber(c.req.query('page'));
  const [pairs,entries]=await Promise.all([
    c.env.DB.prepare(`${pairSelect} WHERE p.author_id=? ORDER BY p.created_at DESC,p.id DESC LIMIT 31 OFFSET ?`).bind(user.id,page*30).all(),
    c.env.DB.prepare(`SELECT s.*,p.left_text,p.right_text,CASE WHEN s.status='active' AND p.status='active' THEN 1 ELSE 0 END AS active FROM score_entries s JOIN rhyme_pairs p ON p.id=s.pair_id WHERE s.user_id=? ORDER BY s.created_at DESC,s.id DESC LIMIT 31 OFFSET ?`).bind(user.id,page*30).all()
  ]);
  return c.json({pairs:pairs.results.slice(0,30).map(row=>publicPair(row)),scoreEntries:entries.results.slice(0,30).map(row=>({...row,active:Number(row.active)===1})),hasMore:pairs.results.length>30||entries.results.length>30});
});
app.get('/api/admin/records',async c=>{
  if(!c.get('pairReady'))return c.json(pausedError,503);
  const page=pageNumber(c.req.query('page'));
  const [pairs,users,logs]=await Promise.all([
    c.env.DB.prepare(`${pairSelect} ORDER BY p.created_at DESC,p.id DESC LIMIT 31 OFFSET ?`).bind(page*30).all(),
    c.env.DB.prepare('SELECT id,username,role,disabled,created_at FROM users ORDER BY created_at DESC,id DESC LIMIT 31 OFFSET ?').bind(page*30).all(),
    c.env.DB.prepare('SELECT m.*,u.username AS admin FROM moderation m JOIN users u ON u.id=m.admin_id ORDER BY m.created_at DESC,m.id DESC LIMIT 31 OFFSET ?').bind(page*30).all()
  ]);
  return c.json({pairs:pairs.results.slice(0,30).map(row=>publicPair(row)),users:users.results.slice(0,30),logs:logs.results.slice(0,30),hasMore:[pairs,users,logs].some(x=>x.results.length>30)});
});
app.post('/api/admin/withdraw',async c=>{
  if(!c.get('pairReady'))return c.json(pausedError,503);
  const body=await jsonObject(c);
  if(body.type!=='pair'||typeof body.id!=='string'||typeof body.reason!=='string'||body.reason.trim().length<2)throw new Error('请选择押韵关系并填写至少两个字的撤回原因');
  const record=await c.env.DB.prepare("SELECT id FROM rhyme_pairs WHERE id=? AND status='active'").bind(body.id).first();
  if(!record)return c.json({error:'押韵已撤回或不存在'},404);
  await c.env.DB.batch([
    c.env.DB.prepare(`INSERT INTO moderation(id,entity_type,entity_id,admin_id,reason,action,created_at) SELECT ?,'pair',?,?,?,'withdraw',? WHERE EXISTS(SELECT 1 FROM rhyme_pairs WHERE id=? AND status='active')`).bind(crypto.randomUUID(),body.id,c.get('user')!.id,body.reason.trim(),now(),body.id),
    c.env.DB.prepare("UPDATE rhyme_pairs SET status='withdrawn' WHERE id=?").bind(body.id),
    c.env.DB.prepare("UPDATE score_entries SET status='withdrawn' WHERE pair_id=? AND status='active'").bind(body.id)
  ]);
  return c.json({ok:true});
});

app.post('/api/admin/reset-password',async c=>{
  const body=await jsonObject(c);
  if(typeof body.id!=='string'||!body.id.trim())throw new Error('请选择有效的用户账号');
  const user=await c.env.DB.prepare('SELECT id,username,role FROM users WHERE id=?').bind(body.id).first<User>();
  if(!user || user.role==='admin')return c.json({error:'只能处理普通用户账号'},400);
  const {password}=validateAccount(user.username,body.password);
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE users SET password_hash=? WHERE id=?').bind(await hashPassword(password),user.id),
    c.env.DB.prepare('DELETE FROM sessions WHERE user_id=?').bind(user.id),
    c.env.DB.prepare(`INSERT INTO moderation(id,entity_type,entity_id,admin_id,reason,action,created_at) VALUES(?,'user',?,?,?,'reset-password',?)`).bind(crypto.randomUUID(),user.id,c.get('user')!.id,'管理员重置密码',now())
  ]);return c.json({ok:true});
});
app.notFound(c=>c.json({error:'接口不存在'},404));
app.onError((err,c)=>{
  if(/UNIQUE constraint failed/.test(err.message))return c.json({error:/users.username/.test(err.message)?'这个用户名已被使用':'这组押韵已经被收录或撤回，不能重复提交'},409);
  if(err instanceof TypeError || /D1_|SQLITE_|database|scrypt|fetch failed/i.test(err.message)){console.error(JSON.stringify({event:'api_error',path:c.req.path,message:err.message}));return c.json({error:'服务暂时不可用，输入已保留，请稍后重试'},503);}
  return c.json({error:err instanceof SyntaxError?'提交格式不正确':err.message},400);
});
export default app;
