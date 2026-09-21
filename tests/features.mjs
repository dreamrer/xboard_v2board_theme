/**
 * 新增功能的浏览器回归：签到、邮箱链接登录、在线客服、加密中间件、
 * 兑换码、登录设备、客户端下载页、分离部署。
 *
 * 每组都用独立的浏览器上下文，因为它们依赖不同的 window.themeConfig
 * （生产环境由 blade 注入，这里用 addInitScript 等价替代）。
 */
import {chromium} from 'playwright';
import {preview} from 'vite';
import {mkdir, writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {xchacha20poly1305} from '@noble/ciphers/chacha.js';
import {sha256} from '@noble/hashes/sha2.js';
import {createServer} from 'node:http';
import {readFile as readFileAsync} from 'node:fs/promises';
import {extname, join} from 'node:path';
import {makeState, mockAPI, authenticate, setThemeConfig} from './state.mjs';
import {guestConfig, nodeOnline, planSoldOut} from '../src/panel.js';
import {FIELDS} from '../scripts/theme-fields.mjs';

const server = await preview({preview: {host: '127.0.0.1', port: 4183, strictPort: true}});
const browser = await chromium.launch({...(process.env.PLAYWRIGHT_CHANNEL ? {channel: process.env.PLAYWRIGHT_CHANNEL} : {}), headless: true});
const base = 'http://127.0.0.1:4183';
const results = [];
const out = 'dist/HeroRui-preview';
await mkdir(out, {recursive: true});

const test = async (name, fn) => {
  try {
    await fn();
    results.push({name, status: 'PASS'});
    console.log('PASS ' + name);
  } catch (e) {
    results.push({name, status: 'FAIL', error: e.message});
    console.error('FAIL ' + name + ': ' + e.message);
    throw e;
  }
};

/**
 * 开一个新页面。themeConfig 必须在页面脚本执行前注入，所以每个用例都要新上下文。
 * mock 选项透传给 mockAPI，用于自定义接口前缀和中间件那两组用例。
 */
const openPage = async ({theme = {}, state = makeState(), mock = {}, authed = true} = {}) => {
  const context = await browser.newContext({locale: 'zh-CN', viewport: {width: 1440, height: 1000}});
  const page = await context.newPage();
  const requests = [];
  if (authed) await authenticate(page);
  await setThemeConfig(page, theme);
  await mockAPI(page, requests, state, mock);
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  return {context, page, requests, state, errors};
};

const goto = async (page, route) => {
  await page.goto(base + '/#/' + route);
  await page.reload();
  await page.locator('h1').waitFor();
};
const settle = async (requests, endpoint) => {
  for (let i = 0; i < 60; i++) {
    if (requests.some(r => r.endpoint === endpoint)) return;
    await new Promise(r => setTimeout(r, 100));
  }
  throw Error('没有等到请求：' + endpoint);
};
const tile = page => page.locator('.checkin-tile');

/**
 * 用纯静态服务器托管 theme/HeroRui-standalone/ —— 这正是分离部署的形态：
 * 没有 PHP、没有 Blade，只有 index.html + config.js + assets/。
 */
const TYPES = {'.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json'};
const staticServer = createServer(async (req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]);
  const file = join('theme/HeroRui-standalone', rel === '/' ? 'index.html' : rel);
  try {
    const body = await readFileAsync(file);
    res.writeHead(200, {'Content-Type': TYPES[extname(file)] || 'application/octet-stream'});
    res.end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
});
await new Promise(r => staticServer.listen(4184, '127.0.0.1', r));
const staticBase = 'http://127.0.0.1:4184';

/**
 * 打开分离部署形态的页面。config.js 的内容由测试替换掉（等价于站长手改），
 * 其余一切都走真实产物。
 */
const openStandalone = async ({theme = {}, settings = {}, state = makeState(), mock = {}} = {}) => {
  const context = await browser.newContext({locale: 'zh-CN', viewport: {width: 1440, height: 1000}});
  const page = await context.newPage();
  const requests = [];
  await authenticate(page);
  await page.route(staticBase + '/config.js', route => route.fulfill({
    contentType: 'application/javascript',
    body: `window.routerBase='/';window.settings=${JSON.stringify({title: 'HeroRui', ...settings})};`
        + `window.themeConfig=${JSON.stringify(theme)};`
  }));
  await mockAPI(page, requests, state, mock);
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  return {context, page, requests, errors};
};

