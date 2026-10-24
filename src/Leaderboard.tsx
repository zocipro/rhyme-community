import React, { useEffect, useState } from 'react';
import { Crown, LoaderCircle, Trophy } from 'lucide-react';
import { api } from './api';

type Row = { rank: number; username: string; points: number; pairs: number; me: boolean };
type Board = { week: { start: string; end: string; back: number }; items: Row[]; me: Row | null };

// "10/20 – 10/26": the Monday-to-Sunday span, shown in Beijing time like the week itself.
function span(week: Board['week']) {
  const fmt = (iso: string) => new Date(iso).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric', timeZone: 'Asia/Shanghai' });
  return `${fmt(week.start)} – ${fmt(new Date(new Date(week.end).getTime() - 1).toISOString())}`;
}

export function Leaderboard({ signedIn, revision = 0, onCompose }: { signedIn: boolean; revision?: number; onCompose: () => void }) {
  const [back, setBack] = useState(0), [board, setBoard] = useState<Board | null>(null), [error, setError] = useState(''), [loading, setLoading] = useState(true), [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true; setLoading(true); setError('');
    api<Board>(`/leaderboard/weekly?week=${back}`).then(data => { if (active) setBoard(data); }).catch(e => { if (active) setError((e as Error).message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [back, signedIn, revision, retry]);
  const showMe = board?.me && !board.items.some(row => row.me);
  return <section className="sc-leaderboard" aria-labelledby="leaderboard-title" aria-busy={loading}>
    <header className="sc-leaderboard-head">
      <div><h2 id="leaderboard-title"><Trophy size={20} aria-hidden="true"/>{back ? '上周' : '本周'}排行</h2><span>{board ? span(board.week) : ''} · 按新收录押韵的积分</span></div>
      <div className="sc-preview-filter sc-leaderboard-weeks" role="group" aria-label="选择周">
        <button type="button" aria-pressed={!back} onClick={() => setBack(0)}>本周</button>
        <button type="button" aria-pressed={!!back} onClick={() => setBack(1)}>上周</button>
      </div>
    </header>
    {error ? <div className="sc-inline-state" role="alert"><p>{error}</p><button type="button" className="sc-link" onClick={() => setRetry(n => n + 1)}>重新读取</button></div>
      : !board ? <div className="sc-empty" role="status"><LoaderCircle size={22} className="sc-spin"/><p>正在读取排行…</p></div>
      : !board.items.length ? <div className="sc-empty sc-leaderboard-empty"><Trophy size={28} strokeWidth={1.5} aria-hidden="true"/><p>{back ? '上周还没有人上榜。' : '本周还没有人收录押韵，'}<br/>{back ? '' : '第一个上榜的可以是你。'}</p>{!back && <button type="button" className="sc-btn sc-btn-quiet" onClick={onCompose}>我来想一个押韵</button>}</div>
      : <ol className="sc-leaderboard-list">
        {board.items.map((row, i) => <li key={`${row.rank}-${row.username}-${i}`} className={`${row.rank <= 3 ? `sc-podium sc-podium-${row.rank}` : ''} ${row.me ? 'sc-leaderboard-me' : ''}`}>
          <span className="sc-leaderboard-rank">{row.rank === 1 ? <Crown size={18} aria-label="第 1 名"/> : row.rank}</span>
          <strong>{row.username}{row.me && <em>我</em>}</strong>
          <span className="sc-leaderboard-pairs">{row.pairs} 对</span>
          <span className="sc-leaderboard-points">+{row.points}</span>
        </li>)}
        {showMe && <li className="sc-leaderboard-me sc-leaderboard-self"><span className="sc-leaderboard-rank">{board.me!.rank}</span><strong>{board.me!.username}<em>我</em></strong><span className="sc-leaderboard-pairs">{board.me!.pairs} 对</span><span className="sc-leaderboard-points">+{board.me!.points}</span></li>}
      </ol>}
    {board && board.items.length > 0 && signedIn && !board.me && !back && <p className="sc-help sc-leaderboard-note">你本周还没有新收录。收录一组押韵就能上榜。</p>}
  </section>;
}
