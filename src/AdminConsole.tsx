import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Ban, BarChart3, ChevronLeft, ChevronRight, Flame, KeyRound, LoaderCircle, PauseCircle, PlayCircle, RotateCcw, ScrollText, Search, Settings, Trash2, Undo2, UserCheck, UserRound, Users, X } from 'lucide-react';
import { kindLabels } from '../shared/rhyme-core';
import type { RhymeKind } from '../shared/rhyme-core';
import type { RhymePair } from '../shared/lookup';
import { Alignment } from './Alignment';
import { ApiError, api, date } from './api';

type AdminUser = { id: string; username: string; role: string; disabled: boolean; created_at: string; active_pairs: number; withdrawn_pairs: number; score: number; last_pair_at: string | null; sessions?: number };
type Overview = {
  totals: { users: number; disabled_users: number; new_users: number; active_pairs: number; withdrawn_pairs: number; week_pairs: number; words: number; points: number };
  daily: { day: string; pairs: number }[]; kinds: { kind: RhymeKind; pairs: number }[]; top: AdminUser[]; paused: boolean;
};
type Log = { id: string; entity_type: string; entity_id: string; reason: string; action: string; admin: string; target: string | null; created_at: string };
type HotList = { items: { text: string; count: number; last_searched_at: string }[]; blocked: string[]; minCount: number; limit: number };
type Page<T> = { items: T[]; total?: number; hasMore: boolean };
type Tab = 'overview' | 'users' | 'pairs' | 'hot' | 'logs' | 'settings';
type Confirm = { title: string; text: string; confirm: string; danger?: boolean; reason?: 'required' | 'optional'; password?: boolean; run: (input: { reason: string; password: string }) => Promise<unknown> };
type Props = { me: { id: string; username: string }; onSessionExpired: () => void; onChanged: () => void };

const tabs: { id: Tab; label: string; icon: typeof Users }[] = [
  { id: 'overview', label: '概览', icon: BarChart3 }, { id: 'users', label: '账号', icon: Users }, { id: 'pairs', label: '押韵', icon: ScrollText },
  { id: 'hot', label: '热门词', icon: Flame }, { id: 'logs', label: '处理记录', icon: RotateCcw }, { id: 'settings', label: '设置', icon: Settings },
];
const actionLabels: Record<string, string> = { withdraw: '撤回押韵', restore: '恢复押韵', disable: '停用账号', enable: '启用账号', 'reset-password': '重置密码' };
const kindOrder: RhymeKind[] = ['perfect', 'final', 'mixed', 'tone'];

function useLoad<T>(path: string | null, onExpired: () => void) {
  const [state, setState] = useState<{ data: T | null; error: string; loading: boolean }>({ data: null, error: '', loading: !!path });
  const [revision, setRevision] = useState(0), request = useRef(0), expired = useRef(onExpired);
  expired.current = onExpired;
  useEffect(() => {
    if (!path) return;
    const id = ++request.current;
    setState(previous => ({ ...previous, loading: true, error: '' }));
    api<T>(path).then(data => { if (id === request.current) setState({ data, error: '', loading: false }); })
      .catch(e => {
        if (id !== request.current) return;
        if (e instanceof ApiError && e.status === 401) { expired.current(); return; }
        setState(previous => ({ ...previous, error: (e as Error).message, loading: false }));
      });
  }, [path, revision]);
  return { ...state, reload: () => setRevision(value => value + 1) };
}

