# GoodDealer 用户后台 UI Kit (account-web)

面向域名投资人本人的**云端 / 账户侧** Web 应用（`apps/account-web`）。本地执行仍在桌面客户端；本 kit 覆盖凭据永不上云前提下、云端能承载的账户能力。Web-native 全屏壳层（侧栏 + 顶栏 + 全宽终端状态栏），沿用 ink/gold/blue 私人银行终端语言，运营密度。按 `brand/` 规范 + 桌面 kit 约定首次实例化，非复刻。

Screens（点击侧栏切换）：
- **概览 Dashboard** — License 周期进度、设备执行权（Active/Standby/Sunset）、云端同步、近期动态、云端数据快照
- **订阅与许可 License** — 方案/周期/续费、本期进度、方案对比与升降级、所有权与 License 证书、用量
- **设备 Devices** — ActiveDeviceLease 状态 + Epoch；重命名、远程解绑丢失设备（danger 确认仪式）、释放额度配对新设备（移交执行权在桌面客户端完成）
- **账单与发票 Billing** — 支付方式、账单信息、发票账本（DS Table）+ 收据弹窗
- **安全 Security** — 活跃会话终止、2FA（TOTP/短信/硬件密钥）、恢复码、改密；强调平台凭据本地加密、永不上云、不在网页可见
- **云端数据 CloudData** — 只读镜像：资产快照 + 操作账本（Revision），常驻「数据来自 GoodDealer Cloud」；编辑与执行引导至桌面客户端
- **账户设置 AccountSettings** — 个人资料、偏好（locale/时区/货币）、通知开关、导出数据、删除账户（danger）
- **下载客户端 Download** — 桌面客户端下载（检测 OS）、平台卡片、安装后绑定四步、系统要求、更新日志

组合自 `components/`（Table, Badge, Money, Panel, Button, IconButton, Input, Select, Switch, Dialog, Tabs, StatusBar, StatusDot, ProgressBar）+ kit-local `controls.jsx`（MetricStrip 指标带 · Pagination）与 `icons.jsx`（Lucide 路径）。React + Babel 加载，`index.html` 内路由。
