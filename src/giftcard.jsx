import React,{useEffect,useState} from 'react';
import {App as AntApp,Input,Table,Pagination,Alert,Divider} from 'antd';
import {Gift,Ticket,Check,X} from 'lucide-react';
import {Action,Panel,Status,Blank,useT,useAccount,useAction,request,post,money,bytes,date} from './core';
import {panelType} from './panel';

/**
 * 兑换码 —— 两个面板的接口差得比签到还远。
 *
 * Xboard（核心自带，路由无条件注册）：
 *   POST /user/gift-card/check   {code}  → 预览，不消耗次数
 *        返回 {code_info:{code,template:{name,description,type_name,...},plan_info?},
 *              reward_preview:{...}, can_redeem, reason}
 *   POST /user/gift-card/redeem  {code}  → 兑换
 *   GET  /user/gift-card/history {page,per_page} → {data,pagination}（**没有** success 包装）
 *   GET  /user/gift-card/types           → {types:{1:'通用',...}}
 *
 * V2board（部分分支才有）：
 *   POST /user/redeemgiftcard    {giftcard} → 直接兑换
 *        字段名是 giftcard 不是 code；没有预览，也没有兑换记录；失败走 abort(500,...)
 *
 * 所以 Xboard 是「输码 → 看预览 → 确认兑换 → 查记录」，v2board 只能「输码 → 兑换」。
 *
 * 模式判定分两步探测，都没有副作用、也不需要先有一个码：
 *   GET /user/gift-card/types   200 → Xboard
 *   GET /user/redeemgiftcard    405 → 路由在、只收 POST，即带兑换码的 v2board 分支
 *                               404 → 这个面板根本没有兑换码（原版 V2board 就是这样）
 * 站长指定了 Xboard 就跳过探测（核心自带、路由无条件注册）；指定 v2board 只做第二步。
 * 探测遇到故障（5xx / 超时）不猜结果，给一个重试按钮 —— 猜错了的话，
 * 用户对着有效的码只会看到一个不存在的端点回的 404。
 */

/**
 * 盲盒礼品卡（GiftCardTemplate::TYPE_MYSTERY）。
 *
 * 后端的 previewRewards() 和 redeem 各自独立调用 calculateActualRewards()，
 * 而这个方法对盲盒类型走的是 mt_rand —— 两次调用结果**不一样**。
 * 所以盲盒的预览只是一次随机抽样，不能当成「你会得到什么」展示出去，
 * 否则就是在界面上替后端许一个它没许的诺。
 */
const TYPE_MYSTERY=3;

/** 奖励字段 → 展示文案。未知键原样显示，不静默丢掉。 */
const REWARD_LABELS={
 balance:['账户余额',v=>'+'+money(v)],
 // 注意单位：GiftCardService 把这个值直接累加到 users.transfer_enable，
 // 而那个字段是**字节**（套餐表里的 transfer_enable 才是 GB）。
 // 当成 GB 显示会变成「+107374182400 GB」。
 transfer_enable:['流量',v=>'+'+bytes(v)],
 expire_days:['有效期',v=>'+'+v+' 天'],
 plan_validity_days:['套餐时长',v=>v+' 天'],
 device_limit:['设备数',v=>v+' 台'],
 reset_package:['流量重置',()=>'包含'],
 // GiftCardService 里是比例（默认 0.2，乘到余额上），不是百分数
 invite_reward_rate:['邀请返利',v=>Math.round(Number(v)*1000)/10+'%']
};

function Rewards({rewards,planName,compact=false}){
 const t=useT();
 const rows=Object.entries(rewards||{}).filter(([k,v])=>v!=null&&v!==''&&v!==false&&k!=='plan_id'&&typeof v!=='object');// random_rewards 等嵌套结构不是可展示的奖励
 if(planName)rows.unshift(['__plan',planName]);
 if(!rows.length)return null;
 return <ul className={'reward-list'+(compact?' is-compact':'')}>{rows.map(([k,v])=>{
  if(k==='__plan')return <li key={k}><span>{t('套餐')}</span><b>{String(v)}</b></li>;
  const label=REWARD_LABELS[k];
  return <li key={k}><span>{t(label?label[0]:k)}</span><b>{label?label[1](v):String(v)}</b></li>;
 })}</ul>;
}

