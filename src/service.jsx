import {useEffect,useRef} from 'react';
import {conf,bytes,date,money,loadScript,trimTrailingSlash,token} from './core';

/**
 * 在线客服对接 —— Chatwoot / Crisp / SalesMartly / 自定义嵌入代码。
 *
 * 四种都只是往页面注入第三方 SDK，没有自己的 UI（气泡和会话窗口由 SDK 画）。
 * 前三种会把用户的邮箱、套餐、到期、剩余流量、余额同步给客服，方便客服一眼
 * 看清在跟谁说话。
 *
 * 关于同步的用户属性，有两点必须清楚：
 *   1. 这些值是**用户自己的浏览器**写进客服系统的，只在打开会话时刷新，不是实时的；
 *   2. 用户能在控制台改成任意值。
 * 所以客服拿它当参考没问题，涉及退款 / 补偿这类决定要回面板核对。
 *
 * 客服脚本挂了不该影响面板本身，所以所有失败都只 warn，不向上抛。
 */

/**
 * 客服系统共用的用户属性。三种 SDK 都用它，避免各写一份。
 *
 * 订阅数据直接用 AuthContext 里已有的那份，不再单独请求：一是重复打接口，
 * 二是两份数据会漂移（签到后只刷新了 context 那份），客服和用户看到的剩余
 * 流量对不上就没法排查。顺带一个真实风险 —— request() 在 401/403 时会先
 * logout() 再抛错，token 过期后用户一点开客服窗口就会被踢出面板。
 */
function attributes(user,subscribe,config){
 const sub=subscribe||{};
 const used=(Number(sub.u)||0)+(Number(sub.d)||0),total=Number(sub.transfer_enable)||0;
 return{
  Email:user?.email||'',
  Plan:sub.plan?.name||'无套餐',
  Expires:sub.expired_at?date(sub.expired_at):'长期有效',
  // 命名写清楚是剩余而不是总量，免得客服看错
  TrafficLeft:bytes(Math.max(0,total-used)),
  Balance:(config?.currency_symbol||'')+money(user?.balance)
 };
}

/** 反复开关会话窗口没必要每次都打接口，30 秒内只同步一次 */
function throttle(ref,fn){
 return()=>{const now=Date.now();if(now-ref.current<30000)return;ref.current=now;fn()};
}

/**
 * 把随时会变的订阅 / 站点配置放进 ref 给 sync 读。
 *
 * 不能把它们放进 effect 依赖：useResource 每次 reload() 都会给出一个新对象
 * （签到、续费、改通知开关都会触发），effect 一重跑就先执行 cleanup ——
 * 对 Crisp 来说那是 session:reset，等于把用户正在进行的客服会话直接清掉。
 * effect 只依赖身份（邮箱），数据更新走 ref —— user 本身也要走 ref：
 * 余额这类字段会变，闭包里抓住的还是挂载时那一份。
 */
function useLatest(value){
 const ref=useRef(value);
 // 在 effect 里写而不是 render 阶段写：React 允许丢弃并重跑一次 render
 // （StrictMode 双调用、Suspense 重试、被高优先级打断），render 阶段的写入
 // 会把一次「从未发生过的渲染」的数据留下来 —— 那份快照可能就是推给客服的
 // 套餐 / 流量 / 余额。
 useEffect(()=>{ref.current=value});
 return ref;
}

