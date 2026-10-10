import React, { useEffect, useRef, useState } from 'react';
import { ChevronRight, Disc3, LoaderCircle, Mic2 } from 'lucide-react';
import { kindLabels, normalize } from '../shared/rhyme-core';
import { tierLabel } from '../shared/library';
import type { LibraryGroup, LibraryIndex, LibraryMatch, LibrarySearch, LibraryWord } from '../shared/library';
import type { Word } from '../shared/lookup';

type Props = {
  library: LibraryIndex|null; search: LibrarySearch|null; query: string; loading: boolean; error: string; selectedId?: string;
  onWord: (word: Word) => void; onCompose: (word?: Word) => void; onRetry: () => void;
};

function Tier({ tier }: { tier: number }) {
  return tier > 0 ? <span className={`sc-tier sc-tier-${Math.min(tier, 3)}`}>{tierLabel(tier)}</span> : null;
}
function WordRow({ word, selected, onWord, match }: { word: LibraryWord; selected: boolean; onWord: (word: Word) => void; match?: LibraryMatch }) {
  const tier = match ? match.tier : word.tier;
  return <button className={`sc-topic ${selected ? 'sc-selected' : ''}`} onClick={() => onWord(word)}>
    <div><strong>{word.text}</strong><span className="sc-topic-tags">{match?.valid && <span className={`sc-badge sc-badge-${match.kind}`}>{kindLabels[match.kind]}</span>}<Tier tier={tier}/></span></div>
    <small><span className="sc-tail">{word.tail}</span><span aria-hidden="true">·</span>已收录 {word.pair_count} 对</small>
  </button>;
}
const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

function GroupedLibrary({ groups, truncated, selectedId, onWord }: { groups: LibraryGroup[]; truncated: boolean; selectedId?: string; onWord: (word: Word) => void }) {
  const list = useRef<HTMLDivElement>(null), index = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(groups[0]?.ending ?? '');
  useEffect(() => { if (!groups.some(group => group.ending === active)) setActive(groups[0]?.ending ?? ''); }, [groups]);
  useEffect(() => {
    const bar = index.current, chip = bar?.querySelector<HTMLElement>('[aria-current="true"]');
    if (!bar || !chip) return;
    const left = bar.scrollLeft + chip.getBoundingClientRect().left - bar.getBoundingClientRect().left - (bar.clientWidth - chip.offsetWidth) / 2;
    bar.scrollTo({ left: Math.max(0, left), behavior: reducedMotion() ? 'auto' : 'smooth' });
  }, [active]);
  function track() {
    const container = list.current; if (!container) return;
    const sections = [...container.querySelectorAll<HTMLElement>('.sc-rhyme-group')];
    const current = sections.filter(section => section.offsetTop - 2 <= container.scrollTop).at(-1) ?? sections[0];
    const ending = current?.dataset.ending; if (ending && ending !== active) setActive(ending);
  }
  function jump(ending: string) {
    const container = list.current, section = container?.querySelector<HTMLElement>(`[data-ending="${CSS.escape(ending)}"]`);
    if (!container || !section) return;
    setActive(ending);
    container.scrollTo({ top: section.offsetTop, behavior: reducedMotion() ? 'auto' : 'smooth' });
    section.querySelector<HTMLElement>('h3')?.focus({ preventScroll: true });
  }
  return <>
    <div className="sc-rhyme-index" ref={index} role="navigation" aria-label="韵脚索引">
      {groups.map(group => <button type="button" key={group.ending} aria-current={group.ending === active ? 'true' : undefined} aria-label={`跳到韵脚 ${group.ending}，${group.count} 个词`} onClick={() => jump(group.ending)}>{group.ending}<sup>{group.count}</sup></button>)}
    </div>
    <div className="sc-topic-list sc-grouped-list" ref={list} onScroll={track}>
      {groups.map(group => <section className="sc-rhyme-group" key={group.ending} data-ending={group.ending} aria-labelledby={`rhyme-group-${group.ending}`}>
        <header className="sc-group-head">
          <h3 id={`rhyme-group-${group.ending}`} tabIndex={-1}><span className="sc-screen-reader-only">韵脚 </span>-{group.ending}</h3>
          <span className="sc-group-finals">{group.finals.length > 1 ? group.finals.join(' / ') : '同韵脚'}</span>
          <span className="sc-group-count">{group.count} 词</span>
        </header>
        {group.items.map(word => <WordRow key={word.id} word={word} selected={word.id === selectedId} onWord={onWord}/>)}
      </section>)}
      {truncated && <p className="sc-help sc-library-note">仅显示押韵最多的前 5,000 个词，可用搜索查找其余词语。</p>}
    </div>
  </>;
}

