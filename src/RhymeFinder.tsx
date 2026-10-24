import React from 'react';
import { ChevronRight, Flame, LoaderCircle, Mic2, Plus, Sparkles } from 'lucide-react';
import { kindLabels, markedPinyin, normalize } from '../shared/rhyme-core';
import type { HotWord, RhymeSearch, SearchMatch, SearchTier, SearchWord } from '../shared/library';
import { RulesLink } from './RulesSheet';

type Props = {
  search: RhymeSearch|null; query: string; hot: HotWord[]|null; loading: boolean; error: string; selectedId?: string;
  onWord: (word: SearchWord) => void; onCompose: (word?: SearchWord) => void; onHot: (text: string) => void; onRetry: () => void;
};

const tierHints: Record<number, string> = { 0: '韵母不同，逐字声调相同', 1: '末字韵母相同' };
const tierHint = (tier: number) => tierHints[tier] ?? `末尾 ${tier} 字韵母都相同`;

function WordChip({ match, selected, onWord }: { match: SearchMatch; selected: boolean; onWord: (word: SearchWord) => void }) {
  const perfect = match.valid && match.kind === 'perfect';
  return <button type="button" className={`sc-word-chip ${perfect ? 'sc-chip-perfect' : ''} ${match.valid ? '' : 'sc-chip-loose'}`} aria-current={selected ? 'true' : undefined}
    aria-label={`${match.word.text}，${match.valid ? kindLabels[match.kind] : '未达收录规则'}${match.spoken ? '，按口语读音' : ''}，查看互押词`} onClick={() => onWord(match.word)}>
    <strong>{match.word.text}</strong>
    <small>{match.pinyin.map(markedPinyin).join(' ')}{match.spoken && <span className="sc-spoken-tag">口语</span>}</small>
    {perfect && <Sparkles size={12} aria-hidden="true"/>}
  </button>;
}

function TierSection({ tier, selectedId, onWord }: { tier: SearchTier; selectedId?: string; onWord: (word: SearchWord) => void }) {
  const id = `rhyme-tier-${tier.tier}`;
  return <section className={`sc-tier-section sc-tier-section-${Math.min(tier.tier, 4)}`} aria-labelledby={id}>
    <header className="sc-tier-head"><h3 id={id}>{tier.label}</h3><span>{tierHint(tier.tier)}</span></header>
    <div className="sc-chip-grid">{tier.items.map(match => <WordChip key={match.word.id} match={match} selected={match.word.id === selectedId} onWord={onWord}/>)}</div>
    {tier.total > tier.items.length && <p className="sc-help sc-library-note">只列出最贴近的一部分，换个更长的词能押得更准。</p>}
  </section>;
}

function HotWords({ hot, onHot }: { hot: HotWord[]|null; onHot: (text: string) => void }) {
  return <section className="sc-hot" aria-labelledby="hot-title">
    <header className="sc-tier-head"><h3 id="hot-title"><Flame size={18} aria-hidden="true"/>热门词汇</h3><span>大家最近在找押韵的词</span></header>
    {hot === null ? <p className="sc-help" role="status">正在读取热门词汇…</p>
      : hot.length ? <ol className="sc-hot-list">{hot.map((item, index) => <li key={item.text}><button type="button" className="sc-hot-word" onClick={() => onHot(item.text)}><span aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>{item.text}</button></li>)}</ol>
      : <p className="sc-help">还没有热门搜索。搜一个词，帮它热起来。</p>}
  </section>;
}

function Idle({ hot, onHot, onCompose }: Pick<Props, 'hot' | 'onHot' | 'onCompose'>) {
  return <div className="sc-topic-list sc-finder-idle">
    <HotWords hot={hot} onHot={onHot}/>
    <div className="sc-finder-actions">
      <button type="button" className="sc-btn sc-btn-quiet" onClick={() => onCompose()}><Plus size={17}/>我来想一个押韵</button>
      <RulesLink/>
    </div>
  </div>;
}

function Results({ search, query, selectedId, onWord, onCompose }: { search: RhymeSearch; query: string; selectedId?: string; onWord: (word: SearchWord) => void; onCompose: (word?: SearchWord) => void }) {
  const key = normalize(query), draft: SearchWord|undefined = !search.error && [...key].length >= 2 ? { id: '', text: query, normalized: key, n: [...key].length } : undefined;
  return <div className="sc-topic-list sc-search-results">
    {search.query && <div className="sc-query-card">
      <span className="sc-query-ending" aria-label={`韵脚 ${search.query.ending}`}>-{search.query.ending}</span>
      <strong>{search.query.text}</strong>
      <span className="sc-tail">{search.query.pinyin.map(markedPinyin).join(' ')}</span>
      {search.exact ? <button type="button" className="sc-link" onClick={() => onWord(search.exact!)}>查看和它互押的词<ChevronRight size={14}/></button>
        : draft && <button type="button" className="sc-link" onClick={() => onCompose(draft)}>用「{search.query.text}」想押韵<ChevronRight size={14}/></button>}
    </div>}
    {search.error && <div className="sc-inline-state" role="status"><p>{search.error}。押韵查询需要输入汉字。</p></div>}
    {search.tiers.map(tier => <TierSection key={tier.tier} tier={tier} selectedId={selectedId} onWord={onWord}/>)}
    {!search.error && !search.tiers.length && <div className="sc-empty sc-small-empty"><Mic2 size={29} strokeWidth={1.5} aria-hidden="true"/><strong>还没有词和它押上</strong><p>写下新的押韵，成为第一个。</p><button className="sc-link" onClick={() => onCompose(draft)}>我来想一个押韵<ChevronRight size={14}/></button></div>}
  </div>;
}

export function RhymeFinder({ search, query, hot, loading, error, selectedId, onWord, onCompose, onHot, onRetry }: Props) {
  const errorState = error && <div className="sc-inline-state" role="alert"><p>{error}</p><button className="sc-link" onClick={onRetry}>重新查找</button></div>;
  if (!normalize(query)) return <>{errorState}<Idle hot={hot} onHot={onHot} onCompose={onCompose}/></>;
  if (search) return <>{errorState}<Results search={search} query={query} selectedId={selectedId} onWord={onWord} onCompose={onCompose}/></>;
  return <div className="sc-topic-list" aria-busy={loading}>{errorState}{loading && !error && <div className="sc-empty sc-small-empty" role="status"><LoaderCircle size={24} className="sc-spin"/><p>正在查找押韵…</p></div>}</div>;
}
