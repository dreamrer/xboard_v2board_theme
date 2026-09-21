# HeroRui 验证记录

## v1.3.2（连不上面板时的提示）

- 网络错误（浏览器只给 "Failed to fetch" / "Load failed"）与网关错误（502–504、Cloudflare 520–527）统一换成中文提示，原始错误写到控制台供站长排查。
- 登录页读取站点配置失败时，说明「无法连接到面板，暂时不能登录」并提供重试按钮；原来登录按钮只是灰着，只能刷新整页。
- **138 项检查全部通过**（32 + 5 + 101），新增 2 项：请求被中断时的提示与重试恢复、Cloudflare 522 的提示。

## v1.3.1（全面审计修复）

对整个主题做了一次全量审计（9 个审查角度，约 30 条候选逐条独立验证，多条在浏览器里对构建产物复现，或对照本地 Xboard / V2board 源码核实），确认成立 15 条，全部修复，**136 项检查全部通过**（32 + 5 + 99，新增 17 项回归）。

**安全 / 功能不可用**

- 知识库 iframe 的 sandbox 可被 mXSS 绕过：sandbox 原先在净化**前**设置，净化结果再以 HTML 字符串塞进 innerHTML，特制正文（`<form><math><mtext></form><form><mglyph><style></math><iframe …>`）能让 iframe 只在后一次解析时出现、不带任何 sandbox。现改为在 DOMPurify 的 `afterSanitizeAttributes` 钩子里给最终节点设置 sandbox，结果以 DOM 片段直接挂载，不再序列化重解析。两档各用独立的 DOMPurify 实例。
- 请求用了 `AbortSignal.any` / `AbortSignal.timeout`，Safari 17.4、Chrome 116 以下没有，iOS 16 及更早的 iPhone 登录后整站打不开。改为手写 AbortController + 定时器，超时给出明确提示。
- 免登录链接在 iOS / Safari 上复制失败：请求返回后再写剪贴板已不算用户操作。改为点击时立即调用 `clipboard.write`，把未落地的链接作为 Promise 交给 `ClipboardItem`；不支持时退回普通复制；仍失败则弹窗展示链接供再次点击复制，且不再误报"已复制"。
- 面板包里带着分离部署的 `index.html` + `config.js`：面板把整个包解压到公开的 `public/theme/HeroRui/`，任何人访问 `/theme/HeroRui/index.html` 都能打开一个读默认配置的前端（中间件关闭、真实接口路径暴露、后台关掉的功能重新出现）。现拆成两个包：`HeroRui.zip`（面板）与 `HeroRui-standalone.zip`（分离部署），构建时先清空输出目录，并有测试钉住面板包不含这两个文件。
- README 的 V2board 升级步骤"删除 `config/theme/HeroRui.php`"是错的：配置缓存存在时不生效，之后保存反而会把全部主题配置重置为默认值。改为"删旧目录再解压，然后在后台保存一次主题配置"，并明确警告不要删该文件。

**特定场景出错**

- V2board 校验失败时 `message` 固定是英文 "The given data was invalid."，原因只在 `errors` 里。现在 `errors` 优先。
- 重置流量包被"不可续费"拦住：两个面板都豁免重置流量包的 renew / sell / 容量检查，`planUnavailable` 现在接收所选周期。套餐列表里"停售但允许续费"的当前套餐也不再显示"已售罄"。
- 一次后台刷新失败就整页换成错误页（并卸载客服组件）。现在只有从未拿到过数据时才整页报错。
- 手机上总览的帮助卡片被 Telegram 卡片挤到 52px 宽。现在频道卡片在手机上单独占一行。
- 签到：指定 V2board 时不再跳过探测（原版 V2board 没有签到接口，会留一个永远报错的入口）；`data:false` 时在入口上显示后端原因，不再显示绿色的"已签到"。
- 兑换码：新增第二步探测（`GET /user/redeemgiftcard` 405 = 有、404 = 没有），原版 V2board 显示"未开启"而不是一个永远报错的输入框；探测故障不再猜面板类型，改为给重试按钮。顺带修正邀请返利比例（0.2 显示为 20%）和嵌套奖励字段显示成 `[object Object]`。
- `sing-box://`、`clash-meta://` 等带连字符的一键导入协议被上一轮收紧的 URI 正则误伤。改为显式列出客户端协议白名单，`ms-msdt:` / `search-ms:` 等仍然拒绝。
- 套餐描述为 `null` 时显示文字 "null"。
- V2board 签到把已用流量减成负数时，总览显示负数流量。现按 0 显示。
- Chatwoot 退出登录后会话还在：现在卸载时调用 `$chatwoot.reset()`。SalesMartly 没有公开的重置接口，退出登录时整页刷新一次卸掉挂件。客服同步的用户数据（余额等）改为读最新值而不是挂载时的快照。

