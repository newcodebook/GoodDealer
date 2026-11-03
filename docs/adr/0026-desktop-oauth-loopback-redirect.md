# ADR-0026：Desktop 浏览器登录改用 RFC 8252 loopback 回调

状态：Accepted

## 背景

Desktop 浏览器登录原先以自定义 scheme `gooddealer://oauth/callback` 接收回调。Cloud 先返回设备
challenge，Native 签名后再次打开浏览器，Cloud 才签发授权码，因此一次登录需要浏览器两次把
`gooddealer://` 交给操作系统。开发 VPS 上的真实登录显示：Cloud 的 challenge、设备签名、Lease
与授权码全部成功，但 Chrome 没有用户手势、或刚交出过一次外部协议时，会静默丢弃外部协议跳转，
Native 收不到回调，标签页停在空白页，登录永远停在 pending。这不是可通过提示用户“点击允许”
修复的偶发问题，而是自定义 scheme 回调在桌面浏览器上的结构性缺陷。

成熟原生客户端的做法是 RFC 8252 §7.3 的 loopback 回调。参考实现 OpenAI Codex
（`openai/codex` 的 `codex-rs/login/src/server.rs`）：本机只在 `127.0.0.1` 上起一个短生命周期
HTTP 服务，`redirect_uri` 为 `http://127.0.0.1:{port}/auth/callback`；浏览器经普通 HTTP 重定向
回到本机，没有外部协议提示与手势限制；回调处理内即用 PKCE 兑换授权码，然后给浏览器返回
本地成功页并关闭服务；state 不匹配只返回 400 而不终止登录；提供取消与关闭句柄；结构化日志
只记录 `has_code`、`state_valid` 等布尔值。

## 决策

Desktop OAuth 回调改为 loopback，自定义 scheme 不再用于登录。

### 回调地址

- `redirect_uri` 精确为 `http://127.0.0.1:{port}/oauth/callback`。只用字面 IPv4 loopback：不用
  `localhost`（解析结果不受 Native 控制）、不用 IPv6、不用 https，无 userinfo、query 或 fragment。
- 端口由 Native 每次登录以 `127.0.0.1:0` 绑定、由操作系统分配；Cloud 按 RFC 8252 §7.3 接受
  `1024–65535` 内任意端口的上述精确形式。Codex 使用固定端口 1455/1457，是因为它的授权服务器
  只允许预登记的 redirect URI；GoodDealer Cloud 自有授权服务器，临时端口避免端口占用与跨实例
  抢占，也就不需要 Codex 的“取消上一个登录服务再重试”逻辑。
- Cloud 把本次请求的 `redirect_uri` 写入 challenge 与授权码，proof 校验、设备签名 transcript 与
  token 兑换都要求同一字符串逐字相等（RFC 6749 §4.1.3）。PostgreSQL 约束改为同一精确形式；
  旧的自定义 scheme 行作为只读历史保留，约束以 `NOT VALID` 加入，旧行在各自 TTL 内自然过期。

### Native 回调服务

- 每次登录一个服务，只监听 `127.0.0.1`。新的登录会取消仍在等待的旧登录及其服务，用户关闭
  标签页后可以直接重试，不再被 `Busy` 卡住。单次登录总时限 10 分钟，到时关闭服务并回到未登录。
- 只接受 `GET /oauth/callback`，且 `Host` 必须精确为 `127.0.0.1:{port}`，以拒绝 DNS rebinding；
  其他路径（例如浏览器自动请求的 `/favicon.ico`）返回 404 并继续等待。请求头最多 8 KiB、
  5 秒读完，每个连接只处理一个请求后关闭。
- state 不匹配返回 400，不消耗当前登录；其他进程或网页无法在不知道 state 的情况下打断登录。
- challenge 回调：Native 签名后以 302 把**同一标签页**送往第二段 authorize。授权码回调：Native
  在处理内用 PKCE 兑换，成功或失败都返回本地结果页，然后关闭服务。
- 结果页是 `brand/` 视觉规范下的静态页：`Cache-Control: no-store`、`Referrer-Policy: no-referrer`、
  只允许内联样式与 `data:` 图片的 CSP，不含脚本、不回显任何查询参数。
- 授权码、state、verifier 只在 Native 内存中；不写日志，错误与页面不包含 URL 参数。

### 移除

`gooddealer://` scheme 注册、`tauri-plugin-deep-link`、启动期回调缓冲与单实例转发中的回调处理
一并移除。`tauri-plugin-single-instance` 保留，用于防止并发刷新进程。

## 残余风险

- 同一用户的其他进程可以连接回调端口，但没有 state 无法让 Native 接受回调，也无法替换设备
  签名；能读取 Native 内存或监听 loopback 流量的同 UID 代码执行已在 ADR-0025 的边界之外。
- 任意网页可以向本机端口发请求；响应是跨源的，不可读取，且没有 state 不会被接受。
- 本决定不提供无浏览器环境的 device code 登录（Codex 的 `device_code_auth`）；需要时另行决定。

## 后果

浏览器登录不再依赖操作系统的 URL scheme 注册与浏览器外部协议策略，Linux、macOS、Windows
行为一致；登录可以重试、有超时，失败在浏览器中有明确结果页。Cloud 授权、challenge 与 token
接口的 `redirect_uri` 契约随之改变，旧 Desktop 构件的自定义 scheme 请求会被拒绝。
