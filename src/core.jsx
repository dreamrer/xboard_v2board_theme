import React,{createContext,useContext,useEffect,useLayoutEffect,useMemo,useState,useCallback,useRef} from 'react';
import {App as AntApp,Alert,Skeleton,Empty,Button as AntButton} from 'antd';
import {Button,Card,Chip} from '@heroui/react';
import DOMPurify from 'dompurify';
import {marked} from 'marked';
import dictionaries from './translations.json';
import {conf} from './panel';
import {rewriteToMiddleware} from './middleware';
export {themeConfig,conf,trimTrailingSlash} from './panel';
export const settings=window.settings||{};
const tokenKey='VUE_NAIVE_ACCESS_TOKEN',localeKey='VUE_NAIVE_LOCALE';
export const storage={get(key,fallback=null){try{return JSON.parse(localStorage.getItem(key)||'null')??fallback}catch{return fallback}},set(key,value){try{localStorage.setItem(key,JSON.stringify(value))}catch{}},remove(key){try{localStorage.removeItem(key)}catch{}}};
export function token(){const entry=storage.get(tokenKey);return entry && (!entry.expire || entry.expire>Date.now())?entry.value:null;}
export function saveToken(value){storage.set(tokenKey,{value,time:Date.now(),expire:Date.now()+21600000});}
export function logout(){storage.remove(tokenKey);location.hash='/login';window.dispatchEvent(new Event('authchange'));}
export function navigate(path){location.hash=path;}
export function useRoute(){const read=()=>location.hash.slice(1)||'/dashboard';const [route,setRoute]=useState(read);useEffect(()=>{const changed=()=>{setRoute(read());window.scrollTo(0,0)};addEventListener('hashchange',changed);return()=>removeEventListener('hashchange',changed)},[]);return route;}
export const LocaleContext=createContext({locale:'zh-CN',setLocale:()=>{}});
// 插值用 replacer 函数而不是字符串：后者会把值里的 $$ / $& / $` / $' 当成替换
// 模式（'$$100' 会变成 '$100'），而插进来的值可能来自后端或第三方插件。
export function useT(){const {locale}=useContext(LocaleContext);return (key,params={})=>{let value=(dictionaries[locale]?.[key]||dictionaries['en-US']?.[key]||key);for(const [k,v]of Object.entries(params))value=value.replaceAll('{'+k+'}',()=>v);return value;};}
export const languageOptions=[['zh-CN','简体中文'],['en-US','English'],['ja-JP','日本語'],['vi-VN','Tiếng Việt'],['ko-KR','한국어'],['zh-TW','繁體中文'],['ru-RU','Русский'],['fa-IR','فارسی']].map(([value,label])=>({value,label}));
/**
 * 首次访问按浏览器语言选，而不是一律中文 —— 否则这 8 本词典里有 7 本
 * 除非用户自己去页脚切换，永远用不上。选定后写进 localStorage，不再自动改。
 * 这个值也会作为 Content-Language 发给后端，影响它返回的文案与邮件语言。
 */
function detectLocale(){
 const supported=languageOptions.map(o=>o.value);
 let tags=[];
 try{tags=navigator.languages?.length?[...navigator.languages]:[navigator.language||'']}catch{tags=[]}
 for(const raw of tags){
  const tag=String(raw).replace(/_/g,'-');
  const exact=supported.find(x=>x.toLowerCase()===tag.toLowerCase());
  if(exact)return exact;
  const base=tag.split('-')[0].toLowerCase();
  // 中文要按地区分繁简：zh-TW / zh-HK / zh-MO / Hant 用繁体，其余简体
  if(base==='zh')return /(^|-)(tw|hk|mo|hant)(-|$)/i.test(tag)?'zh-TW':'zh-CN';
  const loose=supported.find(x=>x.split('-')[0]===base);
  if(loose)return loose;
 }
 return 'zh-CN';
}
export function getLocale(){
 const saved=storage.get(localeKey)?.value;
 if(saved)return saved;
 // 落盘，兑现上面「选定后不再自动改」的说法：否则每次 request()/date() 都会
 // 重算一遍，而且用户换个系统语言整站语言就跟着变，没有任何操作痕迹。
 const picked=detectLocale();
 persistLocale(picked);
 return picked;
}
export function persistLocale(locale){storage.set(localeKey,{value:locale,time:Date.now(),expire:null});}
/** 带 HTTP 状态码的错误。调用方要靠它区分 404（功能未开启）/429（太频繁）等语义。 */
const fail=(message,status)=>Object.assign(Error(message),{status});
let warnedDisguised404=false;
/**
 * 接口根地址（末尾带 /）。
 *
 * server_url 留空 = 同域部署，用当前站点 + routerBase；
 * 填了 = 分离部署，前端单独托管在别的域名，面板在 server_url。
 * api_path 留空用 /api/v1；以 / 开头相对上面那个根的站点根，否则相对它本身。
 */
