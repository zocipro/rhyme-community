import React, { useState } from 'react';
import { Moon, Sun } from 'lucide-react';

type Theme = 'light'|'dark';
const themeColors:Record<Theme,string> = {light:'#f4eee1',dark:'#120e0e'};
function storedTheme():Theme|null{
  try{const value=localStorage.getItem('sc-theme');return value==='light'||value==='dark'?value:null;}catch{return null;}
}
function applyTheme(theme:Theme){
  const root=document.documentElement;
  if(theme==='light')root.dataset.scTheme='light';else delete root.dataset.scTheme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content',themeColors[theme]);
}

export function ThemeToggle(){
  const [theme,setTheme]=useState<Theme>(()=>storedTheme()??'dark');
  function toggle(){
    const next=theme==='dark'?'light':'dark';
    setTheme(next);applyTheme(next);
    try{localStorage.setItem('sc-theme',next);}catch{/* The choice still applies to this page. */}
  }
  return <button type="button" className="sc-theme-toggle" aria-label={theme==='dark'?'切换到浅色模式':'切换到深色模式'} title={theme==='dark'?'浅色模式':'深色模式'} onClick={toggle}>{theme==='dark'?<Sun size={16}/>:<Moon size={16}/>}</button>;
}
