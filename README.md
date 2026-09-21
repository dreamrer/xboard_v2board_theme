<div align="center">

# HeroRui

**朱红与纸白，让连接回归简单。**

基于 **React + Ant Design + HeroUI** 的独立用户主题，同时支持 **Xboard** 与 **V2board**。

[下载主题](https://github.com/dreamrer/xboard_v2board_theme/releases/latest/download/HeroRui.zip) · [版本发布](https://github.com/dreamrer/xboard_v2board_theme/releases) · [反馈问题](https://github.com/dreamrer/xboard_v2board_theme/issues) · [Telegram 频道](https://t.me/jichangbiji)

![React](https://img.shields.io/badge/React-19-20232a?logo=react)
![Ant Design](https://img.shields.io/badge/Ant_Design-6-ce303b)
![HeroUI](https://img.shields.io/badge/HeroUI-3-ce303b)
![License](https://img.shields.io/badge/License-MIT-blue)
[![Telegram](https://img.shields.io/badge/Telegram-%E9%A2%91%E9%81%93-26A5E4?logo=telegram&logoColor=white)](https://t.me/jichangbiji)

</div>

![HeroRui 首页](docs/images/dashboard.png)

## 设计

HeroRui 使用朱红、纸白与暖灰，配合简洁字排、细线分隔与克制的圆角。页面采用全新的顶部导航、订阅概览、独立结算和工单会话布局，适配桌面和移动设备，并支持深浅色切换。

本仓库只包含主题源码、构建脚本、测试和说明。前端独立实现，沿用 `/api/v1` 接口及主题加载格式，不加载原版 `umi.js`，不修改后端业务逻辑。

Xboard 与 V2board 的 blade 变量完全同名，同一个包两种面板都能装。两者的接口字段差异（验证码、Telegram、节点在线状态、套餐售罄等）由 `src/panel.js` 兜底归一化，不需要选择面板类型 —— 也因此对补过接口的改版分支同样成立。

## 下载与安装

1. 下载 **[HeroRui.zip](https://github.com/dreamrer/xboard_v2board_theme/releases/latest/download/HeroRui.zip)**。
2. 打开 **Xboard 后台 → 主题管理**，上传 ZIP，无需解压（V2board 见下方单独说明）。
3. 选择 **HeroRui** 并保存。如果前台没有变化，请在界面设置的前端主题字段中选择 HeroRui。
4. 刷新前台；如浏览器仍显示旧页面，执行强制刷新。

**请下载 Release 附件 `HeroRui.zip`。GitHub 自动生成的 `Source code (zip)` 是源码压缩包，不能直接作为主题上传。**

### 分离部署（前端单独托管）

把前端放到静态托管（Cloudflare Pages、Vercel、单独的 nginx 站点……），只让它跨域调面板接口。分离部署用**另一个包** **[HeroRui-standalone.zip](https://github.com/dreamrer/xboard_v2board_theme/releases/latest/download/HeroRui-standalone.zip)**，解压后：

```text
index.html      ← 入口
config.js       ← 手填配置，改完刷新即可，不用重新构建
assets/
```

> 两个包不要混用。面板会把主题包整个解压到公开目录 `public/theme/HeroRui/`，如果里面有 `index.html`，任何人访问 `/theme/HeroRui/index.html` 都能打开一个**不读后台配置**的前端（加密中间件是关的，真实接口路径会暴露）。所以 `HeroRui.zip` 里不带这两个文件。

1. 解压 `HeroRui-standalone.zip` 到静态站点根目录。
2. 编辑 `config.js`，**至少填 `server_url`**（面板地址）：

```js
window.themeConfig = {
  server_url: "https://panel.example.com",   // 必填
  // 其余配置项与后台主题管理里的同名，按需填
};
window.settings = {
  title: "你的站点名",   // 分离部署下站点名/描述/Logo 没有面板来源，在这里填
};
```

3. 静态服务器需要把找不到的路径回落到 `index.html`（主题用 hash 路由，通常不配也能用）。

**跨域不需要改后端。** Xboard 与 V2board 的 `config/cors.php` 都是 `paths: ['api/*']` + `allowed_origins: ['*']` + `allowed_headers: ['*']`，且 `HandleCors` 在全局中间件里。

**升级时先备份 `config.js`** —— 新包里带的是一份全新的默认配置，直接覆盖会抹掉你填的值。只替换 `index.html` 和 `assets/` 最省事。


### V2board 安装

V2board 没有主题上传界面，改为手动放目录（ZIP 根目录的结构与 V2board 的主题目录一致，解压即可）：

```bash
unzip HeroRui.zip -d /www/wwwroot/v2board/public/theme/HeroRui
```

然后在 **后台 → 系统配置 → 界面设置 → 前端主题** 选择 HeroRui 并保存。

**升级：** 先删掉旧目录再解压，不要直接覆盖 —— 旧版本残留的文件不会被新包清掉（v1.3.0 的面板包里带了 `index.html` 和 `config.js`，覆盖解压后它们仍然留在公开目录里）：

```bash
rm -rf /www/wwwroot/v2board/public/theme/HeroRui
unzip HeroRui.zip -d /www/wwwroot/v2board/public/theme/HeroRui
```

升级后到 **后台 → 主题配置** 打开 HeroRui 点一次**保存**，新增的配置项就会写入（表单本身按新的 `config.json` 渲染，新字段会以默认值出现）。**不要删除 `config/theme/HeroRui.php`**：配置缓存存在时删它不会生效，之后再保存时反而会把全部主题配置重置为默认值（面板地址、中间件密钥、客服设置都会丢，中间件会悄悄关闭）。

站点名称、描述和 Logo 沿用后台设置；主题配置支持自定义 HTML，可用于客服或统计脚本。原版主题可继续保留，必要时在后台切回。

### 更新

下载新版本 Release 的 `HeroRui.zip`，在主题管理中上传更新。Xboard 可能要求新包的 `config.json` 版本号高于已安装版本；自行修改主题后重新发布时，请同步调整 `config.json` 和 `package.json` 的版本。

## 功能

| 模块 | 支持功能 |
| --- | --- |
| 账户认证 | 登录、注册、邀请码、邮箱验证码、密码找回、服务条款、免密链接登录 |
| 人机验证 | reCAPTCHA v2 / v3、Cloudflare Turnstile（依赖后端配置） |
| 订阅管理 | 用量与到期时间、订阅复制、协议选择、二维码、客户端导入、续费、流量重置 |
| 选购与订单 | 套餐分类、付款周期、优惠券、旧订单处理、订单详情、服务端余额抵扣 |
| 支付 | 支付方式选择、手续费展示、二维码支付、收银台跳转、Stripe 卡输入、状态轮询 |
| 网络与内容 | 节点状态和搜索、流量明细、公告、知识库搜索与文章阅读 |
| 推广邀请 | 邀请码与链接、佣金统计、分页记录、余额划转、提现工单 |
| 工单与设置 | 工单创建、会话回复、关闭；修改密码、订阅安全重置、邮件提醒、Telegram 绑定 |
| 每日签到 | 自动适配 Xboard 签到插件与 V2board 内置签到，面板没有该功能时不显示入口 |
| 邮箱链接登录 | 只填邮箱发送登录链接，免密登录；面板未开启时给出明确提示 |
| 在线客服 | Chatwoot、Crisp、SalesMartly 或任意自定义嵌入代码，自动同步套餐 / 到期 / 流量 / 余额 |
| 接口隐藏 | 自定义接口路径前缀；可选接入加密中间件，真实接口地址不出现在网络请求里 |
| 兑换码 | 礼品卡 / 兑换码。Xboard 先预览奖励再确认并带兑换记录，V2board 直接兑换 |
| 登录设备 | 查看账号在哪些设备登录并可逐个移除，自动标出当前设备 |
| 免登录链接 | 生成 60 秒有效的临时链接，在其他设备打开即可直接登录 |
| 客户端下载 | 七端下载地址（Windows / macOS / Android / iOS / Linux / OpenWrt / TV）+ 说明文字与帮助外链；一个都没配则连入口都不出现 |
| Telegram 频道 | 总览与下载页各一处关注入口，可自定义说明文字；留空则不出现 |
| 部署方式 | 同一个包支持面板上传（同域）与静态托管（分离部署，跨域调接口），无需改后端 |
| 界面 | 响应式布局、深浅色切换、多语言（8 种，首次访问按浏览器语言与系统深浅色偏好自动选）、键盘导航 |

可用支付方式、验证码、Telegram、提现等功能由站点后端配置决定。既有主要语言词典已迁移，新增少量提示在缺少译文时回退到中文。

## 主题配置

在 **后台 → 主题管理 → HeroRui** 里填写，全部留空也能正常使用。

后台输入框较窄，里面的提示文字会被截断且无法左右滚动，所以那里只写了最短的提示。**完整说明以下表为准**（本文件也在主题包里，装好后可在 `theme/HeroRui/README.md` 查看）。

| 配置项 | 说明 |
| --- | --- |
| 面板类型 | 默认自动识别。字段差异已兜底，多数站点不用改；选定后跳过能力探测、直接按该面板契约走 |
| 面板地址 | 同域部署留空。分离部署必填，如 `https://panel.example.com` |
| 接口路径前缀 | 默认 `/api/v1`。用反代隐藏接口时填反代路径，如 `/proxy/api` |
| 加密中间件-地址 | 中间件域名，如 `https://enc.example.com`。**地址和密钥都填才启用**，留空不启用 |
| 加密中间件-密钥 | 与中间件 `.env` 的 `AES_KEY` 一字不差 |
| 加密中间件-入口前缀 | 默认 `/assets/immutable`，对应中间件的 `PATH_PREFIX` |
| 加密中间件-伪装扩展名 | 默认 `.js`。只认 `.js .css .json .map .png .jpg .jpeg .gif .webp .svg .ico .woff .woff2`（区分大小写）；要不带后缀填 `none` |
| 邀请链接域名 | 留空用用户当前访问的域名。主域名被墙时填备用域名，已发出去的邀请链接才不会全是死链 |
| 每日签到 | 这个功能的总开关。用哪套签到接口由「面板类型」决定 |
| 客户端-Windows / macOS / Android / iOS / Linux / OpenWrt / TV | 各平台下载地址，留空则不显示该平台；七个全空则整个下载页和导航入口都不出现 |
| 客户端下载页说明 | 显示在下载列表上方的一段文字，可留空 |
| Telegram 频道 | 在总览和客户端下载页显示关注入口，默认为 [@jichangbiji](https://t.me/jichangbiji)。**不想推广请清空这一项**，清空后入口完全不出现 |
| Telegram 频道说明 | 入口下方的一句话说明，留空用默认文案 |
| 帮助中心外链 | 填了会在下载页显示「查看教程」按钮 |
| 邮箱链接登录 | 登录页是否显示该入口。需面板已开启 `login_with_mail_link_enable` |
| 在线客服类型 | 不启用 / Chatwoot / Crisp / SalesMartly / 其它（自定义嵌入代码） |
| Chatwoot 地址、网站令牌 | 客服类型选 Chatwoot 时填。令牌在 Chatwoot 后台 → 收件箱 → 网站令牌 |
| Crisp Website ID | 客服类型选 Crisp 时填。Crisp 后台 → 设置 → 网站设置 → Website ID |
| SalesMartly 脚本地址 | 客服类型选 SalesMartly 时填。后台 → 集成 → 网站插件 → 安装代码里那条完整 URL |
| 自定义客服嵌入代码 | 客服类型选「其它」时填，粘贴客服系统的 `<script>` 代码（美洽 / 53kf / TG 挂件等） |
| 自定义页脚 HTML | 客服 JS、统计代码等。在所有页面（含登录页）生效 |

### 面板类型

两种面板的**字段差异**（验证码、Telegram、节点在线状态、套餐售罄等）由 [src/panel.js](src/panel.js) 兜底归一化，两个字段名都认，所以这一项留默认就行。

填了具体面板时它作为**显式覆盖**：跳过能力探测、直接按该面板的契约走，并在接口返回的字段形状与所填不符时在控制台提示一声（兜底归一化是隐形的，填错了本来不会有任何反馈）。

它**不用来隐藏功能**。按面板硬关会在改版分支上判错 —— 比如有的 V2board 分支补上了 Xboard 才有的 `loginWithMailLink` 和 `token2Login`，按面板关掉就把本来能用的功能关了；反过来 V2board 有内置签到，Xboard 原版反而要装插件。功能有无一律以探测和错误码为准。

配置字段的唯一真源是 [scripts/theme-fields.mjs](scripts/theme-fields.mjs)，加字段后运行 `npm run gen:config` 重新生成 `config.json`；两者不一致时构建会直接报错，避免站长填了却静默不生效。

### 加密中间件

启用后，请求路径会被加密成一串形似静态资源的乱码打给中间件，真实接口地址不出现在网络请求里：

```text
https://enc.example.com/assets/immutable/<加密 token>.js
```

协议细节（便于自建或复用已有的中间件）：

```text
明文    = <时间戳>|<路径>
inner   = 版本(1 字节, 0x03) ‖ 明文长度(2 字节, 大端) ‖ 明文 ‖ 随机填充(补到 32 的倍数)
nonce   = 24 字节随机数
密钥    = SHA-256(配置里填的密钥)
密文    = XChaCha20-Poly1305(inner, 密钥, nonce)      末尾自带 16 字节 tag
token   = base64url-nopad(nonce ‖ 密文)
```

这是通用的路径加密中间件协议，**已有中间件实例和密钥可以直接复用**，不需要为本主题单独部署。

两点取舍需要知道：

- **地址和密钥只填一个时，请求会直接失败而不是回退直连面板。** 静默直连意味着站长以为开了、实际真实路径一直裸奔，这正是中间件唯一要藏的东西。要停用就把两项都留空。
- **伪装扩展名填了名单外的值，前端会当场中止并在控制台说明原因。** 中间件对未知后缀一律返回伪装 404，没有任何线索，与其让人对着一堆无差别 404 猜，不如在前端拦下。

订阅地址由后端生成、客户端直连，不经过中间件。

### 每日签到

签到不是面板核心功能，两种面板的实现也完全不同。**面板类型留默认「自动识别」时**，主题探测 `GET /user/checkin` 来判定：

| 探测结果 | 判定 | 契约 |
| --- | --- | --- |
| 200 | Xboard「每日签到」插件 | `GET` 查状态，`POST` 签到 |
| 405 | V2board 内置签到（路由只收 POST） | `POST` 带 `type=1` |
| 404 / 其它 | 没有该功能 | 不渲染入口 |

**明确选了面板**就按所选的契约直接走：选 V2board 连探测都不发（它本来就没有查状态的接口，省一个请求），选 Xboard 则探测不到就是没有、不再回退去猜 V2board。

没有签到的站点不会多出任何东西，仪表盘上那排入口仍是原来的三列。V2board 没有查询当日状态的接口，所以「今天已签」只在本地记一笔用于收起按钮；真正的重复签到由后端当日占位拦住。

V2board 的「运气签到」（`type=2`，需用户输入数值）未包含。

## 页面预览

截图使用模拟数据，仅展示主题界面，不代表实际套餐或服务承诺。

### 登录

![登录页](docs/images/login.png)

### 套餐

![套餐页](docs/images/plan.png)

### 工单

![工单会话](docs/images/ticket-1.png)

<details>
<summary>查看手机端截图</summary>

<img src="docs/images/mobile.png" width="390" alt="HeroRui 手机端首页">

</details>

## 本地开发

建议使用 **Node.js 24 LTS** 和 npm；最低 Node.js 版本为 **22.12**。

```bash
git clone https://github.com/dreamrer/xboard_v2board_theme.git
cd Xboar-HeroRui-Theme
npm ci
npm run dev
```

开发入口默认为 `http://127.0.0.1:4180`。开发页保留演示站点标题，但默认不提供模拟 API；连接实际服务时，需要自行配置开发代理或同源后端。测试脚本中的模拟 API 不会进入生产包。

## 构建主题包

在仓库根目录执行：

```bash
npm ci
npm run build
```

产物如下：

```text
dist/
├── HeroRui.zip                        # 面板主题包（Xboard 上传 / V2board 解压）
├── HeroRui-standalone.zip             # 分离部署包（静态托管）
├── *.sha256                           # ZIP 的 SHA-256 校验值
└── *.manifest.json                    # 包内文件清单及校验值

theme/HeroRui/                         # 面板包展开文件
├── config.json
├── dashboard.blade.php
├── assets/
├── README.md
└── LICENSE

theme/HeroRui-standalone/              # 分离部署包展开文件
├── index.html
├── config.js                          # 手填配置
├── assets/
├── README.md
└── LICENSE
```

构建过程自动注入 Xboard 的站点设置与 `/theme/<主题名>/assets/` 资源地址。ZIP 根目录直接包含 `config.json` 和 `dashboard.blade.php`，可直接上传。

## 测试

```bash
npm ci
npx playwright install chromium
npm test
```

测试会构建生产版本，启动临时预览服务器，使用模拟 API 执行三组检查，共 **136 项**，全部通过：

| 套件 | 项数 | 覆盖 |
| --- | --- | --- |
| `tests/smoke.mjs` | 32 | 认证、订阅、选购结算、支付、节点、工单、邀请、设置、移动布局、深浅色、多语言、错误重试 |
| `tests/integrations.mjs` | 5 | Turnstile、reCAPTCHA v2 / v3、Stripe 卡 token、收银台跳转（模拟 SDK） |
| `tests/features.mjs` | 99 | 两种面板的字段归一化、面板类型覆盖与形状不符提示、签到两种契约及探测回退、邮箱链接登录四种响应、四类在线客服注入与属性同步、接口前缀与其误填保护、加密中间件、分离部署、首次访问的语言与深浅色识别、兑换码双契约、登录设备两种结构、免登录链接、七端下载页、Telegram 频道 |

加密中间件那项会在测试里用同一套算法把请求 token **解密回原路径**，同时断言真实接口路径没有出现在任何一条网络请求里。结果位于 `dist/HeroRui-preview/`。

如需重新生成演示截图：

```bash
npm run build
npm run preview
```

`npm run preview` 会自动使用模拟数据生成截图，随后关闭浏览器和服务器；它不是持续运行的在线演示站。

如希望使用已安装的 Google Chrome，可设置环境变量 `PLAYWRIGHT_CHANNEL=chrome` 后运行测试。

## 兼容性与验证范围

主题依据 Xboard 与 V2board 源码的接口和主题加载规则实现，两种面板的 blade 变量同名、接口差异已归一化。目前没有覆盖所有分支或历史版本；接口存在自定义修改的站点需要单独联调。

签到、邮箱链接登录属于面板可选能力，主题靠探测与错误码兜底，面板没有就不显示或给出提示，不会因此报错。

本地已验证浏览器交互、请求参数、金额及流量换算、移动布局、错误重试、生产构建和 ZIP 完整性。第三方验证码、Telegram 和 Stripe 使用模拟 SDK 测试，支付使用模拟响应。**尚未在真实站点验证后台安装、邮件送达、验证码挑战、客户端唤起及支付到账。** 建议先在测试站完成这些链路验证。

详细记录见 [VALIDATION.md](VALIDATION.md)。

## 目录

```text
src/                      React 页面、组件、样式与语言词典
  panel.js                Xboard / V2board 字段差异归一化
  middleware.js           路径加密中间件（XChaCha20-Poly1305）
  checkin.jsx             每日签到，双契约探测
  giftcard.jsx            兑换码，双契约探测
  clients.jsx             客户端下载页
  service.jsx             在线客服对接
scripts/theme-fields.mjs  主题配置字段唯一真源
scripts/gen-config.mjs    依此生成 config.json
scripts/standalone.mjs    分离部署的 index.html + config.js
scripts/package.mjs       Blade 生成、主题打包与校验清单
tests/                    模拟 API、浏览器回归和截图脚本
docs/images/              README 页面预览
config.json               主题标识及可配置字段（由 gen:config 生成）
vite.config.js            前端构建配置
```

## 交流与反馈

- **Telegram 频道** —— [@jichangbiji](https://t.me/jichangbiji)：主题更新、节点与故障公告
- **问题反馈** —— [GitHub Issues](https://github.com/dreamrer/xboard_v2board_theme/issues)

## 致谢与许可

本主题基于 [Grandova/Xboar-HeroRui-Theme](https://github.com/Grandova/Xboar-HeroRui-Theme)（MIT）二次开发，在其之上增加了 V2board 支持、加密中间件、分离部署、在线客服、每日签到、兑换码、登录设备管理、客户端下载页等功能，并修复了若干缺陷（详见 [VALIDATION.md](VALIDATION.md)）。

界面使用 [Ant Design](https://ant.design/) 与 [HeroUI](https://www.heroui.com/)，图标使用 [Lucide](https://lucide.dev/)。`LICENSE` 保留了上游 Xboard / V2Board 项目的 MIT 许可证及版权声明，原版静态语言词典用于既有文案兼容；各依赖遵循其自身许可证。

详见 [LICENSE](LICENSE)。
