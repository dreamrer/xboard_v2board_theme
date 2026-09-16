import {plan as basePlan,user,order} from './fixtures.mjs';
export const plan={...basePlan,sell:true,renew:true,content:JSON.stringify([{feature:'200 GB 高速流量 / 月',support:true},{feature:'全球多地区接入',support:true},{feature:'最多 5 台设备',support:true},{feature:'全平台客户端支持',support:true}])};
export function makeState(){return{user:{...user},plan:{...plan},order:{...order},hasPending:true,guest:{is_email_verify:0,is_invite_force:0,email_whitelist_suffix:0,is_captcha:0,captcha_type:'recaptcha',tos_url:''},config:{currency:'CNY',currency_symbol:'¥',withdraw_methods:['支付宝'],withdraw_close:0,commission_distribution_enable:0,is_telegram:1},ticket:{id:1,subject:'客户端连接咨询',level:1,status:0,reply_status:1,created_at:1789171200,updated_at:1789171300,message:[{id:1,is_me:1,message:'请问如何导入订阅？',created_at:1789171200},{id:2,is_me:0,message:'您好，请在总览中点击一键订阅，即可选择客户端并导入。',created_at:1789171300}]},checkout:{type:0,data:'https://example.invalid/pay/preview'},fail:{},unexpected:[],empty:false,
// 签到：mode 决定探测 GET /user/checkin 的回应，据此模拟两种面板
//   xboard  → 200 + 插件契约；v2board → 405（路由只收 POST）；off → 404（没这功能）
// 知识库正文。默认这段带 onclick / onerror / <script>，用于内容安全检查；
// 用例可覆盖（如验证知识库放行嵌入视频）。
knowledgeBody:'<h2>开始使用</h2><p>在总览页选择一键订阅，导入客户端。</p><button onclick="copy(\'https://example.invalid/s/preview\')">复制示例</button><button onclick="jump(2)">下一篇</button><img src=x onerror="window.__xss=1"><script>window.__xss=1</script>',
checkin:{mode:'xboard',enabled:1,checked_today:0,streak:3,reason:null,traffic:'20 MB'},
mailLink:{status:200},
// 免登录链接：两个面板都返回 {app_url}/#/login?verify=CODE，60 秒有效
quickLoginUrl:'https://panel.example.invalid/#/login?verify=quick-code&redirect=dashboard',
// 登录设备。默认给 Xboard 的形状（Sanctum token 行数组）；
// v2board 的形状是以会话 id 为键的对象，用例可整体替换
// Xboard 的真实形状：Sanctum PersonalAccessToken 行 —— name 是 Str::random(20)
// 的随机串（不是设备名），日期是 Carbon 序列化出的 ISO-8601 字符串。
// 原来这里用整数时间戳，把 Number() 解析不了 ISO 的 bug 遮住了。
sessions:[{id:7,name:'kQ8mZ2vX1pL7nR4tY6wA',created_at:'2026-09-14T02:00:00.000000Z',last_used_at:'2026-09-15T03:12:45.000000Z'},
          {id:8,name:'aB3cD4eF5gH6iJ7kL8mN',created_at:'2026-09-12T01:00:00.000000Z',last_used_at:'2026-09-13T04:00:00.000000Z'}],
giftcard:{mode:'xboard',code:'GIFT-2026',
 preview:{code_info:{code:'GIFT-2026',template:{name:'新年礼包',description:'限时活动',type:1,type_name:'通用礼品卡'},expires_at:1800000000},
  reward_preview:{balance:5000,transfer_enable:107374182400,expire_days:30},can_redeem:true,reason:null},
 history:{data:[{id:1,code:'GIFT-202****',template_name:'新年礼包',template_type_name:'通用礼品卡',
  rewards_given:{balance:5000,transfer_enable:107374182400},created_at:1789171200}],
  pagination:{current_page:1,last_page:1,per_page:10,total:1}}},subscriptionURL:'https://example.invalid/s/preview',methods:[{id:1,name:'支付宝',payment:'alipay',handling_fee_fixed:20,handling_fee_percent:2}],checkStatus:null}}
/**
 * 拦截接口请求。pattern / strip 可覆盖，用于测试自定义接口前缀（api_path）
 * 和加密中间件 —— 那两种情况请求根本不会打到 /api/v1 上。
 */