function State({ loading, error, onRetry }: { loading: boolean; error: string; onRetry: () => void }) {
  if (error) return <div className="sc-inline-state" role="alert"><p>{error}</p><button type="button" className="sc-link" onClick={onRetry}>重新读取</button></div>;
  return loading ? <div className="sc-empty" role="status"><LoaderCircle size={22} className="sc-spin"/><p>正在读取…</p></div> : null;
}
function Pager({ page, hasMore, total, onPage }: { page: number; hasMore: boolean; total?: number; onPage: (page: number) => void }) {
  if (!page && !hasMore) return total !== undefined ? <p className="sc-admin-count">共 {total} 条</p> : null;
  return <div className="sc-admin-pager">
    <button type="button" disabled={!page} onClick={() => onPage(page - 1)} aria-label="上一页"><ChevronLeft size={16}/></button>
    <span>第 {page + 1} 页{total !== undefined ? ` · 共 ${total} 条` : ''}</span>
    <button type="button" disabled={!hasMore} onClick={() => onPage(page + 1)} aria-label="下一页"><ChevronRight size={16}/></button>
  </div>;
}
function Filters<T extends string>({ value, options, onChange, label }: { value: T; options: [T, string][]; onChange: (value: T) => void; label: string }) {
  return <div className="sc-preview-filter sc-admin-filters" role="group" aria-label={label}>{options.map(([id, text]) => <button key={id} type="button" aria-pressed={value === id} onClick={() => onChange(id)}>{text}</button>)}</div>;
}
function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (value: string) => void; placeholder: string }) {
  return <label className="sc-search sc-admin-search"><Search size={18}/><input aria-label={placeholder} placeholder={placeholder} value={value} onChange={e => onChange(e.target.value)}/>{value && <button type="button" className="sc-search-clear" aria-label="清空" onClick={() => onChange('')}><X size={15}/></button>}</label>;
}
// Typing filters after a short pause, so each keystroke does not hit the API.
function useDebounced(value: string, delay = 300) {
  const [settled, setSettled] = useState(value);
  useEffect(() => { const timer = setTimeout(() => setSettled(value), delay); return () => clearTimeout(timer); }, [value, delay]);
  return settled;
}

function ConfirmDialog({ action, onClose }: { action: Confirm; onClose: (done: boolean) => void }) {
  const [reason, setReason] = useState(''), [password, setPassword] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose(false); };
    document.addEventListener('keydown', key); return () => document.removeEventListener('keydown', key);
  }, [busy, onClose]);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError('');
    try { await action.run({ reason: reason.trim(), password }); onClose(true); }
    catch (err) { setError((err as Error).message); setBusy(false); }
  }
  return <div className="sc-overlay"><section className="sc-modal sc-admin-confirm" role="dialog" aria-modal="true" aria-labelledby="admin-confirm-title">
    <button className="sc-modal-close" aria-label="关闭" disabled={busy} onClick={() => onClose(false)}><X/></button>
    <h2 id="admin-confirm-title">{action.title}</h2>
    <p className="sc-manage-text">{action.text}</p>
    <form onSubmit={submit}>
      {action.password && <label className="sc-field">新密码<input autoFocus type="password" required minLength={10} maxLength={128} autoComplete="new-password" value={password} onChange={e => setPassword(e.target.value)} placeholder="至少 10 位"/></label>}
      {action.reason && <label className="sc-field">{action.reason === 'required' ? '处理原因' : '处理原因（可选）'}<textarea autoFocus={!action.password} required={action.reason === 'required'} minLength={action.reason === 'required' ? 2 : 0} maxLength={200} value={reason} onChange={e => setReason(e.target.value)} placeholder="保留在处理记录中"/></label>}
      {error && <p className="sc-error" role="alert">{error}</p>}
      <button className={`sc-btn sc-full ${action.danger ? 'sc-btn-danger' : ''}`} disabled={busy}>{busy ? '正在处理…' : action.confirm}</button>
    </form>
  </section></div>;
}