try {

// ——— 面板字段归一化（纯函数，不需要浏览器）———————————————————
// V2board 兼容的风险几乎都集中在这三个函数上，所以两种面板的取值逐个钉住。

await test('归一化：验证码字段（Xboard is_captcha / V2board is_recaptcha）', async () => {
  // Xboard 明确回 0 时，不能因为「假值」就去读 V2board 的字段
  assert.equal(guestConfig({is_captcha: 0, is_recaptcha: 1}).is_captcha, false);
  assert.equal(guestConfig({is_captcha: 1}).is_captcha, true);
  // V2board 没有 is_captcha，只有 is_recaptcha
  assert.equal(guestConfig({is_recaptcha: 1}).is_captcha, true);
  assert.equal(guestConfig({is_recaptcha: 0}).is_captcha, false);
  // 必须是真布尔：数字 0 会被 JSX 当文本渲染出来
  assert.equal(typeof guestConfig({}).is_captcha, 'boolean');
  // V2board 不返回 captcha_type，只支持 recaptcha v2
  assert.equal(guestConfig({is_recaptcha: 1}).captcha_type, 'recaptcha');
  assert.equal(guestConfig({captcha_type: 'turnstile'}).captcha_type, 'turnstile');
});



await test('归一化：节点在线状态（V2board 只给 last_check_at）', async () => {
  assert.equal(nodeOnline({is_online: 1}), true);
  assert.equal(nodeOnline({is_online: 0}), false);
  // is_online 为 0 时不能再去看心跳，否则会把明确离线的节点显示成在线
  assert.equal(nodeOnline({is_online: 0, last_check_at: Math.floor(Date.now() / 1000)}), false);
  const now = Math.floor(Date.now() / 1000);
  assert.equal(nodeOnline({last_check_at: now}), true);
  assert.equal(nodeOnline({last_check_at: now - 60}), true);
  assert.equal(nodeOnline({last_check_at: now - 600}), false, '超过 300 秒没心跳算离线');
  assert.equal(nodeOnline({}), false);
  assert.equal(nodeOnline(undefined), false);
});

await test('归一化：套餐售罄（sell 布尔/整数、capacity_limit 字符串/数字）', async () => {
  assert.equal(planSoldOut({sell: true}), false);      // Xboard
  assert.equal(planSoldOut({sell: false}), true);
  assert.equal(planSoldOut({sell: 1}), false);         // V2board
  assert.equal(planSoldOut({sell: 0}), true);
  // 字段缺失只说明这个面板不返回它，不代表卖完了
  assert.equal(planSoldOut({}), false);
  // Xboard 满员返回本地化字符串，V2board 返回剩余数量
  assert.equal(planSoldOut({sell: 1, capacity_limit: 'Sold out'}), true);
  assert.equal(planSoldOut({sell: 1, capacity_limit: '已售罄'}), true);
  assert.equal(planSoldOut({sell: 1, capacity_limit: 0}), true);
  assert.equal(planSoldOut({sell: 1, capacity_limit: -3}), true);
  assert.equal(planSoldOut({sell: 1, capacity_limit: 20}), false);
  assert.equal(planSoldOut({sell: 1, capacity_limit: '20'}), false);
  assert.equal(planSoldOut({sell: 1, capacity_limit: null}), false, '不限人数');
});

// ——— 签到 ———————————————————————————————————————————————

await test('签到：Xboard 插件契约（GET 探测 + POST 签到）', async () => {
  const {context, page, requests, errors} = await openPage();
  await goto(page, 'dashboard');
  await tile(page).waitFor();
  // 探测走 GET，且不带 type 参数（那是 v2board 的东西）
  const probe = requests.find(r => r.endpoint === '/user/checkin');
  assert.equal(probe.method, 'GET');
  await assert.doesNotReject(tile(page).getByText('已连续 3 天').waitFor());
  await assert.doesNotReject(tile(page).getByText('立即签到').waitFor());

  await tile(page).click();
  await settle(requests, '/user/checkin');
  const posted = requests.filter(r => r.endpoint === '/user/checkin' && r.method === 'POST');
  assert.equal(posted.length, 1);
  assert.deepEqual(posted[0].body, {}, 'Xboard 插件的签到不该带 type 参数');
  // 插件回的 traffic 已是 '20 MB' 这样的字符串，应原样展示而不是再换算一次
  await assert.doesNotReject(page.getByText('签到成功，获得 20 MB').waitFor());
  await assert.doesNotReject(tile(page).getByText('已签到').waitFor());
  assert.ok(await tile(page).isDisabled(), '已签到后入口应禁用');
  assert.deepEqual(errors, []);
  await context.close();
});

await test('签到：V2board 内置契约（405 探测 → POST type=1）', async () => {
  const state = makeState();
  state.checkin.mode = 'v2board';
  const {context, page, requests, errors} = await openPage({state});
  await goto(page, 'dashboard');
  // GET 被判成 405，说明路由在、只是不收 GET —— 据此认定是 v2board 内置签到
  await tile(page).waitFor();
  assert.equal(requests.find(r => r.endpoint === '/user/checkin').method, 'GET');

  await tile(page).click();
  const posted = await (async () => {
    for (let i = 0; i < 60; i++) {
      const hit = requests.find(r => r.endpoint === '/user/checkin' && r.method === 'POST');
      if (hit) return hit;
      await new Promise(r => setTimeout(r, 100));
    }
    throw Error('没有等到签到请求');
  })();
  assert.equal(posted.body.type, '1', 'v2board 普通签到必须带 type=1');
  // v2board 的提示语后端已经拼好，前端应直接显示，不要自己再造一句
  await assert.doesNotReject(page.getByText('签到成功！获得 +20.00MB 流量 (5MB-50MB随机)').waitFor());
  assert.deepEqual(errors, []);
  await context.close();
});

await test('签到：面板没这功能时不渲染入口（404）', async () => {
  const state = makeState();
  state.checkin.mode = 'off';
  const {context, page, requests, errors} = await openPage({state});
  await goto(page, 'dashboard');
  await settle(requests, '/user/checkin');
  await page.waitForTimeout(300);
  assert.equal(await tile(page).count(), 0, '探测 404 后不该留一个坏按钮');
  // 没有签到时 metrics-strip 必须还是原来的三列，布局一个像素都不该变
  assert.equal(await page.locator('.metrics-strip > *').count(), 3);
  assert.deepEqual(errors, []);
  await context.close();
});

await test('签到：配置为关闭时连探测都不发', async () => {
  const {context, page, requests, errors} = await openPage({theme: {checkin_mode: 'off'}});
  await goto(page, 'dashboard');
  await page.waitForTimeout(600);
  assert.equal(await tile(page).count(), 0);
  assert.equal(requests.filter(r => r.endpoint === '/user/checkin').length, 0, '关闭时不该打探测请求');
  assert.deepEqual(errors, []);
  await context.close();
});

await test('面板类型：指定 Xboard 时不回退到 v2board', async () => {
  const state = makeState();
  state.checkin.mode = 'v2board'; // 后端其实是 v2board（GET 回 405）
  const {context, page, requests, errors} = await openPage({state, theme: {panel_type: 'xboard'}});
  await goto(page, 'dashboard');
  await settle(requests, '/user/checkin');
  await page.waitForTimeout(300);
  assert.equal(await tile(page).count(), 0, '指定了 Xboard 就不该再猜 v2board');
  assert.deepEqual(errors, []);
  await context.close();
});

await test('面板类型：指定 V2board 时按 405 认定内置签到，走 POST 契约', async () => {
  const state = makeState();
  state.checkin.mode = 'v2board';
  const {context, page, requests, errors} = await openPage({state, theme: {panel_type: 'v2board'}});
  await goto(page, 'dashboard');
  await tile(page).waitFor();
  await tile(page).click();
  await settle(requests, '/user/checkin');
  const posted = requests.find(r => r.endpoint === '/user/checkin' && r.method === 'POST');
  assert.equal(posted.body.type, '1');
  assert.deepEqual(errors, []);
  await context.close();
});

await test('面板类型：指定 V2board 但面板没有签到接口（原版）时不留坏入口', async () => {
  const state = makeState();
  state.checkin.mode = 'off';
  const {context, page, requests, errors} = await openPage({state, theme: {panel_type: 'v2board'}});
  await goto(page, 'dashboard');
  await settle(requests, '/user/checkin');
  await page.waitForTimeout(300);
  assert.equal(await tile(page).count(), 0, '原版 V2board 没有签到，入口不该出现');
  assert.equal(requests.filter(r => r.endpoint === '/user/checkin' && r.method === 'POST').length, 0);
  assert.deepEqual(errors, []);
  await context.close();
});

await test('签到：V2board 返回 data:false 时显示原因，不显示「已签到」', async () => {
  const state = makeState();
  state.checkin.mode = 'v2board';
  state.checkin.checked_today = 1;
  state.checkin.message = '没有可用订阅，无法签到';
  const {context, page, requests, errors} = await openPage({state});
  await goto(page, 'dashboard');
  await tile(page).waitFor();
  await tile(page).click();
  await page.waitForFunction(() => document.querySelector('.checkin-tile')?.innerText.includes('不可签到'), null, {timeout: 10000});
  const text = await tile(page).innerText();
  assert.ok(await tile(page).isDisabled());
  assert.ok(!text.includes('已签到'), '没签上就不能显示已签到：' + text);
  assert.ok(text.includes('没有可用订阅'), '应把后端原因显示在入口上：' + text);
  assert.ok(!(await tile(page).getAttribute('class')).includes('is-done'));
  assert.deepEqual(errors, []);
  await context.close();
});

await test('面板类型：所填面板与接口形状不符时控制台提示', async () => {
  // 后端是 Xboard（guest 配置里有 is_captcha），却填了 v2board
  const {context, page} = await openPage({theme: {panel_type: 'v2board'}, authed: false});
  const warnings = [];
  page.on('console', m => m.type() === 'warning' && warnings.push(m.text()));
  await page.goto(base + '/#/login');
  await page.reload();
  await page.getByRole('textbox', {name: '邮箱'}).waitFor();
  assert.ok(warnings.some(w => w.includes('[面板]') && w.includes('更像 Xboard')),
    '兜底归一化是隐形的，填错面板至少要在控制台说一声：' + JSON.stringify(warnings));
  await context.close();
});

await test('面板类型：形状一致时不多嘴', async () => {
  const {context, page} = await openPage({theme: {panel_type: 'xboard'}, authed: false});
  const warnings = [];
  page.on('console', m => m.type() === 'warning' && warnings.push(m.text()));
  await page.goto(base + '/#/login');
  await page.reload();
  await page.getByRole('textbox', {name: '邮箱'}).waitFor();
  assert.equal(warnings.filter(w => w.includes('[面板]')).length, 0);
  await context.close();
});

// ——— 邮箱链接登录 ———————————————————————————————————————

const mailButton = page => page.getByRole('button', {name: /用邮箱链接登录|发送中/});

await test('邮箱链接登录：只填邮箱即可发送', async () => {
  const {context, page, requests, errors} = await openPage({authed: false});
  await page.goto(base + '/#/login');
  await page.reload();
  await page.getByRole('textbox', {name: '邮箱'}).fill('someone@example.com');
  await mailButton(page).click();
  await settle(requests, '/passport/auth/loginWithMailLink');
  const sent = requests.find(r => r.endpoint === '/passport/auth/loginWithMailLink');
  assert.equal(sent.method, 'POST');
  assert.equal(sent.body.email, 'someone@example.com');
  assert.equal(sent.body.password, undefined, '密码留空也该能用');
  // 后端为防用户枚举，邮箱不存在时也返回成功，所以文案不能暗示账号是否存在
  await assert.doesNotReject(page.getByText('如果该邮箱已注册，登录链接已发送，请查收').waitFor());
  assert.deepEqual(errors, []);
  await context.close();
});

await test('邮箱链接登录：邮箱没填先提示、不发请求', async () => {
  const {context, page, requests, errors} = await openPage({authed: false});
  await page.goto(base + '/#/login');
  await page.reload();
  await mailButton(page).click();
  await page.waitForTimeout(400);
  assert.equal(requests.filter(r => r.endpoint === '/passport/auth/loginWithMailLink').length, 0);
  await assert.doesNotReject(page.getByText('请输入邮箱地址').waitFor());
  assert.deepEqual(errors, []);
  await context.close();
});

// 404 / 429 用自己的文案（两种面板这两档都不带 message）；
// 其余情况优先显示后端原文，后端没给才回落通用文案。
for (const [status, message, text] of [
  [404, '', '站长未开启邮箱链接登录'],
  [429, '', '发送过于频繁，请稍后再试'],
  [500, '', '发送失败，请稍后再试']
]) {
  await test(`邮箱链接登录：${status} 提示对应文案`, async () => {
    const state = makeState();
    state.mailLink.status = status;
    state.mailLink.message = message;
    const {context, page, errors} = await openPage({state, authed: false});
    await page.goto(base + '/#/login');
    await page.reload();
    await page.getByRole('textbox', {name: '邮箱'}).fill('someone@example.com');
    await mailButton(page).click();
    await assert.doesNotReject(page.getByText(text).waitFor());
    assert.deepEqual(errors, []);
    await context.close();
  });
}

await test('邮箱链接登录：配置隐藏后按钮消失', async () => {
  const {context, page, errors} = await openPage({theme: {mail_link_login: 'hide'}, authed: false});
  await page.goto(base + '/#/login');
  await page.reload();
  await page.getByRole('textbox', {name: '邮箱'}).waitFor();
  assert.equal(await mailButton(page).count(), 0);
  assert.deepEqual(errors, []);
  await context.close();
});

// ——— 在线客服 ———————————————————————————————————————————

/** 把第三方客服 SDK 换成本地假脚本，避免测试依赖外网 */
const stubSdk = async (page, url, script) => {
  await page.route(url, route => route.fulfill({contentType: 'application/javascript', body: script}));
};

await test('在线客服：退出登录时重置 Chatwoot 会话（共用电脑不串号）', async () => {
  const {context, page, errors} = await openPage({
    theme: {customer_service_type: 'chatwoot', chatwoot_url: 'https://chat.example.invalid', chatwoot_token: 'TOKEN123'}
  });
  await stubSdk(page, 'https://chat.example.invalid/packs/js/sdk.js', `
    window.__calls=[];
    window.chatwootSDK={run:()=>{window.$chatwoot={setUser:()=>window.__calls.push(['setUser']),
      setCustomAttributes:()=>window.__calls.push(['attrs']),reset:()=>window.__calls.push(['reset'])};
      dispatchEvent(new Event('chatwoot:ready'));}};
  `);
  await goto(page, 'dashboard');
  await page.waitForFunction(() => window.__calls?.some(c => c[0] === 'attrs'), null, {timeout: 15000});
  await page.getByRole('button', {name: '账户菜单'}).click();
  await page.getByText('退出登录').click();
  await page.waitForFunction(() => location.hash.startsWith('#/login'), null, {timeout: 15000});
  assert.ok(await page.evaluate(() => window.__calls.some(c => c[0] === 'reset')), '退出后必须 reset，否则下一个人能看到上一个人的对话');
  assert.deepEqual(errors, []);
  await context.close();
});

await test('在线客服：Chatwoot 传入站点令牌并同步用户属性', async () => {
  const {context, page, errors} = await openPage({
    theme: {customer_service_type: 'chatwoot', chatwoot_url: 'https://chat.example.invalid/', chatwoot_token: 'TOKEN123'}
  });
  // 假 SDK：记录 run 的参数，并把 setUser / setCustomAttributes 的调用存起来
  await stubSdk(page, 'https://chat.example.invalid/packs/js/sdk.js', `
    window.__calls=[];
    window.chatwootSDK={run:o=>{window.__calls.push(['run',o]);
      window.$chatwoot={setUser:(id,a)=>window.__calls.push(['setUser',id,a]),
                        setCustomAttributes:a=>window.__calls.push(['attrs',a])};
      dispatchEvent(new Event('chatwoot:ready'));}};
  `);
  await goto(page, 'dashboard');
  await page.waitForFunction(() => window.__calls?.some(c => c[0] === 'attrs'), null, {timeout: 15000});
  const calls = await page.evaluate(() => window.__calls);
  const run = calls.find(c => c[0] === 'run');
  assert.equal(run[1].websiteToken, 'TOKEN123');
  assert.equal(run[1].baseUrl, 'https://chat.example.invalid', '结尾斜杠要去掉');
  assert.equal(calls.find(c => c[0] === 'setUser')[1], 'hello@example.com');
  const attrs = calls.find(c => c[0] === 'attrs')[1];
  assert.equal(attrs.Email, 'hello@example.com');
  assert.equal(attrs.Plan, '探索者 Pro');
  assert.ok(attrs.TrafficLeft.endsWith('GB'), '剩余流量应是可读单位：' + attrs.TrafficLeft);
  // 余额要带货币符号，否则客服分不清 CNY 还是 USD
  assert.equal(attrs.Balance, '¥88.00');
  assert.equal(attrs.Traffic, undefined, '字段名要说清是剩余量');
  assert.deepEqual(errors, []);
  await context.close();
});

await test('在线客服：Crisp 写入 WEBSITE_ID 与会话数据', async () => {
  const {context, page, errors} = await openPage({
    theme: {customer_service_type: 'crisp', crisp_website_id: 'WID-9'}
  });
  await stubSdk(page, 'https://client.crisp.chat/l.js', `
    // 真 SDK 会接管 $crisp 队列。这里先把 push 换掉再触发回调 ——
    // 顺序反了的话，回调同步推进去的那几条会落进原数组而不是 __pushed。
    window.__pushed=window.$crisp.slice();
    const queued=window.$crisp.slice();
    window.$crisp.push=(...a)=>{window.__pushed.push(...a);return 0};
    for(const item of queued) if(item[0]==='on'&&item[1]==='session:loaded') item[2]();
  `);
  await goto(page, 'dashboard');
  await page.waitForFunction(() => window.__pushed?.some(p => p[1] === 'session:data'), null, {timeout: 15000});
  assert.equal(await page.evaluate(() => window.CRISP_WEBSITE_ID), 'WID-9');
  const pushed = await page.evaluate(() => window.__pushed);
  const email = pushed.find(p => p[1] === 'user:email');
  assert.deepEqual(email[2], ['hello@example.com']);
  const data = Object.fromEntries(pushed.find(p => p[1] === 'session:data')[2][0]);
  assert.equal(data.Plan, '探索者 Pro');
  assert.deepEqual(errors, []);
  await context.close();
});

await test('在线客服：SalesMartly 通过 setLoginInfo 上报', async () => {
  const {context, page, errors} = await openPage({
    theme: {customer_service_type: 'salesmartly', salesmartly_url: 'https://assets.example.invalid/js/project_x.js'}
  });
  await stubSdk(page, 'https://assets.example.invalid/js/project_x.js', `
    window.__ssq=[];window.ssq={push:(...a)=>{window.__ssq.push(a);
      if(a[0]==='onReady') a[1]();}};
  `);
  await goto(page, 'dashboard');
  await page.waitForFunction(() => window.__ssq?.some(a => a[0] === 'setLoginInfo'), null, {timeout: 15000});
  const payload = await page.evaluate(() => window.__ssq.find(a => a[0] === 'setLoginInfo')[1]);
  assert.equal(payload.user_id, 'hello@example.com');
  assert.equal(payload.email, 'hello@example.com');
  assert.match(payload.description, /Plan: 探索者 Pro/);
  assert.deepEqual(errors, []);
  await context.close();
});

await test('在线客服：自定义嵌入代码里的 script 会真的执行', async () => {
  const {context, page, errors} = await openPage({
    theme: {
      customer_service_type: 'other',
      // innerHTML 塞进去的 script 浏览器不会执行，必须重建成真 script 元素
      customer_service_html: '<div id="cs-marker"></div><script>window.__customServiceRan=1<\/script>'
    }
  });
  await goto(page, 'dashboard');
  await page.waitForFunction(() => window.__customServiceRan === 1, null, {timeout: 15000});
  assert.equal(await page.locator('#cs-marker').count(), 1, '非脚本节点也该搬进页面');
  assert.deepEqual(errors, []);
  await context.close();
});

await test('在线客服：留空时什么都不注入', async () => {
  const {context, page, errors} = await openPage();
  await goto(page, 'dashboard');
  await page.waitForTimeout(500);
  const injected = await page.evaluate(() =>
    [...document.querySelectorAll('script')].filter(s => /crisp|chatwoot|salesmartly/i.test(s.src)).length);
  assert.equal(injected, 0);
  assert.equal(await page.evaluate(() => !!window.$crisp), false);
  assert.deepEqual(errors, []);
  await context.close();
});

// ——— 自定义接口前缀与加密中间件 ——————————————————————————

await test('接口前缀：api_path 改写请求根路径', async () => {
  const {context, page, requests, errors} = await openPage({
    theme: {api_path: '/proxy/api'},
    mock: {pattern: '**/proxy/api/**', strip: '/proxy/api'}
  });
  await goto(page, 'dashboard');
  await settle(requests, '/user/info');
  const all = await page.evaluate(() => performance.getEntriesByType('resource').map(e => e.name));
  assert.ok(!all.some(u => u.includes('/api/v1/')), '不该再有请求打到 /api/v1');
  assert.deepEqual(errors, []);
  await context.close();
});

/** 与前端 src/middleware.js 对称的解密，用来验证协议真的能往返 */
function decryptToken(token, key) {
  const b64 = token.replace(/-/g, '+').replace(/_/g, '/');
  const raw = Buffer.from(b64, 'base64');
  const nonce = raw.subarray(0, 24);
  const inner = xchacha20poly1305(sha256(new TextEncoder().encode(key)), nonce).decrypt(raw.subarray(24));
  assert.equal(inner[0], 0x03, '协议版本必须是 3');
  assert.equal(inner.length % 32, 0, 'inner 长度必须补齐到 32 的倍数');
  const len = (inner[1] << 8) | inner[2];
  const plain = Buffer.from(inner.subarray(3, 3 + len)).toString('utf8');
  const [ts, ...rest] = plain.split('|');
  return {ts: Number(ts), path: rest.join('|')};
}

await test('加密中间件：请求改打中间件，真实路径不出现在网络里', async () => {
  const key = 'CuhqusAmqyvZzwLmaSceWZ8jKC7272wgUJA_NQ';
  const {context, page, requests, errors} = await openPage({
    theme: {middleware_url: 'https://enc.example.invalid', middleware_key: key},
    // 中间件地址形如 https://enc.example.invalid/assets/immutable/<token>.js，
    // 真实路径藏在 token 里，所以要自己把它解出来再交给 mock
    mock: {
      pattern: 'https://enc.example.invalid/**',
      endpointOf: url => decryptToken(url.pathname.replace('/assets/immutable/', '').replace(/\.js$/, ''), key).path.split('?')[0]
    }
  });
  await goto(page, 'dashboard');
  await settle(requests, '/user/info');

  const urls = await page.evaluate(() => performance.getEntriesByType('resource').map(e => e.name));
  const apiCalls = urls.filter(u => u.includes('enc.example.invalid'));
  assert.ok(apiCalls.length > 0, '应该有请求打到中间件');
  assert.ok(!urls.some(u => /\/api\/v1\//.test(u)), '真实接口路径不该出现在任何请求里');
  assert.ok(!urls.some(u => /user\/(info|getSubscribe)/.test(u)), '接口名也不该出现在 URL 里');

  // 逐条解密：路径能还原、时间戳合理、同一路径两次加密结果不同（nonce 随机）
  const tokens = apiCalls.map(u => new URL(u).pathname.replace('/assets/immutable/', '').replace(/\.js$/, ''));
  const decoded = tokens.map(x => decryptToken(x, key));
  assert.ok(decoded.every(d => d.path.startsWith('/')), '解出来的都应是裸路径');
  assert.ok(decoded.some(d => d.path.startsWith('/user/info')));
  const now = Date.now() / 1000;
  assert.ok(decoded.every(d => Math.abs(now - d.ts) < 300), '内嵌时间戳应接近当前时间');
  assert.equal(new Set(tokens).size, tokens.length, '每次加密的 token 都应不同（nonce 随机）');
  assert.deepEqual(errors, []);
  await context.close();
});

await test('加密中间件：只填一半时中止请求而不是直连面板', async () => {
  // 只填地址不填密钥。回退直连等于站长以为开了、实际真实路径全裸奔，
  // 所以这里必须 fail-closed。
  const {context, page, errors} = await openPage({theme: {middleware_url: 'https://enc.example.invalid'}});
  await page.goto(base + '/#/dashboard');
  await page.reload();
  await page.getByText('配置不完整').waitFor({timeout: 15000});
  const urls = await page.evaluate(() => performance.getEntriesByType('resource').map(e => e.name));
  assert.ok(!urls.some(u => /\/api\/v1\//.test(u)), '配置不全时不该绕过中间件直连面板');
  assert.deepEqual(errors, []);
  await context.close();
});

await test('加密中间件：伪装扩展名非法时中止并说明原因', async () => {
  const {context, page} = await openPage({
    theme: {middleware_url: 'https://enc.example.invalid', middleware_key: 'k', middleware_ext: '.php'}
  });
  const logs = [];
  page.on('console', m => m.type() === 'error' && logs.push(m.text()));
  await page.goto(base + '/#/dashboard');
  await page.reload();
  await page.getByText('伪装扩展名无效').waitFor({timeout: 15000});
  assert.ok(logs.some(l => l.includes('不在中间件认得的名单里')), '控制台要说清是哪个配置项错了');
  await context.close();
});

// ——— 中间件诊断与富文本分档 ————————————————————————————

await test('加密中间件：伪装 404 时在控制台列出四种成因', async () => {
  const key = 'k';
  const {context, page} = await openPage({
    theme: {middleware_url: 'https://enc.example.invalid', middleware_key: key},
    // 中间件对密钥不符 / 时钟偏差 / 前缀不符 / 后缀不符一律回同一个伪装 404。
    // 不经过 mockAPI：Playwright 的路由按注册倒序匹配，后注册的同 pattern
    // 会把它整个挡掉，写了也是死配置。
    mock: {pattern: 'about:blank__unused'}
  });
  const logs = [];
  page.on('console', m => m.type() === 'error' && logs.push(m.text()));
  await page.route('https://enc.example.invalid/**', route => route.fulfill({status: 404, body: 'not found'}));
  await page.goto(base + '/#/dashboard');
  await page.reload();
  await page.waitForFunction(() => true);
  for (let i = 0; i < 60 && !logs.some(l => l.includes('[中间件] 有请求返回 404')); i++) await page.waitForTimeout(100);
  const hint = logs.find(l => l.includes('[中间件] 有请求返回 404'));
  assert.ok(hint, '伪装 404 没有任何线索，必须把可能成因打出来：' + JSON.stringify(logs));
  for (const cause of ['AES_KEY', 'TIMESTAMP_WINDOW', 'PATH_PREFIX', '剥离名单']) {
    assert.ok(hint.includes(cause), '成因清单缺少 ' + cause);
  }
  await context.close();
});

await test('富文本：知识库保留嵌入视频，套餐与公告仍然剥除', async () => {
  const state = makeState();
  const iframe = '<p>教程正文</p><iframe src="https://player.example.invalid/v" allowfullscreen></iframe>';
  state.knowledgeBody = iframe;
  state.plan.content = iframe;
  const {context, page, errors} = await openPage({state});

  // 知识库：教程里普遍嵌视频，应当保留
  await goto(page, 'knowledge');
  await page.getByText('开始使用：导入订阅').click();
  await page.getByText('教程正文').waitFor();
  assert.equal(await page.locator('.ant-drawer iframe').count(), 1, '知识库应保留 iframe');

  // 套餐描述：应该是纯排版，iframe 一律剥掉
  await goto(page, 'plan');
  await page.locator('.plan-card').first().waitFor();
  assert.equal(await page.locator('.plan-card iframe').count(), 0, '套餐描述不该允许 iframe');
  assert.deepEqual(errors, []);
  await context.close();
});

await test('首次访问：按浏览器语言选词典，不是一律中文', async () => {
  // 8 本词典里有 7 本原来除非用户自己去页脚切换、永远用不上
  for (const [browserLocale, expect, text] of [
    ['en-US', 'en-US', 'Dashboard'],
    ['ja-JP', 'ja-JP', 'ダッシュボード'],
    ['zh-TW', 'zh-TW', '儀表板'],
    ['zh-HK', 'zh-TW', null],   // 港澳按繁体，不能落到简体
    ['pt-BR', 'zh-CN', null]    // 没有对应词典就回默认
  ]) {
    const context = await browser.newContext({locale: browserLocale, viewport: {width: 1440, height: 1000}});
    const page = await context.newPage();
    const requests = [];
    await authenticate(page);
    await setThemeConfig(page, {});
    await mockAPI(page, requests, makeState());
    await page.goto(base + '/#/dashboard');
    await page.reload();
    await page.locator('h1').waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.lang), expect,
      `浏览器语言 ${browserLocale} 应选 ${expect}`);
    // 这个值还要作为 Content-Language 发给后端，影响它返回的文案和邮件语言
    await settle(requests, '/user/info');
    assert.equal(requests.find(r => r.endpoint === '/user/info').headers['content-language'], expect);
    if (text) await assert.doesNotReject(page.getByText(text).first().waitFor());
    await context.close();
  }
});

await test('首次访问：已手动选过语言就不再自动改', async () => {
  const context = await browser.newContext({locale: 'en-US', viewport: {width: 1440, height: 1000}});
  const page = await context.newPage();
  await authenticate(page);
  await setThemeConfig(page, {});
  await page.addInitScript(() =>
    localStorage.setItem('VUE_NAIVE_LOCALE', JSON.stringify({value: 'ja-JP', time: Date.now(), expire: null})));
  await mockAPI(page, [], makeState());
  await page.goto(base + '/#/dashboard');
  await page.reload();
  await page.locator('h1').waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.lang), 'ja-JP', '用户选过就听用户的');
  await context.close();
});

await test('首次访问：深色模式跟随系统偏好', async () => {
  for (const [scheme, expectDark] of [['dark', true], ['light', false]]) {
    const context = await browser.newContext({locale: 'zh-CN', colorScheme: scheme, viewport: {width: 1440, height: 1000}});
    const page = await context.newPage();
    await authenticate(page);
    await setThemeConfig(page, {});
    await mockAPI(page, [], makeState());
    await page.goto(base + '/#/dashboard');
    await page.reload();
    await page.locator('h1').waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.classList.contains('dark')), expectDark,
      `系统 ${scheme} 时首屏应为 ${expectDark ? '深色' : '浅色'}`);
    await context.close();
  }
});