export async function mockAPI(page,requests=[],provided,{pattern='**/api/v1/**',strip='/api/v1',endpointOf=null}={}){const state=provided||makeState();await page.route(pattern,async route=>{const req=route.request(),url=new URL(req.url()),endpoint=endpointOf?endpointOf(url):url.pathname.replace(strip,''),body=Object.fromEntries(new URLSearchParams(req.postData()||''));requests.push({endpoint,method:req.method(),body,query:Object.fromEntries(url.searchParams),headers:req.headers()});if(state.fail[endpoint])return route.fulfill({status:state.fail[endpoint].status||500,json:{message:state.fail[endpoint].message||'模拟服务异常'}});let data;
switch(endpoint){
case '/guest/comm/config':data=state.guest;break;
case '/user/comm/config':data=state.config;break;
case '/user/getQuickLoginUrl':data=state.quickLoginUrl;break;
case '/user/getActiveSession':data=state.sessions;break;
// 礼品卡。giftcard.mode 决定探测 /user/gift-card/types 的结果：
//   xboard → 200（走预览 + 记录）；v2board → 404（只能直接兑换 /user/redeemgiftcard）
case '/user/gift-card/types':
 if(state.giftcard.mode!=='xboard')return route.fulfill({status:404,json:{message:'Not Found'}});
 data={types:{1:'通用礼品卡',2:'套餐礼品卡',3:'盲盒礼品卡'}};break;
case '/user/gift-card/check':
 if(body.code!==state.giftcard.code)return route.fulfill({status:400,json:{message:'礼品卡不存在或已过期'}});
 data=state.giftcard.preview;break;
case '/user/gift-card/redeem':
 if(body.code!==state.giftcard.code)return route.fulfill({status:400,json:{message:'礼品卡不存在或已过期'}});
 data=true;break;
case '/user/redeemgiftcard':
 // v2board 的字段名是 giftcard，不是 code
 if(body.giftcard!==state.giftcard.code)return route.fulfill({status:500,json:{message:'The gift card does not exist'}});
 data=true;break;
// history 不走 success 包装，直接就是 {data,pagination}
case '/user/gift-card/history':return route.fulfill({json:state.giftcard.history});
case '/user/removeActiveSession':
 // 两种形状都要能删：数组（Xboard）和以会话 id 为键的对象（v2board）
 if(Array.isArray(state.sessions))state.sessions=state.sessions.filter(x=>String(x.id)!==String(body.session_id));
 else if(state.sessions&&typeof state.sessions==='object'){const c={...state.sessions};delete c[body.session_id];state.sessions=c}
 data=true;break;
case '/user/checkin':{
 const c=state.checkin;
 if(c.mode==='off')return route.fulfill({status:404,json:{message:'Not Found'}});
 if(req.method()==='GET'){
  // v2board 那种只有 POST 的内置签到，GET 会被 Laravel 判成 405
  if(c.mode==='v2board')return route.fulfill({status:405,json:{message:'Method Not Allowed'}});
  const body={checked_today:c.checked_today,streak:c.streak,reason:c.reason};
  if('enabled' in c)body.enabled=c.enabled;// 删掉这个字段可模拟不返回 enabled 的插件版本
  return route.fulfill({json:{data:body}});
 }
 if(c.checked_today)return c.mode==='v2board'
  ?route.fulfill({json:{data:false,message:c.message??'您今天已经签到过，请勿重复签到'}})
  :route.fulfill({json:{data:{success:false,message:'今天已签到'}}});
 c.checked_today=1;c.streak=Number(c.streak)+1;
 return c.mode==='v2board'
  ?route.fulfill({json:{data:true,message:'签到成功！获得 +20.00MB 流量 (5MB-50MB随机)',traffic:20971520}})
  :route.fulfill({json:{data:{success:true,streak:c.streak,traffic:c.traffic}}});
}
case '/passport/auth/loginWithMailLink':
 if(state.mailLink.status!==200)return route.fulfill({status:state.mailLink.status,json:{message:state.mailLink.message??'mock'}});
 data=true;break;
case '/passport/auth/login':case '/passport/auth/register':case '/passport/auth/token2Login':data={auth_data:'preview-token',token:'preview-token'};break;
case '/passport/comm/sendEmailVerify':case '/passport/auth/forget':case '/user/changePassword':data=true;break;
case '/user/info':data=state.user;break;
case '/user/getSubscribe':data={...state.user,plan:state.user.plan_id?state.plan:null,subscribe_url:state.subscriptionURL,reset_day:18};break;
case '/user/getStat':data=[state.hasPending?1:0,1,0];break;
case '/user/notice/fetch':data=state.empty?[]:[{id:1,title:'欢迎来到你的连接空间',content:'<p>在这里管理订阅、查看用量，随时开始新的探索。</p>',created_at:1789171200},{id:2,title:'九月服务更新 · 让日常更顺畅',content:'<p>感谢你的陪伴。</p>',created_at:1789084800}];break;
case '/user/plan/fetch':data=url.searchParams.has('id')?state.plan:state.empty?[]:[{...plan,id:2,name:'轻享 Starter',month_price:1200,transfer_enable:60,content:plan.content.replace('200 GB','60 GB')},state.plan,{...plan,id:3,name:'无限可能 Max',month_price:5900,transfer_enable:500,onetime_price:9900,content:plan.content.replace('200 GB','500 GB')}];break;
case '/user/order/fetch':data=state.hasPending?[state.order,{...order,trade_no:'202608120001',status:3}]:[];break;
case '/user/order/detail':data=state.order;break;
case '/user/order/getPaymentMethod':data=state.methods;break;
case '/user/order/save':state.order={...order,period:body.period,total_amount:plan[body.period]-(body.coupon_code?500:0)};state.hasPending=true;data=state.order.trade_no;break;
case '/user/order/cancel':state.hasPending=false;state.order.status=2;data=true;break;
case '/user/order/checkout':if(state.checkout.data===true)state.order.status=3;return route.fulfill({json:state.checkout});
case '/user/order/check':if(state.checkStatus!=null)state.order.status=state.checkStatus;data=state.order.status;break;
case '/user/coupon/check':data={id:1,code:body.code,type:1,value:500};break;
case '/user/server/fetch':data=state.empty?[]:[{id:1,name:'香港 · Hong Kong 01',type:'vless',rate:'1.0',is_online:1,tags:['推荐','香港']},{id:2,name:'日本 · Tokyo 01',type:'shadowsocks',rate:'1.0',is_online:1,tags:['日本']},{id:3,name:'新加坡 · Singapore 01',type:'trojan',rate:'1.5',is_online:0,tags:['新加坡']}];break;
case '/user/ticket/fetch':data=url.searchParams.has('id')?state.ticket:state.empty?[]:[state.ticket];break;
case '/user/ticket/save':data=true;break;
case '/user/ticket/reply':state.ticket.message.push({id:3,is_me:1,message:body.message,created_at:1789171500});data=true;break;
case '/user/ticket/close':state.ticket.status=1;data=true;break;
case '/user/invite/fetch':data={codes:[{code:'SCAR2026',created_at:1789171200}],stat:[12,6800,1200,20,state.user.commission_balance]};break;
case '/user/invite/save':data=true;break;
case '/user/invite/details':return route.fulfill({json:{data:[{created_at:1789171200,get_amount:580,trade_no:'202609120001'}],total:21}});
case '/user/transfer':state.user.commission_balance-=Number(body.transfer_amount);state.user.balance+=Number(body.transfer_amount);data=true;break;
case '/user/ticket/withdraw':data=true;break;
case '/user/knowledge/fetch':data=url.searchParams.has('id')?{id:1,title:'开始使用：导入订阅',body:state.knowledgeBody}:state.empty?{}:{'快速入门':[{id:1,title:'开始使用：导入订阅',updated_at:1789171200},{id:2,title:'选择适合你的客户端',updated_at:1789171100}],'常见问题':[{id:3,title:'订阅与账单说明',updated_at:1789171200}]};break;
case '/user/stat/getTrafficLog':data=state.empty?[]:[{record_at:1789171200,u:2*1073741824,d:6*1073741824,server_rate:2}];break;
case '/user/resetSecurity':state.subscriptionURL='https://example.invalid/s/reset';data=state.subscriptionURL;break;
case '/user/update':Object.assign(state.user,Object.fromEntries(Object.entries(body).map(([k,v])=>[k,Number(v)])));data=true;break;
case '/user/telegram/getBotInfo':data={username:'herorui_demo_bot'};break;
case '/user/comm/getStripePublicKey':data='pk_test_mock';break;
default:state.unexpected.push(endpoint);return route.fulfill({status:404,json:{message:'Unmocked endpoint: '+endpoint}});
}return route.fulfill({json:{data}})});return state;}
export {authenticate,setThemeConfig} from './fixtures.mjs';
