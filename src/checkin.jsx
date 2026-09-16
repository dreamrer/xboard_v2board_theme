import React,{useEffect,useState,useRef} from 'react';
import {App as AntApp} from 'antd';
import {Gift,CheckCircle2,Loader2} from 'lucide-react';
import {request,useT,bytes,storage,conf} from './core';
import {panelType} from './panel';

/**
 * 每日签到 —— 同时适配两套互不兼容的后端契约。
 *
 * Xboard 走第三方「每日签到」插件：
 *   GET  /user/checkin → {enabled, checked_today, streak, reason}
 *   POST /user/checkin → {success, streak, traffic}（失败也是 HTTP 200，看 success）
 *
 * V2board（带内置签到的分支）只有 POST，没有查状态的接口：
 *   POST /user/checkin  body: type=1 → {data:true|false, message, traffic}
 *   功能没开时直接 HTTP 500。message 后端已经拼成完整中文句子，直接显示即可。
 *
 * 面板类型留空（默认「自动识别」）时靠**探测 GET** 判定：
 *   200 → Xboard 插件装着
 *   405 → 路由存在但不收 GET，即 v2board 那种只有 POST 的内置签到
 *   404 / 其它 → 没这功能，整张卡片不渲染（不给没装插件的站点留坏按钮）
 *
 * 站长在主题配置里明确选了面板，就按所选的契约直接走：选 v2board 连探测都不发
 * （省一个请求），选 Xboard 则探测失败就是没有、不再回退去猜 v2board。
 * checkin_mode 只管这个功能的总开关。
 */

/**
 * v2board 模式下没有「今天签没签」的查询接口，只能本地记一笔，
 * 免得刷新后又出现一个按下去只会说「今天已签过」的按钮。
 * 这只是同一浏览器内的体验优化：清了缓存或换设备会重新出现按钮，
 * 真正的重复签到由后端的当日占位（SET NX）拦住，不依赖这里。
 */
const markKey='herorui-checkin-day';
const today=()=>new Date().toLocaleDateString('sv');// sv locale 直接给 YYYY-MM-DD
const readMark=email=>storage.get(markKey)?.[email||'']===today();
const writeMark=email=>storage.set(markKey,{[email||'']:today()});

