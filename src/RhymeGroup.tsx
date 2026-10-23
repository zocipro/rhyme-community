import React, { useState } from 'react';
import { ArrowLeft, Disc3, LoaderCircle, PenLine } from 'lucide-react';
import { kindLabels, rhymeFinal } from '../shared/rhyme-core';
import { Alignment } from './Alignment';
import type { RhymePair, RhymingWord } from '../shared/lookup';
import type { SearchWord } from '../shared/library';

type Props = {
  word: SearchWord; items: RhymingWord[]; loading: boolean; error: string; more: boolean;
  onWord: (word: SearchWord) => void; onMore: () => void; onRetry: () => void; onCompose: (word: SearchWord) => void; onBack: () => void;
  date: (text: string) => string;
};

function Relation({ pair, date }: { pair: RhymePair } & Pick<Props, 'date'>) {
  const [open, setOpen] = useState(false);
  return <article className="sc-relation">
    <div className="sc-relation-line"><strong>{pair.left.text}<span aria-label="互押">↔</span>{pair.right.text}</strong><span className={`sc-badge sc-badge-${pair.kind}`}>{kindLabels[pair.kind]}</span></div>
    <p className="sc-lookup-author"><span><span className="sc-credit-name">{pair.author}</span> 最先提交</span><span className="sc-credit-dot" aria-hidden="true">·</span><time dateTime={pair.created_at}>{date(pair.created_at)}</time></p>
    <details onToggle={e => setOpen(e.currentTarget.open)}><summary>查看逐字对照</summary>{open && <Alignment result={pair.comparison} readOnly/>}</details>
  </article>;
}

// Every member is shown the same way; the word you arrived from is only highlighted, never a heading.
export function RhymeGroup({ word, items, loading, error, more, onWord, onMore, onRetry, onCompose, onBack, date }: Props) {
  // A direct pair is shown from this word's side, so its left reading is this word's own.
  const direct = items.find(item => item.association === 'direct');
  const ending = direct ? rhymeFinal(direct.pair.left.readings.at(-1)?.final ?? '') : '';
  const members = [{ word, association: 'self' as const }, ...items.map(item => ({ word: item.word as SearchWord, association: item.association }))]
    .sort((a, b) => a.word.normalized.localeCompare(b.word.normalized, 'zh-Hans-CN'));
  const pairs = [...new Map(items.map(item => [item.pair.id, item.pair])).values()].sort((a, b) => a.created_at.localeCompare(b.created_at));
  return <div className="sc-lookup-panel sc-group-panel">
    <div className="sc-challenge-heading"><span className="sc-pill">押韵互查{ending && ` · -${ending}`}</span><button className="sc-link" onClick={onBack}><ArrowLeft size={14}/>返回搜索</button></div>
    <h2 className="sc-group-title">这些词<span className="sc-highlight">彼此押韵</span></h2>
    <p className="sc-meta">点任意一个词，从它出发继续互查。虚线框是经由组内其他词相连的同组词。</p>
    <div className="sc-lookup-results" aria-busy={loading}>
      {error && <div className="sc-inline-state" role="alert"><p>{error}</p><button className="sc-link" onClick={onRetry}>重新读取押韵</button></div>}
      <ul className="sc-member-list" aria-label="互相押韵的词">{members.map(member => <li key={member.word.normalized}>
        {member.association === 'self' ? <span className="sc-member" aria-current="true">{member.word.text}<span className="sc-screen-reader-only">（当前词）</span></span>
          : <button type="button" className={`sc-member ${member.association === 'group' ? 'sc-member-group' : ''}`} onClick={() => onWord(member.word)}>{member.word.text}{member.association === 'group' && <span className="sc-screen-reader-only">（同组词）</span>}</button>}
      </li>)}</ul>
      {pairs.length > 0 && <section className="sc-relations" aria-labelledby="relations-title"><h3 id="relations-title">实际收录的关系</h3>{pairs.map(pair => <Relation key={pair.id} pair={pair} date={date}/>)}</section>}
      {!items.length && <div className="sc-empty">{loading ? <><LoaderCircle size={24} className="sc-spin"/><p>正在读取押韵…</p></> : !error && <><Disc3 size={30} strokeWidth={1.5} aria-hidden="true"/><p>这个词还没有有效押韵。<br/>写下新的灵感吧。</p></>}</div>}
      {more && <button className="sc-load-more" disabled={loading} onClick={onMore}>继续读取同组词</button>}
    </div>
    <div className="sc-lookup-action"><button className="sc-btn" disabled={loading} onClick={() => onCompose(word)}><PenLine size={17}/>给这组再添一个押韵</button></div>
  </div>;
}
