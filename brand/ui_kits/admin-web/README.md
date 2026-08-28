# GoodDealer 管理员后台 UI Kit (admin-web)

GoodDealer 运营方**内部控制台**（`apps/admin-web`）。跨客户视角的运营、系统、支持与配置。Web-native 全屏壳层（分组侧栏 + 顶栏含 Production 环境标 + 全宽系统健康状态栏），沿用 ink/gold/blue 终端语言，运营密度。按 `brand/` 规范 + 桌面 kit 约定首次实例化，非复刻。

Screens（点击侧栏切换）：
- **运营概览 Dashboard** — MRR 近 12 月柱图、方案分布、近期交易、需要关注（事件/逾期/工单/舰队）、设备舰队健康
- **客户管理 Customers** — 跨客户表（筛选/搜索/分页）+ 详情抽屉（方案、设备、MRR、重置 2FA / 暂停 / 以客户身份查看）
- **许可与订阅 Licenses** — 方案分布与 MRR 贡献、订阅账本（设备额度/续费时间轴/状态）、签发 / 赠送 License
- **设备舰队 Fleet** — 跨客户 ActiveDeviceLease：状态/Epoch/区域/Lease 健康；强制解绑（运营 danger 仪式，入审计）
- **计费与营收 Revenue** — MRR/ARR、MRR 构成、逾期待收与重试扣款、交易流水（退款 danger 仪式）
- **同步与基础设施 SyncInfra** — 服务健康卡片、按区域同步队列、活跃事件、连接器健康
- **支持工单 Support** — 按状态 Tab（待认领/处理中/已解决）、工单表、详情抽屉（回复/认领/分配/标记解决）
- **审计日志 Audit** — 只读追加账本；运营 + 系统操作，高敏感操作高亮，导出
- **系统配置 Config** — 功能开关（分组 · 开关 + 灰度）、全局默认、只读维护模式（danger）、环境信息
- **公告 Announcements** — 撰写 / 排期 / 发布分受众公告，状态徽章（已发布/已排期/草稿）

组合自 `components/`（Table, Badge, Money, Panel, Button, IconButton, Input, Select, Switch, Checkbox, Dialog, Tabs, StatusBar, StatusDot, ProgressBar）+ kit-local `controls.jsx`（MetricStrip · Pagination）与 `icons.jsx`（Lucide 路径）。React + Babel 加载，`index.html` 内路由。