export function CheckinTile({email,onDone}){
 const t=useT(),{message}=AntApp.useApp();
 const panel=panelType(),enabled=conf('checkin_mode','auto')!=='off';
 const [mode,setMode]=useState(null);// null=探测中
 const [state,setState]=useState({checkedToday:false,streak:0,reason:null});
 const [busy,setBusy]=useState(false);
 // v2board 模式下连续失败次数，用于「第二次才收起入口」
 const fails=useRef(0);

 /** 只取数，不写 state —— 组件可能在请求返回前就被卸载（main.jsx 用 key 重挂 <main>） */
 const loadXboard=async()=>(await request('/user/checkin')).data;

 /**
  * 把插件返回的状态写进 state。
  *
  * 只有后端**明确**说没开才关掉 —— 字段缺失只说明这个插件版本不返回它，
  * 与 panel.js 对 sell 的取舍一致：不存在 ≠ 关闭。
  * reason 来自第三方插件，可能是对象或数组；直接当 React 子节点渲染会抛
  * 「Objects are not valid as a React child」，把整个面板带进 ErrorBoundary，
  * 所以统一转成字符串。
  */
 const applyXboard=d=>{
  const info=d&&typeof d==='object'?d:{};
  if(info.enabled!=null&&!Number(info.enabled)){setMode('off');return}
  setMode('xboard');
  setState({checkedToday:!!Number(info.checked_today),streak:Number(info.streak)||0,reason:info.reason==null?null:String(info.reason)});
 };

 useEffect(()=>{
  if(!enabled){setMode('off');return}
  // 明确选了 v2board：它没有查状态的接口，探测纯属浪费一个请求
  if(panel==='v2board'){setMode('v2board');setState(s=>({...s,checkedToday:readMark(email)}));return}
  let active=true;
  (async()=>{
   try{
    const d=await loadXboard();
    if(active)applyXboard(d);
   }catch(e){
    if(!active)return;
    // 405 = 路由在、但只收 POST，正是 v2board 内置签到的样子。
    // 站长指定了 Xboard 就不做这个回退，探不到就是没有。
    if(panel==='auto'&&e.status===405){setMode('v2board');setState(s=>({...s,checkedToday:readMark(email)}));return}
    // 404 = 面板没这个功能，正常结果，安静收起。
    //
    // 其余（500 / 超时 / 中间件配置错）是故障。这里仍然收起入口 —— 状态没探到
    // 就没有可渲染的内容，硬显示一个不知道能不能点的按钮更糟；但必须留下线索，
    // 否则用户白丢一天签到还查不出原因。与 submit 路径的差别是有意的：
    // 那边已经拿到了状态、按钮就在眼前，所以报错后保留入口。
    if(e.status!==404)console.warn('[签到] 探测失败，本次不显示签到入口：'+(e.message||e),e.status?'HTTP '+e.status:'');
    setMode('off');
   }
  })();
  return()=>{active=false};
 },[enabled,panel,email]);

 const submit=async()=>{
  if(busy||state.checkedToday||state.reason)return;
  setBusy(true);
  try{
   if(mode==='v2board'){
    // type=1 是普通签到；运气签到（type=2）需要用户输入数值，这里不涉及
    const r=await request('/user/checkin',{method:'POST',data:{type:1}});
    if(r.data===false){
     // data:false 是业务性失败（今天已签过、订阅不可用）。不去匹配文案 ——
     // request() 会带上 Content-Language，两个面板都据此本地化，zh-TW 回的是
     // 「已經簽到」，日韩俄语更是完全不同，靠中文正则必然漏。
     // 处理方式与语言无关：本次会话内禁掉按钮（避免反复点出同一句提示），
     // 但不写当天的本地标记 —— 万一原因是订阅不可用，刷新后还应该能再试。
     message.warning(r.message||t('签到失败'));
     setState(s=>({...s,checkedToday:true}));
     return;
    }
    fails.current=0;
    setState(s=>({...s,checkedToday:true}));
    writeMark(email);
    message.success(r.message||t('签到成功'));
   }else{
    const d=(await request('/user/checkin',{method:'POST'})).data||{};
    if(!d.success){message.warning(d.message||t('签到失败'));await loadXboard().then(applyXboard).catch(()=>{});return}
    setState(s=>({checkedToday:true,streak:Number(d.streak)||s.streak,reason:null}));
    // 插件回的 traffic 有的版本已是「50 MB」这样的字符串，有的是字节数
    const gained=d.traffic==null?'':(/^\d+$/.test(String(d.traffic))?bytes(d.traffic):String(d.traffic));
    message.success(gained?t('签到成功，获得 {traffic}',{traffic:gained}):t('签到成功'));
   }
   onDone?.();
  }catch(e){
   // v2board 把「功能没开」也走 abort(500)，和真实故障（用户不存在、数据库抖动）
   // 同一个状态码，只能看文案区分。不管哪种都先把原因说出来 —— 之前一律当成
   // 「没这功能」静默收起卡片，真出错时按钮凭空消失、控制台也没线索。
   message.error(e.generic?t('签到失败'):e.message);
   // v2board 用 abort(500) 同时表示「功能没开」「用户不存在」和真实故障，
   // 无法区分 —— 也不能靠文案区分，后端会按 Content-Language 本地化，
   // 中文正则在 zh-TW / ja / ko 上必然漏。
   //
   // 折中：第一次失败只报错、保留入口（可能只是数据库抖了一下，用户还能重试）；
   // 连续第二次再收起（那就是持续性的，不留一个按下去永远报错的按钮）。
   // 与语种无关，也不会因为一次偶发故障让用户白丢一天签到。
   if(mode==='v2board'&&e.status>=500){
    const n=fails.current+1;fails.current=n;
    if(n>=2)setMode('off');
   }
  }finally{setBusy(false)}
 };

 if(mode===null||mode==='off')return null;
 const done=state.checkedToday,blocked=!!state.reason;
 // 与 metrics-strip 里其它入口同构：上面小字是说明，下面大字是当前状态
 const label=blocked?state.reason:state.streak>1?t('已连续 {days} 天',{days:state.streak}):t('每日签到');
 const value=done?t('已签到'):blocked?t('不可签到'):t('立即签到');
 return <button type="button" className={'checkin-tile'+(done?' is-done':'')} onClick={submit} disabled={busy||done||blocked} title={state.reason||''}>
  {busy?<Loader2 size={19} className="spin"/>:done?<CheckCircle2 size={19}/>:<Gift size={19}/>}
  <span>{label}<strong>{value}</strong></span>
 </button>;
}
