import React, { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ChevronRight, NotebookPen, Plus, Sparkles } from 'lucide-react';
import { markedPinyin } from '../shared/rhyme-core';
import type { Syllable } from '../shared/rhyme-core';
import { analyzeLyrics, rhymeWord, splitHighlight } from '../shared/lyrics';
import { tierLabel } from '../shared/library';

type Props = { pronounce: ((text: string) => Syllable[]) | null; dictionaryError: string; onBack: () => void; onCompose: (words: string[]) => void };
type Pane = 'write' | 'check';

const STORAGE_KEY = 'rhyme-lyrics-v1';
// An original sample verse; it only lives in the browser and is never submitted.
const SAMPLE = '深夜的街灯照亮我的光芒\n回头看过去，一片苍茫\n不管有多难 我都不慌忙\n把梦想写进每一行\n\n说唱是我的信仰\n节奏在心里回荡';
const COLORS = 6;

function storedText() { try { return localStorage.getItem(STORAGE_KEY) ?? ''; } catch { return ''; } }

export function Lyrics({ pronounce, dictionaryError, onBack, onCompose }: Props) {
  const [text, setText] = useState(storedText), [pane, setPane] = useState<Pane>('write');
  const deferred = useDeferredValue(text);
  useEffect(() => { try { localStorage.setItem(STORAGE_KEY, text); } catch { /* The draft still lives in this tab. */ } }, [text]);
  const analysis = useMemo(() => pronounce && deferred.trim() ? analyzeLyrics(deferred, pronounce) : null, [deferred, pronounce]);
  const colorOf = useMemo(() => new Map(analysis?.endings.map((e, i) => [e.ending, i % COLORS])), [analysis]);
  const status = dictionaryError || (!pronounce ? '正在准备读音…' : !analysis ? '写下或贴一段歌词' : analysis.rhymedLines ? `${analysis.rhymedLines} 行押上 · 最多${tierLabel(analysis.best)}` : '还没有押上的行');

  const tabs = <div className="sc-compose-tabs sc-lyrics-tabs" role="tablist" aria-label="歌词本">
    {(['write', 'check'] as Pane[]).map(p => <button key={p} type="button" role="tab" id={`lyrics-tab-${p}`} aria-controls={`lyrics-${p}`} aria-selected={pane === p} tabIndex={pane === p ? 0 : -1} onClick={() => setPane(p)}>
      {p === 'write' ? '写歌词' : `看押韵${analysis?.rhymedLines ? ` · ${analysis.rhymedLines}` : ''}`}</button>)}
  </div>;

  return <div className="sc-lyrics" data-pane={pane}>
    <div className="sc-compose-heading">
      <div><h2><NotebookPen size={26} aria-hidden="true"/>歌词本</h2></div>
      <button type="button" className="sc-link" onClick={onBack}><ArrowLeft size={14}/>想押韵</button>
    </div>
    <p className="sc-compose-intro">贴一段歌词，自动标出每行的韵脚和几押。草稿只存在这台设备上。</p>
    {tabs}
    <div className="sc-lyrics-body">
      <section id="lyrics-write" role="tabpanel" aria-labelledby="lyrics-tab-write" className="sc-lyrics-pane sc-lyrics-write">
        <textarea aria-label="歌词" value={text} onChange={e => setText(e.target.value)} placeholder={'一行一句，空行分段\n\n比如：\n深夜的街灯照亮我的光芒\n回头看过去，一片苍茫'} spellCheck={false}/>
        <div className="sc-lyrics-tools">
          {!text.trim() ? <button type="button" className="sc-link" onClick={() => setText(SAMPLE)}><Sparkles size={14}/>试试示例</button>
            : <button type="button" className="sc-link sc-lyrics-clear" onClick={() => setText('')}>清空</button>}
          <span>{text ? `${text.split(/\r?\n/).filter(line => line.trim()).length} 行` : ''}</span>
          <button type="button" className="sc-link sc-lyrics-to-check" onClick={() => setPane('check')}>看押韵<ChevronRight size={14}/></button>
        </div>
      </section>
      <section id="lyrics-check" role="tabpanel" aria-labelledby="lyrics-tab-check" className="sc-lyrics-pane sc-lyrics-check" aria-live="polite">
        <div className="sc-lyrics-summary"><strong>{status}</strong>
          {analysis?.endings.map(e => <span key={e.ending} className={`sc-lyrics-ending sc-rhyme-c${colorOf.get(e.ending)}`}>-{e.ending} · {e.lines} 行</span>)}
        </div>
        {analysis?.truncated && <p className="sc-help">只分析前 300 行。</p>}
        {analysis ? <ol className="sc-lyric-lines">{analysis.lines.map((line, i) => {
          const [before, mark, after] = splitHighlight(line.text, line.highlight), color = colorOf.get(line.ending);
          const partner = line.partner === null ? null : analysis.lines[line.partner];
          const newStanza = i > 0 && analysis.lines[i - 1].stanza !== line.stanza;
          return <li key={line.index} className={`sc-lyric-line ${line.highlight ? `sc-rhyme-c${color}` : ''} ${newStanza ? 'sc-lyric-stanza' : ''}`}>
            <span className="sc-lyric-no" aria-hidden="true">{line.index + 1}</span>
            <div className="sc-lyric-text">
              <p>{before}{mark && <mark>{mark}</mark>}{after}</p>
              {line.pinyin.length > 0 && line.highlight > 0 && <small>{line.pinyin.slice(-line.highlight).map(markedPinyin).join(' ')}</small>}
              {line.error && <small className="sc-error">{line.error}</small>}
            </div>
            {partner && <div className="sc-lyric-rhyme">
              <span className={`sc-lyric-tag ${line.perfect ? 'sc-lyric-perfect' : ''}`} title={`与第 ${partner.index + 1} 行`}>{line.perfect && <Sparkles size={11} aria-hidden="true"/>}{tierLabel(line.rhymes)} ↑{partner.index + 1}{line.spoken ? ' · 口语' : ''}</span>
              <button type="button" className="sc-link" aria-label={`把第 ${partner.index + 1} 行和第 ${line.index + 1} 行的押韵带到想押韵`} onClick={() => onCompose([rhymeWord(partner.text, line.rhymes), rhymeWord(line.text, line.rhymes)])}><Plus size={13}/>收录</button>
            </div>}
          </li>;
        })}</ol> : <div className="sc-empty"><NotebookPen size={30} strokeWidth={1.5} aria-hidden="true"/><p>{pronounce ? '写下歌词后，' : '读音准备好后，'}<br/>押上的行会在这里标出来。</p></div>}
      </section>
    </div>
  </div>;
}