## v1.1.0（V2board 支持 + 功能扩展）

本地环境：macOS、Node.js 26、Chrome、Vite 生产构建。

### 已完成

- **119 项检查全部通过**（`npm test`）：
  - 32 项主流程：认证兼容、公告、订阅复制及协议过滤、套餐分类、周期与优惠券、旧订单取消、订单保存、支付手续费、二维码结算、轮询、零元订单、节点过滤、流量倍率换算、知识库、工单、密码、订阅重置、通知、邀请、佣金、移动布局、深浅色、多语言、错误重试、空账户和登录失效。
  - 5 项集成契约：Turnstile、reCAPTCHA v2 / v3、Stripe 卡 token、收银台跳转（模拟 SDK，未真实付款）。
  - 82 项新功能：两种面板的字段归一化（验证码 / Telegram / 节点在线 / 套餐售罄）、面板类型的显式覆盖与形状不符提示、签到的两种契约与三种探测结果、邮箱链接登录的四种响应、四类在线客服的注入与属性同步、自定义接口前缀、加密中间件、分离部署。
- **接口契约与两种面板源码逐字段核对**（Xboard 与 V2board 本地源码，2026-09）：
  - 订单周期的 8 个 key 与 `OrderSave` 的白名单逐字一致；优惠券算法与 `CouponService` 一致（定额 / 百分比 + 封顶）；流量明细除以 `server_rate` 还原真实用量。
  - HeroRui 调用的 37 个接口在 V2board 中均存在，仅 `/passport/auth/telegramLogin` 缺失 —— 该入口由 `telegram_login_enable` 控制，V2board 不返回该字段，入口自然不渲染。
  - blade 渲染变量（`$title / $theme / $version / $description / $logo / $theme_config`）两种面板完全同名；V2board 为 Laravel 8，因此注入用 `@json` 而非 `@js`（后者需 Laravel 9+）。
- **加密中间件协议往返验证**：测试用同一套算法把请求 token 解密回原路径，断言协议版本为 3、inner 长度补齐到 32 字节的倍数、内嵌时间戳接近当前时间、同一路径两次加密的 token 不同（nonce 随机），且真实接口路径与接口名没有出现在任何一条网络请求里。
- **分离部署已用真实产物验证**：测试起一个纯静态服务器托管 `theme/HeroRui/`（无 PHP、无 Blade），config.js 里填跨域面板地址，断言仪表盘正常渲染、接口打到面板域名而非前端域名、站点名取自 config.js、`custom_html` 的 `<script>` 真的执行、以及同域部署下不会重复注入。面板地址填错时明确报错而不回退同域。
- **两种面板的 CORS 已核对**：`config/cors.php` 均为 `paths: ['api/*']` + `allowed_origins: ['*']` + `allowed_headers: ['*']`，`HandleCors` 在全局中间件里，分离部署无需改后端。
- **fail-closed 行为已验证**：中间件地址 / 密钥只填一个、或伪装扩展名非法时，请求中止且不会回退直连面板。
- 生产构建通过；全部用例零浏览器 JavaScript 异常；ZIP CRC 与 manifest SHA-256 一致；包内无原版 `umi.js`、模拟数据、开发依赖和测试代码。
- `config.json` 与 `scripts/theme-fields.mjs` 的一致性由构建期校验保证，漂移直接报错。

### 审计发现并修正的问题

代码审计（`/code-review high`）报出 4 项，逐条核对后全部成立并修复；安全审计（`/security-review`）无达标发现，另有 2 项我自行收紧：

