/**
 * 主题配置字段 —— 唯一真源。
 *
 * 同一个字段本来要在三处对齐：config.json 的后台表单、blade 注入给前端的
 * window.themeConfig、以及前端读取处。漏一处不报错，只是静默不生效。
 * 这里把前两处收敛成由本文件生成：
 *   scripts/gen-config.mjs   依此重写 config.json 的 configs
 *   scripts/package.mjs      依此生成 blade 的 themeConfig 注入块，并校验 config.json 未漂移
 * 加字段只改这里，漏改 config.json 由 build 期校验拦下。
 *
 * 注意 expose:false 的字段不进 window.themeConfig —— custom_html 由 blade 的
 * {!! !!} 直出，再塞一份进 JSON 只是徒增体积。
 */
export const FIELDS = [
  /**
   * 面板类型放首位：它决定后续接口行为，配置时应该先定这个。
   *
   * 默认「自动」—— 字段差异由 src/panel.js 兜底归一化，能力差异靠探测，
   * 绝大多数站点不用改这一项。填了具体面板则作为**显式覆盖**：跳过探测、
   * 直接按该面板的契约走，并在检测结果与所填不符时在控制台提示。
   *
   * 注意：这一项不用来隐藏功能。按面板硬关会在改版分支上判错 —— 有的 v2board
   * 分支补了 Xboard 才有的邮箱链接登录，按面板关掉就把本来能用的功能关了。
   * 能力有无一律以「探测 + 错误码」为准。
   */
  {
    name: 'panel_type',
    label: '面板类型',
    placeholder: '一般不用改',
    type: 'select',
    options: {auto: '自动识别', xboard: 'Xboard', v2board: 'V2board'},
    default: 'auto'
  },
  /**
   * 面板地址。同域部署（面板上传主题包）留空即可 —— 用当前站点。
   * 分离部署（前端单独托管到别的域名）必填，因为那时前端域名下没有 /api/v1。
   *
   * 两个面板的 config/cors.php 都是 api/* + allowed_origins ['*'] +
   * allowed_headers ['*']，且 HandleCors 在全局中间件里，所以跨域不用改后端。
   */
  {
    name: 'server_url',
    label: '面板地址',
    placeholder: '同域部署留空；分离部署填面板地址',
    type: 'input',
    default: ''
  },
  {
    name: 'api_path',
    label: '接口路径前缀',
    placeholder: '默认 /api/v1，反代填如 /proxy/api',
    type: 'input',
    default: ''
  },
  {
    name: 'middleware_url',
    label: '加密中间件-地址',
    placeholder: '如 https://enc.example.com',
    type: 'input',
    default: ''
  },
  {
    name: 'middleware_key',
    label: '加密中间件-密钥',
    placeholder: '与中间件 AES_KEY 一致',
    type: 'input',
    default: ''
  },
  {
    name: 'middleware_path',
    label: '加密中间件-入口前缀',
    placeholder: '默认 /assets/immutable',
    type: 'input',
    default: ''
  },
  {
    name: 'middleware_ext',
    label: '加密中间件-伪装扩展名',
    placeholder: '默认 .js，不带后缀填 none',
    type: 'input',
    default: ''
  },
  {
    name: 'invite_domain',
    label: '邀请链接域名',
    placeholder: '留空用当前域名',
    type: 'input',
    default: ''
  },
  {
    name: 'checkin_mode',
    label: '每日签到',
    placeholder: '',
    type: 'select',
    options: {auto: '开启（面板支持时显示）', off: '关闭'},
    default: 'auto'
  },
  {
    name: 'mail_link_login',
    label: '邮箱链接登录',
    placeholder: '',
    type: 'select',
    options: {show: '显示', hide: '隐藏'},
    default: 'show'
  },
  // 客户端下载页。七个平台地址全留空则不显示这个页面和导航入口 ——
  // 没填地址的站点不该多出一个空页面。
  {
    name: 'client_windows',
    label: '客户端-Windows',
    placeholder: '下载地址，留空不显示',
    type: 'input',
    default: ''
  },
  {
    name: 'client_macos',
    label: '客户端-macOS',
    placeholder: '下载地址，留空不显示',
    type: 'input',
    default: ''
  },
  {
    name: 'client_android',
    label: '客户端-Android',
    placeholder: '下载地址，留空不显示',
    type: 'input',
    default: ''
  },
  {
    name: 'client_ios',
    label: '客户端-iOS',
    placeholder: '下载地址，留空不显示',
    type: 'input',
    default: ''
  },
  {
    name: 'client_linux',
    label: '客户端-Linux',
    placeholder: '下载地址，留空不显示',
    type: 'input',
    default: ''
  },
  {
    name: 'client_openwrt',
    label: '客户端-OpenWrt',
    placeholder: '下载地址，留空不显示',
    type: 'input',
    default: ''
  },
  {
    name: 'client_tv',
    label: '客户端-TV',
    placeholder: '下载地址，留空不显示',
    type: 'input',
    default: ''
  },
  {
    name: 'client_note',
    label: '客户端下载页说明',
    placeholder: '下载页顶部说明，可留空',
    type: 'textarea',
    default: ''
  },
  /**
   * Telegram 频道。填了会在总览和客户端下载页显示关注入口，**清空则完全不出现**。
   *
   * 默认值是本主题作者的频道。站长不想推广它，在后台把这一项清空即可 ——
   * 主题不会在别处硬编码这个地址。
   */
  {
    name: 'telegram_channel',
    label: 'Telegram 频道',
    placeholder: '如 https://t.me/yourchannel；清空则不显示',
    type: 'input',
    default: 'https://t.me/jichangbiji'
  },
  {
    name: 'telegram_channel_note',
    label: 'Telegram 频道说明',
    placeholder: '一句话说明，可留空',
    type: 'input',
    default: ''
  },
  {
    name: 'help_url',
    label: '帮助中心外链',
    placeholder: '如 https://help.example.com',
    type: 'input',
    default: ''
  },
  {
    name: 'customer_service_type',
    label: '在线客服类型',
    placeholder: '',
    type: 'select',
    options: {'': '不启用', chatwoot: 'Chatwoot', crisp: 'Crisp', salesmartly: 'SalesMartly', other: '其它（自定义嵌入代码）'},
    default: ''
  },
  {
    name: 'chatwoot_url',
    label: 'Chatwoot 地址',
    placeholder: '如 https://chat.example.com',
    type: 'input',
    default: ''
  },
  {
    name: 'chatwoot_token',
    label: 'Chatwoot 网站令牌',
    placeholder: '收件箱 → 网站令牌',
    type: 'input',
    default: ''
  },
  {
    name: 'crisp_website_id',
    label: 'Crisp Website ID',
    placeholder: '设置 → 网站设置 → Website ID',
    type: 'input',
    default: ''
  },
  {
    name: 'salesmartly_url',
    label: 'SalesMartly 脚本地址',
    placeholder: '安装代码里那条完整 URL',
    type: 'input',
    default: ''
  },
  {
    name: 'customer_service_html',
    label: '自定义客服嵌入代码',
    placeholder: '粘贴客服 <script> 代码',
    type: 'textarea',
    default: ''
  },
  {
    name: 'custom_html',
    label: '自定义页脚 HTML',
    placeholder: '统计代码或客服脚本',
    type: 'textarea',
    default: '',
    expose: false
  }
];

/** config.json 的 configs 数组 */
export function toConfigs() {
  return FIELDS.map(f => {
    const item = {label: f.label, placeholder: f.placeholder, field_name: f.name, field_type: f.type};
    if (f.options) item.select_options = f.options;
    item.default_value = f.default;
    return item;
  });
}

/** 需要注入 window.themeConfig 的字段名 */
export function exposedNames() {
  return FIELDS.filter(f => f.expose !== false).map(f => f.name);
}
