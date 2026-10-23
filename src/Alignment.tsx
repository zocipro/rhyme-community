import React from 'react';
import { Check, Sparkles, X } from 'lucide-react';
import { kindLabels, rhymeFinal } from '../shared/rhyme-core';
import type { Comparison } from '../shared/rhyme-core';

export function Alignment({result,readOnly=false}:{result:Comparison;readOnly?:boolean}){
  return <div className={`sc-alignment ${result.kind==='perfect'&&!result.same?'sc-perfect':''}`}>
    <div className="sc-alignment-head"><strong>逐字对照</strong><span>韵母 / 声调</span></div>
    <div className="sc-pairs">{result.rows.map((r,i)=><div className="sc-pair" key={i}>
      <div className="sc-pair-words"><span>{r.target.char}</span><span className="sc-pair-divider">/</span><strong>{r.answer?.char||'—'}</strong></div>
      <div className={r.finalMatch?'sc-match':'sc-mismatch'}><span>{r.target.final} / {r.answer?.final||'—'}{r.finalMatch&&r.target.final!==r.answer?.final&&<small className="sc-rhyme-family">同韵 {rhymeFinal(r.target.final)}</small>}</span>{r.finalMatch?<Check size={13}/>:<X size={13}/>}</div>
      <div className={r.toneMatch?'sc-match':'sc-mismatch'}><span>{r.target.tone||'轻'} / {r.answer?(r.answer.tone||'轻'):'—'}</span>{r.toneMatch?<Check size={13}/>:<X size={13}/>}</div>
    </div>)}</div>
    <div className="sc-result-note">{readOnly?<><Sparkles size={16}/>{kindLabels[result.kind]} · 末尾 {result.n} 字</>:result.same?'同一个词不能组成押韵':result.valid?<><Sparkles size={16}/>{kindLabels[result.kind]} · +{result.points} 分</>:<>每个位置的韵母或声调至少押上一项</>}</div>
  </div>;
}
