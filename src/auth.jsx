import React,{useEffect,useRef,useState,useContext} from 'react';
import {Form,Input,Checkbox,Select,Alert,App as AntApp} from 'antd';
import {ArrowRight,Globe,Mail} from 'lucide-react';
import {Action,api,post,settings,useT,useAction,navigate,saveToken,languageOptions,LocaleContext,safeURL,conf,loadScript} from './core';
import {guestConfig} from './panel';
export {loadScript} from './core';
function Captcha({config,onToken,cycle}){
 const target=useRef(),[error,setError]=useState('');const kind=config.captcha_type||'recaptcha';
 useEffect(()=>{if(!config.is_captcha||kind==='recaptcha-v3')return;let cancelled=false,widget,provider;const boot=async()=>{try{const turn=kind==='turnstile';await loadScript(turn?'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit':'https://www.google.com/recaptcha/api.js?render=explicit');provider=turn?window.turnstile:window.grecaptcha;if(!turn)await new Promise(r=>provider.ready(r));if(cancelled)return;widget=provider.render(target.current,{sitekey:turn?config.turnstile_site_key:config.recaptcha_site_key,callback:onToken,'expired-callback':()=>onToken(''),'error-callback':()=>{onToken('');setError('验证服务暂不可用，请重试。')}})}catch(e){if(!cancelled)setError(e.message)}};boot();return()=>{cancelled=true;if(provider&&widget!=null){try{provider.remove?provider.remove(widget):provider.reset(widget)}catch{}}}},[config,cycle]);
 return <div className="captcha"><div ref={target}/>{error&&<Alert type="error" title={error}/>}</div>;
}
export function AuthPage({route}){
 const mode=route.split('?')[0].slice(1),register=mode==='register',forget=mode==='forgetpassword',t=useT();
 const [form]=Form.useForm(),[config,setConfig]=useState(),[error,setError]=useState(''),[captcha,setCaptcha]=useState(''),[cycle,setCycle]=useState(0),[seconds,setSeconds]=useState(0),[sending,setSending]=useState(false),[mailing,setMailing]=useState(false);
 const {locale,setLocale}=useContext(LocaleContext),{busy,run}=useAction(),{message}=AntApp.useApp();
 const params=new URLSearchParams(route.split('?')[1]);
 // 过一遍 guestConfig：Xboard 与 v2board 的验证码字段名不同，
 // 且两边都返回 0/1 而非布尔（0 会被 JSX 当文本渲染出来）
 useEffect(()=>{let active=true;api('/guest/comm/config').then(c=>active&&setConfig(guestConfig(c))).catch(e=>active&&setError(e.message));return()=>active=false},[]);
 useEffect(()=>{if(!seconds)return;const id=setTimeout(()=>setSeconds(x=>x-1),1000);return()=>clearTimeout(id)},[seconds]);
 useEffect(()=>{form.resetFields();setCaptcha('');setCycle(x=>x+1)},[mode]);
 const signedIn=data=>{if(!data?.auth_data)throw Error('登录响应无效');saveToken(data.auth_data);window.dispatchEvent(new Event('authchange'));const redirect=params.get('redirect');navigate(redirect?.startsWith('/')&&!redirect.startsWith('//')?redirect:'/dashboard')};
 useEffect(()=>{const verify=params.get('verify');if(verify)run(async()=>signedIn(await api('/passport/auth/token2Login',{verify})))},[]);
 const captchaFields=async(action)=>{if(!config?.is_captcha)return{};if(config.captcha_type==='recaptcha-v3'){await loadScript('https://www.google.com/recaptcha/api.js?render='+encodeURIComponent(config.recaptcha_v3_site_key));await new Promise(r=>window.grecaptcha.ready(r));return{recaptcha_v3_token:await window.grecaptcha.execute(config.recaptcha_v3_site_key,{action})}}if(!captcha)throw Error('请先完成人机验证');return{[config.captcha_type==='turnstile'?'turnstile_token':'recaptcha_data']:captcha}};
 const submit=values=>run(async()=>{const {confirm,agree,suffix,...data}=values;if(register&&config.tos_url&&!agree)throw Error(t('我已阅读并同意服务条款'));data.email=values.email+((register||forget)?suffix||'':'');if(register){Object.assign(data,await captchaFields('register'));signedIn(await post('/passport/auth/register',data))}else if(forget){await post('/passport/auth/forget',data);message.success(t('重置密码成功,正在返回登录'));navigate('/login')}else signedIn(await post('/passport/auth/login',data))}).finally(()=>{setCaptcha('');setCycle(x=>x+1)});
 const send=async()=>{if(sending||seconds)return;setSending(true);try{const values=await form.validateFields(['email','suffix']);await post('/passport/comm/sendEmailVerify',{email:values.email+(values.suffix||''),...await captchaFields('sendEmailVerify')});setSeconds(60);message.success(t('发送成功'))}catch(e){if(e.message)message.error(e.message)}finally{setSending(false);setCaptcha('');setCycle(x=>x+1)}};
 /**
  * 邮箱链接登录：只填邮箱，密码留空。
  *
  * 后端（MailLinkService）三个要点决定了这里的措辞和错误分支：
  *   · 面板没开这个功能 → 404；
  *   · 同一邮箱 60 秒内重复请求 → 429；
  *   · 邮箱不存在时**也返回成功**，防止拿这个接口枚举用户 —— 所以提示文案
  *     不能暗示账号是否存在，只能说「如果该邮箱已注册」。
  * 没有可供探测的 GET 接口（POST 会真的发信），所以按钮默认显示、靠 404 兜底，
  * 站长也可以在主题配置里直接隐藏。
  */
 const mailLink=async()=>{if(mailing)return;let values;try{values=await form.validateFields(['email','suffix'])}catch{return}
  setMailing(true);
  try{await post('/passport/auth/loginWithMailLink',{email:values.email+(values.suffix||'')});message.success(t('如果该邮箱已注册，登录链接已发送，请查收'))}
  catch(e){const s=e.status;
   // 404 = 面板没开这个功能（两种面板都不带 message）。
   // 限流两边状态码不同：Xboard 回 429，v2board 是 abort(500,'Sending frequently…')，
   // 所以除了 404 以外都优先显示后端原文 —— 否则 v2board 的限流会被吞成通用文案。
   if(s===404)message.info(t('站长未开启邮箱链接登录'));
   else if(s===429)message.warning(t('发送过于频繁，请稍后再试'));
   else message.error(e.generic?t('发送失败，请稍后再试'):e.message);}
  finally{setMailing(false)}};
 const whitelist=Array.isArray(config?.email_whitelist_suffix)?config.email_whitelist_suffix:[];
 return <div className="auth-page"><header className="auth-top"><a className="brand" href="#/login"><span className="brand-icon">h.</span><span>{settings.title||'HeroRui'}</span></a><Select aria-label="Language" value={locale} onChange={setLocale} options={languageOptions} variant="borderless" suffixIcon={<Globe size={16}/>}/></header><div className="auth-stage"><div className="auth-note"><span className="eyebrow">YOUR WORLD, UNRESTRICTED.</span><h1>{register?'Make it\nyours.':forget?'A fresh\nstart.':'Hello,\nagain.'}</h1><p>{settings.description||'连接，自有新意。'}</p><span className="auth-edition">01 — ACCOUNT ACCESS</span></div><section className="auth-form"><span className="mini-index">{register?'02':forget?'03':'01'} / {t('用户')}</span><h2>{t(register?'注册':forget?'重置密码':'登入')}</h2>{error&&<Alert type="error" title={error}/>}<Form form={form} layout="vertical" onFinish={submit} requiredMark={false} initialValues={{invite_code:params.get('code')||'',suffix:(register||forget)&&whitelist[0]?'@'+whitelist[0]:undefined}}>
 <div className="email-row"><Form.Item name="email" label={t('邮箱')} rules={[{required:true,message:t('请输入邮箱地址')},...(!whitelist.length||!register&&!forget?[{type:'email',message:t('邮箱格式错误')}]:[])]}><Input autoComplete="email" placeholder="you@example.com" aria-label={t('邮箱')}/></Form.Item>{(register||forget)&&whitelist.length>0&&<Form.Item name="suffix" label=" " initialValue={'@'+whitelist[0]}><Select aria-label="Email suffix" options={whitelist.map(v=>({label:'@'+v,value:'@'+v}))}/></Form.Item>}</div>
 {(forget||register&&config?.is_email_verify===1)&&<Form.Item label={t('邮箱验证码')} required><div className="inline-input"><Form.Item name="email_code" noStyle rules={[{required:true,message:t('邮箱验证码')}]}><Input autoComplete="one-time-code" aria-label={t('邮箱验证码')}/></Form.Item><Action variant="secondary" disabled={seconds>0} loading={sending} onClick={send}>{seconds?`${seconds}s`:t('发送')}</Action></div></Form.Item>}
 <Form.Item name="password" label={t('密码')} rules={[{required:true,message:t('请输入账号密码')},...(register||forget?[{min:8,message:'至少 8 个字符'}]:[])]}><Input.Password autoComplete={register||forget?'new-password':'current-password'} aria-label={t('密码')}/></Form.Item>
 {(register||forget)&&<Form.Item name="confirm" label={t('再次输入密码')} dependencies={['password']} rules={[{required:true},({getFieldValue})=>({validator:(_,v)=>v===getFieldValue('password')?Promise.resolve():Promise.reject(Error(t('请确保两次密码输入一致')))})]}><Input.Password aria-label={t('再次输入密码')} autoComplete="new-password"/></Form.Item>}
 {register&&<Form.Item name="invite_code" label={t('邀请码')} rules={[{required:!!config?.is_invite_force,message:t('邀请码')}]}><Input readOnly={!!params.get('code')} aria-label={t('邀请码')}/></Form.Item>}
 {register&&config?.tos_url&&<Form.Item name="agree" valuePropName="checked" rules={[{validator:(_,v)=>v?Promise.resolve():Promise.reject(Error('请同意服务条款'))}]}><Checkbox><a href={safeURL(config.tos_url)||'#'} target="_blank" rel="noreferrer">{t('服务条款')}</a></Checkbox></Form.Item>}
 {!!config?.is_captcha&&(register||forget)&&<Captcha key={mode+cycle} config={config} onToken={setCaptcha} cycle={cycle}/>}
 <Action type="submit" fullWidth loading={busy} disabled={!config}>{t(register?'注册':forget?'重置密码':'登入')}<ArrowRight size={17}/></Action>
 {!register&&!forget&&conf('mail_link_login','show')!=='hide'&&<button type="button" className="mail-link-button" onClick={mailLink} disabled={mailing}><Mail size={15}/>{t(mailing?'发送中':'用邮箱链接登录')}</button>}
 </Form><div className="auth-links">{register||forget?<a href="#/login">{t('返回登入')}</a>:<><a href="#/register">{t('注册')}</a><a href="#/forgetpassword">{t('忘记密码')}</a></>}</div></section></div><footer className="auth-footer"><span>© {new Date().getFullYear()} {settings.title}</span><span>LESS FRICTION. MORE POSSIBILITY.</span></footer></div>
}