await test('首次访问：手动切过深浅色就不再跟随系统', async () => {
  const context = await browser.newContext({locale: 'zh-CN', colorScheme: 'dark', viewport: {width: 1440, height: 1000}});
  const page = await context.newPage();
  await authenticate(page);
  await setThemeConfig(page, {});
  await page.addInitScript(() => localStorage.setItem('herorui-mode', 'light'));
  await mockAPI(page, [], makeState());
  await page.goto(base + '/#/dashboard');
  await page.reload();
  await page.locator('h1').waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.classList.contains('dark')), false);
  await context.close();
});

await test('签到：探测到 500 时报出原因，不静默收起入口', async () => {
  const state = makeState();
  state.fail['/user/checkin'] = {status: 500, message: '数据库暂时不可用'};
  const {context, page, requests} = await openPage({state});
  const logs = [];
  page.on('console', m => m.type() === 'warning' && logs.push(m.text()));
  await goto(page, 'dashboard');
  await settle(requests, '/user/checkin');
  await page.waitForTimeout(300);
  // 入口确实不显示（没探到状态就没法渲染），但必须在控制台留下线索 ——
  // 静默收起等于用户白丢一天签到还查不出原因
  assert.equal(await tile(page).count(), 0);
  assert.ok(logs.some(l => l.includes('[签到] 探测失败')), '探测故障要留线索：' + JSON.stringify(logs));
  await context.close();
});

