/**
 * 给构建产物补上「分离部署」所需的文件，让同一个包两种部署方式通用。
 *
 * 背景：主题原本只能同域部署 —— 产物放进面板 theme 目录，由面板渲染
 * dashboard.blade.php，`window.settings` / `window.themeConfig` 由 Blade 填值。
 * 前端单独托管到别的域名时没人渲染 Blade，那两个对象根本不存在，
 * 而且前端域名下也没有 /api/v1，整站打不开。
 *
 * 做法是在**保留** config.json + dashboard.blade.php 的前提下，额外生成：
 *   index.html   纯静态版，把内联的 bootstrap 换成 <script src="./config.js">
 *   config.js    原本由 Blade 注入的那两个对象，改完刷新即可，不用重新构建
 *
 * 于是同一个包：
 *   面板上传   → 面板走 dashboard.blade.php，index.html / config.js 闲置
 *   静态托管   → 服务器默认走 index.html，Blade 文件闲置
 *
 * config.js 的字段直接遍历 theme-fields.mjs 生成，不另维护一份清单 ——
 * 否则加了字段忘了补，分离部署下就是静默失效。
 */
import {readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {FIELDS} from './theme-fields.mjs';

/** Blade 注入的 window.settings 在分离部署下没有来源，只能由站长填 */
const SITE_FIELDS = [
  ['title', 'HeroRui', '站点名称'],
  ['description', '', '站点描述，留空用主题内置文案'],
  ['logo', '', 'Logo 图片地址，留空显示文字标识'],
  ['version', '', '版本号，留空不显示']
];

const quote = v => JSON.stringify(v ?? '');

function buildConfigJs() {
  const site = SITE_FIELDS.map(([k, def, note]) => `  // ${note}\n  ${k}: ${quote(def)}`).join(',\n');
  // custom_html 在同域部署下由 Blade 的 {!! !!} 直出，不进 themeConfig；
  // 分离部署没有 Blade，所以这里必须带上，由前端在运行时注入。
  const theme = FIELDS.map(f => {
    const note = f.placeholder ? `${f.label} —— ${f.placeholder}` : f.label;
    const options = f.options ? `\n  // 可选值：${Object.keys(f.options).map(k => k || '(留空)').join(' / ')}` : '';
    return `  // ${note}${options}\n  ${f.name}: ${quote(f.default)}`;
  }).join(',\n');

  return `/**
 * 分离部署配置。改完直接刷新页面生效，不需要重新构建。
 *
 * 最少只需要填 server_url（面板地址）。
 * 同域部署（把整个包上传到面板主题管理）用不到本文件，配置在后台填。
 *
 * 升级提示：新版本的包里会带一份全新的 config.js，
 * 覆盖前请先备份本文件，或者只替换 index.html 和 assets/。
 */
window.routerBase = '/';

window.settings = {
${site}
};

window.themeConfig = {
${theme}
};
`;
}

/**
 * 把 Vite 产出的 index.html 改成分离部署版。
 *
 * Vite 的 index.html 里那段内联脚本是给 dev / preview 用的占位值，
 * 整段换成外部 config.js —— 它是 classic script，会在 type="module" 的
 * 入口（defer 语义）之前执行，所以配置一定先就位。
 */
function toStandaloneHtml(html) {
  const bootstrap = /<script>\s*window\.routerBase[\s\S]*?<\/script>/;
  if (!bootstrap.test(html)) throw Error('index.html 里找不到内联的 bootstrap 脚本，产物结构变了？');
  return html.replace(bootstrap, '<script src="./config.js"></script>');
}

export async function writeStandalone(project, output) {
  const html = await readFile(path.join(project, 'build/index.html'), 'utf8');
  await writeFile(path.join(output, 'index.html'), toStandaloneHtml(html));
  await writeFile(path.join(output, 'config.js'), buildConfigJs());
  return ['index.html', 'config.js'];
}