- `injectOnce` 只重建顶层 `<script>`，包在 `<div>` 里的客服嵌入代码静默不执行；重建时 `async` 默认为 true，原本顺序执行的外链脚本会乱序。**修复过程中我自己引入过一个更严重的问题** —— 改用 `document.body.querySelectorAll('script')` 会把应用自己的 bootstrap 和 `type="module"` 入口一起重建，等于把 React 挂载两遍；已改为只在注入的那批节点内查找，并加测试钉住"页面不该被挂载两次"。
- 签到在 v2board 上把任何 5xx 都当成"没这功能"静默收起入口。v2board 用 `abort(500, …)` 作通用业务错误通道（"用户不存在"、数据库抖动都是 500），真出错时按钮凭空消失且无任何提示。现在一律先报错，只在文案确实是"未开启"时才收起。
- 邮箱链接登录只认 404/429 并丢弃 `e.message`。v2board 的限流是 `abort(500, 'Sending frequently…')` 而非 429，原来会被吞成通用文案。现在除 404/429 外优先显示后端原文；为区分"后端给的原因"和"前端自己凑的"，`request()` 抛出的错误新增 `generic` 标记。
- `middleware_url` 漏写协议（填 `enc.example.com`）时拼出相对地址，每个请求都打给前端自己、静默 404，而 `middleware_ext` 和 `server_url` 对同类笔误都是当场报错。已统一为 fail-closed。
- （自行收紧）`api_path` 填成绝对地址或 `//host` 时，`new URL` 会让它覆盖接口根，把带 `Authorization` 的请求静默送到那个域名。字段名是"接口路径前缀"，很容易被误填成面板地址，现在当场报错并指向"面板地址"配置项。
- （自行收紧）中间件的明文长度字段只有 2 字节，超长路径会被截断成错误长度、变成畸形请求，现在提前报错。

安全审计独立核对并清除的面：`Rich` 的 DOMPurify 净化未被本次改动触及；`@json` 会转义 `</script>` 与引号，主题配置注入不能突破内联脚本；40 余个接口调用点全是字面量常量，无法被后端或用户数据引导到站外；`fetch` 未带 `credentials`，跨域不携带 Cookie；加密实现的 nonce 每次随机且不复用、密钥恰为 32 字节、大端长度与随机填充处理正确、fail-closed 路径为真实抛出而非回退直连。两个注入沿口（`custom_html` / `customer_service_html`）的数据源均为管理员配置，与改动前 Blade 的 `{!! !!}` 同一信任级别。

### 开源版新增（v1.3.0）

- **客户端下载扩到七端** —— 加了 TV（Android TV / 电视盒子）。
- **Telegram 频道入口** —— 总览的帮助卡片区与客户端下载页各一处，说明文字可自定义，留空则整个入口不出现。地址走 `externalURL()`：只接受绝对 http(s)，缺协议会被 `safeURL` 解析成本站死链，所以直接忽略并在控制台说明。外链带 `rel="noopener noreferrer"`。

### 第二轮深度审计（`/code-review max`）发现并修正的问题

九个审查角度里八个完成（第九个撞上会话限额）。多个角度交叉确认的七条已全部修复：

- **登录设备在 Xboard 上时间全丢、排序失效**（3 个角度独立确认）。Xboard 的 `/user/getActiveSession` 是 `$user->tokens()->get()->toArray()`，即 Sanctum 的 `PersonalAccessToken` 行，日期经 Carbon 序列化成 ISO-8601（`"2026-09-15T03:12:45.000000Z"`）；我用 `Number()` 去解析，得到 `NaN → 0`，于是每行的时间都退化成「—」，`.sort()` 变成 `0-0` 的空操作。**而我的 fixture 用的是整数时间戳，所以测试完全查不出来。** 已改为 `toUnixSeconds()`（同时容忍毫秒），fixture 换成 Xboard 的真实形状。
- **同一处：Sanctum 的 `name` 被当成设备名**。它是 `createToken(Str::random(20))` 产生的随机串，界面上会显示成一串乱码（`kQ8mZ2vX1pL7nR4tY6wA`）。现在留空，由界面显示「未知设备」。
- **售罄拦截把老用户的续费也挡了**（3 个角度确认）。两个面板对续费只看 `renew`（Xboard `PlanService::isPlanAvailableForUser` 第 61-62 行直接 `return $plan->renew`，不看 `sell`、不看容量），而「停售但让老用户续费」（`sell=0, renew=1`）是很常见的配置。用户点仪表盘的「续费」只会看到一个禁用的「已售罄」按钮，重置流量包同样被挡。**这个拦截正是上一轮审计让我加的** —— 那一条对语义的判断是错的。已拆成 `planUnavailable(plan, user)`：续费看 `renew`，新购看 `sell`/容量。
- **礼品卡流量奖励的单位错了**。`GiftCardService::giveRewards` 把 `rewards['transfer_enable']` 直接累加到 `users.transfer_enable`，而那个字段是**字节**（套餐表里的才是 GB）。我标成 GB，一张实际给 100 GB 的卡会显示成「+107374182400 GB」。已改用 `bytes()`，fixture 也换成真实字节值。
- **兑换码的面板探测把所有失败都当成 V2board**（3 个角度确认）。500 / 超时 / 中间件配置错都会让 Xboard 站点掉进「直接兑换」分支，而 `/user/redeemgiftcard` 在 Xboard 上不存在 —— 用户对着有效的码只能反复看到 404。已改为只有 404 才判定为 V2board，其余按主流面板走并在控制台留线索（与 `checkin.jsx` 同一标准）。
- **兑换记录 / 佣金记录的错误是粘性的**（2 个角度确认）。两处 effect 只 set 不 clear，一次瞬时失败之后即使重取成功，旧错误仍会永久盖住表格，刚兑换的记录也看不到。已在每次重取前清空。
- **`useLatest` 在 render 阶段写 ref**。React 允许丢弃并重跑一次 render（StrictMode 双调用、Suspense 重试、被高优先级打断），render 阶段的写入会把一次「从未发生过的渲染」的数据留下来 —— 而那份快照正是推给客服的套餐 / 流量 / 余额。已改到 effect 里写。
- **客户端下载地址缺协议时会变成本站链接**。`safeURL` 用 `location.origin` 作 base，所以 `dl.example.com/win.exe`（复制时漏掉 `https://` 很常见）会被解析成 `https://本站/dl.example.com/win.exe` —— 校验通过、卡片照常显示，用户点进去是本站 404。已加 `externalURL()` 只接受绝对 http(s) 地址并在控制台说明被忽略的原因。

