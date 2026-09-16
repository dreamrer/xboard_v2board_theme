import React,{useState} from 'react';
import {App as AntApp,Tabs,Form,Input,Switch,Select,InputNumber,Modal,Table,Pagination,Avatar,Alert,Button as AntButton} from 'antd';
import {Wallet,Copy,ArrowUpRight,Shield,Mail,Send,Users,Link2,Monitor,LogOut} from 'lucide-react';
import {Action,Panel,Status,Heading,Load,Blank,useT,useAccount,useResource,useAction,money,date,api,post,request,copyText,navigate,safeURL,conf,token,trimTrailingSlash} from './core';
import {normalizeSessions} from './panel';
import {GiftCard} from './giftcard';
export function Profile(){const t=useT(),{user,config,reload}=useAccount(),{modal}=AntApp.useApp(),{busy,run}=useAction(),[form]=Form.useForm(),[bot,setBot]=useState(null);const password=v=>run(async()=>{await post('/user/changePassword',{old_password:v.old_password,new_password:v.new_password});form.resetFields()},t('密码修改成功'));
 /**
  * 免登录链接。两个面板都是 POST /user/getQuickLoginUrl，返回
  * {app_url}/#/login?verify=CODE&redirect=dashboard，**有效期 60 秒**
  * （Xboard LoginService / v2board UserController 都是 Cache::put(...,60)）。
  * 登录页已经会处理 ?verify=，所以链接直接可用。
  *
  * 注意链接域名取的是面板的 app_url。分离部署时若 app_url 指向面板而不是前端
  * 域名，生成的链接会打开面板自己的地址 —— 这由站长的 app_url 决定，主题改不了。
  */
 const quickLogin=()=>run(async()=>{
  const url=await post('/user/getQuickLoginUrl');
  if(!url||typeof url!=='string')throw Error(t('生成失败，请稍后再试'));
  await copyText(url);
 },t('链接已复制，60 秒内有效'));
 const reset=()=>modal.confirm({title:t('重置订阅信息'),content:t('当你的订阅地址或账户发生泄漏被他人滥用时，可以在此重置订阅信息。避免带来不必要的损失。'),okText:t('重置'),cancelText:t('取消'),okButtonProps:{danger:true},onOk:()=>run(async()=>{await api('/user/resetSecurity');reload()},t('重置成功'))});
 return <><Heading kicker="PERSONAL / 06" title={t('个人中心')}/><div className="profile-banner"><Avatar size={62} src={safeURL(user.avatar_url)}>{user.email?.[0]?.toUpperCase()}</Avatar><div><h2>{user.email}</h2><span>{t('我的账户')}</span></div><div className="wallet-inline"><span>{t('账户余额(仅消费)')}</span><strong>{config.currency_symbol}{money(user.balance)}</strong></div></div><Tabs defaultActiveKey="security" items={[{key:'security',label:t('修改密码'),children:<div className="settings-grid"><Panel><div className="section-title"><h2>{t('修改密码')}</h2><Shield size={20}/></div><Form form={form} layout="vertical" requiredMark={false} onFinish={password}><Form.Item name="old_password" label={t('旧密码')} rules={[{required:true}]}><Input.Password aria-label={t('旧密码')} autoComplete="current-password"/></Form.Item><Form.Item name="new_password" label={t('新密码')} rules={[{required:true,min:8}]}><Input.Password aria-label={t('新密码')} autoComplete="new-password"/></Form.Item><Form.Item name="confirm" label={t('再次输入密码')} dependencies={['new_password']} rules={[{required:true},({getFieldValue})=>({validator:(_,v)=>v===getFieldValue('new_password')?Promise.resolve():Promise.reject(Error(t('两次新密码输入不同')))})]}><Input.Password aria-label={t('再次输入密码')} autoComplete="new-password"/></Form.Item><Action type="submit" loading={busy}>{t('保存')}</Action></Form></Panel><Panel className="security-panel"><Shield size={28}/><h2>{t('重置订阅信息')}</h2><p>{t('当你的订阅地址或账户发生泄漏被他人滥用时，可以在此重置订阅信息。避免带来不必要的损失。')}</p><Action variant="danger" onClick={reset}>{t('重置')}</Action></Panel><Panel className="security-panel"><Link2 size={28}/><h2>{t('免登录链接')}</h2><p>{t('生成一条 60 秒内有效的临时链接，在其他设备上打开即可直接登录')}</p><Action variant="secondary" loading={busy} onClick={quickLogin}><Link2 size={16}/>{t('生成并复制')}</Action></Panel></div>},{key:'notifications',label:t('通知'),children:<Panel><div className="setting-row"><div><Mail size={20}/>{t('到期邮件提醒')}</div><Switch aria-label={t('到期邮件提醒')} checked={!!user.remind_expire} loading={busy} onChange={v=>run(async()=>{await post('/user/update',{remind_expire:v?1:0});reload()},t('更新成功'))}/></div><div className="setting-row"><div><Mail size={20}/>{t('流量邮件提醒')}</div><Switch aria-label={t('流量邮件提醒')} checked={!!user.remind_traffic} loading={busy} onChange={v=>run(async()=>{await post('/user/update',{remind_traffic:v?1:0});reload()},t('更新成功'))}/></div>{!!config.is_telegram&&<div className="setting-row"><div><Send size={20}/>{t('绑定Telegram')}</div>{user.telegram_id?<Status>{t('已绑定')}</Status>:<Action variant="secondary" onClick={()=>run(async()=>setBot(await api('/user/telegram/getBotInfo')))}>{t('立即开始')}</Action>}</div>}</Panel>},{key:'devices',label:t('登录设备'),children:<Sessions/>},{key:'giftcard',label:t('兑换码'),children:<div className="settings-stack"><GiftCard/></div>},{key:'wallet',label:t('我的钱包'),children:<div className="settings-grid"><Panel className="wallet-panel"><Wallet size={26}/><span>{t('账户余额(仅消费)')}</span><strong>{config.currency_symbol}{money(user.balance)}</strong><Action variant="secondary" onClick={()=>navigate('/plan')}>{t('购买订阅')}</Action></Panel><Panel className="wallet-panel"><Users size={26}/><span>{t('推广佣金(可提现)')}</span><strong>{config.currency_symbol}{money(user.commission_balance)}</strong><Action variant="secondary" onClick={()=>navigate('/invite')}>{t('我的邀请')}</Action></Panel></div>} ]}/><Modal open={!!bot} onCancel={()=>setBot(null)} title={t('绑定Telegram')} footer={null}>{bot&&<div className="telegram-help"><p>{t('打开Telegram搜索')}</p><a href={'https://t.me/'+encodeURIComponent(bot.username)} target="_blank" rel="noreferrer">@{bot.username}</a><p>{t('向机器人发送你的')}</p><Input readOnly value={'/bind '+user.uuid}/><Action onClick={()=>run(()=>copyText('/bind '+user.uuid),t('复制成功'))}>{t('复制')}</Action></div>}</Modal></>}
