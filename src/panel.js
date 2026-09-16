/**
 * 面板适配层 —— 抹平 Xboard 与 V2board 的字段差异。
 *
 * 这里不做「面板类型」分支，只做字段兜底：两种面板同一个意思用了不同字段名，
 * 取值时把两个名字都认下来即可。好处是对改版分支同样成立 —— 有的 v2board 分支
 * 补齐了 Xboard 才有的接口，按面板硬分支会把本来能用的功能关掉。
 *
 * 已知差异（对本地 Xboard / V2board 源码逐字段核对，2026-09）：
 *
 *   /guest/comm/config
 *     is_captcha              Xboard 有；v2board 只有 is_recaptcha
 *     captcha_type            Xboard 有；v2board 无（只支持 recaptcha v2）
 *     recaptcha_site_key      两边同名
 *
 *   /user/server/fetch
 *     is_online               Xboard 有；v2board 只给 last_check_at 时间戳
 *
 *   /user/plan/fetch
 *     sell / show / renew     Xboard 经 PlanResource 转成 bool；v2board 是 0/1
 *     capacity_limit          Xboard 满员时返回本地化字符串 'Sold out'；v2board 是剩余数字
 *
 *   /user/comm/config、/user/getStat、/user/knowledge/fetch 等其余接口两边一致。
 */

/** 站长在后台主题配置里填的值，由 blade 注入（见 scripts/package.mjs） */
export const themeConfig = (typeof window !== 'undefined' && window.themeConfig) || {};

/**
 * 站长填的地址统一去掉首尾空白和尾部斜杠（可能粘进来多个）。
 * 放在这里而不是 core：middleware.js 需要它，而 core 又 import middleware，
 * 从 core 取会形成循环依赖。panel.js 不 import 任何本地模块，是安全的落点。
 */
export const trimTrailingSlash = v => String(v || '').trim().replace(/\/+$/, '');

export const conf = (name, fallback = '') => {
  const v = themeConfig[name];
  return v === undefined || v === null || v === '' ? fallback : v;
};

/**
 * 站长填的面板类型。
 *
 * 默认 auto：字段差异靠下面的兜底归一化，能力差异靠探测，绝大多数站点不用改。
 * 填了具体面板则作为**显式覆盖** —— 跳过探测、直接按该面板的契约走。
 *
 * 它不用来隐藏功能：按面板硬关会在改版分支上判错（有的 v2board 分支补了
 * Xboard 才有的邮箱链接登录），能力有无一律以探测和错误码为准。
 */
export const panelType = () => {
  const v = String(conf('panel_type', 'auto')).trim().toLowerCase();
  return v === 'xboard' || v === 'v2board' ? v : 'auto';
};

let warnedMismatch = false;

/**
 * 归一化 /guest/comm/config。
 *
 * 注意 is_captcha 用 `??` 而不是 `||`：后端返回的是 0/1，0 是「关闭」这个有效答案，
 * 用 `||` 会在 Xboard 明确回 0 时错误地去读 v2board 的字段。
 */
export function guestConfig(raw) {
  if (!raw) return raw;
  // 兜底归一化是隐形的：字段名变了也只会安静地走 fallback。所以当站长明确
  // 指定了面板、而响应的形状指向另一种时，在控制台说一声 —— 通常意味着
  // 面板类型填错了，或者面板改过接口。
  const looksXboard = 'is_captcha' in raw;
  const declared = panelType();
  if (!warnedMismatch && declared !== 'auto' && looksXboard !== (declared === 'xboard')) {
    warnedMismatch = true;
    console.warn(`[面板] 主题配置里选的是 ${declared}，但 /guest/comm/config 的字段形状更像 ${looksXboard ? 'Xboard' : 'V2board'}。\n字段差异已自动兜底，功能不受影响；如果签到等功能表现异常，请检查「面板类型」是否填对。`);
  }
  const captcha = raw.is_captcha ?? raw.is_recaptcha ?? 0;
  return {
    ...raw,
    // 转成真正的布尔，避免 {0 && <X/>} 把 0 当文本渲染出来
    is_captcha: !!Number(captcha),
    captcha_type: raw.captcha_type || 'recaptcha'
  };
}

/**
 * 节点在线状态。v2board 不给 is_online，只给最后心跳时间。
 * 300 秒的判定窗口与 Xboard ServerService 认定节点在线的口径一致。
 */
export function nodeOnline(node) {
  if (node?.is_online !== undefined && node?.is_online !== null) return !!Number(node.is_online);
  const last = Number(node?.last_check_at) || 0;
  return last > 0 && Date.now() / 1000 - last < 300;
}

/**
 * 时间戳归一化成 Unix 秒。
 *
 * 两个面板给的形状不同：V2board 的会话缓存是 `time()` 的整数秒；
 * Xboard 走 Sanctum 的 PersonalAccessToken，日期是 Carbon 强转、序列化成
 * ISO-8601（"2026-09-15T03:12:45.000000Z"）—— 直接 Number() 得到 NaN，
 * 于是所有行的时间都显示成「—」、排序也变成空操作。
 */
