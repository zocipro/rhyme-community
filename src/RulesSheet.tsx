import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CircleHelp, Sparkles, X } from 'lucide-react';

const rules = [
  { no: '01', name: '韵母押', rule: '每个位置的韵母同韵部', score: 'N', example: '说唱 ↔ 多光' },
  { no: '02', name: '声调押', rule: '每个位置的声调相同', score: 'N', example: '山河 ↔ 斑驳' },
  { no: '03', name: '混合押韵', rule: '每个位置押韵母或声调之一', score: 'N', example: '山河天地人 ↔ 风云星底任' },
  { no: '✦', name: '完美押韵', rule: '韵母与声调全部押上', score: '2N', example: '光芒 ↔ 苍茫', gold: true },
];

// The one place the scoring rules are explained; the homepage only links to it.
// The dialog is portaled to <body> so animated or transformed ancestors cannot trap the fixed overlay.
export function RulesLink({ className = '' }: { className?: string }) {
  const [open, setOpen] = useState(false), opener = useRef<HTMLButtonElement>(null), close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    close.current?.focus();
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('keydown', key); opener.current?.focus(); };
  }, [open]);
  return <>
    <button ref={opener} type="button" className={`sc-link sc-rules-link ${className}`} onClick={() => setOpen(true)}><CircleHelp size={15}/>押韵怎么算？</button>
    {open && createPortal(<div className="sc-overlay" onClick={e => { if (e.target === e.currentTarget) setOpen(false); }}>
      <section className="sc-modal sc-rules-sheet" role="dialog" aria-modal="true" aria-labelledby="rules-title">
        <button ref={close} className="sc-modal-close" aria-label="关闭" onClick={() => setOpen(false)}><X/></button>
        <h2 id="rules-title">押韵怎么算</h2>
        <p>两个词按较短一方的字数 N 对齐末尾，逐字比较；每个位置至少押上韵母或声调中的一项。</p>
        <ol className="sc-rules-list">{rules.map(r => <li key={r.name} className={r.gold ? 'sc-gold-rule' : ''}>
          <span className="sc-rules-no">{r.gold ? <Sparkles size={16}/> : r.no}</span>
          <div><strong>{r.name}</strong><small>{r.rule}</small><em>{r.example}</em></div>
          <b>+{r.score}</b>
        </li>)}</ol>
        <p className="sc-rules-note">常见口语读音（如「怂」读 sóng）可以在读音里选用。每对押韵只记录最先提交的人。</p>
      </section>
    </div>, document.body)}
  </>;
}