/**
 * 登录设备管理。
 *
 * 两个面板的返回结构完全不同（数组 vs 以会话 id 为键的对象），由
 * panel.js 的 normalizeSessions 抹平；Xboard 不给 IP / UA，所以那两列可能为空。
 * 接口两边都有，但属于可选能力 —— 拿不到就整块不显示，不留一个空白面板。
 */
function Sessions(){
 const t=useT(),{run}=useAction(),{modal}=AntApp.useApp();
 const sessions=useResource('/user/getActiveSession');
 // 按行记 pending：共用一个 busy 会让点一行时所有行一起转圈
 const [pending,setPending]=useState('');
 // 请求失败（面板没这接口 / 故障）就不显示这一块
 if(sessions.error)return <Panel><p className="muted">{t('暂时无法获取登录设备')}</p></Panel>;
 const kick=row=>modal.confirm({
  title:t('移除该设备'),
  content:row.current?t('这是你当前正在使用的设备，移除后需要重新登录。'):t('移除后该设备需要重新登录。'),
  okText:t('移除'),cancelText:t('取消'),okButtonProps:{danger:true},
  onOk:()=>{setPending(row.id);return run(async()=>{await post('/user/removeActiveSession',{session_id:row.id});sessions.reload()},t('已移除')).finally(()=>setPending(''))}
 });
 return <Load resource={sessions}>{raw=>{
  const rows=normalizeSessions(raw,token());
  if(!rows.length)return <Panel><Blank/></Panel>;
  return <Panel><div className="session-list">{rows.map(r=><div className="session-row" key={r.id}>
   <Monitor size={20}/>
   <div>
    <strong>{r.device||t('未知设备')}{r.current&&<Status tone="success">{t('当前设备')}</Status>}</strong>
    <span>{[r.ip,r.loginAt?t('登录于 {time}',{time:date(r.loginAt,true)}):'',r.lastUsedAt?t('最后活跃 {time}',{time:date(r.lastUsedAt,true)}):''].filter(Boolean).join(' · ')||'—'}</span>
   </div>
   <AntButton type="text" danger loading={pending===r.id} onClick={()=>kick(r)}><LogOut size={16}/>{t('移除')}</AntButton>
  </div>)}</div></Panel>;
 }}</Load>;
}

/**
 * 邀请链接的域名前缀。
 *
 * 默认用用户当前访问的地址；站长可以在主题配置里指定备用域名 ——
 * 主域名被墙之后，用户手上已经发出去的邀请链接才不会全是死链。
 * 填错（少了协议之类）就退回当前域名，不至于生成一堆打不开的链接。
 */
