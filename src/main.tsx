import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Plus, Sparkles, X, LogIn, ArrowLeft, BookOpen, PenLine, UserRound, Shield, Search, Music2, LoaderCircle, ChevronRight, Trash2, Disc3, Eye, EyeOff } from 'lucide-react';
import { kindLabels, markedPinyin, normalize, validateText } from '../shared/rhyme-core';
import { compareMutual, validatePairWorkload } from '../shared/pair-comparison';
import { isSpoken, spokenFixes } from '../shared/spoken';
import type { SpokenFix } from '../shared/spoken';
import type { Syllable, Comparison } from '../shared/rhyme-core';
import type { Word, RhymingWord, RhymePair, ScoreEntry } from '../shared/lookup';
import { ApiError, api, date } from './api';
import { WordInput } from './WordInput';
import { ThemeToggle } from './ThemeToggle';
import { Alignment } from './Alignment';
import { RhymeFinder } from './RhymeFinder';
import { RhymeGroup } from './RhymeGroup';
import { AdminConsole, AdminGate } from './AdminConsole';
import { hotSearchKey } from '../shared/library';
import type { HotWord, RhymeSearch, SearchWord } from '../shared/library';
import '@fontsource/anton/latin.css';
import './style.css';

type User = { id:string; username:string; role:string; score:number };
type DraftItem = { id:string; text:string; choices:string[] };
type PreviewPair = { leftIndex:number; rightIndex:number; comparison:Comparison; duplicate?:RhymePair };
type Preview = { items:{text:string;normalized:string;readings:Syllable[]}[]; pairs:PreviewPair[]; valid:boolean; totalPoints:number; pairCount:number };
type Records = { pairs:RhymePair[]; scoreEntries?:ScoreEntry[]; hasMore:boolean };
type View = 'library'|'mine'|'admin';
type Screen = 'library'|'lookup'|'compose';
type Pane = 'write'|'compare';
type SubmissionResult = { id:string; pairs:RhymePair[]; points:number; replayed:boolean };
type UnconfirmedSubmission = { userId:string; username:string; requestId:string; items:{text:string;readings:string[]}[] };
function initialSubmission():UnconfirmedSubmission|null{
  try{const value=JSON.parse(sessionStorage.getItem('rhyme-unconfirmed-v1')||'null');if(value&&typeof value.userId==='string'&&typeof value.username==='string'&&typeof value.requestId==='string'&&Array.isArray(value.items)&&value.items.length>=2&&value.items.length<=50&&value.items.every((x:{text:string;readings:string[]})=>typeof x.text==='string'&&Array.isArray(x.readings)&&x.readings.every(y=>typeof y==='string')))return value;}catch{/* Confirmation still works in this tab without storage. */}
  return null;
}
type NavigationState = { view:View; screen:Screen; pane:Pane; word:SearchWord|null };
const blankItem = ():DraftItem => ({id:crypto.randomUUID(),text:'',choices:[]});
function initialDraft():{items:DraftItem[];requestId:string}{
  try {
    const value=JSON.parse(sessionStorage.getItem('rhyme-draft-v2')||'null');
    if(value&&typeof value.requestId==='string'&&Array.isArray(value.items)&&value.items.length>=2&&value.items.length<=50&&value.items.every((x:DraftItem)=>typeof x.id==='string'&&typeof x.text==='string'&&Array.isArray(x.choices)&&x.choices.every(y=>typeof y==='string')))return value;
  } catch { /* A stored draft is optional. */ }
  return {items:[blankItem(),blankItem()],requestId:crypto.randomUUID()};
}
type Pronunciation = (text:string,choices?:string[])=>Syllable[];
function resolveItem(item:DraftItem,pronunciation?:Pronunciation){
  try {
    if(!normalize(item.text))return {data:[] as Syllable[],error:''};
    validateText(item.text);
    return {data:pronunciation?pronunciation(item.text,item.choices):[] as Syllable[],error:''};
  } catch(e){return {data:[] as Syllable[],error:(e as Error).message};}
}
function Readings({data,onChange,disabled=false,labelPrefix=''}:{data:Syllable[];onChange?:(i:number,value:string)=>void;disabled?:boolean;labelPrefix?:string}){
  return <div className="sc-syllables">{data.map((s,i)=><div className="sc-syllable" key={i}><span className="sc-char">{s.char}</span>{s.options.length>1&&onChange?<select disabled={disabled} aria-label={`${labelPrefix}${s.char}的读音，第${i+1}字`} value={s.pinyin} onChange={e=>onChange(i,e.target.value)}>{s.options.map(p=><option key={p} value={p}>{markedPinyin(p)}{isSpoken(s.char,p)?' · 口语':''}</option>)}</select>:<span className="sc-pinyin">{markedPinyin(s.pinyin)}</span>}{isSpoken(s.char,s.pinyin)&&<span className="sc-spoken-tag">口语</span>}<span className="sc-sound">{s.final} <span className="sc-tone">{s.tone||'轻'}</span></span></div>)}</div>;
}
function WordReadings({data,onChange,disabled,labelPrefix}:{data:Syllable[];onChange:(i:number,value:string)=>void;disabled:boolean;labelPrefix:string}){
  const [open,setOpen]=useState(false);
  return <details className="sc-word-readings" onToggle={event=>setOpen(event.currentTarget.open)}><summary><span className="sc-reading-title">读音</span><span className="sc-reading-preview">{data.slice(0,8).map(syllable=>markedPinyin(syllable.pinyin)).join(' ')}{data.length>8?` … · 共 ${data.length} 字`:''}</span><span className="sc-reading-toggle">{data.some(syllable=>syllable.options.length>1)?'调整':'查看'}<ChevronRight size={13}/></span></summary>{open&&<Readings data={data} disabled={disabled} labelPrefix={labelPrefix} onChange={onChange}/>}</details>;
}
function RecordedDetails({pair}:{pair:RhymePair}){
  const [open,setOpen]=useState(false);
  return <details className="sc-record-details" onToggle={event=>setOpen(event.currentTarget.open)}><summary>查看逐字对照</summary>{open&&<Alignment result={pair.comparison} readOnly/>}</details>;
}
// Offered when switching one character to its common spoken reading makes the pair pass.
function SpokenFixes({fixes,onFix,disabled}:{fixes:SpokenFix[];onFix:(fix:SpokenFix)=>void;disabled:boolean}){
  return <div className="sc-spoken-fix"><p>按口语读音就能押上：</p><div>{fixes.map(fix=><button key={`${fix.side}:${fix.position}:${fix.reading}`} type="button" disabled={disabled} onClick={()=>onFix(fix)}>「{fix.char}」读 <strong>{markedPinyin(fix.reading)}</strong></button>)}</div></div>;
}
function PairPreviewCard({pair,items,onEdit,disabled,fixes,onFix}:{pair:PreviewPair;items:DraftItem[];onEdit:(id:string)=>void;disabled:boolean;fixes:SpokenFix[];onFix:(fix:SpokenFix)=>void}){
  const [open,setOpen]=useState(false);
  return <div className={`sc-preview-pair-wrap ${!pair.comparison.valid||pair.duplicate?'sc-preview-invalid':''}`}><details className="sc-preview-pair" onToggle={e=>setOpen(e.currentTarget.open)}>
    <summary><span className="sc-pair-title">{items[pair.leftIndex].text} <span>↔</span> {items[pair.rightIndex].text}</span><span className={`sc-badge sc-badge-${pair.comparison.same?'invalid':pair.duplicate?'group':pair.comparison.kind}`}>{pair.comparison.same?'重复词语':pair.duplicate?(pair.duplicate.status==='withdrawn'?'已撤回':'已收录'):kindLabels[pair.comparison.kind]}</span><strong className="sc-pair-score">{pair.duplicate||!pair.comparison.valid?'不可提交':`+${pair.comparison.points} 分`}</strong></summary>
    {open&&<><p className="sc-help">比较双方末尾 {pair.comparison.n} 字，每字至少押上一项。</p>{pair.duplicate&&<p className="sc-error">{pair.duplicate.author} 已最先提交这组押韵 · {date(pair.duplicate.created_at)}。本次全部词语暂不收录。</p>}{pair.duplicate&&<p className="sc-help">下方展示已收录时的读音和对照，不产生新积分。</p>}<Alignment result={pair.duplicate?.comparison||pair.comparison} readOnly={!!pair.duplicate}/><div className="sc-pair-edit">{[pair.leftIndex,pair.rightIndex].map(index=><button key={index} type="button" className="sc-link" disabled={disabled} aria-label={`修改词语 ${index+1}：${items[index].text}`} onClick={()=>onEdit(items[index].id)}><PenLine size={14}/>修改词语 {String(index+1).padStart(2,'0')}</button>)}</div></>}
  </details>{!pair.duplicate&&fixes.length>0&&<SpokenFixes fixes={fixes} onFix={onFix} disabled={disabled}/>}</div>;
}
function App(){
  const [user,setUser]=useState<User|null>(null),[ready,setReady]=useState(false),[notice,setNotice]=useState('');
  const [view,setView]=useState<View>(location.pathname==='/admin'?'admin':'library'),[screen,setScreen]=useState<Screen>(()=>initialSubmission()||(history.state?.rhymeNavigation?.view==='library'&&history.state?.rhymeNavigation?.screen==='compose')?'compose':'library'),[pane,setPane]=useState<Pane>('write');
  const [search,setSearch]=useState<RhymeSearch|null>(null),[hot,setHot]=useState<HotWord[]|null>(null),[query,setQuery]=useState(''),[appliedQuery,setAppliedQuery]=useState(''),[searchComposition,setSearchComposition]=useState(0);
  const [lookupWord,setLookupWord]=useState<SearchWord|null>(null),[rhymes,setRhymes]=useState<RhymingWord[]>([]),[rhymePage,setRhymePage]=useState(0),[rhymeMore,setRhymeMore]=useState(false),[rhymeLoading,setRhymeLoading]=useState(false),[rhymeError,setRhymeError]=useState('');
  const [wordLoading,setWordLoading]=useState(false),[wordError,setWordError]=useState('');
  const [auth,setAuth]=useState<'login'|'register'|'setup'|null>(location.pathname==='/setup'?'setup':null),[username,setUsername]=useState(''),[password,setPassword]=useState(''),[authError,setAuthError]=useState(''),[busy,setBusy]=useState(false);
  const [draft,setDraft]=useState(initialDraft),[submitError,setSubmitError]=useState(''),[preview,setPreview]=useState<Preview|null>(null),[previewError,setPreviewError]=useState(''),[previewBusy,setPreviewBusy]=useState(false),[previewRevision,setPreviewRevision]=useState(0);
  const [records,setRecords]=useState<Records|null>(null),[recordPage,setRecordPage]=useState(0),[recordLoading,setRecordLoading]=useState(false),[recordError,setRecordError]=useState(''),[recordTab,setRecordTab]=useState<'pairs'|'scoreEntries'>('pairs');
  const [recordRevision,setRecordRevision]=useState(0);
  const [unconfirmed,setUnconfirmed]=useState(initialSubmission),[recoveryMissing,setRecoveryMissing]=useState(false);
  const [previewFilter,setPreviewFilter]=useState<'all'|'issues'>('issues'),[focusWordId,setFocusWordId]=useState<string|null>(null),[passwordVisible,setPasswordVisible]=useState(false);
  const [dictionary,setDictionary]=useState<{pronunciation:Pronunciation}|null>(null),[dictionaryLoading,setDictionaryLoading]=useState(false),[dictionaryError,setDictionaryError]=useState('');
  const [composingWordId,setComposingWordId]=useState<string|null>(null),[previewLimit,setPreviewLimit]=useState(40);
  const submissionFlight=useRef(false),unconfirmedRef=useRef(unconfirmed);unconfirmedRef.current=unconfirmed;
  const opener=useRef<HTMLElement|null>(null),busyRef=useRef(false),userRequest=useRef(0),recoveryChecked=useRef('');busyRef.current=busy;
  const wordAttempt=useRef({q:''}),searchComposing=useRef(false),recordedSearches=useRef(new Set<string>()),recordAttempt=useRef(0);
  const wordRequest=useRef(0),rhymeRequest=useRef(0),recordRequest=useRef(0),previewRequest=useRef(0),pendingSubmit=useRef<'submit'|'recover'|null>(null),draftRef=useRef(draft);
  const viewRef=useRef(view),userRef=useRef(user);viewRef.current=view;userRef.current=user;
  draftRef.current=draft;
  const workloadError=useMemo(()=>{try{validatePairWorkload(draft.items.map(x=>x.text));return '';}catch(e){return (e as Error).message;}},[draft.items]);
  const resolved=useMemo(()=>draft.items.map(item=>workloadError?{data:[] as Syllable[],error:''}:resolveItem(item,dictionary?.pronunciation)),[draft.items,workloadError,dictionary]);
  const localPreview=useMemo(()=>{
    const pairs:PreviewPair[]=[];
    for(let i=0;i<resolved.length;i++)for(let j=i+1;j<resolved.length;j++)if(resolved[i].data.length>=2&&resolved[j].data.length>=2)pairs.push({leftIndex:i,rightIndex:j,comparison:compareMutual(resolved[i].data,resolved[j].data)});
    const complete=resolved.every(x=>x.data.length>=2&&!x.error);
    return {pairs,valid:complete&&pairs.every(x=>x.comparison.valid),pairCount:draft.items.length*(draft.items.length-1)/2,totalPoints:pairs.reduce((total,x)=>total+x.comparison.points,0)};
  },[resolved,draft.items.length]);
  const currentPreview=preview||localPreview;
  const canSubmit=!!dictionary&&!composingWordId&&localPreview.valid&&!previewBusy&&!!preview?.valid&&!previewError;
  const inputProblems=resolved.flatMap((value,index)=>value.data.length<2||value.error?[index]:[]);
  const readyForPreview=!!dictionary&&!composingWordId&&!workloadError&&!inputProblems.length&&new Set(draft.items.map(item=>normalize(item.text))).size===draft.items.length;
  const issuePairs=currentPreview.pairs.filter(pair=>!pair.comparison.valid||pair.duplicate);
  const missingPairs=currentPreview.pairCount-currentPreview.pairs.length;
  const issueCount=issuePairs.length+missingPairs;
  const showIssues=previewFilter==='issues'&&issueCount>0;
  const visiblePairs=showIssues?issuePairs:currentPreview.pairs;
  const recordTabs:typeof recordTab[] = ['pairs','scoreEntries'];

  async function refreshUser(){const request=++userRequest.current;const data=await api<{user:User|null}>('/me');if(request===userRequest.current)setUser(data.user);return data.user;}
  function openAuth(mode:'login'|'register'|'setup'='login'){if(!auth)opener.current=document.activeElement as HTMLElement|null;setAuthError('');setAuth(mode);}
  function sessionExpired(intent:'submit'|'recover'|null=null){userRequest.current++;recordRequest.current++;setUser(null);setRecords(null);pendingSubmit.current=intent;openAuth();setAuthError('登录已过期，请重新登录。内容和读音已保留。');}
  async function loadWords(q=query){
    if(q!==appliedQuery){setSearch(null);setAppliedQuery(q);}
    wordAttempt.current={q};const request=++wordRequest.current;setWordError('');
    if(!normalize(q)){setWordLoading(false);return true;}
    setWordLoading(true);
    try{const data=await api<{search:RhymeSearch}>(`/library/search?q=${encodeURIComponent(q)}`);if(request!==wordRequest.current)return false;setSearch(data.search);setAppliedQuery(q);return true;}
    catch(e){if(request===wordRequest.current)setWordError((e as Error).message);return false;}
    finally{if(request===wordRequest.current)setWordLoading(false);}
  }
  function recordSearch(q:string){
    const key=hotSearchKey(q);if(!key||recordedSearches.current.has(key))return;
    recordedSearches.current.add(key);api('/search/hits',{q:key}).catch(()=>recordedSearches.current.delete(key));
  }
  async function commitSearch(q:string){setQuery(q);if(await loadWords(q))recordSearch(q);}
  async function selectWord(word:SearchWord,p=0){
    const request=++rhymeRequest.current;setRhymeLoading(true);setRhymeError('');
    if(!p){setLookupWord(word);setRhymes([]);setRhymePage(0);setRhymeMore(false);setView('library');setScreen('lookup');setNotice('');}
    try{const data=await api<{word:Word;items:RhymingWord[];hasMore:boolean}>(`/words/${word.id}/rhymes?page=${p}`);if(request!==rhymeRequest.current)return;setLookupWord(data.word);setRhymes(previous=>p?[...previous,...data.items]:data.items);setRhymePage(p);setRhymeMore(data.hasMore);}
    catch(e){if(request===rhymeRequest.current)setRhymeError((e as Error).message);}
    finally{if(request===rhymeRequest.current)setRhymeLoading(false);}
  }
  async function loadRecords(which:View,p=0){
    const accountId=userRef.current?.id;
    if(which!=='mine'||which!==viewRef.current||!accountId)return false;
    recordAttempt.current=p;const request=++recordRequest.current;setRecordLoading(true);setRecordError('');
    const isCurrent=()=>request===recordRequest.current&&which===viewRef.current&&accountId===userRef.current?.id;
    try{const data=await api<Records>(`/profile?page=${p}`);if(!isCurrent())return false;setRecords(previous=>p&&previous?{...data,pairs:[...previous.pairs,...data.pairs],scoreEntries:[...(previous.scoreEntries||[]),...(data.scoreEntries||[])]}:data);setRecordPage(p);return true;}
    catch(e){if(isCurrent()){if(e instanceof ApiError&&e.status===401)sessionExpired();else setRecordError((e as Error).message);}return false;}
    finally{if(request===recordRequest.current)setRecordLoading(false);}
  }
  async function refreshActiveRecords(){const current=viewRef.current;return current==='library'||!userRef.current?true:loadRecords(current);}
  useEffect(()=>{refreshUser().catch(e=>setNotice(e.message)).finally(()=>setReady(true));api<{items:HotWord[]}>('/search/hot').then(data=>setHot(data.items)).catch(()=>setHot([]));},[]);
  useEffect(()=>{if(searchComposing.current||query===wordAttempt.current.q)return;const timer=setTimeout(()=>loadWords(query),320);return()=>clearTimeout(timer);},[query,searchComposition]);
  // A live result only counts as a search once the user has paused on it.
  useEffect(()=>{if(!search?.query||search.error)return;const settled=appliedQuery;const timer=setTimeout(()=>recordSearch(settled),1500);return()=>clearTimeout(timer);},[search]);
  useEffect(()=>{
    recordRequest.current++;setRecords(null);setRecordPage(0);setRecordError('');setRecordLoading(false);
    if(ready&&user&&view==='mine')loadRecords(view);
    return()=>{recordRequest.current++;};
  },[ready,user?.id,user?.role,view,recordRevision]);
  useEffect(()=>{
    if(dictionary||view!=='library'||screen!=='compose')return;
    let active=true;setDictionaryLoading(true);setDictionaryError('');
    import('../shared/pronunciation').then(module=>{if(active)setDictionary(module);}).catch(()=>{if(active)setDictionaryError('读音工具暂时无法加载，词语和已选读音已保留。');}).finally(()=>{if(active)setDictionaryLoading(false);});
    return()=>{active=false;};
  },[dictionary,view,screen]);
  useEffect(()=>{setPreviewLimit(40);},[draft.requestId,showIssues]);
  useEffect(()=>{try{sessionStorage.setItem('rhyme-draft-v2',JSON.stringify(draft));}catch { /* Editing still works without session storage. */ }},[draft]);
  useEffect(()=>{
    const request=++previewRequest.current;setPreview(null);setPreviewError('');
    if(!readyForPreview){setPreviewBusy(false);return;}
    setPreviewBusy(true);
    const timer=setTimeout(()=>{
      api<Preview>('/rhymes/preview',{items:draft.items.map((item,i)=>({text:item.text,readings:resolved[i].data.map(s=>s.pinyin)}))})
        .then(data=>{if(request===previewRequest.current)setPreview(data);})
        .catch(e=>{if(request===previewRequest.current)setPreviewError(e.message);})
        .finally(()=>{if(request===previewRequest.current)setPreviewBusy(false);});
    },350);
    return()=>clearTimeout(timer);
  },[draft.requestId,readyForPreview,previewRevision]);
  useEffect(()=>{
    const viewport=window.visualViewport;let restingHeight=viewport?.height||innerHeight,lastWidth=innerWidth,focusFrame=0;
    const update=()=>{const height=viewport?.height||innerHeight;if(innerWidth!==lastWidth){restingHeight=height;lastWidth=innerWidth;}else restingHeight=Math.max(restingHeight,height);document.documentElement.style.setProperty('--sc-app-height',`${height}px`);const typing=document.activeElement?.matches('input,textarea,select');document.documentElement.dataset.scKeyboard=String(matchMedia('(max-width:760px)').matches&&height<restingHeight-120&&(!!typing||document.documentElement.dataset.scKeyboard==='true'));cancelAnimationFrame(focusFrame);focusFrame=requestAnimationFrame(()=>{const field=document.activeElement;if(field?.matches('input,textarea,select'))field.scrollIntoView({block:'nearest',inline:'nearest'});});};
    update();viewport?.addEventListener('resize',update);window.addEventListener('resize',update);document.addEventListener('focusin',update);document.addEventListener('focusout',update);
    return()=>{cancelAnimationFrame(focusFrame);viewport?.removeEventListener('resize',update);window.removeEventListener('resize',update);document.removeEventListener('focusin',update);document.removeEventListener('focusout',update);};
  },[]);
  useEffect(()=>{
    if(location.pathname==='/setup')return;
    const nav:NavigationState={view,screen,pane,word:lookupWord};
    const key=(n:NavigationState)=>JSON.stringify([n.view,n.screen,n.pane,n.word?.id]);
    const previous=history.state?.rhymeNavigation as NavigationState|undefined;
    const url=view==='admin'?'/admin':'/';
    if(!previous)history.replaceState({rhymeNavigation:nav},'',url);else if(key(previous)!==key(nav))history.pushState({rhymeNavigation:nav},'',url);
  },[view,screen,pane,lookupWord?.id]);
  useEffect(()=>{
    const back=(e:PopStateEvent)=>{
      const nav=e.state?.rhymeNavigation as NavigationState|undefined;if(!nav)return;
      const nextView=nav.view==='admin'&&user&&user.role!=='admin'?'mine':nav.view;
      if(nextView!==nav.view)history.replaceState({...history.state,rhymeNavigation:{...nav,view:nextView}},'');
      setAuth(null);pendingSubmit.current=null;setView(nextView);setScreen(nav.screen);setPane(nav.pane);setLookupWord(nav.word);setNotice('');
      rhymeRequest.current++;recordRequest.current++;setRhymeLoading(false);setRhymeError('');setRecordTab('pairs');setRecords(null);setRecordError('');
      if(nextView==='library'&&nav.screen==='lookup'&&nav.word)selectWord(nav.word);
      if(nextView!=='library')setRecordRevision(revision=>revision+1);
    };
    window.addEventListener('popstate',back);return()=>window.removeEventListener('popstate',back);
  },[user]);
  useEffect(()=>{if(auth){setPassword('');setPasswordVisible(false);}},[auth]);
  useEffect(()=>{if(focusWordId&&pane==='write'&&screen==='compose'){const field=document.getElementById(`word-${focusWordId}`);if(field){field.focus();field.scrollIntoView({block:'nearest',inline:'nearest'});setFocusWordId(null);}}},[focusWordId,pane,screen,draft.items]);
  useEffect(()=>{if(ready&&view==='admin'&&user&&user.role!=='admin')navigate('mine');},[ready,user?.role,view]);
  useEffect(()=>{if(submitError||previewError)document.getElementById(`compose-${pane}`)?.scrollTo({top:0});},[submitError,previewError,pane,screen,view]);
  const dialogOpen=!!auth;
  useEffect(()=>{
    if(!dialogOpen)return;
    const handler=(e:KeyboardEvent)=>{const dialog=document.querySelector<HTMLElement>('[role="dialog"]');if(!dialog)return;if(e.key==='Escape'&&!busyRef.current){e.preventDefault();setAuth(null);pendingSubmit.current=null;return;}if(e.key==='Tab'){const focusable=[...dialog.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),a[href]')];const first=focusable[0],last=focusable.at(-1);if(!dialog.contains(document.activeElement)){e.preventDefault();first?.focus();}else if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}}};
    document.addEventListener('keydown',handler);return()=>{document.removeEventListener('keydown',handler);if(opener.current?.isConnected&&!opener.current.matches(':disabled'))opener.current.focus();else document.querySelector<HTMLElement>('#compose-tab-write,.sc-brand')?.focus();};
  },[dialogOpen]);
  function editDraft(update:(items:DraftItem[])=>DraftItem[]){setDraft(previous=>({items:update(previous.items),requestId:crypto.randomUUID()}));setSubmitError('');setPreview(null);setPreviewError('');setPreviewFilter('issues');previewRequest.current++;}
  function changeText(id:string,text:string){if(draftRef.current.items.find(item=>item.id===id)?.text===text)return;editDraft(items=>items.map(item=>item.id===id?{...item,text,choices:normalize(text)===normalize(item.text)?item.choices:[]}:item));}
  function reloadDictionary(){
    try{
      const saved=JSON.stringify(draftRef.current);sessionStorage.setItem('rhyme-draft-v2',saved);if(sessionStorage.getItem('rhyme-draft-v2')!==saved)throw new Error();
      if(unconfirmedRef.current){const pending=JSON.stringify(unconfirmedRef.current);sessionStorage.setItem('rhyme-unconfirmed-v1',pending);if(sessionStorage.getItem('rhyme-unconfirmed-v1')!==pending)throw new Error();}
    }catch{setDictionaryError('浏览器暂时无法保存草稿。请先复制词语和读音，再刷新页面；当前输入仍保留在本页。');return;}
    location.reload();
  }
  function focusWord(id:string){setPane('write');setFocusWordId(id);}
  function addWord(){const item=blankItem();editDraft(items=>[...items,item]);setFocusWordId(item.id);}
  function removeWord(id:string){const index=draft.items.findIndex(item=>item.id===id);const next=draft.items[index+1]||draft.items[index-1];editDraft(items=>items.filter(item=>item.id!==id));if(next)setFocusWordId(next.id);}
  function changeChoice(id:string,index:number,value:string){editDraft(items=>items.map(item=>{if(item.id!==id)return item;const choices=resolveItem(item,dictionary?.pronunciation).data.map(x=>x.pinyin);choices[index]=value;return {...item,choices};}));}
  function showLibrary(){rhymeRequest.current++;recordRequest.current++;setRhymeLoading(false);setView('library');setScreen('library');setNotice('');}
  function openComposer(word?:SearchWord){
    rhymeRequest.current++;recordRequest.current++;setRhymeLoading(false);setView('library');setScreen('compose');setPane('write');setNotice('');
    if(word&&!draft.items.some(item=>normalize(item.text)===word.normalized))editDraft(items=>{const empty=items.findIndex(item=>!normalize(item.text));if(empty!==-1)return items.map((item,i)=>i===empty?{...item,text:word.text,choices:[]}:item);return items.length<50?[...items,{...blankItem(),text:word.text}]:items;});
  }
  function navigate(next:View){if(next==='library'){showLibrary();return;}rhymeRequest.current++;setRhymeLoading(false);setNotice('');setView(next);setRecordTab('pairs');}
  async function logout(){try{await api('/auth/logout',{});userRequest.current++;setUser(null);setRecords(null);showLibrary();}catch(e){setNotice((e as Error).message);}}
  function rememberSubmission(value:UnconfirmedSubmission|null){
    unconfirmedRef.current=value;recoveryChecked.current=value?.requestId||'';setUnconfirmed(value);setRecoveryMissing(false);
    try{if(value)sessionStorage.setItem('rhyme-unconfirmed-v1',JSON.stringify(value));else sessionStorage.removeItem('rhyme-unconfirmed-v1');}catch{/* The current tab retains the unconfirmed request. */}
  }
  async function finishSubmission(saved:UnconfirmedSubmission,data:SubmissionResult){
    if(unconfirmedRef.current?.requestId===saved.requestId&&unconfirmedRef.current.userId===saved.userId)rememberSubmission(null);setSubmitError('');
    if(draftRef.current.requestId===saved.requestId){setDraft({items:[blankItem(),blankItem()],requestId:crypto.randomUUID()});setPreview(null);setPane('write');}
    if(!data.replayed)setUser(previous=>previous?.id===saved.userId?{...previous,score:previous.score+data.points}:previous);
    const message=`已收录 ${data.pairs.length} 对原创押韵，+${data.points} 分${data.replayed?'；已确认原提交，没有重复加分':''}。`;
    setNotice(message);
    const updates=await Promise.allSettled([refreshUser(),loadWords(wordAttempt.current.q),refreshActiveRecords()]);
    if(updates.some(result=>result.status==='rejected'||result.value===false))setNotice(message+' 记录已保存，显示暂未刷新；可在“我的”查看。');
  }
  async function performSubmit(currentUser:User|null=user,saved?:UnconfirmedSubmission,fromRecovery=false){
    if(submissionFlight.current&&!fromRecovery)return;
    if(!saved&&!canSubmit){setSubmitError('请等待词语和读音核验完成后再收录。');return;}
    if(!currentUser){pendingSubmit.current=saved?'recover':'submit';openAuth();return;}
    const current=draftRef.current;
    const submission=saved||{userId:currentUser.id,username:currentUser.username,requestId:current.requestId,items:current.items.map(item=>({text:item.text,readings:resolveItem(item,dictionary?.pronunciation).data.map(s=>s.pinyin)}))};
    if(submission.userId!==currentUser.id){setSubmitError(`请登录 ${submission.username}，确认上次提交结果。`);return;}
    submissionFlight.current=true;rememberSubmission(submission);setBusy(true);setSubmitError('');
    try{const data=await api<SubmissionResult>('/rhymes',{requestId:submission.requestId,items:submission.items});await finishSubmission(submission,data);}
    catch(e){
      if(e instanceof ApiError&&e.status===401){sessionExpired('recover');return;}
      if(e instanceof ApiError&&e.status>=400&&e.status<500&&e.status!==408){rememberSubmission(null);setSubmitError(e.message);const data=e.data;if(data&&typeof data==='object'&&'preview' in data&&data.preview&&draftRef.current.requestId===submission.requestId){setPreview(data.preview as Preview);setPane('compare');}}
      else setSubmitError('提交结果暂未确认，内容与读音已保留。请确认上次提交结果。');
    }finally{submissionFlight.current=false;setBusy(false);}
  }
  async function recoverSubmission(currentUser:User|null=user,retryIfMissing=false){
    if(!unconfirmed||submissionFlight.current)return;
    if(!currentUser){pendingSubmit.current='recover';openAuth();return;}
    if(currentUser.id!==unconfirmed.userId){setSubmitError(`请登录 ${unconfirmed.username}，确认上次提交结果。`);return;}
    submissionFlight.current=true;setBusy(true);setSubmitError('');
    try{const data=await api<({found:true}&SubmissionResult)|{found:false}>(`/rhymes/requests/${encodeURIComponent(unconfirmed.requestId)}`);if(data.found)await finishSubmission(unconfirmed,data);else if(retryIfMissing)await performSubmit(currentUser,unconfirmed,true);else{setRecoveryMissing(true);setSubmitError('服务器尚未收录上次提交，可以安全重试。');}}
    catch(e){if(e instanceof ApiError&&e.status===401)sessionExpired('recover');else setSubmitError('暂时无法确认结果，请稍后再试。草稿仍然保留。');}
    finally{submissionFlight.current=false;setBusy(false);}
  }
  useEffect(()=>{if(ready&&user&&unconfirmed&&user.id===unconfirmed.userId&&recoveryChecked.current!==unconfirmed.requestId){recoveryChecked.current=unconfirmed.requestId;recoverSubmission(user);}},[ready,user?.id]);
  async function submitDraft(e:React.FormEvent){e.preventDefault();if(unconfirmed){if(recoveryMissing&&user?.id===unconfirmed.userId)await performSubmit(user,unconfirmed);else await recoverSubmission();return;}if(!canSubmit){setPane('compare');return;}if(!user){pendingSubmit.current='submit';openAuth();return;}await performSubmit();}
  async function authenticate(e:React.FormEvent){
    e.preventDefault();setBusy(true);setAuthError('');
    try{const token=decodeURIComponent(location.hash.slice(1));await api(auth==='setup'?'/setup':`/auth/${auth}`,{username,password,...(auth==='setup'?{token}:{})});if(auth==='setup')history.replaceState(null,'','/');const signedIn=await refreshUser();const intent=pendingSubmit.current;pendingSubmit.current=null;setAuth(null);setPassword('');if(intent==='recover')await recoverSubmission(signedIn,true);else if(intent==='submit')await performSubmit(signedIn);}
    catch(e){setAuthError((e as Error).message);}finally{setBusy(false);}
  }
  function choosePane(next:Pane){setPane(next);}
  function pairFixes(pair:PreviewPair){
    const left=resolved[pair.leftIndex]?.data,right=resolved[pair.rightIndex]?.data;
    return pair.comparison.valid||pair.comparison.same||!left?.length||!right?.length?[]:spokenFixes(left,right);
  }

  const submissionFeedback=(unconfirmed||submitError||previewError)&&<div className="sc-submission-feedback">
    {unconfirmed&&<p className="sc-recovery-note">待确认：{unconfirmed.items.slice(0,2).map(x=>x.text).join(' ↔ ')}{unconfirmed.items.length>2?` 等 ${unconfirmed.items.length} 个词`:''}。{unconfirmed.requestId!==draft.requestId?'当前新草稿会保留。':''}</p>}
    {(submitError||previewError)&&<p className="sc-error" role="alert">{submitError||previewError}{previewError&&<button type="button" className="sc-link sc-preview-retry" onClick={()=>setPreviewRevision(value=>value+1)}>重新核验</button>}</p>}
  </div>;
  const dictionaryFeedback=!dictionary&&<div className="sc-inline-state" role={dictionaryError?'alert':'status'}><p>{dictionaryError||'正在准备读音，词语可继续填写。'}</p>{dictionaryError&&<button type="button" className="sc-link" onClick={reloadDictionary}>重新加载读音</button>}</div>;
  const composer=<form className="sc-rhyme-form" onSubmit={submitDraft}>
    <div className="sc-compose-heading"><div><span className="sc-eyebrow">RHYME LAB / 说唱押韵共创</span><h2>我来想一个押韵</h2></div><button type="button" className="sc-link" onClick={showLibrary}><ArrowLeft size={14}/>词库</button></div>
    <p className="sc-compose-intro">写下互相押韵的词，全部两两通过后一起收录。</p>
    <div className="sc-compose-tabs" role="tablist" aria-label="投稿界面">{(['write','compare'] as Pane[]).map(p=><button type="button" role="tab" id={`compose-tab-${p}`} aria-controls={`compose-${p}`} aria-selected={pane===p} tabIndex={pane===p?0:-1} key={p} onClick={()=>choosePane(p)} onKeyDown={e=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){e.preventDefault();const next=e.key==='Home'?'write':e.key==='End'?'compare':p==='write'?'compare':'write';choosePane(next);document.getElementById(`compose-tab-${next}`)?.focus();}}}>{p==='write'?'填写词语':`逐对核验 · ${localPreview.pairCount}`}</button>)}</div>
    <div id="compose-write" role="tabpanel" aria-labelledby="compose-tab-write" className="sc-compose-pane sc-word-fields" hidden={pane!=='write'}>
      {submissionFeedback}
      {dictionaryFeedback}
      {workloadError&&<p className="sc-error" role="alert">{workloadError}</p>}
      <p className="sc-help sc-word-help">至少 2 个，最多 50 个词；每词至少两个汉字。字数不同，比较双方末尾较短的一段。</p>
      {draft.items.map((item,i)=><article className="sc-draft-word" key={item.id}><div className="sc-draft-word-heading"><label className="sc-label" htmlFor={`word-${item.id}`}><span className="sc-word-number" aria-hidden="true">{String(i+1).padStart(2,'0')}</span><span>词语 {i+1}</span></label>{draft.items.length>2&&<button className="sc-icon-btn sc-danger" type="button" aria-label={`删除词语 ${i+1}`} disabled={busy} onClick={()=>removeWord(item.id)}><Trash2 size={17}/></button>}</div><WordInput id={`word-${item.id}`} active={pane==='write'} disabled={busy} placeholder={i===0?'写下第一个词':'写下与其他词都押韵的词'} value={item.text} onChange={text=>changeText(item.id,text)} onComposing={active=>setComposingWordId(active?item.id:null)}/>{resolved[i].error&&<p className="sc-error" role="alert">{resolved[i].error}</p>}{resolved[i].data.length>0&&<WordReadings data={resolved[i].data} disabled={busy||!!composingWordId} labelPrefix={`词语 ${i+1}，`} onChange={(index,value)=>changeChoice(item.id,index,value)}/>}</article>)}
      <button className="sc-add-word" type="button" disabled={draft.items.length>=50||busy} onClick={addWord}><Plus size={17}/>{draft.items.length>=50?'已达到 50 个词':'继续添加一个词'}</button>
    </div>
    {pane==='compare'&&currentPreview.pairs.length>0&&<div className="sc-preview-filter" role="group" aria-label="核验筛选"><button type="button" aria-pressed={!showIssues} onClick={()=>setPreviewFilter('all')}>全部 {currentPreview.pairCount} 对</button><button type="button" aria-pressed={showIssues} disabled={!issueCount} onClick={()=>setPreviewFilter('issues')}>需调整 {issueCount} 对</button><span>{unconfirmed?'上次提交待确认':previewBusy?'正在核验…':previewError||!preview?'查重未完成':!issueCount?'全部可收录':`${currentPreview.pairs.length-issuePairs.length} 对可收录`}</span></div>}
    <div id="compose-compare" role="tabpanel" aria-labelledby="compose-tab-compare" className="sc-compose-pane sc-preview-results" hidden={pane!=='compare'}>
      {submissionFeedback}
      {dictionaryFeedback}
      <p className="sc-help">每一对都需要通过。点击关系，查看逐字对照。</p>
      {inputProblems.length>0&&currentPreview.pairs.length>0&&<div className="sc-input-problems"><p>还有 {inputProblems.length} 个词未填写完整；相关词对暂未核验。</p>{inputProblems.map(index=><button type="button" className="sc-link" key={draft.items[index].id} onClick={()=>focusWord(draft.items[index].id)}>填写词语 {String(index+1).padStart(2,'0')}<ChevronRight size={13}/></button>)}</div>}{pane==='compare'&&(currentPreview.pairs.length?<>{visiblePairs.slice(0,previewLimit).map(pair=><PairPreviewCard key={`${draft.items[pair.leftIndex].id}:${draft.items[pair.rightIndex].id}`} pair={pair} items={draft.items} onEdit={focusWord} disabled={busy||!!unconfirmed} fixes={pairFixes(pair)} onFix={fix=>changeChoice(draft.items[fix.side==='left'?pair.leftIndex:pair.rightIndex].id,fix.position,fix.reading)}/>)}{visiblePairs.length>previewLimit&&<button type="button" className="sc-load-more" onClick={()=>setPreviewLimit(limit=>limit+40)}>再看 {Math.min(40,visiblePairs.length-previewLimit)} 对 · 已显示 {previewLimit}/{visiblePairs.length}</button>}</>:<div className="sc-empty"><Disc3 size={30} strokeWidth={1.5} aria-hidden="true"/><p>先填写至少两个词，<br/>再来核验它们的押韵。</p><button type="button" className="sc-link" onClick={()=>setPane('write')}>去填写词语<ChevronRight size={14}/></button></div>)}
      {workloadError&&<p className="sc-error" role="alert">{workloadError}</p>}
      {!localPreview.valid&&currentPreview.pairs.length>0&&<p className="sc-error">{inputProblems.length?'还有词语未填写完整':`${localPreview.pairs.filter(pair=>!pair.comparison.valid).length} 对还没有押上`}，本次全部词语暂不收录。</p>}
      {preview&&currentPreview.pairs.some(x=>x.duplicate)&&<p className="sc-error">包含已收录或已撤回的关系，请修改词语。本次不会部分保存。</p>}
    </div>
    <div className="sc-composer-action"><div className="sc-preview-summary" aria-live="polite"><span>{draft.items.length} 个词 · {currentPreview.pairCount} 对关系</span><strong>{unconfirmed?'先确认上次提交':dictionaryError?'读音暂未加载':!dictionary||dictionaryLoading?'正在准备读音…':composingWordId?'输入完成后核验':previewBusy?'正在核验…':previewError?'核验暂未完成':inputProblems.length?`还需填写 ${inputProblems.length} 个词`:issueCount?`${issueCount} 对待调整`:canSubmit?`合计 +${currentPreview.totalPoints} 分`:'等待核验'}</strong>{pane==='write'&&<button type="button" className="sc-link" onClick={()=>setPane('compare')}>查看核验<ChevronRight size={14}/></button>}</div><button className="sc-btn" type="submit" disabled={busy||(!unconfirmed&&!canSubmit)}>{busy?<LoaderCircle size={17} className="sc-spin"/>:<PenLine size={17}/>} {busy?(unconfirmed?'正在确认…':'正在收录…'):unconfirmed?(recoveryMissing?'重试上次提交':'确认上次提交结果'):user?'收录这份押韵':'登录后收录'}</button></div>
  </form>;

  return <div className="sc-app" data-mobile-screen={screen} data-view={view}>
    <header className="sc-header" inert={dialogOpen}><div className="sc-shell sc-header-inner"><a className="sc-brand" href="/" onClick={e=>{e.preventDefault();showLibrary();}}><span className="sc-brand-mark" aria-hidden="true">韵</span><span className="sc-wordmark">softcloud<span className="sc-dot">.</span></span><span className="sc-eq" aria-hidden="true"><i/><i/><i/><i/></span><span className="sc-product-name">押韵共创</span></a><nav aria-label="主导航"><button className={view==='library'&&screen!=='compose'?'sc-nav-active':''} aria-current={view==='library'&&screen!=='compose'?'page':undefined} onClick={showLibrary}><Music2 size={16}/>词库</button><button className={view==='library'&&screen==='compose'?'sc-nav-active':''} aria-current={view==='library'&&screen==='compose'?'page':undefined} onClick={()=>openComposer()}><PenLine size={16}/>想押韵</button><button className={view==='mine'?'sc-nav-active':''} aria-current={view==='mine'?'page':undefined} onClick={()=>navigate('mine')}><UserRound size={16}/>我的</button>{user?.role==='admin'&&<button className={view==='admin'?'sc-nav-active':''} aria-current={view==='admin'?'page':undefined} onClick={()=>navigate('admin')}><Shield size={16}/>管理</button>}</nav><div className="sc-account"><ThemeToggle/>{user?<><span className="sc-account-name">{user.username}</span><span className="sc-points">{user.score} 分</span><button className="sc-link" disabled={busy} onClick={logout}>退出</button></>:<button className="sc-btn sc-btn-small" disabled={!ready} onClick={()=>openAuth()}><LogIn size={15}/>登录 / 注册</button>}</div></div></header>
    <main className="sc-shell sc-main" inert={dialogOpen}>{notice&&<div role="status" className="sc-notice"><span>{notice}</span><button aria-label="关闭提示" onClick={()=>setNotice('')}><X size={16}/></button></div>}
    {view==='library'?<><h1 className="sc-screen-reader-only">押韵共创 · {screen==='compose'?'想押韵':screen==='lookup'?'押韵互查':'词库'}</h1>
      <div className="sc-game-grid"><aside className="sc-panel sc-topic-panel sc-finder"><div className="sc-finder-head"><span className="sc-eyebrow">RHYME LAB / 说唱押韵共创</span><span className="sc-sticker" aria-hidden="true">先到<br/>先记</span><h2>输入一个词，<span className="sc-highlight">找出所有押韵</span></h2></div><form className="sc-search" role="search" onSubmit={e=>{e.preventDefault();commitSearch(query);}}><Search size={20}/><input aria-label="搜索押韵词" placeholder="比如：光芒、说唱、自由" value={query} onChange={e=>setQuery(e.target.value)} onCompositionStart={()=>{searchComposing.current=true;}} onCompositionEnd={()=>{searchComposing.current=false;setSearchComposition(value=>value+1);}} enterKeyHint="search"/>{query&&<button type="button" className="sc-search-clear" aria-label="清空搜索" onClick={()=>{setQuery('');loadWords('');document.querySelector<HTMLInputElement>('[aria-label="搜索押韵词"]')?.focus();}}><X size={16}/></button>}<button type="submit" aria-label="搜索">找押韵</button></form><RhymeFinder search={search} query={appliedQuery} hot={hot} loading={wordLoading} error={wordError} selectedId={lookupWord?.id} onWord={selectWord} onCompose={openComposer} onHot={commitSearch} onRetry={()=>loadWords(wordAttempt.current.q)}/></aside>
      <section className="sc-panel sc-play-panel" aria-label={screen==='compose'?'想押韵':'押韵互查'}>{screen==='compose'?composer:screen==='lookup'&&lookupWord?<RhymeGroup word={lookupWord} items={rhymes} loading={rhymeLoading} error={rhymeError} more={rhymeMore} onWord={selectWord} onMore={()=>selectWord(lookupWord,rhymePage+1)} onRetry={()=>selectWord(lookupWord,rhymes.length?rhymePage+1:0)} onCompose={openComposer} onBack={showLibrary} date={date}/>:<div className="sc-start"><div className="sc-start-icon sc-record-icon"><Disc3 size={48} strokeWidth={1.35} aria-hidden="true"/></div><span className="sc-eyebrow">RHYME LAB / 说唱押韵共创</span><span className="sc-sticker" aria-hidden="true">先到<br/>先记</span><h2>选一个词，<span className="sc-highlight">找到整组灵感</span></h2><p>选词互查，或写下你自己的押韵。<br/>每对关系，只记录最先提交者。</p><button className="sc-btn" onClick={()=>openComposer()}><Plus size={18}/>我来想一个押韵</button><div className="sc-rules"><div><span>01</span><strong>韵母押</strong><p>对应韵母属于同韵部<br/>得 N 分</p></div><div><span>02</span><strong>声调押</strong><p>对应声调全部相同<br/>得 N 分</p></div><div><span>03</span><strong>混合押韵</strong><p>逐字押声调或韵母<br/>得 N 分</p></div><div className="sc-gold-rule"><span><Sparkles size={16}/></span><strong>完美押韵</strong><p>韵母 + 声调都押上<br/>得 2N 分</p></div></div><small>N 是两个词中较短的汉字数，比较双方末尾 N 字。</small><div className="sc-ticker" aria-hidden="true"><div>{[0,1].map(round=>['单押','双押','三押','韵母押','声调押','混合押韵','完美押韵'].map(label=><span key={round+label}>{label}</span>))}</div></div></div>}</section></div>
    </>:view==='admin'?(!ready?<section className="sc-panel sc-record-panel"><div className="sc-empty" role="status"><LoaderCircle size={24} className="sc-spin"/><p>正在确认登录状态…</p></div></section>:user?.role==='admin'?<AdminConsole me={user} onSessionExpired={()=>sessionExpired()} onChanged={()=>{refreshUser().catch(()=>{});if(wordAttempt.current.q)loadWords(wordAttempt.current.q);}}/>:<AdminGate onLogin={()=>openAuth()}/>):<><div className="sc-page-heading"><div><div className="sc-eyebrow">{view==='mine'?'灵感档案':'内容与账号'}</div><h1>{view==='mine'?'我的押韵':'共创管理'}<span>.</span></h1><p>{view==='mine'?`你的原创积累，共 ${user?.score||0} 分。`:'撤回后保留首次归属，关联积分自动扣回。'}</p></div></div><section className="sc-panel sc-record-panel">{!ready?<div className="sc-empty" role="status"><LoaderCircle size={24} className="sc-spin"/><p>正在确认登录状态…</p></div>:!user?<div className="sc-profile-gate"><div className="sc-start-icon"><UserRound size={30}/></div><h2>让灵感有个名字</h2><p>登录后，你的押韵与积分<br/>都会留在创作档案里。</p><button className="sc-btn" onClick={()=>openAuth()}>登录 / 注册</button></div>:<><div className="sc-mobile-only sc-profile-summary"><div><strong>{user.username}</strong><span>{user.score} 分 · 我的原创积累</span></div><button className="sc-link" disabled={busy} onClick={logout}>退出登录</button></div><div className="sc-tabs" role="tablist" aria-label={view==='mine'?'我的记录':'管理记录'}>{recordTabs.map(tab=><button key={tab} role="tab" id={`records-tab-${tab}`} aria-controls="records-panel" aria-selected={recordTab===tab} tabIndex={recordTab===tab?0:-1} className={recordTab===tab?'sc-tab-active':''} onClick={()=>setRecordTab(tab)} onKeyDown={e=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){e.preventDefault();const index=recordTabs.indexOf(tab),next=e.key==='Home'?recordTabs[0]:e.key==='End'?recordTabs[recordTabs.length-1]:recordTabs[(index+(e.key==='ArrowRight'?1:recordTabs.length-1))%recordTabs.length];setRecordTab(next);document.getElementById(`records-tab-${next}`)?.focus();}}}>{({pairs:'押韵关系',scoreEntries:'积分来源',users:'账号',logs:'处理记录'})[tab]}</button>)}</div>{recordError&&<div className="sc-inline-state" role="alert"><p>{recordError}</p><button className="sc-link" onClick={()=>loadRecords(view,recordAttempt.current)}>重新读取记录</button></div>}<div className="sc-records" id="records-panel" role="tabpanel" tabIndex={0} aria-labelledby={`records-tab-${recordTab}`} aria-busy={recordLoading}>{recordLoading&&!records?<div className="sc-empty"><LoaderCircle size={24} className="sc-spin"/><p>正在读取记录…</p></div>:!records?null:<>
      {recordTab==='pairs'&&records.pairs.map(pair=><article className="sc-record" key={pair.id}><div><strong>{pair.left.text} ↔ {pair.right.text}</strong><p>{kindLabels[pair.kind]} · {pair.n} 押 · {pair.author} 最先提交</p><small>{date(pair.created_at)} · {pair.status==='withdrawn'?'已撤回':`+${pair.points} 分`}</small><RecordedDetails pair={pair}/></div></article>)}
      {recordTab==='scoreEntries'&&records.scoreEntries?.map(entry=><article className="sc-record" key={entry.id}><div><strong>{entry.left_text} ↔ {entry.right_text}</strong><p>{entry.source==='legacy'?'历史积分':'原创押韵积分'} · {date(entry.created_at)}</p><small>{entry.active?`+${entry.points} 分`:'已撤回 / 不计分'}</small></div></article>)}
      {!records[recordTab]?.length&&<div className="sc-empty"><BookOpen size={27}/><p>{view==='mine'?(recordTab==='pairs'?'还没有收录押韵':'有效的押韵词对，会为你积累积分。'):'这里还没有记录。'}</p>{view==='mine'&&<button type="button" className="sc-btn" onClick={()=>openComposer()}><Plus size={16}/>我来想一个押韵</button>}</div>}
    </>}</div>{records?.hasMore&&<button className="sc-load-more" disabled={recordLoading} onClick={()=>loadRecords(view,recordPage+1)}>加载更多记录</button>}</>}</section></>}
    <footer className="sc-footer"><span>softcloud. / 押韵共创</span><span>亲手写下 · 先到先记 · 每份灵感都有名字</span></footer></main>
    <nav inert={dialogOpen} className="sc-bottom-nav" aria-label="手机导航"><button aria-current={view==='library'&&screen!=='compose'?'page':undefined} onClick={showLibrary}><BookOpen size={21}/><span>词库</span></button><button aria-current={view==='library'&&screen==='compose'?'page':undefined} onClick={()=>openComposer()}><span className="sc-create-icon"><Plus size={23}/></span><span>想押韵</span></button><button aria-current={view==='mine'?'page':undefined} onClick={()=>navigate('mine')}><UserRound size={21}/><span>我的</span></button>{user?.role==='admin'&&<button aria-current={view==='admin'?'page':undefined} onClick={()=>navigate('admin')}><Shield size={21}/><span>管理</span></button>}</nav>
    {auth&&<div className="sc-overlay"><section className="sc-modal" role="dialog" aria-modal="true" aria-labelledby="auth-title"><button className="sc-modal-close" aria-label="关闭登录窗口" disabled={busy} onClick={()=>{setAuth(null);pendingSubmit.current=null;if(location.pathname==='/setup')history.replaceState(null,'','/');}}><X/></button><div className="sc-modal-icon"><UserRound size={25}/></div><h2 id="auth-title">{auth==='setup'?'建立管理员账号':auth==='register'?'加入押韵共创':'欢迎回来'}</h2><p>{auth==='setup'?'一次性初始化，之后你也使用相同的投稿入口。':pendingSubmit.current?'灵感已保留，登录后继续收录。':'登录后收录原创押韵，换设备也能保留创作与积分。'}</p><form className="sc-auth-form" onSubmit={authenticate}><div className="sc-auth-fields"><label className="sc-field">用户名<input autoFocus autoComplete="username" required minLength={2} maxLength={24} value={username} onChange={e=>setUsername(e.target.value)} placeholder="2–24 位中文、字母或数字"/></label><label className="sc-field">密码<span className="sc-password-field"><input type={passwordVisible?'text':'password'} required minLength={10} maxLength={128} autoComplete={auth==='login'?'current-password':'new-password'} value={password} onChange={e=>setPassword(e.target.value)} placeholder="至少 10 位"/><button type="button" aria-label={passwordVisible?'隐藏密码':'显示密码'} aria-pressed={passwordVisible} onClick={()=>setPasswordVisible(value=>!value)}>{passwordVisible?<EyeOff size={18}/>:<Eye size={18}/>}</button></span></label>{authError&&<p className="sc-error" role="alert">{authError}</p>}</div><button className="sc-btn sc-full" disabled={busy} type="submit">{busy?'正在处理…':auth==='setup'?'建立管理员账号':auth==='register'?'注册并登录':'登录'}</button></form>{auth!=='setup'&&<button className="sc-switch" disabled={busy} onClick={()=>openAuth(auth==='login'?'register':'login')}>{auth==='login'?'没有账号？注册一个':'已有账号？直接登录'}</button>}</section></div>}
    {(wordLoading||rhymeLoading)&&<div className="sc-loading" role="status"><LoaderCircle size={16} className="sc-spin"/>正在读取</div>}
  </div>;
}
createRoot(document.getElementById('root')!).render(<App/>);
