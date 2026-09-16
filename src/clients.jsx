import React from 'react';
import {Monitor,Apple,Smartphone,Terminal,Router,Tv,Send,BookOpen,Download,ArrowUpRight} from 'lucide-react';
import {Action,Panel,Heading,useT,conf,safeURL,Blank} from './core';

/**
 * 客户端下载页。
 *
 * 纯配置驱动：站长在主题配置里填哪些平台的地址，就显示哪些平台；
 * 七个全留空时连导航入口都不出现（见 main.jsx 的 nav），不给没填地址的
 * 站点留一个空页面。
 *
 * 地址必须是**绝对** http(s) 地址。不能只用 safeURL：它会把缺协议的值
 * （如 dl.example.com/win.exe，复制时很容易漏掉 https://）按相对路径解析到
 * 本站域名下，于是校验通过、卡片照常显示，用户点进去却是本站的 404。
 */
const PLATFORMS=[
 ['client_windows','Windows',Monitor],
 ['client_macos','macOS',Apple],
 ['client_android','Android',Smartphone],
 ['client_ios','iOS',Smartphone],
 ['client_linux','Linux',Terminal],
 ['client_openwrt','OpenWrt',Router],
 ['client_tv','TV',Tv]
];

/** 只接受绝对 http(s) 地址；缺协议的值会被 safeURL 误判成本站路径 */
function externalURL(value,label){
 const raw=String(value||'').trim();
 if(!raw)return null;
 if(!/^https?:\/\//i.test(raw)){
  console.error('[客户端下载] '+label+' 必须以 http:// 或 https:// 开头，已忽略：'+raw);
  return null;
 }
 return safeURL(raw);
}

/**
 * 配好地址的平台。main.jsx 靠它决定要不要显示导航入口。
 *
 * 结果缓存一次：themeConfig 是模块级快照，这个列表在一次页面生命周期内
 * 不会变，而 main.jsx 的 nav 每次渲染都会重建 —— 不缓存就是每渲染跑 6 次 new URL。
 */
let cached=null;
export function availableClients(){
 if(!cached)cached=PLATFORMS
  .map(([field,name,Icon])=>({name,Icon,url:externalURL(conf(field),name)}))
  .filter(x=>x.url);
 return cached;
}

/**
 * Telegram 频道入口。站长填了地址才出现。
 *
 * 地址走 externalURL：只接受绝对 http(s)，缺协议会被 safeURL 解析成本站路径，
 * 变成一个指向自己域名的死链。
 */
export function TelegramChannel({compact=false}){
 const t=useT();
 const url=externalURL(conf('telegram_channel'),'Telegram 频道');
 if(!url)return null;
 const note=String(conf('telegram_channel_note')).trim();
 return <a className={'tg-channel'+(compact?' is-compact':'')} href={url} target="_blank" rel="noopener noreferrer">
  <Send size={compact?22:24}/>
  <div>
   <strong>{t('Telegram 频道')}</strong>
   <span>{note||t('关注频道，获取节点更新与故障公告')}</span>
  </div>
  <ArrowUpRight size={compact?18:17}/>
 </a>;
}

export function Clients(){
 const t=useT();
 const list=availableClients(),note=String(conf('client_note')).trim(),help=externalURL(conf('help_url'),'帮助中心外链');
 return <>
  <Heading kicker="CLIENTS / 09" title={t('客户端下载')} action={help&&
   <Action variant="secondary" onClick={()=>window.open(help,'_blank','noopener,noreferrer')}>
    <BookOpen size={16}/>{t('查看教程')}<ArrowUpRight size={14}/>
   </Action>}>{t('下载并安装客户端，再回到总览一键导入订阅')}</Heading>
  {note&&<p className="client-note">{note}</p>}
  <TelegramChannel/>
  {list.length
   ?<div className="client-grid">{list.map(({name,Icon,url})=>
     <a className="client-card" key={name} href={url} target="_blank" rel="noopener noreferrer">
      <Icon size={26}/>
      <strong>{name}</strong>
      <span><Download size={14}/>{t('下载')}</span>
     </a>)}</div>
   :<Panel><Blank/></Panel>}
 </>;
}