function inviteBase(){
 const custom=trimTrailingSlash(conf('invite_domain'));
 if(custom){
  if(/^https?:\/\//i.test(custom))return custom+'/';
  console.warn('[邀请] 邀请链接域名必须以 http:// 或 https:// 开头，已忽略：'+custom);
 }
 return location.origin+location.pathname;
}

export function Invite(){const t=useT(),invite=useResource('/user/invite/fetch'),{config}=useAccount(),{busy,run}=useAction(),[dialog,setDialog]=useState(''),[form]=Form.useForm(),[page,setPage]=useState(1),[pageSize,setPageSize]=useState(10),[logs,setLogs]=useState({data:[],total:0}),[logError,setLogError]=useState('');
 React.useEffect(()=>{let active=true;setLogError('');// 每次重取都清掉上次的错误，否则一次失败会永久盖住表格
 request('/user/invite/details',{data:{current:page,page_size:pageSize}}).then(r=>{if(active){setLogs(r);setLogError('')}}).catch(e=>active&&setLogError(e.message));return()=>active=false},[page,pageSize]);
 const submit=values=>run(async()=>{if(dialog==='transfer')await post('/user/transfer',{transfer_amount:Math.round(Number(values.amount)*100)});else await post('/user/ticket/withdraw',{withdraw_method:values.method,withdraw_account:values.account});setDialog('');form.resetFields();invite.reload();if(dialog==='withdraw')navigate('/ticket')},t(dialog==='transfer'?'划转成功':'创建成功'));
 return <><Heading kicker="SHARE / 05" title={t('我的邀请')} action={<Action onClick={()=>run(async()=>{await api('/user/invite/save');invite.reload()},t('已生成'))}>{t('生成邀请码')}<ArrowUpRight size={16}/></Action>}/><Load resource={invite}>{data=>{const s=data.stat||[];return <><div className="invite-hero"><div><span>{t('当前剩余佣金')}</span><strong>{config.currency_symbol}{money(s[4])}</strong><div className="inline-actions"><Action variant="secondary" onClick={()=>setDialog('transfer')}>{t('划转')}</Action>{!config.withdraw_close&&<Action variant="outline" onClick={()=>setDialog('withdraw')}>{t('推广佣金提现')}</Action>}</div></div><div className="invite-stats"><span>{t('已注册用户数')}<b>{s[0]||0}</b></span><span>{t('佣金比例')}<b>{config.commission_distribution_enable?[1,2,3].map(i=>Math.floor(Number(config['commission_distribution_l'+i]||0)*s[3]/100)+'%').join(' / '):(s[3]||0)+'%'}</b></span><span>{t('确认中的佣金')}<b>{money(s[2])}</b></span><span>{t('累计获得佣金')}<b>{money(s[1])}</b></span></div></div><section className="section-block"><h2>{t('邀请码管理')}</h2><div className="invite-codes">{data.codes?.map(c=>{const link=inviteBase()+'#/register?code='+encodeURIComponent(c.code);return <Panel key={c.code}><div className="invite-code"><span>{c.code}</span><Action variant="ghost" onClick={()=>run(()=>copyText(link),t('复制成功'))}><Copy size={16}/>{t('复制链接')}</Action></div><small>{date(c.created_at)}</small></Panel>})}</div></section></>}}</Load><section className="section-block"><h2>{t('佣金发放记录')}</h2>{logError?<Alert type="error" title={logError}/>:<Table rowKey={(r,i)=>r.id||r.trade_no||i} dataSource={logs.data||[]} pagination={false} columns={[{title:t('发放时间'),dataIndex:'created_at',render:d=>date(d,true)},{title:t('佣金'),dataIndex:'get_amount',render:n=>config.currency_symbol+money(n)}]}/>}<Pagination current={page} total={logs.total||logs.data?.length||0} pageSize={pageSize} showSizeChanger pageSizeOptions={[10,50,100]} onChange={(p,size)=>{setPage(p);setPageSize(size)}}/></section><Modal title={t(dialog==='transfer'?'划转':'推广佣金提现')} open={!!dialog} onCancel={()=>setDialog('')} footer={null} destroyOnHidden><Form form={form} layout="vertical" onFinish={submit}>{dialog==='transfer'?<><p>{t('划转后的余额仅用于Xboard消费使用')}</p><Form.Item name="amount" label={t('划转金额')} rules={[{required:true,type:'number',min:.01}]}><InputNumber aria-label={t('划转金额')} min={.01} precision={2} style={{width:'100%'}}/></Form.Item></>:<><Form.Item name="method" label={t('提现方式')} rules={[{required:true}]}><Select aria-label={t('提现方式')} options={(config.withdraw_methods||[]).map(m=>({value:m,label:m}))}/></Form.Item><Form.Item name="account" label={t('提现账号')} rules={[{required:true,whitespace:true}]}><Input aria-label={t('提现账号')}/></Form.Item></>}<Action type="submit" fullWidth loading={busy}>{t('确定')}</Action></Form></Modal></>}
