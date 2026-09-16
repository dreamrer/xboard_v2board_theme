/**
 * 路径加密中间件 —— 前端侧实现（协议 v3）。
 *
 * 把请求路径加密成一串看似静态资源的乱码，真实接口地址不出现在网络里。
 * 与 Go 版路径加密中间件逐字节对齐，已有的中间件实例和密钥可以直接复用：
 *
 *   明文    = "<时间戳>|<路径>"
 *   inner   = 版本(1=0x03) ‖ 明文长度(2, 大端) ‖ 明文 ‖ 随机填充(补到 32 的倍数)
 *   nonce   = 24 字节随机数
 *   密钥    = SHA-256(配置里的 key)                  → 恒定 32 字节
 *   密文    = XChaCha20-Poly1305(inner, 密钥, nonce)   末尾自带 16 字节 tag
 *   token   = base64url-nopad(nonce ‖ 密文 ‖ tag)
 *   最终 URL = <中间件域名><入口前缀>/<token><伪装扩展名>
 *
 * 只加密普通 API 请求。订阅地址由后端生成、客户端直连，不经过中间件。
 *
 * 浏览器 Web Crypto 没有 XChaCha20，这里用经过审计的 @noble/ciphers，
 * SHA-256 用其配套的 @noble/hashes，保持全同步、无需 await。
 */
import {xchacha20poly1305} from '@noble/ciphers/chacha.js';
import {sha256} from '@noble/hashes/sha2.js';
import {conf, trimTrailingSlash} from './panel';

const FORMAT_VERSION = 0x03, PAD_BLOCK = 32, NONCE_SIZE = 24;

/**
 * 中间件认得的伪装扩展名。
 *
 * 中间件只会剥掉这几种后缀再去解密，其余一律落不到解密逻辑上、直接回伪装 404。
 * 配错一个字符（填 .php / .txt、大写 .JS、漏了点的 js）就是**全站接口全挂**，
 * 而伪装 404 本身没有任何线索 —— 所以宁可在前端就拦住并把原因打到控制台。
 *
 * 名单来自对中间件逐个探测的实测结果，且**区分大小写**。
 */