await test('签到：插件不返回 enabled 字段时仍然显示（缺失 ≠ 关闭）', async () => {
  const state = makeState();
  delete state.checkin.enabled;   // 某些插件版本不回这个字段
  const {context, page, errors} = await openPage({state});
  await goto(page, 'dashboard');
  await tile(page).waitFor();
  assert.deepEqual(errors, []);
  await context.close();
});

await test('签到：reason 是对象时不把整个面板带崩', async () => {
  const state = makeState();
  state.checkin.reason = {code: 'need_plan', message: '请先购买套餐'};
  const {context, page, errors} = await openPage({state});
  await goto(page, 'dashboard');
  await tile(page).waitFor();
  // 直接当 React 子节点渲染会抛 Objects are not valid as a React child，
  // 被应用级 ErrorBoundary 接住后整个面板变成「页面暂时无法显示」
  assert.equal(await page.getByText('页面暂时无法显示').count(), 0);
  assert.equal(await page.locator('.metrics-strip').count(), 1);
  assert.deepEqual(errors, []);
  await context.close();
});

await test('签到：v2board 回「今天已签过」也要记下来，按钮不再可点', async () => {
  const state = makeState();
  state.checkin.mode = 'v2board';
  state.checkin.checked_today = 1;   // 手机上已经签过
  const {context, page, errors} = await openPage({state});
  await goto(page, 'dashboard');
  await tile(page).waitFor();
  await tile(page).click();
  // 原因同时出现在提示和入口上
  await assert.doesNotReject(page.locator('.ant-message').getByText('您今天已经签到过，请勿重复签到').waitFor());
  await page.waitForFunction(() => document.querySelector('.checkin-tile')?.innerText.includes('您今天已经签到过'), null, {timeout: 10000});
  assert.ok(await tile(page).isDisabled());
  assert.deepEqual(errors, []);
  await context.close();
});

await test('登录态：401 响应体不是 JSON 时也要清掉 token', async () => {
  const {context, page} = await openPage();
  // nginx / CDN 的拦截页、PHP fatal 都会给出非 JSON 的 401
  await page.route('**/api/v1/user/info**', route =>
    route.fulfill({status: 401, contentType: 'text/html', body: '<html>401</html>'}));
  await page.goto(base + '/#/dashboard');
  await page.reload();
  await page.waitForFunction(() => location.hash.startsWith('#/login'), null, {timeout: 15000});
  assert.equal(await page.evaluate(() => localStorage.getItem('VUE_NAIVE_ACCESS_TOKEN')), null,
    '过期 token 必须清掉，否则页面卡在无限重试的错误页');
  await context.close();
});

await test('加密中间件：入口前缀漏了斜杠不会改坏主机名', async () => {
  const key = 'k';
  const {context, page, requests, errors} = await openPage({
    // 从中间件 .env 复制 PATH_PREFIX 时很容易漏掉开头的 /
    theme: {middleware_url: 'https://enc.example.invalid/', middleware_key: key, middleware_path: 'assets/immutable'},
    mock: {
      pattern: 'https://enc.example.invalid/**',
      endpointOf: url => decryptToken(url.pathname.replace('/assets/immutable/', '').replace(/\.js$/, ''), key).path.split('?')[0]
    }
  });
  await goto(page, 'dashboard');
  await settle(requests, '/user/info');
  const urls = await page.evaluate(() => performance.getEntriesByType('resource').map(e => e.name));
  assert.ok(urls.some(u => u.startsWith('https://enc.example.invalid/assets/immutable/')),
    '地址应被归一化，而不是拼成 enc.example.invalidassets：' + JSON.stringify(urls.filter(u => u.includes('example.invalid'))));
  assert.deepEqual(errors, []);
  await context.close();
});

await test('富文本：知识库的 iframe 带 sandbox，挡住真域名下的假登录框', async () => {
  const state = makeState();
  state.knowledgeBody = '<p>教程正文</p><iframe src="https://player.example.invalid/v"></iframe>';
  const {context, page, errors} = await openPage({state});
  await goto(page, 'knowledge');
  await page.getByText('开始使用：导入订阅').click();
  await page.getByText('教程正文').waitFor();
  const frame = page.locator('.ant-drawer iframe');
  const sandbox = await frame.getAttribute('sandbox');
  assert.ok(sandbox !== null, '放行 iframe 就必须带 sandbox');
  assert.ok(!/allow-same-origin/.test(sandbox), 'allow-scripts 与 allow-same-origin 同时给会让 sandbox 失效');
  assert.ok(!/allow-top-navigation|allow-forms/.test(sandbox), '不该允许表单提交与顶层跳转');
  assert.equal(await frame.getAttribute('referrerpolicy'), 'no-referrer');
  assert.deepEqual(errors, []);
  await context.close();
});

await test('富文本：二次解析才出现的 iframe（mXSS）同样带 sandbox', async () => {
  const state = makeState();
  // 第一次解析时 iframe 只是 <style> 里的文本，序列化再解析后才变成真元素
  state.knowledgeBody = '<p>教程正文</p><form><math><mtext></form><form><mglyph><style></math><iframe src="https://evil.example.invalid/login"></iframe>';
  const {context, page, errors} = await openPage({state});
  await goto(page, 'knowledge');
  await page.getByText('开始使用：导入订阅').click();
  await page.getByText('教程正文').waitFor();
  const frames = await page.$$eval('.ant-drawer iframe', list => list.map(f => f.getAttribute('sandbox')));
  for (const sandbox of frames) assert.equal(sandbox, 'allow-scripts allow-presentation', '每个 iframe 都必须带 sandbox');
  assert.deepEqual(errors, []);
  await context.close();
});

await test('富文本：放行客户端一键导入协议（sing-box / clash-meta），拒绝系统协议', async () => {
  const state = makeState();
  state.knowledgeBody = '<p>教程正文</p><a id="a1" href="sing-box://import-remote-profile?url=x">A</a><a id="a2" href="clash-meta://install-config?url=x">B</a>'
    + '<a id="a3" href="ms-msdt:/id x">C</a><a id="a4" href="search-ms:query=x">D</a><a id="a5" href="javascript:alert(1)">E</a><a id="a6" href="/help">F</a>';
  const {context, page, errors} = await openPage({state});
  await goto(page, 'knowledge');
  await page.getByText('开始使用：导入订阅').click();
  await page.getByText('教程正文').waitFor();
  const href = id => page.locator('.ant-drawer #' + id).getAttribute('href');
  assert.equal(await href('a1'), 'sing-box://import-remote-profile?url=x');
  assert.equal(await href('a2'), 'clash-meta://install-config?url=x');
  for (const id of ['a3', 'a4', 'a5']) assert.equal(await href(id), null, id + ' 的危险协议必须剥掉');
  assert.equal(await href('a6'), '/help');
  assert.deepEqual(errors, []);
  await context.close();
});

await test('富文本：套餐描述为 null 时不显示文字 "null"', async () => {
  const state = makeState();
  state.plan.content = null;
  const {context, page, errors} = await openPage({state});
  await goto(page, 'plan/1');
  await page.getByText('商品信息').waitFor();
  assert.ok(!(await page.locator('.rich').first().innerText()).includes('null'));
  assert.deepEqual(errors, []);
  await context.close();
});

await test('兼容：没有 AbortSignal.any / AbortSignal.timeout 的旧浏览器（iOS 16）照常加载', async () => {
  const {context, page, errors} = await openPage();
  await page.addInitScript(() => { delete AbortSignal.any; delete AbortSignal.timeout; });
  await goto(page, 'dashboard');
  await assert.doesNotReject(page.getByText('28.50', {exact: true}).waitFor());
  assert.equal(await page.locator('.fatal-error').count(), 0);
  assert.deepEqual(errors, []);
  await context.close();
});

await test('请求：V2board 的 422 显示 errors 里的原因，而不是英文的 "The given data was invalid."', async () => {
  const {context, page, errors} = await openPage();
  await page.route('**/api/v1/user/changePassword', route => route.fulfill({status: 422,
    json: {message: 'The given data was invalid.', errors: {new_password: ['新密码至少 8 位']}}}));
  await goto(page, 'profile');
  await page.getByRole('textbox', {name: '旧密码'}).fill('old-password');
  await page.getByRole('textbox', {name: '新密码'}).fill('new-password');
  await page.getByRole('textbox', {name: '再次输入密码'}).fill('new-password');
  await page.getByRole('button', {name: '保存'}).click();
  await assert.doesNotReject(page.getByText('新密码至少 8 位').waitFor());
  assert.equal(await page.getByText('The given data was invalid.').count(), 0);
  assert.deepEqual(errors, []);
  await context.close();
});

