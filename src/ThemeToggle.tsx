import React, { useEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';

type Theme = 'light'|'dark';
const themeColors:Record<Theme,string> = {light:'#f5f4f0',dark:'#0f0f10'};
const systemQuery = () => matchMedia('(prefers-color-scheme: dark)');
function storedTheme():Theme|null{
  try{const value=localStorage.getItem('sc-theme');return value==='light'||value==='dark'?value:null;}catch{return null;}
}
function applyTheme(theme:Theme,explicit:boolean){
  const root=document.documentElement;
  if(explicit)root.dataset.scTheme=theme;else delete root.dataset.scTheme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content',themeColors[theme]);
}

export function ThemeToggle(){
  const [theme,setTheme]=useState<Theme>(()=>storedTheme()??(systemQuery().matches?'dark':'light'));
  useEffect(()=>{
    const query=systemQuery();
    const follow=()=>{if(storedTheme())return;const next=query.matches?'dark':'light';setTheme(next);applyTheme(next,false);};
    query.addEventListener('change',follow);return()=>query.removeEventListener('change',follow);
  },[]);
  function toggle(){
    const next=theme==='dark'?'light':'dark';
    setTheme(next);applyTheme(next,true);
    try{localStorage.setItem('sc-theme',next);}catch{/* The choice still applies to this page. */}
  }
  return <button type="button" className="sc-theme-toggle" aria-label={theme==='dark'?'切换到浅色模式':'切换到深色模式'} title={theme==='dark'?'浅色模式':'深色模式'} onClick={toggle}>{theme==='dark'?<Sun size={16}/>:<Moon size={16}/>}</button>;
}