审计另外提出的重构类建议（能力探测抽成统一 hook、三个客服组件合并成一个工厂、`config.json` 改为构建期生成而不是提交+校验、测试 harness 去重）已记录，未在本轮实施 —— 它们改动面大且与当前的正确性修复无关。

### 本轮自审发现并修正的问题

多智能体审计因会话上限无法运行，改为对本轮新增代码逐项自查（按前几轮审计暴露的问题类型定向排查）：

- **盲盒礼品卡把随机预览当成了承诺** —— 后端 `previewRewards()` 与 `redeem` 各自独立调用 `calculateActualRewards()`，而该方法对盲盒类型（`TYPE_MYSTERY = 3`）走的是 `mt_rand`，**两次调用结果不同**。原实现会把预览那次抽到的奖励逐项列出来，用户实际兑到的却是另一样 —— 等于在界面上替后端许了一个它没许的诺。现在盲盒只提示「兑换后随机获得，实际以兑换结果为准」，不列明细；非盲盒照旧逐项列出。
- **登录设备所有行共用一个 loading** —— 点某一行的「移除」会让所有行一起转圈。改为按行记录 pending。
- **`availableClients()` 每次渲染跑 6 次 `new URL`** —— `main.jsx` 的 `nav` 每渲染都重建，而这个列表在一次页面生命周期内不会变（`themeConfig` 是模块级快照）。已缓存一次。

同时核对无误的契约细节：`removeActiveSession` 的参数名 `session_id`（两个面板一致）；礼品卡记录的 `per_page`（`page` 由 Laravel 的 `paginate()` 自动读取）；礼品卡 `rewards['balance']` 经 `addBalance()` 直接累加到 `user.balance`，与主题 `money()` 的分为单位一致。

### 移除 Telegram 登录（v1.2.0）

按使用者要求删除。一并清掉了只服务于它的代码，不留死配置：`auth.jsx` 的挂件注入、`panel.js` 里 `telegram_bot_username` / `telegram_login_enable` 的归一化（删掉这个入口后它们再无消费者）、以及相关测试与 mock 分支。

**Telegram 绑定（通知）保留** —— 那是另一条链路（`/user/telegram/getBotInfo` + 向机器人发送 `/bind`），在个人中心的「通知」里，与登录无关。

### 功能扩展（v1.2.0）

按从小到大的顺序补齐的四项，每项都核对过两个面板的真实接口：