await test('总览：V2board 签到把已用流量减成负数时按 0 显示', async () => {
  const state = makeState();
  state.user.u = -31457280; state.user.d = 0;
  const {context, page, errors} = await openPage({state});
  await goto(page, 'dashboard');
  await page.locator('.usage-display').waitFor();
  const text = await page.locator('.usage-card').innerText();
  assert.ok(!text.includes('-'), '不该出现负数流量：' + text);
  assert.deepEqual(errors, []);
  await context.close();
});

await test('总览：后台刷新失败不把整个面板换成错误页', async () => {
  const {context, page, requests, state, errors} = await openPage();
  await goto(page, 'dashboard');
  await tile(page).waitFor();
  state.fail['/user/info'] = {status: 500, message: '临时故障'};
  state.fail['/user/getSubscribe'] = {status: 500, message: '临时故障'};
  await tile(page).click();   // 签到成功后会 reload() 刷新 user / subscribe
  for (let i = 0; i < 60 && requests.filter(r => r.endpoint === '/user/info').length < 2; i++) await page.waitForTimeout(100);
  await page.waitForTimeout(300);
  assert.equal(await page.locator('.fatal-error').count(), 0, '已有数据时一次刷新失败不该整页报错');
  assert.ok(await page.locator('.usage-card').isVisible());
  assert.deepEqual(errors, []);
  await context.close();
});

await test('总览：手机宽度下帮助卡片不被 Telegram 卡片挤窄', async () => {
  const {context, page, errors} = await openPage({theme: {telegram_channel: 'https://t.me/example'}});
  await page.setViewportSize({width: 390, height: 900});
  await goto(page, 'dashboard');
  await page.locator('.help-stack .tg-channel').waitFor();
  const widths = await page.$$eval('.help-stack > .help-link', list => list.map(e => e.getBoundingClientRect().width));
  for (const w of widths) assert.ok(w > 120, '帮助卡片太窄：' + widths.join(', '));
  assert.deepEqual(errors, []);
  await context.close();
});

await test('购买：renew=0 的当前套餐仍可买重置流量包', async () => {
  const state = makeState();
  state.plan.renew = 0;
  const {context, page, errors} = await openPage({state});
  await goto(page, 'plan/1?period=reset_price');
  const buy = page.locator('.checkout-summary .button').first();
  await buy.waitFor();
  assert.ok(await buy.isEnabled(), '两个面板都豁免重置流量包的续费检查');
  // 换回普通周期就应该是「不可续费」
  await page.locator('.period-option').first().click();
  await assert.doesNotReject(page.getByText('不可续费').first().waitFor());
  assert.deepEqual(errors, []);
  await context.close();
});

await test('购买：停售但允许续费的当前套餐，列表里不显示「已售罄」', async () => {
  const state = makeState();
  state.plan.sell = 0; state.plan.renew = 1;
  const {context, page, errors} = await openPage({state});
  await goto(page, 'plan');
  const card = page.locator('.plan-card', {hasText: '探索者 Pro'});
  await card.waitFor();
  assert.ok(!(await card.innerText()).includes('已售罄'), '老用户续费不受停售影响');
  assert.deepEqual(errors, []);
  await context.close();
});

await test('文案插值：值里的 $ 不被当成替换模式', async () => {
  const state = makeState();
  // 插件回的 traffic 原样进 t()，其中的 $& / $` 会被 replaceAll 当成替换模式
  state.checkin.traffic = '$&20 MB';
  const {context, page, errors} = await openPage({state});
  await goto(page, 'dashboard');
  await tile(page).click();
  await assert.doesNotReject(page.getByText('签到成功，获得 $&20 MB').waitFor());
  assert.deepEqual(errors, []);
  await context.close();
});

await test('签到：非中文语种下的失败也能正确收起 / 禁用（不靠中文正则）', async () => {
  // 后端按 Content-Language 本地化，zh-TW 是「已經簽到」，日韩俄更是完全不同
  const off = makeState();
  off.checkin.mode = 'v2board';
  const a = await openPage({state: off});
  await goto(a.page, 'dashboard');
  await tile(a.page).waitFor();          // 先让探测通过，再注入故障（fail 对 GET 也生效）
  off.fail['/user/checkin'] = {status: 500, message: 'チェックイン機能は無効です'};
  await tile(a.page).click();
  await assert.doesNotReject(a.page.getByText('チェックイン機能は無効です').waitFor());
  await tile(a.page).click();   // 连续第二次才收起，与语种无关
  await a.page.waitForFunction(() => !document.querySelector('.checkin-tile'), null, {timeout: 10000});
  await a.context.close();

  const done = makeState();
  done.checkin.mode = 'v2board';
  done.checkin.checked_today = 1;
  done.checkin.message = '이미 출석했습니다';
  const b = await openPage({state: done});
  await goto(b.page, 'dashboard');
  await tile(b.page).waitFor();
  await tile(b.page).click();
  await assert.doesNotReject(b.page.locator('.ant-message').getByText('이미 출석했습니다').waitFor());
  await b.page.waitForFunction(() => document.querySelector('.checkin-tile')?.disabled === true, null, {timeout: 10000});
  await b.context.close();
});

await test('富文本：带连字符的协议不被放行（正则字符类不能写成范围）', async () => {
  const state = makeState();
  // [^a-z+.-:] 里未转义的 - 会构成 . 到 : 的范围，把连字符放出排除集，
  // 于是 ms-msdt: / search-ms: 这类可唤起本地程序的协议全被放行
  state.knowledgeBody = '<p>正文</p><a id="bad" href="search-ms:query=x">点这里</a><a id="ok" href="clash://install-config?url=x">导入</a>';
  const {context, page, errors} = await openPage({state});
  await goto(page, 'knowledge');
  await page.getByText('开始使用：导入订阅').click();
  await page.getByText('正文').waitFor();
  assert.equal(await page.locator('#bad[href]').count(), 0, 'search-ms: 应被剥掉');
  assert.equal(await page.locator('#ok[href^="clash://"]').count(), 1, '订阅协议仍要放行');
  assert.deepEqual(errors, []);
  await context.close();
});

await test('套餐详情页：新购拦住售罄，但不拦老用户续费', async () => {
  // 「停售但让老用户续费」（sell=0, renew=1）是常见配置。两个面板对续费
  // 只看 renew（Xboard PlanService::isPlanAvailableForUser），拿售罄拦续费
  // 等于把后端本来会接受的订单挡在前端。
  const other = makeState();
  other.plan.sell = 0; other.plan.renew = 1; other.user.plan_id = 99;  // 不是自己的套餐 → 新购
  const a = await openPage({state: other});
  await goto(a.page, 'plan/1');
  await a.page.locator('.checkout-summary').waitFor();
  assert.ok(await a.page.getByRole('button', {name: /已售罄/}).isDisabled(), '新购应被拦住');
  await a.context.close();

  const mine = makeState();
  mine.plan.sell = 0; mine.plan.renew = 1; mine.user.plan_id = 1;      // 正是自己的套餐 → 续费
  const b = await openPage({state: mine});
  await goto(b.page, 'plan/1');
  await b.page.locator('.checkout-summary').waitFor();
  assert.ok(!(await b.page.getByRole('button', {name: '下单'}).isDisabled()), '续费不该被售罄拦住');
  assert.equal(await b.page.getByText('已售罄').count(), 0);
  await b.context.close();

  const noRenew = makeState();
  noRenew.plan.sell = 1; noRenew.plan.renew = 0; noRenew.user.plan_id = 1;
  const c = await openPage({state: noRenew});
  await goto(c.page, 'plan/1');
  await c.page.locator('.checkout-summary').waitFor();
  assert.ok(await c.page.getByRole('button', {name: /不可续费/}).isDisabled(), 'renew=0 时要拦住续费');
  await c.context.close();
});

// ——— 邀请域名 / 登录设备 ——————————————————————————————————

await test('邀请链接：默认用当前域名，配置了备用域名则用它', async () => {
  const a = await openPage();
  await a.context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await goto(a.page, 'invite');
  await a.page.getByRole('button', {name: '复制链接'}).first().click();
  const def = await a.page.evaluate(() => navigator.clipboard.readText());
  assert.ok(def.startsWith(base + '/#/register?code='), '默认应是当前域名：' + def);
  await a.context.close();

  // 主域名被墙时，已发出去的邀请链接才不会全是死链
  const b = await openPage({theme: {invite_domain: 'https://backup.example.invalid/'}});
  await b.context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await goto(b.page, 'invite');
  await b.page.getByRole('button', {name: '复制链接'}).first().click();
  const custom = await b.page.evaluate(() => navigator.clipboard.readText());
  assert.ok(custom.startsWith('https://backup.example.invalid/#/register?code='), '应使用备用域名：' + custom);
  await b.context.close();
});

await test('邀请链接：备用域名漏了协议时退回当前域名而不是生成死链', async () => {
  const {context, page} = await openPage({theme: {invite_domain: 'backup.example.invalid'}});
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const warns = [];
  page.on('console', m => m.type() === 'warning' && warns.push(m.text()));
  await goto(page, 'invite');
  await page.getByRole('button', {name: '复制链接'}).first().click();
  const link = await page.evaluate(() => navigator.clipboard.readText());
  assert.ok(link.startsWith(base + '/#/register?code='), '应退回当前域名：' + link);
  assert.ok(warns.some(w => w.includes('[邀请]')), '要在控制台说明被忽略的原因');
  await context.close();
});

await test('登录设备：Xboard 形状（Sanctum 行 + ISO 日期）解析正确并可移除', async () => {
  const state = makeState();
  const {context, page, requests, errors} = await openPage({state});
  await goto(page, 'profile');
  await page.getByRole('tab', {name: '登录设备'}).click();
  const rows = page.locator('.session-row');
  await rows.first().waitFor();
  assert.equal(await rows.count(), 2);
  // Sanctum 的 name 是随机串，不能当设备名显示
  assert.equal(await page.getByText('kQ8mZ2vX1pL7nR4tY6wA').count(), 0, '随机 token 名不该显示成设备名');
  await assert.doesNotReject(rows.first().getByText('未知设备').waitFor());
  // 时间必须解析出来 —— Number() 吃不下 ISO-8601，原来整条时间行会是「—」
  const meta = await rows.first().locator('span').first().textContent();
  assert.ok(/登录于|最后活跃/.test(meta), '应显示登录 / 活跃时间，实际：' + JSON.stringify(meta));
  assert.ok(!/^—$/.test(meta.trim()), '时间没解析出来会退化成「—」');
  // 按最后活跃倒序：id 7 的 last_used_at 比 id 8 新
  await rows.first().getByRole('button', {name: '移除'}).click();
  await page.getByRole('button', {name: '移除', exact: true}).last().click();
  await settle(requests, '/user/removeActiveSession');
  assert.equal(requests.find(r => r.endpoint === '/user/removeActiveSession').body.session_id, '7',
    '排序应把最近活跃的排在最前');
  await page.waitForFunction(() => document.querySelectorAll('.session-row').length === 1, null, {timeout: 15000});
  assert.deepEqual(errors, []);
  await context.close();
});