export function GiftCard(){
 const t=useT(),{reload}=useAccount(),{message}=AntApp.useApp(),{busy,run}=useAction();
 const forced=panelType();
 const [mode,setMode]=useState(forced==='xboard'?'xboard':null);// null=探测中 / absent=面板没有 / error=探测故障
 const [probe,reprobe]=useState(0);
 const [code,setCode]=useState(''),[preview,setPreview]=useState(null),[checking,setChecking]=useState(false);
 const [page,setPage]=useState(1),[revision,revise]=useState(0),[history,setHistory]=useState(null),[historyError,setHistoryError]=useState('');

 // 探测：types 无副作用，不需要码
 useEffect(()=>{
  if(forced==='xboard')return;
  let active=true;
  const broken=e=>{
   console.warn('[兑换码] 面板探测失败：'+(e.message||e),e.status?'HTTP '+e.status:'');
   if(active)setMode('error');
  };
  const v2board=()=>request('/user/redeemgiftcard').then(
   // 能 GET 通说明不是那个只收 POST 的路由，按有这个功能处理，让后端给原因
   ()=>active&&setMode('v2board'),
   e=>{if(!active)return;if(e.status===405)setMode('v2board');else if(e.status===404)setMode('absent');else broken(e)});
  setMode(null);
  if(forced==='v2board')v2board();
  else request('/user/gift-card/types').then(()=>active&&setMode('xboard'),e=>{
   if(!active)return;
   // 只有 404 才说明「不是 Xboard」，再去看是不是带兑换码的 v2board。
   // 500 / 超时 / 中间件配置错都是故障，不能拿来下结论（与 checkin.jsx 同一标准）
   if(e.status===404)v2board();else broken(e);
  });
  return()=>{active=false};
 },[forced,probe]);

 // 兑换记录只有 Xboard 有。这个接口不走 success 包装，直接是 {data,pagination}
 useEffect(()=>{
  if(mode!=='xboard')return;
  let active=true;
  setHistoryError('');// 每次重取都要清掉上次的错误，否则一次失败就永久卡住
  request('/user/gift-card/history',{data:{page,per_page:10}})
   .then(r=>{if(active){setHistory(r);setHistoryError('')}})
   .catch(e=>active&&setHistoryError(e.message));
  return()=>{active=false};
 },[mode,page,revision]);

 const check=async()=>{
  const value=code.trim();
  if(!value)return message.warning(t('请输入兑换码'));
  setChecking(true);setPreview(null);
  try{
   setPreview((await request('/user/gift-card/check',{method:'POST',data:{code:value}})).data);
  }catch(e){
   // 码不存在 / 已过期 / 已停用都是用户输错，属于正常情况
   message.error(e.generic?t('兑换码无效'):e.message);
  }finally{setChecking(false)}
 };

 const redeem=()=>run(async()=>{
  const value=code.trim();
  if(!value)throw Error(t('请输入兑换码'));
  if(mode==='v2board'){
   // 字段名是 giftcard 不是 code
   await post('/user/redeemgiftcard',{giftcard:value});
  }else{
   await post('/user/gift-card/redeem',{code:value});
  }
  setCode('');setPreview(null);
  reload();                                  // 套餐 / 流量 / 余额都可能变了
  if(mode==='xboard')revise(n=>n+1);          // 重拉记录（不要拿 page 当触发器，0 是无效页码）
 },t('兑换成功'));

 if(mode===null)return <Panel><p className="muted">{t('加载中')}</p></Panel>;
 if(mode==='absent')return <Panel><p className="muted">{t('当前站点未开启兑换码功能')}</p></Panel>;
 if(mode==='error')return <Panel><Alert type="warning" title={t('暂时无法获取兑换码功能，请稍后重试')} action={<Action variant="secondary" onClick={()=>reprobe(n=>n+1)}>{t('重试')}</Action>}/></Panel>;

 const canRedeem=mode==='v2board'||(preview?preview.can_redeem!==false:false);
 const columns=[
  {title:t('兑换码'),dataIndex:'code'},
  {title:t('类型'),render:(_,r)=>r.template_type_name||r.template_name||'—'},
  {title:t('获得'),render:(_,r)=><Rewards compact rewards={r.rewards_given}/>},
  {title:t('兑换时间'),dataIndex:'created_at',render:d=>date(d,true)}
 ];

 return <>
  <Panel className="giftcard-panel">
   <div className="section-title"><h2>{t('兑换码')}</h2><Ticket size={20}/></div>
   <p className="muted">{t('输入礼品卡或兑换码，兑换后套餐、流量或余额会立即到账')}</p>
   <div className="giftcard-entry">
    <Input value={code} onChange={e=>{setCode(e.target.value);setPreview(null)}} onPressEnter={()=>mode==='xboard'?check():redeem()}
     placeholder={t('请输入兑换码')} aria-label={t('兑换码')} allowClear/>
    {mode==='xboard'
     ?<Action variant="secondary" loading={checking} disabled={!code.trim()} onClick={check}>{t('查询')}</Action>
     :<Action loading={busy} disabled={!code.trim()} onClick={redeem}>{t('兑换')}</Action>}
   </div>

   {/* Xboard 才有预览：先让用户看清能换到什么，再确认 */}
   {preview&&<div className="giftcard-preview">
    <Divider/>
    <div className="preview-head">
     <Gift size={22}/>
     <div>
      <strong>{preview.code_info?.template?.name||t('兑换码')}</strong>
      {preview.code_info?.template?.description&&<span>{preview.code_info.template.description}</span>}
     </div>
     <Status tone={preview.can_redeem===false?'warning':'success'}>
      {preview.can_redeem===false?<X size={13}/>:<Check size={13}/>}
      {t(preview.can_redeem===false?'不可兑换':'可以兑换')}
     </Status>
    </div>
    {Number(preview.code_info?.template?.type)===TYPE_MYSTERY
     ?<Alert type="info" title={t('盲盒礼品卡：兑换后随机获得奖励，实际到账内容以兑换结果为准')}/>
     :<Rewards rewards={preview.reward_preview} planName={preview.code_info?.plan_info?.name}/>}
    {preview.can_redeem===false&&preview.reason&&<Alert type="warning" title={String(preview.reason)}/>}
    {preview.code_info?.expires_at&&<p className="muted">{t('有效期至')} {date(preview.code_info.expires_at,true)}</p>}
    <Action loading={busy} disabled={!canRedeem} onClick={redeem}>{t('确认兑换')}</Action>
   </div>}
  </Panel>

  {mode==='xboard'&&<Panel>
   <div className="section-title"><h2>{t('兑换记录')}</h2><span className="mini-index">HISTORY</span></div>
   {historyError
    ?<p className="muted">{historyError}</p>
    :history
     ?(history.data?.length
       ?<><Table rowKey="id" dataSource={history.data} columns={columns} pagination={false} scroll={{x:640}}/>
         {(history.pagination?.total||0)>10&&<Pagination align="end" current={history.pagination.current_page||page}
          total={history.pagination.total} pageSize={history.pagination.per_page||10} showSizeChanger={false}
          onChange={setPage}/>}</>
       :<Blank/>)
     :<p className="muted">{t('加载中')}</p>}
  </Panel>}
 </>;
}