- **邀请链接域名**（`invite_domain`）—— 原先写死 `location.origin`，主域名被墙后用户已经发出去的邀请链接全是死链。填错（漏协议）会退回当前域名并在控制台说明，不生成一堆打不开的链接。
- **登录设备管理** —— 两个面板的返回结构完全不同：Xboard 是 Sanctum token 行的**数组**（有 `last_used_at`，无 IP/UA），V2board 是缓存里以会话 id 为键的**对象**（有 `ip`/`ua`/`login_at`）。由 `normalizeSessions` 抹平。**V2board 会把每个会话的 `auth_data`（真实 token）一起返回** —— 那是同一用户自己的 token、不构成越权，但只用来在本地比对标出「当前设备」，输出里不含该字段，并有断言确保它不出现在页面上。
- **兑换码** —— 两个面板差得比签到还远：Xboard 是 `/user/gift-card/{check,redeem,history,types}`、字段名 `code`、有不消耗次数的预览和分页记录；V2board 只有 `/user/redeemgiftcard`、字段名是 **`giftcard`**、无预览无记录、失败走 `abort(500)`。模式用 `GET /user/gift-card/types` 探测（无副作用且不需要先有一个码，拿 `check` 去探得先让用户输码）。奖励字段按 8 种已知键渲染，未知键原样显示而不是静默丢弃。`history` 不走 `success` 包装，直接是 `{data,pagination}`。
- **客户端下载页** —— 六个平台地址 + 说明文字 + 帮助外链，全配置驱动。地址一律过 `safeURL`（只放行 http(s)，挡住 `javascript:` 之类），外链带 `rel="noopener noreferrer"`；六个地址全空时连导航入口都不出现，不给没填地址的站点留一个空页面。

未做（理由已与使用者确认）：营销落地页会改变本主题「打开即登录页」的定位；主题色十选与单一品牌色的辨识度冲突。

### 深度审计（`/code-review max`）发现并修正的问题

十个审查角度 + 一轮补漏扫描，共 23 项，逐条核实后全部修复。按严重程度：

