# 普通交接来源回执与续作审查

基线 `1218e18`；范围见 [Task Frame](../phase0/NORMAL_HANDOFF_RECEIPT_TASK_FRAME.md)。本记录只接受来源回执/续作与只读 Inbox，不把尚未生产调用的移交 adapter 当作完整移交界面。

## 实现与独立责任

- Cloud/protocol 构建：standby_cloud；独立评估：device_architecture_review。
- Host/DB 整合构建：root；Native custody 构建：standby_native；两者独立评估：standby_cloud。
- Native 协调器构建：device_architecture_review；独立评估：standby_native。
- 单一 writer、原 publication mutex 与最终提交栅栏保留；本地只追加 `202611180002`，未改已应用迁移。

## 发现及修复

1. 真正 desktop_login Lease 的 allocation.workspace_id 为 null，原普通切换准入错误拒绝。限定 desktop_login 来源并核对账户默认工作区后准入；跨工作区负向与真实 OAuth 登录路径通过。
2. 屏障不能证明交接成功。新增严格 v2 view receipt，连接唯一 consumed accepted proof、同 source/epoch 且 normal_handoff 释放的 Lease、匹配 target 的历史能力。引导完成/失败后事实仍可读，forced 无回执。
3. 全局最大 epoch 不能代表最后本机 Active epoch。Native floor v2 分开保存；旧 floor 保留原安全边界并将缺失事实留为未知。测试证明 epoch 2 的正常交接无法解冻后来 epoch 3 被强制接管的副本。
4. 只记 proof digest 会在 HTTP 发送前崩溃时永久停住。原 signed body 先保存并读回 Native，再提交公开 attempt，最后 HTTP。重开先 status，只在严格同 request/source/target、未消费、当前 Active/同 epoch/同 barrier/未过期时恢复原 bytes；不签新 proof。没有业务 attempt 的 Native 孤儿可以清理，已提交的 attempt 不可替换。
5. 确定拒绝、目标失败和角色变化分别处理：proof INVALID/EXPIRED/STREAMS_INCOMPLETE 持久阻止重发；成功释放后的目标失败不清源屏障；刷新为 Standby 不能虚报 WritesReopened；后台未成功释放的取消/失败会清屏障。
6. Standby Inbox 使用独立准入，保留现有原子页/确认 token/readGeneration；刷新、撤权与最终提交栅栏拒绝旧准入，retired cursor 重开仍冻结。Provider/Outbox/checkpoint 发布/普通业务写未开放。

7. 扩展后台取消时复查发现旧 barrier clear 直接 autocommit 且丢弃 Host guard。现已改成同 writer 的事务删除、最终 guard、commit；取消和更高 epoch 清理在提交前撤权时都回滚保留屏障。

## 复现证据

- Cloud 独立 PostgreSQL 18.6 三文件 61/61；协议 targeted 69、Cloud targeted 15 通过。构建者完整 Protocol 468 与 Cloud 788 单测通过。
- Host/DB/custody 独立 `cargo test -p gooddealer-local-storage normal_handoff` 11/11；此前 floor 6、switch decoder 5、Native runtime 14 通过；最终清理屏障提交栅栏的 Host/DB 两项回归由独立评估者复跑通过。
- Native 协调器最终独立 15/15、runtime 14/14；相关 crates 全 targets clippy `-D warnings` 通过。
- 最终根 `pnpm check` 通过（`/tmp/gooddealer-handoff-final-verified-check.log`，exit 0）：结构 205、Cloud 788、Desktop 326、protocol 468、client-core 415、local-storage 438/6 项既有 ignored、Native 87。整合工作区同时验证了独立在途 Afternic Core（Core 共 56 项），它不进入本设备提交。Desktop production build、最终 Native/local-storage 全 targets clippy、差异与文档链接检查通过。前期整合检查发现旧 client-core view fixture、独立在途 Afternic 精确 export 清单，以及迁移测试误把 Listing 当作最后一项，均已修复；迁移独立回归 19/19。失败日志不作为接受证据。

## 声明边界与继续工作

OS custody 在 Linux 源码测试中使用独立 test store；不能据此声明真实 Windows/macOS Keychain 或双设备资格。Windows custody 仍 unavailable；目标引导、激活、强制接管、云恢复与交接确认 UI 仍需交付。生产第三签名用途 OpenBao、真实部署与双机路径未验收。

Afternic Core 是独立在途工作，其固定官方 HTTP、解析与 Native 凭据 facade 已经独立审查，但缺少 local-storage/Renderer 组合和真实账号验收，不混入本设备切片提交，不声明可用市场闭环。