function Chatwoot({user,subscribe,config}){
 const last=useRef(0),data=useLatest({user,subscribe,config});
 useEffect(()=>{
  const base=trimTrailingSlash(conf('chatwoot_url')),token=conf('chatwoot_token');
  if(!base||!token)return;
  // 和 middleware_url / server_url 一样当场说清楚：少了协议会变成相对地址、
  // 打给前端自己，表现只是一句「SDK 加载失败」，看不出是配置问题。
  if(!/^https?:\/\//i.test(base)){console.error('[Chatwoot] 地址必须以 http:// 或 https:// 开头，当前填的是 '+JSON.stringify(base));return}
  let dead=false;
  const sync=async()=>{
   if(dead||!window.$chatwoot||!user?.email)return;
   last.current=Date.now();
   try{window.$chatwoot.setUser(user.email,{email:user.email,name:user.email.split('@')[0]})}
   catch(e){console.warn('[Chatwoot] setUser 失败',e);return}
   try{window.$chatwoot.setCustomAttributes(attributes(data.current.user,data.current.subscribe,data.current.config))}
   catch(e){console.warn('[Chatwoot] 同步用户属性失败',e)}
  };
  const onOpened=throttle(last,sync);
  addEventListener('chatwoot:ready',sync);
  addEventListener('chatwoot:opened',onOpened);
  loadScript(base+'/packs/js/sdk.js').then(()=>{
   if(dead)return;
   window.chatwootSettings={position:'right',locale:'zh_CN',type:'standard',hideMessageBubble:false};
   // run() 幂等性没有保证，路由切换重复挂载时只跑第一次
   // 只有 run() 真的执行成功才上锁：先上锁再调用的话，SDK 全局缺失（被 SPA
   // 回退页顶掉、路径不对）时锁已经落下，之后每次挂载都走 else 分支直接返回，
   // 气泡再也出不来且没有任何提示。
   if(window.__heroruiChatwoot){sync();return}
   if(!window.chatwootSDK?.run){console.warn('[Chatwoot] 已加载脚本但没有 chatwootSDK，请检查地址是否正确：'+base);return}
   window.chatwootSDK.run({websiteToken:token,baseUrl:base});
   window.__heroruiChatwoot=true;
  }).catch(e=>console.warn('[Chatwoot] SDK 加载失败',e));
  return()=>{
   dead=true;removeEventListener('chatwoot:ready',sync);removeEventListener('chatwoot:opened',onOpened);
   // 退出登录 / 换号时清掉会话：SDK 把会话存在自己的 Cookie 里，不 reset 的话
   // 共用电脑上下一个人在登录页就能接着看上一个人的客服对话
   try{window.$chatwoot?.reset?.()}catch{}
  };
 },[user?.email]);
 return null;
}

function Crisp({user,subscribe,config}){
 const last=useRef(0),data=useLatest({user,subscribe,config});
 useEffect(()=>{
  const id=conf('crisp_website_id');
  if(!id)return;
  let dead=false;
  const sync=async()=>{
   if(dead||!window.$crisp||!user?.email)return;
   last.current=Date.now();
   try{
    window.$crisp.push(['set','user:email',[user.email]]);
    window.$crisp.push(['set','user:nickname',[user.email.split('@')[0]]]);
   }catch(e){console.warn('[Crisp] 设置用户失败',e);return}
   try{
    const attrs=attributes(data.current.user,data.current.subscribe,data.current.config);
    // Crisp 的 session:data 收 [[key, value], ...]
    window.$crisp.push(['set','session:data',[Object.entries(attrs).map(([k,v])=>[k,String(v)])]]);
   }catch(e){console.warn('[Crisp] 同步用户属性失败',e)}
  };
  // 标准嵌入：先建 $crisp 队列和 WEBSITE_ID，再异步加载 l.js
  window.$crisp=window.$crisp||[];
  window.CRISP_WEBSITE_ID=id;
  // 事件全局只能注册一次。之前每次挂载都 push 两个闭包且从不注销，于是
  // 队列无限增长、全部指向旧的 user；而 session:loaded 一个页面只触发一次，
  // 重新挂载后新用户的身份根本推不出去 —— 共用浏览器时客服看到的还是上一个人。
  window.__heroruiCrispSync=sync;
  window.__heroruiCrispOpen=throttle(last,sync);
  if(!window.__heroruiCrisp){
   window.__heroruiCrisp=true;
   window.$crisp.push(['on','session:loaded',()=>window.__heroruiCrispSync?.()]);
   window.$crisp.push(['on','chat:opened',()=>window.__heroruiCrispOpen?.()]);
  }
  loadScript('https://client.crisp.chat/l.js').then(()=>sync()).catch(e=>console.warn('[Crisp] SDK 加载失败',e));
  return()=>{
   dead=true;
   if(window.__heroruiCrispSync===sync){delete window.__heroruiCrispSync;delete window.__heroruiCrispOpen}
   // 换用户时清掉上一个人的会话，否则同一浏览器里下一位用户会继承前一位的
   // 会话 id、聊天记录和属性
   try{window.$crisp?.push(['do','session:reset'])}catch{}
  };
 },[user?.email]);
 return null;
}

function SalesMartly({user,subscribe,config}){
 const last=useRef(0),data=useLatest({user,subscribe,config});
 useEffect(()=>{
  const src=String(conf('salesmartly_url')).trim();
  if(!src)return;
  if(!/^https?:\/\//i.test(src)){console.error('[SalesMartly] 脚本地址必须以 http:// 或 https:// 开头，当前填的是 '+JSON.stringify(src));return}
  let dead=false;
  const sync=async()=>{
   if(dead||!window.ssq||!user?.email)return;
   last.current=Date.now();
   // user_id / user_name 是 setLoginInfo 的必填项
   const payload={user_id:user.email,user_name:user.email.split('@')[0],email:user.email};
   try{
    const attrs=attributes(data.current.user,data.current.subscribe,data.current.config);
    // 结构化字段 custom_fields_ext 要先在后台建字段拿 ID，这里走纯文本，客服照样看得到
    payload.description=Object.entries(attrs).map(([k,v])=>`${k}: ${v}`).join(' | ');
   }catch(e){console.warn('[SalesMartly] 同步用户属性失败',e)}
   try{window.ssq.push('setLoginInfo',payload)}catch(e){console.warn('[SalesMartly] 设置用户失败',e)}
  };
  loadScript(src).then(()=>{
   if(dead||!window.ssq)return;
   // 事件全局只能注册一次，但组件可能重新挂载；回调里重读最新的 sync
   if(!window.__heroruiSalesMartly){
    window.__heroruiSalesMartly=true;
    try{
     window.ssq.push('onReady',()=>window.__heroruiSSSync?.());
     window.ssq.push('onOpenChat',()=>window.__heroruiSSOpen?.());
    }catch(e){window.__heroruiSalesMartly=false;console.warn('[SalesMartly] 绑定事件失败',e)}
   }
   sync();
  }).catch(e=>console.warn('[SalesMartly] SDK 加载失败',e));
  window.__heroruiSSSync=sync;
  window.__heroruiSSOpen=throttle(last,sync);
  return()=>{
   dead=true;if(window.__heroruiSSSync===sync){delete window.__heroruiSSSync;delete window.__heroruiSSOpen}
   // SalesMartly 没有公开的「退出 / 重置访客」接口，挂件和会话会一直留在页面上，
   // 下一个人在登录页就能接着上一个人的对话。退出登录时（logout() 已先删掉 token）
   // 整页刷新一次把挂件卸干净 —— 登录页不加载客服，下一位登录后 setLoginInfo 换成新身份。
   if(window.ssq&&!token())location.reload();
  };
 },[user?.email]);
 return null;
}

/**
 * 把站长粘贴的任意 HTML 注入页面，只注入一次。
 *
 * innerHTML 塞进去的 <script> 浏览器**不会执行**，而这些字段的用途就是放
 * 客服挂件和统计代码，所以要把 script 节点逐个重建成真正的 script 元素再插入；
 * 非脚本节点原样搬过去。
 *
 * 内容是站长自己填的，等价于同域部署下 Blade 的 {!! !!} 直出，不做净化 ——
 * 净化了挂件就跑不起来。
 */
function injectOnce(html,guard,label){
 if(!html||window[guard])return;
 window[guard]=true;
 try{
  const tpl=document.createElement('template');
  tpl.innerHTML=html;
  // 先记下要插入的顶层节点：append 之后 fragment 会被清空，而且之后只能
  // 在**这些**节点里找 script —— 直接查 document.body 会把应用自己的
  // bootstrap 和 type="module" 入口也选中，重建它们等于把 React 挂载两遍。
  const added=[...tpl.content.childNodes];
  document.body.append(tpl.content);
  // 整棵树里的 script 都要重建，不能只看顶层 —— 客服挂件的嵌入代码经常是
  // <div>…<script>…</script></div> 这种包了一层的，漏掉就静默不执行。
  const scripts=[];
  for(const node of added){
   if(node.nodeType!==1)continue;
   if(node.tagName==='SCRIPT')scripts.push(node);
   else scripts.push(...node.querySelectorAll('script'));
  }
  for(const original of scripts){
   const s=document.createElement('script');
   for(const a of Array.from(original.attributes))s.setAttribute(a.name,a.value);
   // 动态插入的 script 的 async 默认为 true，会让原本按顺序执行的外链脚本
   // 乱序（挂件常常依赖前一个脚本先跑完）。源码没显式写 async 就关掉它。
   //
   // 注意这只解决「外链之间」的顺序。无 src 的内联脚本是插入时同步执行的，
   // 所以 <script src=w.js></script><script>KF.init()</script> 这种写法里，
   // 内联那句仍会先于 w.js 跑完 —— 官方嵌入代码基本都是单个 <script>，
   // 真遇到这种组合请把初始化写进 w.js 的 onload，或改用「自定义页脚 HTML」
   // 让浏览器自己按文档顺序解析。
   if(original.src&&!original.hasAttribute('async'))s.async=false;
   if(original.textContent)s.textContent=original.textContent;
   original.replaceWith(s);
  }
 }catch(e){console.warn(label+'注入失败',e)}
}

/** 「其它」客服：注入站长粘贴的客服系统嵌入代码 */
function Custom(){
 useEffect(()=>{injectOnce(conf('customer_service_html'),'__heroruiCustomService','[客服] 自定义嵌入代码')},[]);
 return null;
}

/**
 * 自定义页脚 HTML。
 *
 * 同域部署下这段由 Blade 的 {!! !!} 直出，themeConfig 里**不带** custom_html
 * （见 theme-fields 的 expose:false），所以这里读不到、不会重复注入。
 * 分离部署没有 Blade，config.js 里带了这个字段，于是改由运行时注入 ——
 * 两种部署方式的行为就一致了。
 */
export function CustomHtml(){
 useEffect(()=>{injectOnce(conf('custom_html'),'__heroruiCustomHtml','[主题] 自定义页脚 HTML')},[]);
 return null;
}

/** 总入口：按 customer_service_type 决定加载哪种，留空则都不加载 */
export function CustomerService({user,subscribe,config}){
 const type=String(conf('customer_service_type')).trim();
 const props={user,subscribe,config};
 if(type==='chatwoot')return <Chatwoot {...props}/>;
 if(type==='crisp')return <Crisp {...props}/>;
 if(type==='salesmartly')return <SalesMartly {...props}/>;
 if(type==='other')return <Custom/>;
 return null;
}