await test('登录设备：v2board 形状（对象）也能列出，且不泄漏 token', async () => {
  const state = makeState();
  state.sessions = {
    g1: {ip: '1.2.3.4', ua: 'Mozilla/5.0 Chrome', login_at: 1789171200, auth_data: 'preview-token'},
    g2: {ip: '5.6.7.8', ua: 'Clash', login_at: 1789100000, auth_data: 'other-token'}
  };
  const {context, page, errors} = await openPage({state});
  await goto(page, 'profile');
  await page.getByRole('tab', {name: '登录设备'}).click();
  await page.getByText('Mozilla/5.0 Chrome').waitFor();
  await assert.doesNotReject(page.getByText('1.2.3.4', {exact: false}).waitFor());
  // v2board 会把每个会话的 auth_data（真 token）一起返回，只能用来标出当前设备
  await assert.doesNotReject(page.getByText('当前设备').waitFor());
  const html = await page.locator('.session-list').innerHTML();
  assert.ok(!html.includes('other-token') && !html.includes('preview-token'), 'token 不能出现在页面上');
  assert.deepEqual(errors, []);
  await context.close();
});

await test('登录设备：接口不可用时不留空白面板', async () => {
  const state = makeState();
  state.fail['/user/getActiveSession'] = {status: 404, message: 'Not Found'};
  const {context, page, errors} = await openPage({state});
  await goto(page, 'profile');
  await page.getByRole('tab', {name: '登录设备'}).click();
  await assert.doesNotReject(page.getByText('暂时无法获取登录设备').waitFor());
  assert.deepEqual(errors, []);
  await context.close();
});

// ——— 客户端下载页 ——————————————————————————————————————

await test('客户端下载：只显示配了地址的平台，并过滤非 http(s)', async () => {
  const {context, page, errors} = await openPage({theme: {
    client_windows: 'https://dl.example.invalid/win.exe',
    client_android: 'https://dl.example.invalid/app.apk',
    client_macos: '',                                  // 留空 → 不显示
    client_ios: 'javascript:alert(1)',                 // 非法协议 → 不显示
    client_linux: 'noscheme.example.invalid/linux',    // 缺协议 → 不显示（safeURL 会误判成本站路径）
    client_tv: 'https://dl.example.invalid/tv.apk',    // 第 7 端
    client_note: '安装后回到总览一键导入',
    help_url: 'https://help.example.invalid'
  }});
  const logs = [];
  page.on('console', m => m.type() === 'error' && logs.push(m.text()));
  await goto(page, 'client');
  await page.getByText('安装后回到总览一键导入').waitFor();
  const names = await page.locator('.client-card strong').allTextContents();
  // 顺序按 PLATFORMS 声明：Windows / macOS / Android / iOS / Linux / OpenWrt / TV
  assert.deepEqual(names, ['Windows', 'Android', 'TV'], '只该显示配了合法绝对地址的平台：' + JSON.stringify(names));
  assert.equal(await page.locator('.client-card[href^="javascript"]').count(), 0);
  // 缺协议的值被 safeURL 解析成本站路径，校验会通过、卡片照常显示，
  // 但用户点进去是本站 404 —— 必须在这之前就拦掉，并说明原因
  assert.equal(await page.locator('.client-card[href*="noscheme.example.invalid"]').count(), 0,
    '缺协议的下载地址不该变成本站相对链接');
  assert.ok(logs.some(l => l.includes('[客户端下载]') && l.includes('Linux')),
    '被忽略的地址要在控制台说明原因：' + JSON.stringify(logs));
  // 外链要带 rel，避免新标签页反向操纵原页
  assert.equal(await page.locator('.client-card[rel="noopener noreferrer"]').count(), 3);
  await assert.doesNotReject(page.getByRole('button', {name: /查看教程/}).waitFor());
  assert.deepEqual(errors, []);
  await context.close();
});

await test('客户端下载：一个地址都没配时连导航入口都不出现', async () => {
  const {context, page, errors} = await openPage();
  await goto(page, 'dashboard');
  assert.equal(await page.locator('.desktop-nav a[href="#/client"]').count(), 0,
    '没填地址就不该多一个空页面的入口');
  assert.deepEqual(errors, []);
  await context.close();
});

await test('客户端下载：配了地址后导航出现且可进入', async () => {
  const {context, page, errors} = await openPage({theme: {client_windows: 'https://dl.example.invalid/win.exe'}});
  await goto(page, 'dashboard');
  await page.locator('.desktop-nav a[href="#/client"]').click();
  await page.getByText('客户端下载').first().waitFor();
  await page.locator('.client-card').first().waitFor();
  assert.deepEqual(errors, []);
  await context.close();
});

await test('客户端下载：七端齐全时全部显示', async () => {
  const urls = {};
  for (const f of ['client_windows', 'client_macos', 'client_android', 'client_ios', 'client_linux', 'client_openwrt', 'client_tv'])
    urls[f] = 'https://dl.example.invalid/' + f + '.bin';
  const {context, page, errors} = await openPage({theme: urls});
  await goto(page, 'client');
  const names = await page.locator('.client-card strong').allTextContents();
  assert.deepEqual(names, ['Windows', 'macOS', 'Android', 'iOS', 'Linux', 'OpenWrt', 'TV']);
  assert.deepEqual(errors, []);
  await context.close();
});

await test('Telegram 频道：配了才出现，总览与下载页各一处', async () => {
  const theme = {telegram_channel: 'https://t.me/examplechannel', client_windows: 'https://dl.example.invalid/w.exe'};
  const {context, page, errors} = await openPage({theme});
  await goto(page, 'dashboard');
  const tg = page.locator('.tg-channel');
  await tg.waitFor();
  assert.equal(await tg.getAttribute('href'), 'https://t.me/examplechannel');
  // 外链要带 rel，避免新标签页反向操纵原页
  assert.equal(await tg.getAttribute('rel'), 'noopener noreferrer');
  await assert.doesNotReject(page.getByText('关注频道，获取节点更新与故障公告').waitFor());
  await goto(page, 'client');
  await page.locator('.tg-channel').waitFor();
  assert.deepEqual(errors, []);
  await context.close();
});

await test('Telegram 频道：留空不出现；缺协议则忽略并说明', async () => {
  const a = await openPage();
  await goto(a.page, 'dashboard');
  await a.page.locator('.help-stack').waitFor();
  assert.equal(await a.page.locator('.tg-channel').count(), 0, '没配就不该多出一个入口');
  await a.context.close();

  const b = await openPage({theme: {telegram_channel: 't.me/examplechannel'}});
  const logs = [];
  b.page.on('console', m => m.type() === 'error' && logs.push(m.text()));
  await goto(b.page, 'dashboard');
  await b.page.locator('.help-stack').waitFor();
  assert.equal(await b.page.locator('.tg-channel').count(), 0, '缺协议会被解析成本站死链，应忽略');
  assert.ok(logs.some(l => l.includes('Telegram 频道')), '要说明被忽略的原因：' + JSON.stringify(logs));
  await b.context.close();
});

await test('Telegram 频道：可自定义说明文字', async () => {
  const {context, page} = await openPage({theme: {
    telegram_channel: 'https://t.me/examplechannel',
    telegram_channel_note: '每日更新可用节点'
  }});
  await goto(page, 'dashboard');
  await assert.doesNotReject(page.getByText('每日更新可用节点').waitFor());
  await context.close();
});

// ——— 兑换码 ————————————————————————————————————————————

const giftTab = async page => {
  await goto(page, 'profile');
  await page.getByRole('tab', {name: '兑换码'}).click();
  await page.getByRole('textbox', {name: '兑换码'}).waitFor();
};

await test('兑换码：Xboard 先预览再确认，奖励逐项列出', async () => {
  const {context, page, requests, errors} = await openPage();
  await giftTab(page);
  // 预览不消耗次数，所以是「查询」而不是直接兑换
  await page.getByRole('textbox', {name: '兑换码'}).fill('GIFT-2026');
  await page.getByRole('button', {name: '查询'}).click();
  await settle(requests, '/user/gift-card/check');
  await page.getByText('新年礼包').waitFor();
  await assert.doesNotReject(page.getByText('可以兑换').waitFor());
  // 三种奖励都要看得见，别静默丢掉
  // 流量奖励在后端是**字节**（直接累加到 users.transfer_enable），
  // 当成 GB 显示会变成「+107374182400 GB」
  for (const text of ['账户余额', '+50.00', '流量', '+100.00 GB', '有效期', '+30 天']) {
    await assert.doesNotReject(page.getByText(text, {exact: false}).first().waitFor());
  }
  assert.equal(requests.filter(r => r.endpoint === '/user/gift-card/redeem').length, 0, '查询不该顺手兑换');

  await page.getByRole('button', {name: '确认兑换'}).click();
  await settle(requests, '/user/gift-card/redeem');
  assert.equal(requests.find(r => r.endpoint === '/user/gift-card/redeem').body.code, 'GIFT-2026');
  await assert.doesNotReject(page.getByText('兑换成功').waitFor());
  // 套餐 / 流量 / 余额都可能变了，必须刷新账户
  assert.ok(requests.filter(r => r.endpoint === '/user/info').length >= 2);
  assert.deepEqual(errors, []);
  await context.close();
});

await test('兑换码：不可兑换时给出原因且禁用按钮', async () => {
  const state = makeState();
  state.giftcard.preview = {...state.giftcard.preview, can_redeem: false, reason: '该礼品卡仅限新用户使用'};
  const {context, page, errors} = await openPage({state});
  await giftTab(page);
  await page.getByRole('textbox', {name: '兑换码'}).fill('GIFT-2026');
  await page.getByRole('button', {name: '查询'}).click();
  await assert.doesNotReject(page.getByText('该礼品卡仅限新用户使用').waitFor());
  assert.ok(await page.getByRole('button', {name: '确认兑换'}).isDisabled());
  assert.deepEqual(errors, []);
  await context.close();
});

await test('兑换码：V2board 没有预览，直接兑换且字段名是 giftcard', async () => {
  const state = makeState();
  state.giftcard.mode = 'v2board';
  const {context, page, requests, errors} = await openPage({state});
  await giftTab(page);
  // 探测 types 得到 404 → 只显示「兑换」，没有「查询」和兑换记录
  assert.equal(await page.getByRole('button', {name: '查询'}).count(), 0);
  assert.equal(await page.getByText('兑换记录').count(), 0);
  await page.getByRole('textbox', {name: '兑换码'}).fill('GIFT-2026');
  await page.getByRole('button', {name: '兑换', exact: true}).click();
  for (let i = 0; i < 60 && !requests.some(r => r.endpoint === '/user/redeemgiftcard' && r.method === 'POST'); i++) await page.waitForTimeout(100);
  // 第一条是探测用的 GET（期望 405），兑换本身是 POST
  const sent = requests.find(r => r.endpoint === '/user/redeemgiftcard' && r.method === 'POST');
  assert.equal(sent.body.giftcard, 'GIFT-2026', 'v2board 的字段名是 giftcard 不是 code');
  assert.equal(sent.body.code, undefined);
  await assert.doesNotReject(page.getByText('兑换成功').waitFor());
  assert.deepEqual(errors, []);
  await context.close();
});