function Stat({ label, value, hint, tone }: { label: string; value: number; hint?: string; tone?: 'gold' | 'danger' }) {
  return <div className={`sc-admin-stat ${tone ? `sc-admin-stat-${tone}` : ''}`}><span>{label}</span><strong>{value.toLocaleString('zh-CN')}</strong>{hint && <small>{hint}</small>}</div>;
}
function OverviewTab({ onExpired, onUser }: { onExpired: () => void; onUser: (id: string) => void }) {
  const { data, error, loading, reload } = useLoad<Overview>('/admin/overview', onExpired);
  if (!data) return <State loading={loading} error={error} onRetry={reload}/>;
  const { totals } = data;
  const days = Array.from({ length: 14 }, (_, i) => new Date(Date.now() - (13 - i) * 86400000).toISOString().slice(0, 10));
  const perDay = new Map(data.daily.map(d => [d.day, Number(d.pairs)])), max = Math.max(1, ...perDay.values());
  const kinds = kindOrder.map(kind => ({ kind, pairs: Number(data.kinds.find(k => k.kind === kind)?.pairs || 0) })), kindTotal = kinds.reduce((sum, k) => sum + k.pairs, 0);
  return <div className="sc-admin-overview">
    {data.paused && <p className="sc-recovery-note">投稿已暂停：用户暂时不能收录新押韵。可在「设置」中恢复。</p>}
    <div className="sc-admin-stats">
      <Stat label="有效押韵" value={totals.active_pairs} hint={`近 7 天 +${totals.week_pairs}`}/>
      <Stat label="收录词语" value={totals.words}/>
      <Stat label="注册账号" value={totals.users} hint={`近 7 天 +${totals.new_users}`}/>
      <Stat label="全站积分" value={totals.points} tone="gold"/>
      <Stat label="已撤回押韵" value={totals.withdrawn_pairs}/>
      <Stat label="已停用账号" value={totals.disabled_users} tone={totals.disabled_users ? 'danger' : undefined}/>
    </div>
    <section className="sc-admin-card">
      <header><h3>近 14 天收录</h3><span>每天新增的押韵关系</span></header>
      <div className="sc-admin-bars" role="img" aria-label={`近 14 天每日收录：${days.map(d => `${d.slice(5)} ${perDay.get(d) || 0} 对`).join('，')}`}>
        {days.map(day => { const n = perDay.get(day) || 0; return <div key={day} className="sc-admin-bar" title={`${day}：${n} 对`}><span style={{ height: `${Math.max(n ? 6 : 2, (n / max) * 100)}%` }}/><small>{Number(day.slice(8))}</small></div>; })}
      </div>
    </section>
    <div className="sc-admin-split">
      <section className="sc-admin-card">
        <header><h3>押韵类型</h3><span>当前有效押韵</span></header>
        {kindTotal ? <><div className="sc-admin-kindbar">{kinds.filter(k => k.pairs).map(k => <span key={k.kind} className={`sc-kind-${k.kind}`} style={{ flexGrow: k.pairs }} title={`${kindLabels[k.kind]} ${k.pairs}`}/>)}</div>
          <ul className="sc-admin-legend">{kinds.map(k => <li key={k.kind}><i className={`sc-kind-${k.kind}`}/>{kindLabels[k.kind]}<strong>{k.pairs}</strong><small>{Math.round(k.pairs / kindTotal * 100)}%</small></li>)}</ul></>
          : <p className="sc-help">还没有有效押韵。</p>}
      </section>
      <section className="sc-admin-card">
        <header><h3>贡献最多</h3><span>按有效积分</span></header>
        <ol className="sc-admin-top">{data.top.map((u, i) => <li key={u.id}><button type="button" onClick={() => onUser(u.id)}><span>{String(i + 1).padStart(2, '0')}</span><strong>{u.username}</strong><small>{u.active_pairs} 对 · {u.score} 分</small><ChevronRight size={14}/></button></li>)}</ol>
      </section>
    </div>
  </div>;
}

function UserRow({ user, onOpen }: { user: AdminUser; onOpen: (id: string) => void }) {
  return <button type="button" className="sc-admin-row" onClick={() => onOpen(user.id)}>
    <span className="sc-admin-avatar" aria-hidden="true">{[...user.username][0]}</span>
    <span className="sc-admin-row-main"><strong>{user.username}</strong>
      <small>注册于 {date(user.created_at)}{user.last_pair_at ? ` · 最近投稿 ${date(user.last_pair_at)}` : ' · 还没有投稿'}</small></span>
    <span className="sc-admin-row-badges">{user.role === 'admin' && <span className="sc-badge sc-badge-perfect">管理员</span>}{user.disabled && <span className="sc-badge sc-badge-none">已停用</span>}</span>
    <span className="sc-admin-row-num"><strong>{user.active_pairs}</strong><small>押韵</small></span>
    <span className="sc-admin-row-num"><strong>{user.score}</strong><small>积分</small></span>
    <ChevronRight size={16} className="sc-admin-row-chevron"/>
  </button>;
}
function UsersTab({ onExpired, onUser }: { onExpired: () => void; onUser: (id: string) => void }) {
  const [q, setQ] = useState(''), [status, setStatus] = useState<'all' | 'active' | 'disabled' | 'admin'>('all'), [page, setPage] = useState(0);
  const query = useDebounced(q);
  useEffect(() => setPage(0), [query, status]);
  const { data, error, loading, reload } = useLoad<Page<AdminUser>>(`/admin/users?q=${encodeURIComponent(query)}&status=${status}&page=${page}`, onExpired);
  return <div>
    <div className="sc-admin-toolbar"><SearchBox value={q} onChange={setQ} placeholder="搜索用户名"/><Filters label="账号筛选" value={status} onChange={setStatus} options={[['all', '全部'], ['active', '正常'], ['disabled', '已停用'], ['admin', '管理员']]}/></div>
    <State loading={loading && !data} error={error} onRetry={reload}/>
    {data && <div className="sc-admin-list" aria-busy={loading}>{data.items.map(u => <UserRow key={u.id} user={u} onOpen={onUser}/>)}{!data.items.length && <div className="sc-empty"><Users size={26}/><p>没有符合条件的账号。</p></div>}</div>}
    {data && <Pager page={page} hasMore={data.hasMore} total={data.total} onPage={setPage}/>}
  </div>;
}