export function apiRoot(){
 const server=String(conf('server_url','')).trim();
 let root;
 if(server){
  // 填错就直接报错，不悄悄回退到同域 —— 分离部署下回退只会得到一堆
  // 打在前端域名上的 404，比明确报错难排查得多。
  try{root=new URL(server.replace(/\/+$/,'')+'/')}
  catch{throw Error('主题配置里的「面板地址」不是合法地址：'+server)}
 }else{
  root=new URL(window.routerBase||'/',location.origin);
  if(!root.pathname.endsWith('/'))root.pathname+='/';
 }
 const custom=String(conf('api_path','')).trim();
 if(!custom)return new URL('api/v1/',root);
 // 只接受路径。填成完整地址（或 //host 这种协议相对写法）时，new URL 会让它
 // 直接覆盖上面的根 —— 把带 Authorization 的请求静默送到别的域名去。
 // 「接口路径前缀」这个名字很容易被误填成面板地址，所以当场报错并指向 server_url。
 // 也要挡住不带协议的主机名（panel.example.com/api/v1）：它会被当成相对路径，
 // 把接口根重挂到前端自己域名下，每个请求 404 且看不出是配置问题。
 if(/^[a-z][a-z\d+.-]*:/i.test(custom)||custom.startsWith('//')||/^[^/]*\.[a-z]{2,}(\/|$)/i.test(custom))
  throw Error('主题配置里的「接口路径前缀」只能填路径（如 /proxy/api）。要指定面板域名请填「面板地址」。当前填的是：'+custom);
 return new URL(custom.replace(/^\//,'').replace(/\/?$/,'/'),custom.startsWith('/')?new URL('/',root):root);
}
export async function request(endpoint,{method='GET',data,signal}={}){
 const root=apiRoot();
 const url=new URL(endpoint.replace(/^\//,''),root);const headers={'Accept':'application/json','Content-Language':getLocale()};
 if(token())headers.Authorization=token();let body;
 if(method==='GET'){Object.entries(data||{}).forEach(([k,v])=>v!=null&&url.searchParams.set(k,v));url.searchParams.set('t',Date.now());}
 else{headers['Content-Type']='application/x-www-form-urlencoded';body=new URLSearchParams(Object.entries(data||{}).filter(([,v])=>v!=null)).toString();}
 // 走加密中间件时打的是伪装成静态资源的地址，真实路径不出现在网络里。
 // 配置不全会在这里抛错而不是回退直连 —— 静默直连等于站长以为开了、实际裸奔。
 const encrypted=rewriteToMiddleware(url.href,root.href.replace(/\/$/,''));
 // 不用 AbortSignal.any / AbortSignal.timeout：前者 Safari 17.4、Chrome 116 才有，
 // iOS 16 及更早的 iPhone 上每个请求都会直接抛 TypeError，登录后整站打不开。
 const controller=new AbortController(),forward=()=>controller.abort();let timedOut=false;
 const timer=setTimeout(()=>{timedOut=true;controller.abort()},20000);
 if(signal){if(signal.aborted)controller.abort();else signal.addEventListener('abort',forward,{once:true})}
 let response;
 try{response=await fetch(encrypted||url,{method,headers,body,signal:controller.signal})}
 catch(e){
  if(timedOut)throw Object.assign(fail('请求超时，请检查网络后重试。'),{network:true});
  // 调用方自己取消的（切页面）原样抛出，useResource 靠 signal.aborted 忽略它
  if(signal?.aborted)throw e;
  // 其余都是连不上：断网、DNS、证书、跨域被拦、源站挂了（Cloudflare 522）。
  // 浏览器给的只是一句 "Failed to fetch" / "Load failed"，用户看不懂，换成中文；
  // 原始错误留在控制台给站长排查。
  console.warn('[请求] 无法连接接口：'+(encrypted||url.href),e);
  throw Object.assign(fail('无法连接到服务器，请检查网络后重试。'),{network:true});
 }
 finally{clearTimeout(timer);signal?.removeEventListener('abort',forward)}
 // 登录态清理必须排在 JSON 解析之前：401 的响应体常常不是 JSON（nginx / CDN
 // 的拦截页、PHP fatal），解析先抛就永远走不到这里，过期 token 留在本地，
 // 页面卡在「重试」按钮上无限循环。
 if(response.status===401 || response.status===403){if(!endpoint.includes('/passport/')&&!endpoint.includes('/guest/'))logout();}
 // 中间件把「密文无效」和「路径不存在」都伪装成同一个 404，四种成因表现完全一样，
 // 不提示的话站长只能看到一个没有任何线索的错误页。只报一次：接口本身合法的
 // 404（比如探测签到插件）也会走到这里，每次都刷这段会变成噪音。
 if(response.status===404&&encrypted&&!warnedDisguised404){
  warnedDisguised404=true;
  console.error('[中间件] 有请求返回 404。中间件对所有失败都回同一个伪装 404，如果整站接口都失败，可能的原因：\n  1. 密钥与中间件 .env 的 AES_KEY 不一致\n  2. 本机时钟与服务器相差超过中间件的 TIMESTAMP_WINDOW（默认 300 秒）\n  3. 入口前缀与中间件 PATH_PREFIX 不一致\n  4. 伪装扩展名不在中间件的剥离名单内\n（若只有个别功能 404，那更可能是面板本身没有该接口）\n  请求地址：'+encrypted);
 }
 // 网关错误：Cloudflare 52x（522 = 连不上源站）/ nginx 502–504。这时面板程序根本没收到
 // 请求，响应体是网关自己的页面，没有可显示的原因 —— 与「连不上」同样处理
 if([502,503,504].includes(response.status)||(response.status>=520&&response.status<=527)){
  console.warn('[请求] 网关返回 '+response.status+'，面板源站可能不可达：'+(encrypted||url.href));
  throw Object.assign(fail('服务器暂时无法连接，请稍后重试。（'+response.status+'）',response.status),{network:true});
 }
 let result;try{result=await response.json()}catch{throw Object.assign(fail('服务器返回了无效响应，请稍后重试。',response.status),{generic:true});}
 if(!response.ok || result?.status==='fail'||result?.status==='error'){
  // generic 标记「这条文案是我们自己凑的，后端没给原因」。调用方想换成
  // 更贴合场景的提示时需要区分：后端给了原因就该照原文显示，不能盖掉。
  // errors 优先：V2board（Laravel 8）校验失败时 message 固定是英文的
  // "The given data was invalid."，真正的原因只在 errors 里
  const detail=Object.values(result?.errors||{}).flat().filter(x=>typeof x==='string'&&x).join('；');
  const reason=detail||result?.message;
  throw Object.assign(fail(reason||`请求失败 (${response.status})`,response.status),{generic:!reason});
 }
 return result;
}
export const api=async(endpoint,data)=> (await request(endpoint,{data})).data;
export const post=async(endpoint,data)=> (await request(endpoint,{method:'POST',data})).data;
export function useResource(endpoint,params={}){
 const [value,setValue]=useState(),[error,setError]=useState(''),[loading,setLoading]=useState(true),[revision,revise]=useState(0);const key=JSON.stringify(params);
 useEffect(()=>{if(!endpoint){setLoading(false);return}const controller=new AbortController();setLoading(true);setError('');request(endpoint,{data:JSON.parse(key),signal:controller.signal}).then(r=>{setValue(r.data);setLoading(false)}).catch(e=>{if(!controller.signal.aborted){setError(e.message);setLoading(false)}});return()=>controller.abort()},[endpoint,key,revision]);
 return {value,error,loading,reload:useCallback(()=>revise(x=>x+1),[]),setValue};
}
export function useAction(){const {message}=AntApp.useApp();const [busy,setBusy]=useState(false),lock=useRef(false);const run=async(fn,success)=>{if(lock.current)return;lock.current=true;setBusy(true);try{const result=await fn();if(success)message.success(success);return result}catch(e){message.error(e.message);return undefined}finally{lock.current=false;setBusy(false)}};return{busy,run};}
export function Load({resource,children}){const t=useT();if(resource.loading&&!resource.value)return <Skeleton active paragraph={{rows:4}}/>;if(resource.error)return <Alert type="error" title={resource.error} action={<AntButton onClick={resource.reload}>{t('重试')}</AntButton>}/>;return children(resource.value);}
export function Panel({children,className='',...props}){return <Card className={'panel '+className} {...props}><Card.Content>{children}</Card.Content></Card>}
export function Action({children,onClick,loading,disabled,variant='primary',...props}){return <Button variant={variant} isPending={loading} isDisabled={disabled} onPress={onClick} {...props}>{children}</Button>}
export function Status({children,tone='default'}){return <Chip size="sm" variant="soft" className={'status status-'+tone}>{children}</Chip>}
export function Heading({kicker,title,children,action}){return <div className="page-heading"><div><span className="eyebrow">{kicker}</span><h1>{title}</h1>{children&&<p>{children}</p>}</div>{action}</div>}
export function Blank(){const t=useT();return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('暂无数据')}/>}
/**
 * 富文本渲染。两档净化，与内容来源匹配：
 *
 *   默认档   套餐描述、公告 —— 应该是纯排版，iframe 一类一律剥掉
 *   rich 档  知识库文章 —— 教程里普遍嵌视频，放行 iframe 及其必要属性
 *
 * 两档都由 DOMPurify 剥掉 script、on* 事件属性和 javascript: 协议。
 * 面板后台的富文本名义上可信（填的人是管理员），但"能写这些字段"不该等于
 * "能在每个用户浏览器里跑 JS" —— 多客服分权、管理员账号被盗、套餐描述来自
 * 上游分销面板时，不过滤就是一条存储型 XSS。所以照样过一遍。
 *
 * 注意这与客服嵌入代码 / 自定义页脚 HTML 不同：那两个的功能本身就是注入
 * <script>，属于站长对自己站点的操作，走原始注入、不经过这里。
 */
/**
 * 两档各用一个独立的 DOMPurify 实例，钩子只挂在自己身上。
 *
 * sandbox / rel 必须在**净化后的最终节点**上设置（afterSanitizeAttributes 钩子），
 * 而且结果以 DOM 片段直接挂进页面、不再序列化成字符串重新解析。
 * 之前是净化前先给 iframe 加 sandbox，再把净化结果当 HTML 字符串塞进 innerHTML ——
 * 每多解析一次，特制的正文就有机会让 iframe 只在后一次解析时才出现（mXSS），
 * 那个 iframe 就一个 sandbox 都没有。
 */
function purifier(rich){
 const p=DOMPurify(window);
 p.addHook('afterSanitizeAttributes',node=>{
  if(node.nodeName==='A'&&node.getAttribute('target')==='_blank')node.setAttribute('rel','noopener noreferrer');
  // sandbox 是必须的：放行 iframe 后，能写知识库正文的人（分权客服、被盗的
  // 管理员账号、上游分销面板的内容）就能在真实域名下放一个全宽的假登录框。
  // allow-scripts + allow-same-origin 一起给会让 sandbox 失效，所以只给脚本和全屏，
  // 播放器够用，取不到本站的 storage / Cookie，也弹不出顶层导航。
  // 正文里自带的 sandbox 在这里被整体覆盖，写什么都放宽不了。
  if(rich&&node.nodeName==='IFRAME'){node.setAttribute('sandbox','allow-scripts allow-presentation');node.setAttribute('referrerpolicy','no-referrer')}
 });
 return p;
}
const purifiers={plain:purifier(false),rich:purifier(true)};
/**
 * 允许的链接协议。除了网页 / 邮件 / 电话，放行各代理客户端的一键导入协议 ——
 * 教程里的「导入到 sing-box」「导入到 Clash Meta」按钮就靠这些。
 * 其余带协议的值一律拒绝；不带协议的相对地址（后半段）照常放行。
 *
 * 带连字符的协议名（sing-box / clash-meta）只能逐个列在前面：想靠放宽后半段的
 * 字符集去兜住它们，会连 ms-msdt: / search-ms: 这类能拉起系统程序的协议一起放行。
 */
const URI_SCHEMES='https?|mailto|tel|clash|clashx|clash-meta|clashmeta|mihomo|flclash|hiddify|sing-box|singbox|sn|sub|stash|surge|quantumult-x|shadowrocket|loon|v2rayng|v2rayn|nekobox|karing';
const ALLOWED_URI=new RegExp('^(?:(?:'+URI_SCHEMES+'):|[^a-z]|[a-z+.\\-]+(?:[^a-z+.\\-:]|$))','i');
function sanitize(content,rich){
 // Preserve legacy knowledge copy/jump buttons without executing arbitrary inline JavaScript.
 // 这一步只把 onclick 翻译成 data-*，和安全无关；安全相关的改写都在上面的钩子里。
 const parsed=new DOMParser().parseFromString(marked.parse(content),'text/html');
 for(const element of parsed.querySelectorAll('[onclick]')){const handler=element.getAttribute('onclick').trim();const jump=handler.match(/^(?:window\.)?jump\(\s*['"]?(\d+)['"]?\s*\)\s*;?$/),copy=handler.match(/^(?:window\.)?copy\(\s*(['"])([\s\S]*?)\1\s*\)\s*;?$/);if(jump)element.dataset.knowledgeId=jump[1];if(copy&&!copy[2].includes(copy[1]))element.dataset.copyText=copy[2];element.removeAttribute('onclick')}
 return purifiers[rich?'rich':'plain'].sanitize(parsed.body.innerHTML,{
  ADD_TAGS:rich?['iframe']:[],
  ADD_ATTR:rich?['target','allow','allowfullscreen','frameborder','scrolling']:['target'],
  FORBID_TAGS:['style','form','input'],
  ALLOWED_URI_REGEXP:ALLOWED_URI,
  RETURN_DOM_FRAGMENT:true});
}
export function Rich({content,rich=false}){
 const {run}=useAction(),t=useT(),ref=useRef(null);
 // 面板对空描述返回 null（不是 undefined，默认参数兜不住），不处理就会显示成文字 "null"
 const text=content==null?'':String(content);
 let rows=null;try{const v=JSON.parse(text);if(Array.isArray(v))rows=v}catch{}
 const fragment=useMemo(()=>rows?null:sanitize(text,rich),[text,rich]);
 useLayoutEffect(()=>{if(ref.current&&fragment)ref.current.replaceChildren(fragment.cloneNode(true))},[fragment]);
 if(rows)return <ul className="features">{rows.map((r,i)=><li key={i} className={r?.support===false?'muted':''}><span>{r?.support===false?'−':'✓'}</span>{r?.feature||r?.name||r?.text||r?.value}</li>)}</ul>;
 return <div ref={ref} className="rich" onClick={e=>{const copy=e.target.closest('[data-copy-text]');if(copy){e.preventDefault();run(()=>copyText(copy.dataset.copyText),t('复制成功'))}}}/>;
}
/**
 * 加载外部脚本，同一个 src 只加载一次。
 *
 * 失败或超时会把 <script> 和缓存条目一起清掉，所以下次挂载能真正重试 ——
 * 之前 service.jsx 另写了一个按 DOM id 去重的版本，一旦首次失败，后续挂载会
 * 往一个事件已经发完的元素上挂监听，Promise 永远不落地，SDK 初始化和失败日志
 * 双双丢失。两处合用这一个。
 */
const pendingScripts=new Map();
export function loadScript(src){
 if(pendingScripts.has(src))return pendingScripts.get(src);
 const p=new Promise((resolve,reject)=>{
  const tag=document.createElement('script');tag.src=src;tag.async=true;
  const fail=message=>{clearTimeout(timer);pendingScripts.delete(src);tag.remove();reject(Error(message))};
  const timer=setTimeout(()=>fail('外部服务加载超时，请重试。'),20000);
  tag.onload=()=>{clearTimeout(timer);resolve()};
  tag.onerror=()=>fail('外部服务加载失败，请重试。');
  document.head.append(tag);
 });
 pendingScripts.set(src,p);return p;
}
export function money(cents=0){return (Number(cents||0)/100).toFixed(2)}
export function bytes(n=0){n=Number(n)||0;const sizes=['B','KB','MB','GB','TB'];const i=n>0?Math.min(4,Math.floor(Math.log(n)/Math.log(1024))):0;return `${(n/1024**i).toFixed(i?2:0)} ${sizes[i]}`;}
export function date(n,includeTime=false){if(!n)return '—';return new Intl.DateTimeFormat(getLocale(),{year:'numeric',month:'2-digit',day:'2-digit',...(includeTime?{hour:'2-digit',minute:'2-digit'}:{})}).format(new Date(n*1000));}
export const periodNames={month_price:'月付',quarter_price:'季付',half_year_price:'半年付',year_price:'年付',two_year_price:'两年付',three_year_price:'三年付',onetime_price:'一次性',reset_price:'重置流量包'};
export function availablePeriods(plan){return Object.keys(periodNames).filter(k=>plan?.[k]!=null)}
export const AuthContext=createContext({});
export function useAccount(){return useContext(AuthContext)}
export async function copyText(text){if(!text)throw Error('暂无可复制的内容');if(navigator.clipboard&&window.isSecureContext)return navigator.clipboard.writeText(text);const e=document.createElement('textarea');e.value=text;e.style.position='fixed';e.style.opacity='0';document.body.append(e);e.select();const ok=document.execCommand('copy');e.remove();if(!ok)throw Error('复制失败，请手动复制');}
export function safeURL(value){if(!value)return null;try{const u=new URL(value,location.origin);return ['https:','http:'].includes(u.protocol)?u.href:null}catch{return null}}