await test('兑换码：无效码显示后端原因，不误报成功', async () => {
  const {context, page, errors} = await openPage();
  await giftTab(page);
  await page.getByRole('textbox', {name: '兑换码'}).fill('WRONG');
  await page.getByRole('button', {name: '查询'}).click();
  await assert.doesNotReject(page.getByText('礼品卡不存在或已过期').waitFor());
  assert.equal(await page.getByRole('button', {name: '确认兑换'}).count(), 0);
  assert.deepEqual(errors, []);
  await context.close();
});

await test('兑换码：兑换记录（该接口不走 success 包装）', async () => {
  const {context, page, errors} = await openPage();
  await giftTab(page);
  await page.getByText('兑换记录').waitFor();
  await assert.doesNotReject(page.getByText('GIFT-202****').waitFor());
  await assert.doesNotReject(page.getByText('通用礼品卡').first().waitFor());
  assert.deepEqual(errors, []);
  await context.close();
});

await test('兑换码：盲盒不把随机预览当成承诺', async () => {
  const state = makeState();
  // 后端 previewRewards() 和 redeem 各自独立调用 calculateActualRewards()，
  // 盲盒（type 3）走 mt_rand —— 两次结果不同，预览不能当成「你会得到什么」
  state.giftcard.preview = {
    ...state.giftcard.preview,
    code_info: {...state.giftcard.preview.code_info,
      template: {name: '神秘盲盒', description: '', type: 3, type_name: '盲盒礼品卡'}},
    reward_preview: {transfer_enable: 536870912000}
  };
  const {context, page, errors} = await openPage({state});
  await giftTab(page);
  await page.getByRole('textbox', {name: '兑换码'}).fill('GIFT-2026');
  await page.getByRole('button', {name: '查询'}).click();
  await page.getByText('神秘盲盒').waitFor();
  await assert.doesNotReject(page.getByText('随机获得奖励', {exact: false}).waitFor());
  // 那个随机抽到的 500 GB 不能显示出来，否则就是替后端许了个它没许的诺
  assert.equal(await page.getByText('+500.00 GB').count(), 0, '盲盒不该把随机抽样当奖励列出来');
  // 仍然可以兑换
  assert.ok(!(await page.getByRole('button', {name: '确认兑换'}).isDisabled()));
  assert.deepEqual(errors, []);
  await context.close();
});

await test('兑换码：非盲盒仍然逐项列出奖励', async () => {
  const state = makeState();
  state.giftcard.preview.code_info.template.type = 1;
  const {context, page, errors} = await openPage({state});
  await giftTab(page);
  await page.getByRole('textbox', {name: '兑换码'}).fill('GIFT-2026');
  await page.getByRole('button', {name: '查询'}).click();
  await assert.doesNotReject(page.getByText('+100.00 GB').waitFor());
  assert.equal(await page.getByText('随机获得奖励', {exact: false}).count(), 0);
  assert.deepEqual(errors, []);
  await context.close();
});

await test('兑换码：未知奖励字段原样显示，不静默丢弃', async () => {
  const state = makeState();
  state.giftcard.preview = {...state.giftcard.preview, reward_preview: {balance: 100, mystery_bonus: 'x2'}};
  const {context, page, errors} = await openPage({state});
  await giftTab(page);
  await page.getByRole('textbox', {name: '兑换码'}).fill('GIFT-2026');
  await page.getByRole('button', {name: '查询'}).click();
  await assert.doesNotReject(page.getByText('mystery_bonus').waitFor());
  await assert.doesNotReject(page.getByText('x2').waitFor());
  assert.deepEqual(errors, []);
  await context.close();
});

await test('兑换码：探测失败（非 404）不猜面板类型，给重试且能恢复', async () => {
  const state = makeState();
  state.fail['/user/gift-card/types'] = {status: 500, message: '服务暂时不可用'};
  const {context, page, requests} = await openPage({state});
  const warns = [];
  page.on('console', m => m.type() === 'warning' && warns.push(m.text()));
  await goto(page, 'profile');
  await page.getByRole('tab', {name: '兑换码'}).click();
  // 500 / 超时 / 中间件配置错都是故障，猜哪边都可能猜错：当 v2board 会让 Xboard
  // 站点掉进不存在的 /user/redeemgiftcard，当 Xboard 又会把故障永久锁死
  await page.getByText('暂时无法获取兑换码功能，请稍后重试').waitFor();
  assert.ok(warns.some(w => w.includes('[兑换码] 面板探测失败')), '要留线索：' + JSON.stringify(warns));
  assert.equal(requests.filter(r => r.endpoint === '/user/redeemgiftcard').length, 0);
  delete state.fail['/user/gift-card/types'];
  await page.getByRole('button', {name: '重试'}).click();
  await assert.doesNotReject(page.getByRole('button', {name: '查询'}).waitFor());
  await context.close();
});

await test('兑换码：原版 V2board（两个接口都 404）明确提示未开启', async () => {
  const state = makeState();
  state.giftcard.mode = 'absent';
  const {context, page, requests, errors} = await openPage({state});
  await goto(page, 'profile');
  await page.getByRole('tab', {name: '兑换码'}).click();
  await page.getByText('当前站点未开启兑换码功能').waitFor();
  assert.equal(await page.getByRole('textbox', {name: '兑换码'}).count(), 0, '不该留一个永远报错的输入框');
  assert.equal(requests.filter(r => r.endpoint === '/user/redeemgiftcard' && r.method === 'POST').length, 0);
  assert.deepEqual(errors, []);
  await context.close();
});

await test('兑换码：邀请返利按比例显示，嵌套字段不显示成 [object Object]', async () => {
  const state = makeState();
  state.giftcard.preview = {...state.giftcard.preview, reward_preview: {balance: 100, invite_reward_rate: 0.2, random_rewards: [{balance: 1}]}};
  const {context, page, errors} = await openPage({state});
  await giftTab(page);
  await page.getByRole('textbox', {name: '兑换码'}).fill('GIFT-2026');
  await page.getByRole('button', {name: '查询'}).click();
  await page.locator('.reward-list').waitFor();
  const text = await page.locator('.giftcard-preview').innerText();
  assert.match(text, /20%/, '0.2 是比例，应显示 20%：' + text);
  assert.ok(!text.includes('0.2%'));
  assert.ok(!text.includes('[object Object]') && !text.includes('random_rewards'), text);
  assert.deepEqual(errors, []);
  await context.close();
});

await test('兑换码：兑换记录一次失败后能恢复，不永久卡住', async () => {
  const state = makeState();
  state.fail['/user/gift-card/history'] = {status: 500, message: '记录服务异常'};
  const {context, page, errors} = await openPage({state});
  await giftTab(page);
  await page.getByText('记录服务异常').waitFor();
  // 错误不清除的话，之后即使重取成功也永远显示这条旧错误
  delete state.fail['/user/gift-card/history'];
  await page.getByRole('textbox', {name: '兑换码'}).fill('GIFT-2026');
  await page.getByRole('button', {name: '查询'}).click();
  await page.getByRole('button', {name: '确认兑换'}).click();
  await assert.doesNotReject(page.getByText('GIFT-202****').waitFor());
  assert.equal(await page.getByText('记录服务异常').count(), 0, '重取成功后旧错误必须消失');
  assert.deepEqual(errors, []);
  await context.close();
});


// ——— 免登录链接 ———————————————————————————————————————————

await test('免登录链接：生成并复制，链接能直接登录', async () => {
  const {context, page, requests, errors} = await openPage();
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await goto(page, 'profile');
  await page.getByRole('button', {name: '生成并复制'}).click();
  await settle(requests, '/user/getQuickLoginUrl');
  assert.equal(requests.find(r => r.endpoint === '/user/getQuickLoginUrl').method, 'POST');
  await assert.doesNotReject(page.getByText('链接已复制，60 秒内有效').waitFor());
  // 复制到剪贴板的必须是后端给的那条链接
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  assert.equal(copied, 'https://panel.example.invalid/#/login?verify=quick-code&redirect=dashboard');
  assert.deepEqual(errors, []);
  await context.close();

  // 真实用法是「在另一台设备上打开」——所以换一个未登录的上下文验证链接可用。
  // 在已登录的页面里打开会被直接重定向到 dashboard，走不到 token2Login。
  const other = await openPage({authed: false});
  await other.page.goto(base + '/' + new URL(copied).hash);
  await other.page.waitForURL('**/#/dashboard', {timeout: 15000});
  const exchanged = other.requests.find(r => r.endpoint === '/passport/auth/token2Login');
  assert.ok(exchanged, '登录页必须拿 verify 去换登录态，否则生成的链接是废的');
  assert.equal(exchanged.query.verify, 'quick-code');
  assert.deepEqual(other.errors, []);
  await other.context.close();
});

await test('免登录链接：剪贴板被拒（Safari 在请求返回后不再算用户操作）时弹窗展示链接', async () => {
  const {context, page, errors} = await openPage();
  await page.addInitScript(() => {
    const deny = () => Promise.reject(new DOMException('NotAllowedError', 'NotAllowedError'));
    Object.defineProperty(navigator, 'clipboard', {value: {write: deny, writeText: deny}, configurable: true});
    document.execCommand = () => false;
  });
  await goto(page, 'profile');
  await page.getByRole('button', {name: '生成并复制'}).click();
  const dialog = page.getByRole('dialog', {name: '免登录链接'});
  await dialog.waitFor();
  assert.equal(await dialog.getByRole('textbox').inputValue(), 'https://panel.example.invalid/#/login?verify=quick-code&redirect=dashboard');
  assert.equal(await page.getByText('链接已复制，60 秒内有效').count(), 0, '没复制成功就不能说已复制');
  assert.deepEqual(errors, []);
  await context.close();
});

await test('免登录链接：后端没返回链接时给出提示而不是复制空串', async () => {
  const state = makeState();
  state.quickLoginUrl = null;
  const {context, page, errors} = await openPage({state});
  await goto(page, 'profile');
  await page.getByRole('button', {name: '生成并复制'}).click();
  await assert.doesNotReject(page.getByText('生成失败，请稍后再试').waitFor());
  assert.deepEqual(errors, []);
  await context.close();
});

// ——— 分离部署 ———————————————————————————————————————————

