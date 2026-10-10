// Actual React DOM regression; this is not a physical keyboard/IME acceptance test.
// Install official jsdom outside the project, with lifecycle scripts disabled:
//   pnpm --dir /absolute/temporary/directory add jsdom --ignore-scripts --registry=https://registry.npmjs.org
// Then run (no project dependency or lockfile change):
//   node scripts/test-word-input.mjs /absolute/temporary/directory/node_modules/jsdom
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const jsdomPath=process.argv[2]||process.env.JSDOM_PATH;
if(!jsdomPath||!path.isAbsolute(jsdomPath))throw new Error('Provide the absolute path of a temporary jsdom package via argv[2] or JSDOM_PATH');
const project=fileURLToPath(new URL('../',import.meta.url));
const projectRequire=createRequire(path.join(project,'package.json'));
const {JSDOM}=projectRequire(jsdomPath);
const dom=new JSDOM('<!doctype html><html><body></body></html>',{url:'http://localhost/',pretendToBeVisual:true});
// jsdom has no layout engine. Keep this browser method callable and record only
// invocation; geometry, clipping and keyboard visibility need browser evidence.
const scrollIntoViewCalls=[];
dom.window.HTMLElement.prototype.scrollIntoView=function(options){scrollIntoViewCalls.push({options,focused:this===dom.window.document.activeElement});};
const savedGlobals=new Map();
for(const name of ['window','document','navigator','HTMLElement','HTMLTextAreaElement','Event','InputEvent','CompositionEvent','KeyboardEvent','Node','MutationObserver','getComputedStyle']){
  savedGlobals.set(name,Object.getOwnPropertyDescriptor(globalThis,name));
  Object.defineProperty(globalThis,name,{value:dom.window[name],configurable:true,writable:true});
}
savedGlobals.set('IS_REACT_ACT_ENVIRONMENT',Object.getOwnPropertyDescriptor(globalThis,'IS_REACT_ACT_ENVIRONMENT'));
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const compilation=await mkdtemp(path.join(tmpdir(),'rhyme-word-input-regression-'));
let passed=0;const failures=[];
try {
  // Load react-dom only after the DOM exists, so it selects its native input and
  // composition event plugins rather than the no-DOM fallback.
  const React=projectRequire('react');
  const {createRoot}=projectRequire('react-dom/client');
  const {build}=createRequire(projectRequire.resolve('tsx'))('esbuild');
  const output=path.join(compilation,'WordInput.mjs');
  await build({
    entryPoints:[path.join(project,'src/WordInput.tsx')],outfile:output,bundle:true,
    platform:'node',format:'esm',jsx:'automatic',logLevel:'silent',
    plugins:[{name:'same-react-instance',setup(builder){
      builder.onResolve({filter:/^react(?:\/.*)?$/},args=>({path:pathToFileURL(projectRequire.resolve(args.path)).href,external:true}));
    }}],
  });
  const {WordInput}=await import(pathToFileURL(output).href);
  const nativeValueSetter=Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype,'value').set;

  async function mount(){
    const host=document.createElement('div');document.body.append(host);
    const root=createRoot(host);
    const seen={changes:[],compositions:[],native:[],draft:null,parentComposing:false};
    // The selected pronunciation is a consumer-side sentinel: any spurious
    // onChange invalidates it, making cancellation observable outside WordInput.
    function Consumer({active,visible=true}){
      const [draft,setDraft]=React.useState({text:'音乐',readings:['yin1','le4']});
      const [composing,setComposing]=React.useState(false);
      seen.draft=draft;seen.parentComposing=composing;
      return visible?React.createElement(WordInput,{id:'actual-word-input',value:draft.text,active,disabled:false,placeholder:'词语',
        onChange:text=>{seen.changes.push(text);setDraft({text,readings:[]});},
        onComposing:next=>{seen.compositions.push(next);setComposing(next);},
      }):null;
    }
    await React.act(async()=>root.render(React.createElement(Consumer,{active:true})));
    const field=host.querySelector('textarea');assert.ok(field);
    for(const type of ['keydown','compositionstart','compositionupdate','beforeinput','input','compositionend','keyup'])field.addEventListener(type,event=>seen.native.push({type,value:field.value,isComposing:event.isComposing,data:event.data}));
    let mounted=true;
    return {field,seen,
      setActive:async active=>React.act(async()=>root.render(React.createElement(Consumer,{active}))),
      unmountWord:async()=>React.act(async()=>root.render(React.createElement(Consumer,{active:true,visible:false}))),
      unmount:async()=>{if(mounted){await React.act(async()=>root.unmount());mounted=false;host.remove();}},
    };
  }
  async function dispatch(fixture,event,value){
    await React.act(async()=>{
      // React tracks programmatic assignments. Use the browser prototype setter
      // to model native user edits, then dispatch a real DOM event through React.
      if(value!==undefined)nativeValueSetter.call(fixture.field,value);
      fixture.field.dispatchEvent(event);
    });
  }
  const composition=(type,data='')=>new dom.window.CompositionEvent(type,{bubbles:true,cancelable:true,data});
  const inputEvent=(type,data,isComposing,inputType)=>new dom.window.InputEvent(type,{bubbles:true,cancelable:type==='beforeinput',composed:true,data,isComposing,inputType});
  async function begin(fixture){
    fixture.field.focus();
    await dispatch(fixture,new dom.window.KeyboardEvent('keydown',{bubbles:true,key:'Process',keyCode:229,which:229}));
    await dispatch(fixture,composition('compositionstart'));
    assert.deepEqual(fixture.seen.compositions,[true]);assert.equal(fixture.seen.parentComposing,true);
  }
  async function intermediate(fixture,value,data){
    await dispatch(fixture,composition('compositionupdate',data));
    await dispatch(fixture,inputEvent('beforeinput',data,true,'insertCompositionText'));
    await dispatch(fixture,inputEvent('input',data,true,'insertCompositionText'),value);
    assert.equal(fixture.field.value,value);assert.deepEqual(fixture.seen.changes,[]);
    assert.equal(fixture.seen.draft.text,'音乐');assert.deepEqual(fixture.seen.draft.readings,['yin1','le4']);
  }
  async function finishKey(fixture){await dispatch(fixture,new dom.window.KeyboardEvent('keyup',{bubbles:true,key:'Process',keyCode:229,which:229}));}
  async function check(name,body){
    const fixture=await mount();
    try{await body(fixture);passed++;console.log('✔ '+name);}
    catch(error){failures.push(error);console.error('✘ '+name+'\n'+error.message);}
    finally{await fixture.unmount();}
  }

  await check('原生普通 input 仍更新父级值，不产生 composition 状态',async f=>{
    await dispatch(f,inputEvent('beforeinput','家',false,'insertText'));
    await dispatch(f,inputEvent('input','家',false,'insertText'),'音乐家');
    assert.deepEqual(f.seen.changes,['音乐家']);assert.equal(f.seen.draft.text,'音乐家');
    assert.deepEqual(f.seen.compositions,[]);assert.equal(f.seen.parentComposing,false);
  });
  await check('音乐 → 中间拼写 → 取消回音乐：父级零变更，手选 le4 保留',async f=>{
    await begin(f);await intermediate(f,'音乐j','j');await intermediate(f,'音乐jia','jia');
    await dispatch(f,composition('compositionend',''),'音乐');
    await dispatch(f,inputEvent('input',null,false,'insertText'),'音乐');await finishKey(f);
    assert.deepEqual(f.seen.changes,[]);assert.deepEqual(f.seen.draft,{text:'音乐',readings:['yin1','le4']});
    assert.equal(f.field.value,'音乐');assert.deepEqual(f.seen.compositions,[true,false]);assert.equal(f.seen.parentComposing,false);
    assert.deepEqual(f.seen.native.map(event=>event.type),['keydown','compositionstart','compositionupdate','beforeinput','input','compositionupdate','beforeinput','input','compositionend','input','keyup']);
  });
  await check('确认音乐家：最终 input 先于 compositionend，只提交一次最终词',async f=>{
    await begin(f);await intermediate(f,'音乐jia','jia');
    await dispatch(f,inputEvent('beforeinput','家',false,'insertFromComposition'));
    await dispatch(f,inputEvent('input','家',false,'insertFromComposition'),'音乐家');
    assert.deepEqual(f.seen.changes,[]);assert.equal(f.seen.draft.text,'音乐');
    await dispatch(f,composition('compositionend','家'));await finishKey(f);
    assert.deepEqual(f.seen.changes,['音乐家']);assert.equal(f.seen.draft.text,'音乐家');assert.equal(f.field.value,'音乐家');
    assert.deepEqual(f.seen.compositions,[true,false]);assert.equal(f.seen.parentComposing,false);
  });
  await check('确认音乐家：compositionend 先于最终 input，不重复提交最终词',async f=>{
    await begin(f);await intermediate(f,'音乐jia','jia');
    await dispatch(f,composition('compositionend','家'),'音乐家');
    await dispatch(f,inputEvent('beforeinput','家',false,'insertFromComposition'));
    await dispatch(f,inputEvent('input','家',false,'insertFromComposition'),'音乐家');await finishKey(f);
    assert.deepEqual(f.seen.changes,['音乐家']);assert.equal(f.seen.draft.text,'音乐家');
    assert.deepEqual(f.seen.compositions,[true,false]);assert.equal(f.seen.parentComposing,false);
  });
  await check('组合过程中切为 inactive：恢复原词与读音，解除父级组合状态',async f=>{
    await begin(f);await intermediate(f,'音乐jia','jia');await f.setActive(false);
    assert.deepEqual(f.seen.changes,[]);assert.deepEqual(f.seen.draft,{text:'音乐',readings:['yin1','le4']});assert.equal(f.field.value,'音乐');
    assert.deepEqual(f.seen.compositions,[true,false]);assert.equal(f.seen.parentComposing,false);
    await f.setActive(true);
    await dispatch(f,inputEvent('input','家',false,'insertText'),'音乐家');
    assert.deepEqual(f.seen.changes,['音乐家']);assert.equal(f.seen.draft.text,'音乐家');
    await f.unmount();assert.deepEqual(f.seen.compositions,[true,false]);
  });
  await check('组合过程中 unmount：通知 false，不提交中间值',async f=>{
    await begin(f);await intermediate(f,'音乐jia','jia');await f.unmountWord();
    assert.deepEqual(f.seen.changes,[]);assert.deepEqual(f.seen.compositions,[true,false]);
    assert.equal(f.seen.parentComposing,false);
    assert.deepEqual(f.seen.draft,{text:'音乐',readings:['yin1','le4']});
  });
  console.log(`React DOM native-event regression: ${passed}/6 passed; jsdom only, no physical IME or browser-layout acceptance.`);
  console.log(`scrollIntoView stub recorded ${scrollIntoViewCalls.length} calls; geometry was not evaluated.`);
  if(failures.length)throw new AggregateError(failures,`${failures.length} actual WordInput event regressions failed`);
} finally {
  await rm(compilation,{recursive:true,force:true});dom.window.close();
  for(const [name,descriptor] of savedGlobals){if(descriptor)Object.defineProperty(globalThis,name,descriptor);else delete globalThis[name];}
}
