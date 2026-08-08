# GoodDealer 账户网页端 UI kit（account-web）

**独立 Web 壳**——品牌一致但**不是**桌面客户端的原生窗口终端（无 WindowChrome/StatusBar/命令面板）。账户网页端在客户端 Locked 后仍可达（承载合规入口），所以刻意做成 web 形态、跨桌面/移动端响应式，绝不伪装原生窗口。

工艺同 desktop kit：React + Babel 即时加载，DS 组件取自预打包 `_ds_bundle.js`（`window.GoodDealerDesignSystem_b5b0b6`），tokens 取自 `brand/styles.css`。壳层 CSS 在 `index.html <style>`（含 `@media(max-width:820px)` 响应式）。

## 壳层（`AccountShell.jsx`）

- **顶栏**：品牌标 + 定价/登录（公共）或 邮箱/登出（登录后）。
- **两种布局**：`flow`（公共流程 = 定价/结账，居中列）· `account`（登录后 = 左导航 + 主区）。
- **账户区左导航**：概览 · **订阅与账单** · 设备 · 安全 · 数据与隐私 · 支持（A 阶段仅订阅账单落地，其余标「即将」）。
- **响应式**：≤820px 左导航 → 顶部横向可滚动 tab 条、内容全宽堆叠、内边距收窄（已在移动端验证）。
- **页脚**：支付由 Paddle 处理（Merchant of Record）。

## A 阶段屏幕（购买主链 · J-06）

- **定价** `Pricing.jsx`（营销面，可用品牌表现层）— Coin Seal hero + 三档 **按期限** License（月 $9.80 / 年 $98「最受欢迎」/ 终身 $498「一次买断」金）；**License 只区分授权期限、不分功能档**，共享全功能清单；金只用于终身/价格时刻。
- **结账** `Checkout.jsx` — 订单摘要（计划/期限/应付「+税·结账时计算」）+ 账户邮箱 + **Paddle MoR 交接**：本页**不收集卡号**，付款/开票/税由 Paddle 托管，「继续到 Paddle 结账」跳转其安全页；14 天全额退款说明。
- **订阅与账单** `Subscription.jsx` — 当前计划/状态、**升级(补差价即时)/降级(下周期)/取消(周期末·不自动退款,承认对话框)**、支付方式(Paddle 保管·不存卡号)、发票历史下载；**续费恢复**：`grace(7天)`/`suspended` 状态 banner（客户端锁定 ≠ 账户页锁定，仍可导出/删除/管理设备）。含演示用状态切换（有效/宽限期/已暂停）。

## 数据（`data.js`）

`window.AW_DATA`：plans（按期限）、共享 features、account（当前订阅态）、invoices。

## B 阶段屏幕（设备 + 安全 · J-01/06/09）

- **设备** `Devices.jsx` — ≤2 台执行设备（MacBook Pro 金实心 Active·Epoch / iPhone 17 蓝空心 Standby，沿用桌面设备点约定）；**移除**走重认证（密码或 Passkey）+ 邮件通知，移除立即撤销服务端会话/Scope 但不消除剩余离线窗口；**移除 Active 进强制切换隔离**（`offline_execute_until`）；名额已满（2/2）提示；**报告遗失/被盗**→遏制对话框（撤销会话 + 递增安全代次 + **平台凭据撤销清单引导**，明示账号代次非即时平台阻断）。
- **安全** `Security.jsx` — 密码（修改→递增代次+撤销全部会话）· **Passkey 可选**（快捷确认，明示不强制 TOTP/短信 2FA，含 Touch/Face ID 列表）· 登录会话（当前/陌生标记 + 逐个/全部远程退出）· 账号安全（**发起接管恢复**→撤销会话+代次+冻结破坏性动作 + recovery_pending 冻结 banner）。含演示状态切换（正常/接管恢复）。

## C 阶段屏幕（数据与隐私 · J-09/06 · 客户端锁定后仍可用的合规闭环）

- **数据与隐私** `DataPrivacy.jsx` — 顶部明示「无论订阅是否有效都可导出/删除，合规入口在客户端锁定后仍保留」。**数据导出**：机器可读 **JSON/CSV/ZIP**，范围仅服务端业务数据（平台凭据/Cookie/密钥永不上云、不在范围）；请求需重认证，异步 身份核验→准备中→**就绪·下载保留 7 天**，就绪邮件通知。**账号删除**：danger 区列「将删除 vs 依法保留（Support 180 天 · 安全审计 365 天 · 财税 7 年 · Legal Hold）」；请求走重认证 + 承认门 → **7 天冷静期 pending banner（可取消）**，冷静期后冻结清除、35 天 PITR。

## D 阶段屏幕（支持 + Sunset · JD-10 / 停服预案）

- **支持** `Support.jsx` — 首版接入**外部 Helpdesk**：打开帮助中心 / 提交新工单（外链）；我的工单只显示 **SupportCaseReference + 映射状态**（待处理 open / 处理中 pending / 已关闭 closed / **状态未知**=与 Helpdesk 失联），不同步完整消息/附件；明示「状态为帮助中心状态的映射」「关闭工单不影响独立的数据权利或安全事件处理」；常见帮助链接。
- **服务延续 · Sunset** `sunset.html` → `Sunset.jsx`（独立卡片）— 停服延续：金色资格 banner（终身 + 停服时订阅有效者符合）；下载**最终本地延续版本**（LocalContinuation · macOS/Windows）+ **永久离线 Sunset Credential**；说明本地只读延续 Workspace、**不承诺**永久兼容未来 OS/API/网页/政策、平台凭据仍需设备重录（离线凭证不含平台密钥）、合规导出/删除停服后按预案另行提供、离线凭证丢失不补发。

## 门禁态（`Auth.jsx`）

web 版注册 / 登录 / 邮箱验证 / 找回密码，复用桌面 `SignIn` 心智（邮箱+密码 · OAuth · 可选 Passkey · 6 格验证码 · 记住此设备 · 凭据本地密钥加密永不上云），但是 account-web flow 布局里的**居中卡片**，非桌面 WindowChrome。顶栏「登录」与定价页「管理订阅」→ 进 `signin`；登录/验证成功 → 交接到账户区（订阅管理）。购买路径由此从登录闭环。

## 后续（未做）

- 转最后一个 surface **admin-web**（Owner 后台 · J-08/09）。

## 门禁态（未做，可复用 desktop SignIn 心智）

注册 / 登录 / 邮箱验证 / 找回密码 / 可选 Passkey — 与桌面 `SignIn` 概念一致，web 形态实现待 B 阶段并入。