await test('分离部署：产物含纯静态 index.html 与 config.js', async () => {
  const html = await readFileAsync('theme/HeroRui-standalone/index.html', 'utf8');
  assert.match(html, /<script src="\.\/config\.js"><\/script>/, '要改成引用外部 config.js');
  assert.ok(!/\{\{|\{!!|@php|@json/.test(html), '静态版不能残留任何 Blade 语法：' + html.slice(0, 200));
  assert.match(html, /\.\/assets\//, '资源要用相对路径，否则换域名就 404');
  const blade = await readFileAsync('theme/HeroRui/dashboard.blade.php', 'utf8');
  assert.match(blade, /@json\(\$heroruiTheme\)/);
});

await test('面板包不含 index.html / config.js（否则 /theme/HeroRui/index.html 能绕开后台配置）', async () => {
  const panel = JSON.parse(await readFileAsync('dist/HeroRui.manifest.json', 'utf8'));
  for (const f of ['index.html', 'config.js'])
    assert.ok(!(f in panel.files), '面板包里不该有 ' + f + '：面板把整个包解压到公开的 public/theme/HeroRui/');
  assert.ok('dashboard.blade.php' in panel.files);
  const standalone = JSON.parse(await readFileAsync('dist/HeroRui-standalone.manifest.json', 'utf8'));
  for (const f of ['index.html', 'config.js'])
    assert.ok(f in standalone.files, '分离部署包缺 ' + f);
  assert.ok(!('dashboard.blade.php' in standalone.files));
  assert.ok(Object.keys(standalone.files).some(f => f.startsWith('assets/')), '分离部署包缺 assets');
});

await test('分离部署：config.js 覆盖全部配置字段（不会漏项静默失效）', async () => {
  const cfg = await readFileAsync('theme/HeroRui-standalone/config.js', 'utf8');
  for (const f of FIELDS) {
    assert.match(cfg, new RegExp(`^\\s*${f.name}:`, 'm'), `config.js 缺字段 ${f.name}`);
  }
  // custom_html 在同域走 Blade 直出、不进 themeConfig，但分离部署必须带上
  assert.match(cfg, /^\s*custom_html:/m);
  assert.match(cfg, /^\s*server_url:/m);
  // 站点信息在分离部署下没有 Blade 来源，也得由 config.js 提供
  for (const k of ['title', 'description', 'logo', 'version']) {
    assert.match(cfg, new RegExp(`^\\s*${k}:`, 'm'), `config.js 缺站点信息 ${k}`);
  }
});

await test('分离部署：跨域打到面板地址，页面正常渲染', async () => {
  const panel = 'https://panel.example.invalid';
  const {context, page, requests, errors} = await openStandalone({
    theme: {server_url: panel},
    settings: {title: '分离部署站'},
    mock: {pattern: panel + '/**', strip: '/api/v1'}
  });
  await page.goto(staticBase + '/#/dashboard');
  await page.locator('h1').waitFor();
  await settle(requests, '/user/info');
  // 用量渲染出来说明整条链路通了
  await assert.doesNotReject(page.getByText('28.50', {exact: true}).waitFor());
  const urls = await page.evaluate(() => performance.getEntriesByType('resource').map(e => e.name));
  assert.ok(urls.some(u => u.startsWith(panel + '/api/v1/')), '接口应打到面板域名');
  assert.ok(!urls.some(u => u.startsWith(staticBase + '/api/')), '不该打到前端自己的域名');
  assert.equal(await page.title(), '分离部署站', '站点名称应来自 config.js');
  assert.deepEqual(errors, []);
  await context.close();
});

await test('分离部署：面板地址填错时明确报错，不静默回退同域', async () => {
  const {context, page} = await openStandalone({theme: {server_url: 'panel.example.invalid'}});
  await page.goto(staticBase + '/#/dashboard');
  // 回退同域只会得到一堆打在前端域名上的 404，比直接报错难排查
  await page.getByText('不是合法地址').waitFor({timeout: 15000});
  const urls = await page.evaluate(() => performance.getEntriesByType('resource').map(e => e.name));
  assert.ok(!urls.some(u => u.includes('/api/v1/')), '地址非法时不该回退去打同域接口');
  await context.close();
});

await test('分离部署：custom_html 由运行时注入且 script 会执行', async () => {
  const panel = 'https://panel.example.invalid';
  const {context, page, errors} = await openStandalone({
    // 分离部署没有 Blade 的 {!! !!}，这个字段改由前端注入
    theme: {server_url: panel, custom_html: '<div id="footer-mark"></div><script>window.__footerRan=1<\/script>'},
    mock: {pattern: panel + '/**', strip: '/api/v1'}
  });
  await page.goto(staticBase + '/#/dashboard');
  await page.waitForFunction(() => window.__footerRan === 1, null, {timeout: 15000});
  assert.equal(await page.locator('#footer-mark').count(), 1);
  assert.deepEqual(errors, []);
  await context.close();
});

await test('分离部署：同域部署下不重复注入 custom_html', async () => {
  // 同域时 Blade 直出这段 HTML，themeConfig 里不带 custom_html，
  // 所以前端读不到、不会再注入一份
  const {context, page, errors} = await openPage();
  await goto(page, 'dashboard');
  await page.waitForTimeout(400);
  assert.equal(await page.evaluate(() => !!window.__heroruiCustomHtml), false,
    'themeConfig 里没有 custom_html 就不该触发注入');
  assert.deepEqual(errors, []);
  await context.close();
});

// ——— 审计发现的修复 ————————————————————————————————————

await test('注入：嵌在容器里的 script 也会执行', async () => {
  const {context, page, errors} = await openPage({
    theme: {
      customer_service_type: 'other',
      // 客服挂件的嵌入代码常常包了一层 div，只重建顶层 script 会静默漏掉
      customer_service_html: '<div class="wrap"><span>hi</span><script>window.__nestedRan=1<\/script></div>'
    }
  });
  await goto(page, 'dashboard');
  await page.waitForFunction(() => window.__nestedRan === 1, null, {timeout: 15000});
  assert.equal(await page.locator('.wrap span').count(), 1, '容器与其它节点也要搬进页面');
  assert.deepEqual(errors, []);
  await context.close();
});

await test('注入：不会重建应用自己的脚本（React 只挂载一次）', async () => {
  const {context, page, errors} = await openPage({
    theme: {customer_service_type: 'other', customer_service_html: '<script>window.__csRan=1<\/script>'}
  });
  await goto(page, 'dashboard');
  await page.waitForFunction(() => window.__csRan === 1, null, {timeout: 15000});
  // 之前查的是 document.body 全量 script，会把 bootstrap 和 type=module 入口
  // 一起重建 —— 表现就是 React 挂两遍、页面元素翻倍
  assert.equal(await page.locator('.metrics-strip').count(), 1, '页面不该被挂载两次');
  assert.equal(await page.locator('#root').count(), 1);
  assert.equal(await page.locator('h1').count(), 1);
  assert.deepEqual(errors, []);
  await context.close();
});

await test('注入：无 async 的外链脚本保持顺序执行', async () => {
  const {context, page, errors} = await openPage({
    theme: {
      customer_service_type: 'other',
      customer_service_html: '<script src="https://cs.example.invalid/a.js"></script><script src="https://cs.example.invalid/b.js"></script>'
    }
  });
  // b.js 故意延迟响应：若被当成 async，b 会先于 a 执行
  await page.route('https://cs.example.invalid/a.js', async route => {
    await new Promise(r => setTimeout(r, 400));
    route.fulfill({contentType: 'application/javascript', body: 'window.__order=(window.__order||[]).concat("a")'});
  });
  await page.route('https://cs.example.invalid/b.js', route =>
    route.fulfill({contentType: 'application/javascript', body: 'window.__order=(window.__order||[]).concat("b")'}));
  await goto(page, 'dashboard');
  await page.waitForFunction(() => window.__order?.length === 2, null, {timeout: 15000});
  assert.deepEqual(await page.evaluate(() => window.__order), ['a', 'b'],
    '源码没写 async 就该按文档顺序执行');
  assert.deepEqual(errors, []);
  await context.close();
});

await test('加密中间件：地址漏了协议时报错，不打成相对地址', async () => {
  // 填 enc.example.com（没有 https://）拼出来是相对地址，fetch 会打给前端自己
  const {context, page} = await openPage({
    theme: {middleware_url: 'enc.example.invalid', middleware_key: 'k'}
  });
  const logs = [];
  page.on('console', m => m.type() === 'error' && logs.push(m.text()));
  await page.goto(base + '/#/dashboard');
  await page.reload();
  await page.getByText('缺少 http(s) 协议').waitFor({timeout: 15000});
  const urls = await page.evaluate(() => performance.getEntriesByType('resource').map(e => e.name));
  assert.ok(!urls.some(u => u.includes('enc.example.invalid')), '不该真的去打这个相对地址');
  assert.ok(logs.some(l => l.includes('http:// 或 https://')), '控制台要说清怎么改');
  await context.close();
});

await test('签到：v2board 真实故障要报错并保留入口', async () => {
  const state = makeState();
  state.checkin.mode = 'v2board';
  const {context, page, requests, errors} = await openPage({state});
  await goto(page, 'dashboard');
  await tile(page).waitFor();
  // v2board 把「功能没开」和真实故障都走 abort(500)，只能看文案区分
  state.fail['/user/checkin'] = {status: 500, message: '用户不存在'};
  await tile(page).click();
  await assert.doesNotReject(page.getByText('用户不存在').waitFor());
  // 第一次失败可能只是数据库抖了一下，入口要保留让用户能重试
  assert.equal(await tile(page).count(), 1, '首次故障不该让入口凭空消失');
  delete state.fail['/user/checkin'];
  assert.deepEqual(errors, []);
  await context.close();
});

await test('签到：v2board 功能未开启时提示并收起入口', async () => {
  const state = makeState();
  state.checkin.mode = 'v2board';
  const {context, page, errors} = await openPage({state});
  await goto(page, 'dashboard');
  await tile(page).waitFor();
  state.fail['/user/checkin'] = {status: 500, message: '签到功能未开启'};
  // 持续性失败：第一次报错保留入口，第二次才收起 —— 不留一个按下去永远报错的按钮
  await tile(page).click();
  await assert.doesNotReject(page.getByText('签到功能未开启').waitFor());
  assert.equal(await tile(page).count(), 1);
  await tile(page).click();
  await page.waitForFunction(() => !document.querySelector('.checkin-tile'), null, {timeout: 10000});
  delete state.fail['/user/checkin'];
  assert.deepEqual(errors, []);
  await context.close();
});

for (const bad of ['https://evil.example.invalid/api', '//evil.example.invalid/api']) {
  await test(`接口前缀：填成完整地址（${bad.slice(0, 12)}…）时报错而不是静默改域名`, async () => {
    // new URL 会让绝对/协议相对地址直接覆盖接口根，把带 Authorization 的请求
    // 送到那个域名去。字段叫「接口路径前缀」，很容易被误填成面板地址。
    const {context, page} = await openPage({theme: {api_path: bad}});
    await page.goto(base + '/#/dashboard');
    await page.reload();
    await page.getByText('只能填路径').waitFor({timeout: 15000});
    const urls = await page.evaluate(() => performance.getEntriesByType('resource').map(e => e.name));
    assert.ok(!urls.some(u => u.includes('evil.example.invalid')), '不该真的把请求发到那个域名');
    await context.close();
  });
}

await test('邮箱链接登录：v2board 的 500 限流保留后端原文', async () => {
  const state = makeState();
  // v2board 的限流是 abort(500, 'Sending frequently…')，不是 429
  state.mailLink.status = 500;
  state.mailLink.message = 'Sending frequently, please try again later';
  const {context, page, errors} = await openPage({state, authed: false});
  await page.goto(base + '/#/login');
  await page.reload();
  await page.getByRole('textbox', {name: '邮箱'}).fill('someone@example.com');
  await mailButton(page).click();
  await assert.doesNotReject(page.getByText('Sending frequently, please try again later').waitFor());
  assert.deepEqual(errors, []);
  await context.close();
});

} finally {
  staticServer.close();
  await writeFile(out + '/features-results.json', JSON.stringify(results, null, 2));
  await browser.close();
  await server.close();
  const passed = results.filter(r => r.status === 'PASS').length;
  console.log(`${passed}/${results.length} checks passed`);
}