function ResultSection({ title, hint, total, children }: { title: string; hint: string; total: number; children: React.ReactNode }) {
  return <section className="sc-result-group">
    <header className="sc-group-head"><h3>{title}</h3><span className="sc-group-finals">{hint}</span><span className="sc-group-count">{total}</span></header>
    {children}
    {total > React.Children.count(children) && <p className="sc-help sc-library-note">共 {total} 个，已显示最相近的 {React.Children.count(children)} 个。</p>}
  </section>;
}

function SearchResults({ search, query, selectedId, onWord, onCompose }: { search: LibrarySearch; query: string; selectedId?: string; onWord: (word: Word) => void; onCompose: (word?: Word) => void }) {
  const key = normalize(query), draft: Word|undefined = [...key].length >= 2 ? { id: '', text: query, normalized: key, n: [...key].length, pair_count: 0 } : undefined;
  const nothing = !search.exact && !search.rhymes.length && !search.sameEnding.length && !search.contains.length;
  return <div className="sc-topic-list sc-search-results">
    {search.query && <div className="sc-query-card">
      <span className="sc-query-ending" aria-label={`韵脚 ${search.query.ending}`}>-{search.query.ending}</span>
      <strong>{search.query.text}</strong>
      <span className="sc-tail">{search.query.pinyin.join(' ')}</span>
      {search.exact ? <button type="button" className="sc-link" onClick={() => onWord(search.exact!)}>已收录 · 查看整组押韵<ChevronRight size={14}/></button>
        : draft && <button type="button" className="sc-link" onClick={() => onCompose(draft)}>用「{search.query.text}」想押韵<ChevronRight size={14}/></button>}
    </div>}
    {search.error && <div className="sc-inline-state" role="status"><p>{search.error}。押韵查询需要输入汉字。</p></div>}
    {search.rhymes.length > 0 && <ResultSection title="押韵" hint="按收录规则可以押上" total={search.totals.rhymes}>{search.rhymes.map(match => <WordRow key={match.word.id} word={match.word} match={match} selected={match.word.id === selectedId} onWord={onWord}/>)}</ResultSection>}
    {search.sameEnding.length > 0 && <ResultSection title="同韵脚" hint="末尾韵母押上，整词未达收录规则" total={search.totals.sameEnding}>{search.sameEnding.map(match => <WordRow key={match.word.id} word={match.word} match={match} selected={match.word.id === selectedId} onWord={onWord}/>)}</ResultSection>}
    {search.contains.length > 0 && <ResultSection title={`包含「${key}」`} hint="已收录的词" total={search.totals.contains}>{search.contains.map(word => <WordRow key={word.id} word={word} selected={word.id === selectedId} onWord={onWord}/>)}</ResultSection>}
    {nothing && <div className="sc-empty sc-small-empty"><Mic2 size={29} strokeWidth={1.5} aria-hidden="true"/><strong>还没有押上这个词的收录</strong><p>写下新的押韵，成为第一个。</p><button className="sc-link" onClick={() => onCompose(draft)}>我来想一个押韵<ChevronRight size={14}/></button></div>}
  </div>;
}

export function Library({ library, search, query, loading, error, selectedId, onWord, onCompose, onRetry }: Props) {
  const searching = !!normalize(query);
  const errorState = error && <div className="sc-inline-state" role="alert"><p>{error}</p><button className="sc-link" onClick={onRetry}>重新读取词库</button></div>;
  if (searching) {
    if (search) return <>{errorState}<SearchResults search={search} query={query} selectedId={selectedId} onWord={onWord} onCompose={onCompose}/></>;
    return <div className="sc-topic-list" aria-busy={loading}>{errorState}{loading && !error && <div className="sc-empty sc-small-empty" role="status"><LoaderCircle size={24} className="sc-spin"/><p>正在查找押韵…</p></div>}</div>;
  }
  if (!library) return <div className="sc-topic-list" aria-busy={loading}>{errorState}{loading && <div className="sc-empty sc-small-empty" role="status"><LoaderCircle size={24} className="sc-spin"/><p>正在读取词库…</p></div>}</div>;
  if (!library.groups.length) return <div className="sc-topic-list">{errorState}{!error && <div className="sc-empty sc-small-empty"><Disc3 size={29} strokeWidth={1.5} aria-hidden="true"/><strong>第一组押韵，等你来想</strong><p>从两个词开始，留下你的原创灵感。</p><button className="sc-link" onClick={() => onCompose()}>我来想一个押韵<ChevronRight size={14}/></button></div>}</div>;
  return <>{errorState}<GroupedLibrary groups={library.groups} truncated={library.truncated} selectedId={selectedId} onWord={onWord}/></>;
}