function PairRow({ pair, onUser, onWithdraw, onRestore }: { pair: RhymePair; onUser?: (id: string) => void; onWithdraw: (pair: RhymePair) => void; onRestore: (pair: RhymePair) => void }) {
  const [open, setOpen] = useState(false), withdrawn = pair.status === 'withdrawn';
  return <article className={`sc-admin-pair ${withdrawn ? 'sc-admin-pair-withdrawn' : ''}`}>
    <div className="sc-admin-pair-line">
      <strong>{pair.left.text}<span aria-label="互押">↔</span>{pair.right.text}</strong>
      <span className={`sc-badge sc-badge-${withdrawn ? 'group' : pair.kind}`}>{withdrawn ? '已撤回' : kindLabels[pair.kind]}</span>
    </div>
    <p className="sc-admin-pair-meta">
      {onUser ? <button type="button" className="sc-link" onClick={() => onUser(pair.author_id)}>{pair.author}</button> : <span>{pair.author}</span>}
      <span>{pair.n} 押 · {withdrawn ? '不计分' : `+${pair.points} 分`}</span><time dateTime={pair.created_at}>{date(pair.created_at)}</time>
    </p>
    <div className="sc-admin-pair-actions">
      <details onToggle={e => setOpen(e.currentTarget.open)} className="sc-record-details"><summary>逐字对照</summary>{open && <Alignment result={pair.comparison} readOnly/>}</details>
      {withdrawn ? <button type="button" className="sc-link" onClick={() => onRestore(pair)}><Undo2 size={14}/>恢复</button>
        : <button type="button" className="sc-link sc-danger" onClick={() => onWithdraw(pair)}><Trash2 size={14}/>撤回</button>}
    </div>
  </article>;
}
function pairActions(ask: (action: Confirm) => void) {
  return {
    onWithdraw: (pair: RhymePair) => ask({ title: '撤回这组押韵', text: `${pair.left.text} ↔ ${pair.right.text}`, confirm: '确认撤回', danger: true, reason: 'required',
      run: ({ reason }) => api('/admin/withdraw', { type: 'pair', id: pair.id, reason }) }),
    onRestore: (pair: RhymePair) => ask({ title: '恢复这组押韵', text: `${pair.left.text} ↔ ${pair.right.text}。恢复后重新计入 ${pair.author} 的积分。`, confirm: '确认恢复', reason: 'optional',
      run: ({ reason }) => api('/admin/restore', { type: 'pair', id: pair.id, reason }) }),
  };
}
function PairsTab({ onExpired, onUser, ask, revision }: { onExpired: () => void; onUser: (id: string) => void; ask: (action: Confirm) => void; revision: number }) {
  const [q, setQ] = useState(''), [status, setStatus] = useState<'all' | 'active' | 'withdrawn'>('all'), [page, setPage] = useState(0);
  const query = useDebounced(q);
  useEffect(() => setPage(0), [query, status]);
  const { data, error, loading, reload } = useLoad<Page<RhymePair>>(`/admin/pairs?q=${encodeURIComponent(query)}&status=${status}&page=${page}&r=${revision}`, onExpired);
  const actions = pairActions(ask);
  return <div>
    <div className="sc-admin-toolbar"><SearchBox value={q} onChange={setQ} placeholder="搜索词语或作者"/><Filters label="押韵筛选" value={status} onChange={setStatus} options={[['all', '全部'], ['active', '有效'], ['withdrawn', '已撤回']]}/></div>
    <State loading={loading && !data} error={error} onRetry={reload}/>
    {data && <div className="sc-admin-list" aria-busy={loading}>{data.items.map(p => <PairRow key={p.id} pair={p} onUser={onUser} {...actions}/>)}{!data.items.length && <div className="sc-empty"><ScrollText size={26}/><p>没有符合条件的押韵。</p></div>}</div>}
    {data && <Pager page={page} hasMore={data.hasMore} total={data.total} onPage={setPage}/>}
  </div>;
}

