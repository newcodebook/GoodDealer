# ADR-0011：设备身份、原子绑定与 Native OAuth 登录

状态：Accepted

## 设备身份与持钥证明

设备身份、绑定、轮换和撤销必须由服务器端事实、明确目的的密码学和严格 wire 契约
共同约束。客户端自报身份、安装标识或普通会话不能替代持有证明、范围校验、并发控制或
撤销语义。

Native 在平台专属秘密托管条目中保存稳定 Device ID、Key ID 与 Ed25519 seed。系统浏览器
完成 Account Web 会话验证后，Cloud 创建两分钟、账户范围、数据库只存 nonce digest 的一次性
challenge。签名 transcript 同时绑定 account/device/key/challenge、PKCE challenge、固定 client、
固定 redirect、nonce digest 与 expiry。Cloud 在同一账户事务中锁定并验证 challenge、当前
Security Epoch 与活动公钥；验签成功后原子消费 challenge 并写入 OAuth authorization code。

首次安装没有 binding 时，同一 challenge 保存 proposed public key 和发起授权的 Account Web
session digest。只有该 Web 会话由五分钟内的密码或 Passkey 认证创建，且第二段浏览器授权仍使用
同一会话，才允许继续；challenge 期限取两分钟与剩余重新认证窗口中的较短值。Native 自签成功且
账户仍有设备槽位时，事务创建 `device_bindings` 与 version 1 active `device_signing_keys`；已移除
设备、Web 会话替换、公钥替换、错误签名、过期、重放或槽位耗尽全部失败关闭。code exchange 前
再次检查 binding 与 active key，防止 challenge 与换 token 之间发生撤销。

设备密钥轮换与恢复必须要求旧钥或恢复流程证明，并原子推进 key version；普通 OAuth session 不是轮换证明。
服务器 Grant、Lease、Standby Grant 的签名托管与验证材料发布按 [ADR-0021](0021-self-hosted-openbao-transit-signing.md)。

## OAuth loopback

Desktop OAuth 回调改为 loopback，自定义 scheme 不再用于登录。

### 回调地址

- `redirect_uri` 精确为 `http://127.0.0.1:{port}/oauth/callback`。只用字面 IPv4 loopback：不用
  `localhost`（解析结果不受 Native 控制）、不用 IPv6、不用 https，无 userinfo、query 或 fragment。
- 端口由 Native 每次登录以 `127.0.0.1:0` 绑定、由操作系统分配；Cloud 按 RFC 8252 §7.3 接受
  `1024–65535` 内任意端口的上述精确形式。临时端口避免端口占用与跨实例抢占。
- Cloud 把本次请求的 `redirect_uri` 写入 challenge 与授权码，proof 校验、设备签名 transcript 与
  token 兑换都要求同一字符串逐字相等（RFC 6749 §4.1.3）。

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

### 浏览器与单实例边界

`gooddealer://` scheme 注册、`tauri-plugin-deep-link`、启动期回调缓冲与单实例转发中的回调处理
不参与登录。`tauri-plugin-single-instance` 保留，用于防止并发刷新进程。

同 UID 代码执行能读取 Native 内存时不由 loopback 防护；不知道 state 的进程或网页不能替换设备签名或消耗登录。
首发不提供无浏览器 device-code 登录。