const ALLOWED_EXT = ['', '.js', '.css', '.json', '.map', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico', '.woff', '.woff2'];

/**
 * 归一化伪装扩展名。
 *
 * 留空 = 没配置 → 用默认的 .js。不把空串当成「不要扩展名」，是因为不带后缀的
 * 路径反而更不像静态资源，与伪装的初衷相悖。确实想要无后缀的，显式填 none。
 */
function normalizeExt(raw) {
  if (raw === undefined || raw === null || raw === '') return '.js';
  const v = String(raw).trim();
  return v.toLowerCase() === 'none' ? '' : v;
}

/**
 * 读取并归一化配置。
 *
 * 地址和入口前缀都要 trim 并补上前导斜杠：站长从中间件 .env 里复制 PATH_PREFIX
 * 时很容易漏掉开头的 `/`，而这两段是直接字符串相接的 ——
 * `https://enc.example.com` + `assets/immutable` 会拼成
 * `https://enc.example.comassets/immutable/...`，主机名被悄悄改掉，
 * 请求死在 DNS 上、连状态码都没有，四种成因的 404 提示也不会触发。
 * 粘进来的尾部空格同样会让 fetch 直接抛 Invalid URL。
 */
function cfg() {
  const rawPath = String(conf('middleware_path', '/assets/immutable')).trim();
  return {
    url: trimTrailingSlash(conf('middleware_url')),
    key: String(conf('middleware_key') || '').trim(),
    path: rawPath === '' ? '' : trimTrailingSlash(rawPath.startsWith('/') ? rawPath : '/' + rawPath),
    ext: normalizeExt(conf('middleware_ext'))
  };
}

// 三个 fail-closed 检查共用一套「同类只提示一次」的记录，省掉三个各自的布尔
const warned = new Set();
function fatal(tag, hint, message) {
  if (!warned.has(tag)) { warned.add(tag); console.error(hint); }
  throw Error(message);
}

/**
 * 地址必须带 http(s) 协议。
 *
 * 少写协议（填 enc.example.com）时，拼出来的是相对地址，fetch 会拿它去
 * 解析当前站点的相对路径 —— 每个请求都变成打给前端自己的 404，而且看不出
 * 是配置问题。与 middleware_ext / server_url 一样当场报错。
 */
function assertUrl(m) {
  if (/^https?:\/\//i.test(m.url)) return;
  fatal('url',
    `[中间件] 地址必须以 http:// 或 https:// 开头，当前填的是 ${JSON.stringify(m.url)}。\n少了协议会让请求变成相对地址、打给前端自己，每个接口都 404。`,
    '[中间件] 地址缺少 http(s) 协议：' + m.url);
}

/**
 * 配置只填了一半时 fail-closed。
 *
 * 直接放行会让请求静默直连面板，真实接口路径全裸暴露 —— 而这恰恰是中间件唯一
 * 要藏的东西，站长以为开了、实际一直没开。宁可站点用不了，也不能在站长以为
 * 受保护的情况下裸奔。
 */
function assertUsable(m) {
  if (!(m.url || m.key) || (m.url && m.key)) return;
  fatal('incomplete',
    '[中间件] 地址和密钥必须同时填写，当前只填了一个。\n为避免真实接口路径明文暴露，请求已被中止（而不是绕过中间件直连面板）。\n要停用中间件请把两项都留空。',
    '[中间件] 配置不完整（地址 / 密钥只填了一个），请求已中止');
}

/** 后缀不在名单里同样 fail-closed：否则每个请求都 404，且 404 没有任何线索 */
function assertExt(m) {
  if (ALLOWED_EXT.includes(m.ext)) return;
  fatal('ext',
    `[中间件] 伪装扩展名配成了 ${JSON.stringify(m.ext)}，不在中间件认得的名单里。\n只认这些（区分大小写）：${ALLOWED_EXT.filter(Boolean).join(' ')}\n填其它值会让每个请求都返回伪装 404。要不带后缀请填 none，留空则用默认的 .js。`,
    `[中间件] 伪装扩展名无效：${m.ext}`);
}

// 密钥派生随 key 缓存，避免每个请求都算一遍 SHA-256
let cachedKey = null, cachedKeyStr = null;
function deriveKey(key) {
  if (key !== cachedKeyStr) {
    cachedKeyStr = key;
    cachedKey = sha256(new TextEncoder().encode(key || ''));
  }
  return cachedKey;
}

/** 字节数组 → base64url（无填充）。URL 路径里不能出现 + / = */
function toBase64Url(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** 组装并填充 inner，长度归一化到 32 字节的倍数（隐藏真实路径长度） */
function pack(ts, path) {
  const body = new TextEncoder().encode(String(ts) + '|' + path);
  // 长度字段只有 2 字节。超了会被 &0xff 截断成一个错误的长度，中间件那边
  // 解出来是畸形路径 —— 与其发出去再收一个没头没尾的 404，不如在这里说清楚。
  if (body.length > 0xffff) throw Error('[中间件] 请求路径过长，无法加密：' + body.length + ' 字节');
  const innerLen = 3 + body.length, total = Math.ceil(innerLen / PAD_BLOCK) * PAD_BLOCK;
  const inner = new Uint8Array(total);
  inner[0] = FORMAT_VERSION;
  inner[1] = (body.length >> 8) & 0xff; // 大端高位
  inner[2] = body.length & 0xff;
  inner.set(body, 3);
  if (total > innerLen) crypto.getRandomValues(inner.subarray(innerLen));
  return inner;
}

/** 加密一个裸路径（如 /user/info?x=1），内嵌当前时间戳 */
function encryptPath(path, key) {
  const nonce = new Uint8Array(NONCE_SIZE);
  crypto.getRandomValues(nonce);
  const sealed = xchacha20poly1305(deriveKey(key), nonce).encrypt(pack(Math.floor(Date.now() / 1000), path));
  const out = new Uint8Array(NONCE_SIZE + sealed.length);
  out.set(nonce, 0);
  out.set(sealed, NONCE_SIZE);
  return toBase64Url(out);
}

/**
 * 把一个完整接口地址改写成打给中间件的加密地址。
 *
 * @param fullUrl 形如 https://panel.com/api/v1/user/info
 * @param apiBase 形如 https://panel.com/api/v1
 * @returns 加密地址；未启用或前缀不匹配时返回 null，调用方走原地址
 */
export function rewriteToMiddleware(fullUrl, apiBase) {
  // 整个流程只读一次配置：校验过的 url / path / ext 必须就是最终拼出去的那一份
  const m = cfg();
  // 配置填一半时在这里抛错，不让请求悄悄绕过中间件直连面板
  assertUsable(m);
  if (!(m.url && m.key) || !fullUrl || !apiBase) return null;
  if (!String(fullUrl).startsWith(apiBase)) return null;

  // 到这里才确定这条请求真要走中间件；地址与后缀校验放在这之后，
  // 免得把「本来就不经过中间件」的请求也一起卡掉
  assertUrl(m);
  assertExt(m);

  try {
    let bare = String(fullUrl).slice(apiBase.length);
    if (!bare.startsWith('/')) bare = '/' + bare;
    return m.url + m.path + '/' + encryptPath(bare, m.key) + m.ext;
  } catch (e) {
    // 加密失败多为非 HTTPS 环境（crypto.getRandomValues 需安全上下文）或浏览器过旧。
    // 抛出让请求失败，而不是返回 null 直连面板 —— 静默直连会泄露真实路径。
    console.error('[中间件] 路径加密失败，请求已中止。常见原因：非 HTTPS 环境或浏览器过旧。', e);
    throw e;
  }
}