function UserDetail({ id, me, onBack, onExpired, ask, revision }: { id: string; me: Props['me']; onBack: () => void; onExpired: () => void; ask: (action: Confirm) => void; revision: number }) {
  const [status, setStatus] = useState<'all' | 'active' | 'withdrawn'>('all'), [page, setPage] = useState(0);
  useEffect(() => setPage(0), [status, id]);
  const { data, error, loading, reload } = useLoad<{ user: AdminUser; pairs: RhymePair[]; hasMore: boolean }>(`/admin/users/${encodeURIComponent(id)}?status=${status}&page=${page}&r=${revision}`, onExpired);
  const back = <button type="button" className="sc-link sc-admin-back" onClick={onBack}><ArrowLeft size={14}/>返回账号列表</button>;
  if (!data) return <div>{back}<State loading={loading} error={error} onRetry={reload}/></div>;
  const { user } = data, managed = user.role !== 'admin' && user.id !== me.id;
  const actions = pairActions(ask);
  return <div className="sc-admin-detail">
    {back}
    <header className="sc-admin-profile">
      <span className="sc-admin-avatar sc-admin-avatar-lg" aria-hidden="true">{[...user.username][0]}</span>
      <div><h3>{user.username}{user.role === 'admin' && <span className="sc-badge sc-badge-perfect">管理员</span>}{user.disabled && <span className="sc-badge sc-badge-none">已停用</span>}</h3>
        <p>注册于 {date(user.created_at)} · {user.sessions ? `${user.sessions} 个设备在线` : '当前没有登录设备'}</p></div>
    </header>
    <div className="sc-admin-stats sc-admin-stats-compact">
      <Stat label="有效押韵" value={user.active_pairs}/><Stat label="已撤回" value={user.withdrawn_pairs}/><Stat label="有效积分" value={user.score} tone="gold"/>
    </div>
    {managed ? <div className="sc-admin-actions">
      <button type="button" className="sc-admin-action" onClick={() => ask({ title: '重置密码', text: `为 ${user.username} 设置新密码，已登录的设备会全部退出。`, confirm: '确认重置', password: true,
        run: ({ password }) => api('/admin/reset-password', { id: user.id, password }) })}><KeyRound size={16}/>重置密码</button>
      {user.disabled
        ? <button type="button" className="sc-admin-action" onClick={() => ask({ title: '启用账号', text: `${user.username} 可以重新登录和投稿。`, confirm: '确认启用', reason: 'optional',
          run: ({ reason }) => api('/admin/users/status', { id: user.id, disabled: false, reason }) })}><UserCheck size={16}/>启用账号</button>
        : <button type="button" className="sc-admin-action sc-admin-action-danger" onClick={() => ask({ title: '停用账号', text: `${user.username} 将立即退出所有设备，且不能再登录。已收录的押韵保留，可另行撤回。`, confirm: '确认停用', danger: true, reason: 'required',
          run: ({ reason }) => api('/admin/users/status', { id: user.id, disabled: true, reason }) })}><Ban size={16}/>停用账号</button>}
      <button type="button" className="sc-admin-action sc-admin-action-danger" disabled={!user.active_pairs} onClick={() => ask({ title: '撤回全部押韵', text: `撤回 ${user.username} 的 ${user.active_pairs} 组有效押韵，相关积分一并扣回。之后可以逐条恢复。`, confirm: `撤回 ${user.active_pairs} 组`, danger: true, reason: 'required',
        run: ({ reason }) => api('/admin/users/withdraw-all', { id: user.id, reason }) })}><Trash2 size={16}/>撤回全部押韵</button>
    </div> : <p className="sc-help">管理员账号不能在后台停用或重置。</p>}
    <div className="sc-admin-section-head"><h3>TA 的押韵</h3><Filters label="押韵筛选" value={status} onChange={setStatus} options={[['all', '全部'], ['active', '有效'], ['withdrawn', '已撤回']]}/></div>
    <div className="sc-admin-list" aria-busy={loading}>{data.pairs.map(p => <PairRow key={p.id} pair={p} {...actions}/>)}{!data.pairs.length && <div className="sc-empty"><ScrollText size={26}/><p>没有符合条件的押韵。</p></div>}</div>
    <Pager page={page} hasMore={data.hasMore} onPage={setPage}/>
  </div>;
}