- **Telegram 登录在 V2board 上是死入口** —— 我写了 `telegram_login_enable ?? !!bot`，从 `telegram_bot_name` 推断支持 Telegram 登录。但那是 V2board 的**通知机器人**（来自 `telegram_bot_enable`），它的登录路由是 `/passport/oauth/telegram`，没有 `/passport/auth/telegramLogin` —— 用户授权完必然 404。**这正是我自己立的规矩（"能力有无一律以探测和错误码为准"）被自己违反**，而且当时的测试把错误行为断言成了正确的，VALIDATION.md 也写反了。现在只按后端原样透传。
- **401 的登录态清理排在 JSON 解析之后** —— 401 响应体常常不是 JSON（nginx/CDN 拦截页、PHP fatal），解析先抛就永远走不到清理，过期 token 留在本地，页面卡在一个按了也没用的「重试」上无限循环。已把清理提到解析之前。
- **`api_path` 填成不带协议的主机名不被拦** —— `panel.example.com/api/v1` 会被当成相对路径，把接口根重挂到前端域名下，每个请求 404 且看不出是配置问题。我上一轮只挡了 `https:` 和 `//host`。
- **知识库的 iframe 没有 sandbox** —— 放行 iframe 后，能写知识库正文的人（分权客服、被盗的管理员、上游分销面板内容）就能在真实域名下放一个全宽的假登录框。已强制 `sandbox="allow-scripts allow-presentation"` + `referrerpolicy=no-referrer`，且不给 `allow-same-origin`（与 `allow-scripts` 同时给会让 sandbox 失效）。
- **URI 白名单正则的字符类写成了范围** —— `[^a-z+.-:]` 里未转义的连字符构成 `.` 到 `:` 的范围，把连字符本身放出了排除集，于是 `ms-msdt:` / `search-ms:` 这类能唤起本地程序的协议全被放行（DOMPurify 自己的默认值是转义的）。这条是既有代码，但放行 iframe 后更吃重。
- **客服属性同步会把用户踢下线** —— `attributes()` 单独请求 `/user/getSubscribe`，而 `request()` 在 401/403 时**先 logout() 再抛错**，`catch{}` 拦不住副作用。token 过期后用户一点开客服窗口就被踢出面板。已改为复用 AuthContext 里已有的订阅数据，不再发请求（顺带消除了两份数据漂移）。
- **Crisp 在共用浏览器上串号** —— 卸载只置了 `dead=true`，既不重置会话也不注销事件；`session:loaded` 一个页面只触发一次，所以换用户后新身份根本推不出去，客服看到的还是上一个人的邮箱和余额。已改为事件只注册一次并走可替换的引用，换用户时重置会话。**修这条时我又引入了新问题**：`session:reset` 放进 cleanup 后，因为依赖里有 `subscribe`，签到触发的 `reload()` 会把用户正在进行的客服会话清掉 —— 已改为用 ref 读最新数据，effect 只依赖身份。
- **客服 SDK 首次加载失败后永远无法重试** —— 自写的加载器按 DOM id 去重，失败的 `<script>` 不清理，下次挂载会往一个事件已发完的元素上挂监听，Promise 永不落地，SDK 初始化和失败日志双双丢失。已与 `auth.jsx` 那个正确实现（20 秒超时 + 失败清理）合并为 `core.jsx` 里的一份。
- **`middleware_path` 漏了前导斜杠会改坏主机名** —— `https://enc.example.com` + `assets/immutable` 拼成 `enc.example.comassets/...`，请求死在 DNS 上，连状态码都没有，四种成因的提示也不会触发。已归一化（并 trim 掉粘贴带入的空白）。
- **`PlanDetail` 没有售罄拦截** —— 列表页判为售罄的套餐，直接访问 `#/plan/<id>` 仍是一个可下单的表单；V2board 的 `?id=` 分支后端也不查 `sell` 与容量。
- **签到靠中文正则判断状态** —— 后端按 `Content-Language` 本地化，zh-TW 回的是「已經簽到」「未開啟」，日韩俄语完全不同，中文正则必然漏。已全部改为与语种无关的信号（`data:false` / HTTP 500 + 连续两次才收起）。
- **签到的其余五条**：缺 `enabled` 字段被当成关闭（与 `panel.js` 给 `sell` 定的"缺失 ≠ 关闭"相反）；`reason` 是对象时直接当 React 子节点渲染会把整个面板带进 ErrorBoundary；v2board 回「今天已签过」不记录导致按钮反复可点；探测失败静默收起且无线索；请求返回时组件可能已卸载。
- **`capacity_limit` 判据过严** —— `' '` 和 `'1,000'` 都会被判成售罄，直接挡住下单。已改为看有没有数字，与 `sell` 的"宁可放过让后端拦"一致。
- **文案插值把值里的 `$` 当替换模式** —— `replaceAll` 的字符串替换会解释 `$$` / `$&` / `` $` ``，而签到提示里插的是第三方插件返回的原文。已改用 replacer 函数。
- **深浅色写入未兜异常** —— 读那边已 try/catch，写那边没有；禁用站点数据的浏览器里开关点了没反应。
- **中间件 404 告警误报** —— 我上一轮加的四种成因提示会在每次合法 404（比如签到探测）时刷屏。已改为只报一次并说明「若只有个别功能 404，更可能是面板本身没有该接口」。
- **响应式断点错位** —— 签到入口写在 1020px，而旁边三格的同类规则在 820px，821~1020px 这一段第四格没图标、左内距窄 11px。
- **测试自身三条**：`smoke.mjs` 的认证页是唯一漏钉 `locale` 的上下文（会在非中文机器上让四项检查超时，而 VALIDATION.md 声称"全部钉死"）；共享 state 的改动没完整还原，用例顺序一变就在别处炸；`features.mjs` 里一个 `endpointOf` 是死配置（Playwright 路由按注册倒序匹配，后注册的同 pattern 把它挡掉了）。

一并做的清理：合并两个脚本加载器、三个 `warned*` 布尔合并为一套记录、中间件配置每请求只读一次（校验过的值就是最终拼出去的那一份）、`apiRoot()` 每请求只算一次、`detectLocale()` 结果落盘（原先每次 `request()` 和每个 `date()` 都要重算）、消除 `core ⇄ middleware` 循环依赖、删掉两个已无调用者的导出、`planSoldOut` 里一个永远为真的死条件。

审查同时独立核实并清除的面：加密协议往返（版本字节、大端长度、32 字节填充、随机 nonce、base64url、密钥缓存失效）；`nodeOnline` / `planSoldOut` / `guestConfig` 对两种面板真实字段语义；`config.json` 与字段真源零漂移；`expose:false` 在 blade 侧生效且 `custom_html` 不会重复注入；分离部署产物里 classic `config.js` 确实先于 `type="module"` 入口执行；DOMPurify 不放行 `srcdoc`、不在多次 `sanitize()` 之间泄漏配置；37 个接口调用点全是字面量常量。

### 横向对比后补齐的问题

与同类主题逐项对比接口面、配置项与实现细节后补上的：

- **加密中间件的伪装 404 没有任何线索**。中间件把密钥不符、时钟偏差超窗、入口前缀不符、伪装后缀不符四种成因一律回同一个 404，而主题原先只显示「请求失败 (404)」。已补齐，并断言四条成因都在提示里。
- **知识库文章里的嵌入视频被整个剥掉**。HeroRui 原来全站只有一档净化配置，`iframe` 一律剥除；教程里嵌视频是这类站点的普遍做法。改为两档：套餐描述 / 公告仍然全剥（应为纯排版），知识库放行 `iframe` 及其必要属性。两档都照样剥 `script`、`on*` 与 `javascript:`。顺带核实 `iframe / object / embed / base / link / meta` 本来就不在 DOMPurify 的默认允许列表里，不需要额外列进 `FORBID_TAGS`；`ping` / `formaction` 同样已被默认剥除。
- **8 本语言词典里有 7 本永远用不上**。`getLocale()` 硬编码默认 `zh-CN`，英文访客首次打开看到中文。已补上浏览器语言识别（港澳台按繁体、无对应词典回落 `zh-CN`），用户手动选过就不再自动改。这个值同时作为 `Content-Language` 发给后端，影响其返回文案与邮件语言。
- **深色模式不看系统偏好**，一律默认浅色，系统是深色的访客第一眼会被闪一下白。已改为跟随 `prefers-color-scheme`，手动切过就听用户的。
- 上述两项识别让测试结果开始依赖跑测试机器的系统语言与配色，因此全部浏览器上下文已显式钉死 `locale` / `colorScheme`。

### 本次修正的既有问题

- 登录页按钮上方会多渲染一个 `0`：`is_captcha` 后端返回数字 0，`0 && <Captcha/>` 求值为 `0` 被 JSX 当文本渲染。归一化为布尔后消失。
- V2board 上验证码与 Telegram 登录不生效：V2board 返回 `is_recaptcha` / `telegram_bot_name`，主题读的是 `is_captcha` / `telegram_bot_username`。
- V2board 上节点全部显示离线：V2board 不返回 `is_online`，只有 `last_check_at`。
- 套餐售罄判断在 V2board 上失效：`sell` 是 0/1 而非布尔；`capacity_limit` 满员时 Xboard 返回字符串、V2board 返回剩余数量。
- 词典里有 284 条 `ru-RU` 但语言菜单没有俄语，现已加入。
- 主流程测试在语言切换一项因浮层动画超时，且首个失败即中断，导致其后 10 项从未跑到。改用 DOM click 后 32 项全部执行。

### 尚未验证

**以下链路仍需在真实站点联调，本地无 PHP / Laravel 运行环境：**

- 真实静态托管平台（Cloudflare Pages / Vercel 等）上的分离部署与真实跨域面板联调。
- 两种面板的后台安装与主题配置表单的实际渲染（含 V2board 需手动删除 `config/theme/HeroRui.php` 才能刷出新配置项）。
- 真实的加密中间件实例对接：本地只验证了协议往返，未与真实中间件握手。
- Xboard「每日签到」插件的真实返回值（本地无该插件，契约按其公开实现推导）；V2board 内置签到的真实响应。
- 邮件送达（邮箱链接登录的信件）、真实验证码挑战、真实客户端唤起、真实支付到账。
- Chatwoot / Crisp / SalesMartly 的真实 SDK（测试中为本地假脚本）。

## v1.0.0

本地环境：Windows、Node.js 24、Chrome Headless、Vite 生产构建。

- 32 项主流程检查与 6 项集成契约检查通过；桌面与 390px 手机端截图检查；十个业务路由无页面级横向溢出。
- ZIP CRC 校验及全部文件 SHA-256 与 manifest 一致；包内无原版 `umi.js`、模拟数据与测试代码。
- 原版 `theme/Xboard/assets/umi.js` SHA-256 保持为 `69ff1e68dd44b84f803e631367b6fc9dfd52e79d049067fa52cfa859031f20dc`。

## 复现

```sh
npm ci
npx playwright install chromium
npm test          # 构建 + 119 项检查
npm run preview   # 生成演示截图
```

测试 JSON 与页面截图输出到 `dist/HeroRui-preview`，安装包输出到 `dist/HeroRui.zip`。
使用已安装的 Google Chrome 可设 `PLAYWRIGHT_CHANNEL=chrome`。