function toUnixSeconds(value) {
  if (value == null || value === '') return 0;
  const n = Number(value);
  if (Number.isFinite(n)) return n > 1e11 ? Math.floor(n / 1000) : n; // 容忍毫秒
  const parsed = Date.parse(String(value));
  return Number.isNaN(parsed) ? 0 : Math.floor(parsed / 1000);
}

/**
 * 归一化登录设备列表。两个面板的结构完全不同：
 *
 *   Xboard    /user/getActiveSession 返回 Sanctum token 行的**数组**
 *             [{id, name, last_used_at, created_at, expires_at, ...}]，没有 IP / UA
 *   V2board   返回缓存里的**对象**，以会话 id 为键
 *             {"<guid>": {ip, login_at, ua, auth_data}}
 *
 * 注意 v2board 会把每个会话的 auth_data（真实 token）一起返回。那是同一个用户
 * 自己的 token，不构成越权，但绝不能渲染到页面上 —— 这里只用它在本地比对出
 * 「当前这台设备」，输出里不带这个字段。
 *
 * @param raw 接口原始返回
 * @param currentToken 本地保存的 token，用于标出当前设备（比对不上就都不标）
 */
export function normalizeSessions(raw, currentToken) {
  const rows = Array.isArray(raw)
    ? raw.map(r => ({id: r?.id, ...r}))
    : raw && typeof raw === 'object'
      ? Object.entries(raw).map(([id, v]) => ({id, ...(v && typeof v === 'object' ? v : {})}))
      : [];
  return rows
    .filter(r => r.id != null && r.id !== '')
    .map(r => ({
      id: String(r.id),
      // v2board 给 ip/ua。Xboard 走 Sanctum，其 name 是 createToken(Str::random(20))
      // 产生的随机串、不是设备名 —— 拿它当标签只会显示一串乱码，
      // 不如留空让界面显示「未知设备」。
      ip: typeof r.ip === 'string' ? r.ip : '',
      device: String(r.ua || '').trim(),
      loginAt: toUnixSeconds(r.login_at ?? r.created_at),
      lastUsedAt: toUnixSeconds(r.last_used_at),
      // 只比对，不外传
      current: !!(currentToken && r.auth_data && r.auth_data === currentToken)
    }))
    .sort((a, b) => (b.lastUsedAt || b.loginAt) - (a.lastUsedAt || a.loginAt));
}

/**
 * 套餐是否不可**新购**。续费请用 planUnavailable。
 *
 * 三种「买不了」要分开看：
 *   sell 为假        —— 站长关了售卖（Xboard 是 false，v2board 是 0）
 *   capacity_limit   —— 订阅人数满了（Xboard 满员时是字符串 'Sold out'，v2board 是剩余数量 <= 0）
 * sell 缺失时不当作售罄 —— 字段不存在只说明这个面板不返回它，不代表卖完了。
 */
export function planSoldOut(plan) {
  // Number(true)===1，所以 !Number(plan.sell) 已经覆盖了 sell===true 的情况
  if (plan?.sell != null && !Number(plan.sell)) return true;
  const cap = plan?.capacity_limit;
  if (cap === undefined || cap === null) return false;
  const text = String(cap).trim();
  if (text === '') return false;                       // 空值等于不限人数，不是售罄
  // Xboard 满员时返回本地化字符串（'Sold out' / '已售罄'），否则是剩余数量。
  // 判据是「有没有数字」而不是「能不能整体当数字解析」：带千分位的 '1,000'
  // 是剩余 1000，不该被当成售罄。与上面 sell 的取舍一致 —— 宁可放过让后端拦，
  // 也不要错杀一个还能卖的套餐。
  const digits = text.replace(/[^\d-]/g, '');
  if (digits === '' || digits === '-') return true;    // 纯文字 = 已售罄
  return Number(digits) <= 0;
}

/**
 * 套餐是否不可下单 —— 区分「新购」和「续费」。
 *
 * 两个面板的判定一致（Xboard PlanService::isPlanAvailableForUser、
 * V2board OrderController@save）：
 *   续费（user.plan_id === plan.id）→ 只看 renew，**不看 sell、不看容量**
 *   新购                            → 看 show / sell / 容量
 *
 * 「停售但让老用户续费」（sell=0, renew=1）是很常见的配置。拿售罄去拦续费
 * 等于把后端本来会接受的订单挡在前端 —— 用户点仪表盘的「续费」只会看到
 * 一个禁用的「已售罄」按钮，而重置流量包（reset_price）后端更是明确豁免容量检查。
 */
export function planUnavailable(plan, user) {
  const renewing = plan?.id != null && user?.plan_id != null && Number(user.plan_id) === Number(plan.id);
  // renew 缺失时不当作禁止续费 —— 与 sell 的取舍一致：不存在 ≠ 关闭
  if (renewing) return plan.renew != null && !Number(plan.renew) && plan.renew !== true;
  return planSoldOut(plan);
}