function HotTab({ onExpired, ask, revision }: { onExpired: () => void; ask: (action: Confirm) => void; revision: number }) {
  const { data, error, loading, reload } = useLoad<HotList>(`/admin/hot?r=${revision}`, onExpired);
  if (!data) return <State loading={loading} error={error} onRetry={reload}/>;
  const blocked = new Set(data.blocked);
  const toggle = (text: string, block: boolean) => ask({ title: block ? '屏蔽热门词' : '取消屏蔽', text: block ? `「${text}」不再出现在热门词汇里，也不再计入搜索次数。` : `「${text}」可以重新上榜。`, confirm: block ? '确认屏蔽' : '确认取消', danger: block,
    run: () => api('/admin/hot', { text, blocked: block }) });
  let rank = 0;
  return <div>
    <p className="sc-help sc-admin-intro">搜索满 {data.minCount} 次的词会上榜，首页最多显示 {data.limit} 个。不合适的词可以屏蔽。</p>
    <div className="sc-admin-list">{data.items.map(item => { const isBlocked = blocked.has(item.text), listed = !isBlocked && item.count >= data.minCount && ++rank <= data.limit;
      return <div key={item.text} className={`sc-admin-hot ${isBlocked ? 'sc-admin-hot-blocked' : ''}`}>
        <strong>{item.text}</strong><span>{item.count} 次 · {date(item.last_searched_at)}</span>
        <span className={`sc-badge ${isBlocked ? 'sc-badge-none' : listed ? 'sc-badge-final' : 'sc-badge-group'}`}>{isBlocked ? '已屏蔽' : listed ? '首页可见' : '未上榜'}</span>
        <button type="button" className={`sc-link ${isBlocked ? '' : 'sc-danger'}`} onClick={() => toggle(item.text, !isBlocked)}>{isBlocked ? '取消屏蔽' : '屏蔽'}</button>
      </div>; })}
      {data.blocked.filter(text => !data.items.some(item => item.text === text)).map(text => <div key={text} className="sc-admin-hot sc-admin-hot-blocked"><strong>{text}</strong><span>无近期搜索</span><span className="sc-badge sc-badge-none">已屏蔽</span><button type="button" className="sc-link" onClick={() => toggle(text, false)}>取消屏蔽</button></div>)}
      {!data.items.length && !data.blocked.length && <div className="sc-empty"><Flame size={26}/><p>还没有搜索记录。</p></div>}
    </div>
  </div>;
}

function LogsTab({ onExpired, onUser, revision }: { onExpired: () => void; onUser: (id: string) => void; revision: number }) {
  const [page, setPage] = useState(0);
  const { data, error, loading, reload } = useLoad<Page<Log>>(`/admin/logs?page=${page}&r=${revision}`, onExpired);
  if (!data) return <State loading={loading} error={error} onRetry={reload}/>;
  return <div>
    <div className="sc-admin-list">{data.items.map(log => <article key={log.id} className="sc-admin-log">
      <span className={`sc-admin-log-action sc-admin-log-${log.action}`}>{actionLabels[log.action] || log.action}</span>
      <div><strong>{log.entity_type === 'user' && log.target ? <button type="button" className="sc-link" onClick={() => onUser(log.entity_id)}>{log.target}</button> : log.target || '已删除的记录'}</strong><p>{log.reason}</p></div>
      <small>{log.admin} · {date(log.created_at)}</small>
    </article>)}{!data.items.length && <div className="sc-empty"><RotateCcw size={26}/><p>还没有处理记录。</p></div>}</div>
    <Pager page={page} hasMore={data.hasMore} onPage={setPage}/>
  </div>;
}

