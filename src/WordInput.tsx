import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';

export function WordInput({id,value,disabled,active,placeholder,onChange,onComposing}:{id:string;value:string;disabled:boolean;active:boolean;placeholder:string;onChange:(text:string)=>void;onComposing:(active:boolean)=>void}){
  const input=useRef<HTMLTextAreaElement>(null);
  const [composition,setComposition]=useState<string|null>(null),composing=useRef(false),notify=useRef(onComposing);notify.current=onComposing;
  const committed=useRef(value);
  useLayoutEffect(()=>{committed.current=value;},[value]);
  const commit=(text:string)=>{if(text!==committed.current){committed.current=text;onChange(text);}};
  const displayValue=composition??value;
  useEffect(()=>()=>{if(composing.current)notify.current(false);},[]);
  useEffect(()=>{if(!active&&composing.current){composing.current=false;setComposition(null);notify.current(false);}},[active]);
  useLayoutEffect(()=>{const resize=()=>{const field=input.current;if(field&&active){field.style.height='auto';field.style.height=`${Math.min(180,field.scrollHeight+2)}px`;if(document.activeElement===field)field.scrollIntoView({block:'nearest',inline:'nearest'});}};resize();window.addEventListener('resize',resize);return()=>window.removeEventListener('resize',resize);},[displayValue,active]);
  return <textarea ref={input} id={id} rows={1} disabled={disabled} placeholder={placeholder} value={displayValue} onCompositionStart={event=>{composing.current=true;setComposition(event.currentTarget.value);notify.current(true);}} onCompositionEnd={event=>{const text=event.currentTarget.value;composing.current=false;setComposition(null);commit(text);notify.current(false);}} onChange={event=>{if(composing.current||(event.nativeEvent as InputEvent).isComposing)setComposition(event.target.value);else commit(event.target.value);}}/>;
}