function SettingsTab({ onExpired, ask, revision }: { onExpired: () => void; ask: (action: Confirm) => void; revision: number }) {
  const { data, error, loading, reload } = useLoad<Overview>(`/admin/overview?r=${revision}`, onExpired);
  if (!data) return <State loading={loading} error={error} onRetry={reload}/>;
  return <div className="sc-admin-settings">
    <section className="sc-admin-card sc-admin-setting">
      <div><h3>{data.paused ? <PauseCircle size={18}/> : <PlayCircle size={18}/>}投稿{data.paused ? '已暂停' : '开放中'}</h3>
        <p>暂停后，用户可以继续浏览和查押韵，但不能收录新押韵，后台的撤回和恢复也会暂停。适合迁移数据或处理大批违规内容时使用。</p></div>
      <button type="button" className={`sc-btn ${data.paused ? '' : 'sc-btn-danger'}`} onClick={() => ask({ title: data.paused ? '恢复投稿' : '暂停投稿', text: data.paused ? '用户可以重新收录押韵。' : '用户将暂时不能收录新押韵，已填写的内容会保留。', confirm: data.paused ? '确认恢复' : '确认暂停', danger: !data.paused,
        run: () => api('/admin/settings', { content_write_paused: !data.paused }) })}>{data.paused ? '恢复投稿' : '暂停投稿'}</button>
    </section>
    <section className="sc-admin-card"><h3>后台说明</h3><ul className="sc-admin-notes">
      <li>撤回押韵会保留原文、首次归属和处理记录，相关积分自动扣回；恢复后积分回到原作者。</li>
      <li>停用账号会立即退出该账号的所有设备，已收录的押韵不受影响。</li>
      <li>管理员账号不能在后台停用、重置或撤回全部押韵。</li>
    </ul></section>
  </div>;
}

export function AdminConsole({ me, onSessionExpired, onChanged }: Props) {
  const [tab, setTab] = useState<Tab>('overview'), [userId, setUserId] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null), [revision, setRevision] = useState(0), [notice, setNotice] = useState('');
  const opener = useRef<HTMLElement | null>(null);
  const ask = (action: Confirm) => { opener.current = document.activeElement as HTMLElement | null; setConfirm(action); };
  const openUser = (id: string) => { setUserId(id); setTab('users'); };
  function closeConfirm(done: boolean) {
    const title = confirm?.title;
    setConfirm(null); opener.current?.focus();
    if (done) { setRevision(value => value + 1); setNotice(`${title}：已完成`); onChanged(); }
  }
  // A 401 inside a confirm surfaces as an error there; elsewhere it ends the session.
  const expire = () => { setConfirm(null); onSessionExpired(); };
  const wrapped = (action: Confirm): Confirm => ({ ...action, run: async input => {
    try { return await action.run(input); } catch (e) { if (e instanceof ApiError && e.status === 401) expire(); throw e; }
  } });
  const askSafe = (action: Confirm) => ask(wrapped(action));
  return <div className="sc-admin">
    <div className="sc-page-heading sc-admin-heading"><div><div className="sc-eyebrow">ADMIN / 管理后台</div><h1>共创后台<span>.</span></h1><p>账号、押韵和热门词都在这里管理。撤回保留首次归属，积分自动扣回。</p></div></div>
    {notice && <div role="status" className="sc-notice"><span>{notice}</span><button aria-label="关闭提示" onClick={() => setNotice('')}><X size={16}/></button></div>}
    <section className="sc-panel sc-admin-panel">
      <nav className="sc-admin-tabs" aria-label="后台分区">{tabs.map(({ id, label, icon: Icon }) => <button key={id} type="button" aria-current={tab === id ? 'page' : undefined} onClick={() => { setTab(id); setUserId(null); setNotice(''); }}><Icon size={16}/>{label}</button>)}</nav>
      <div className="sc-admin-body" key={`${tab}:${userId || ''}`}>
        {tab === 'overview' && <OverviewTab onExpired={expire} onUser={openUser}/>}
        {tab === 'users' && (userId ? <UserDetail id={userId} me={me} onBack={() => setUserId(null)} onExpired={expire} ask={askSafe} revision={revision}/> : <UsersTab onExpired={expire} onUser={openUser}/>)}
        {tab === 'pairs' && <PairsTab onExpired={expire} onUser={openUser} ask={askSafe} revision={revision}/>}
        {tab === 'hot' && <HotTab onExpired={expire} ask={askSafe} revision={revision}/>}
        {tab === 'logs' && <LogsTab onExpired={expire} onUser={openUser} revision={revision}/>}
        {tab === 'settings' && <SettingsTab onExpired={expire} ask={askSafe} revision={revision}/>}
      </div>
    </section>
    {confirm && <ConfirmDialog action={confirm} onClose={closeConfirm}/>}
  </div>;
}

export function AdminGate({ onLogin }: { onLogin: () => void }) {
  return <section className="sc-panel sc-record-panel"><div className="sc-profile-gate"><div className="sc-start-icon"><UserRound size={30}/></div><h2>管理后台</h2><p>请使用管理员账号登录。</p><button className="sc-btn" onClick={onLogin}>登录</button></div></section>;
}
