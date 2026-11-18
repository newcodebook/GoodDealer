# 阶段 5 多平台共用框架：Task Frame 与切片

按 [ADR-0027](../adr/0027-multi-platform-domain-providers-and-marketplaces.md) 交付十二平台与整批一次确认。
十二平台读取合同及 manifest 已补齐，实际 Service 按用户旅程优先级实施；官方能力缺口直接进入自研私有 API 开发。

产品负责人于 2026-11-16 决定：阶段 5 的**框架源码**可先于阶段 4 V1 汇合验收进行，前提是框架不开放任何
平台能力的执行路径——每项能力在资格认证（ADR-0027）前不可用并说明原因，生产入口没有可执行路径。
Cloudflare 的 Registrar、DNS/DNSSEC 写入与监控（台账第 213–217 行）需要与所选接入方式匹配的合同证据与真实资格，
仍按阶段 4 进入条件暂停。本文件是阶段 5 框架项（台账第 206–212 行）的 Task Frame；任务状态只记在
[执行台账](PHASE0_EXECUTION_PLAN.md#5-多平台共用框架与-cloudflare-全能力)。

## Task Frame

| 字段 | 内容 |
| --- | --- |
| 目标与允许声明 | 交付 ADR-0027的共用模型：平台连接与四种角色、`listing` 绑定、能力目录与每平台 manifest 骨架、资格登记、跨平台所有权验证计划、对账任务、逐笔资金确认（含出价）。允许声明：“框架模型与合同已实现并有负向测试，全部能力不可执行”。不允许声明任何平台能力可用、已资格化，或阶段 5 完成。 |
| 固定范围与非目标 | 十二个首发平台（ADR-0027）；不做代理/自动出价、浏览器自动化、CSV 导入、凭据迁移、清单外平台；不写平台事实（端点、scope、幂等、价格）——它们由各平台 Service 从官方合同或当前账户私有协议证据取得。 |
| 拥有 runtime 与信任域 | 能力目录与 manifest 合同：`packages/protocol`（connectors）。角色与资格的权威：Host（`local-storage` 的资格登记与设置读取，`secure-host-core` 的平台 Service）。展示：Desktop Renderer 只渲染 Host 结论。 |
| 合同与输入 | 目录与 manifest 是经审查的静态清单，不是执行许可；Host 读取对未知角色、未知平台、重复角色失败关闭；Renderer 从 `unknown` 严格校验 Host 读取。 |
| 源码现状（2026-11-17） | 协议目录 v1 只有 registrar/DNS/监控 16 项、无角色字段、无市场与获取能力；Host 资格登记为空（`capability_qualification.rs`）；设置读取只接受 `registrar`/`dns`/`marketplace` 三种角色，声明 `acquisition` 的连接让读取失败；绑定只有 `zone`/`registration`；没有平台 Service 框架。 |
| 依赖与共享面 | 共享面：协议 connectors 导出、本地迁移目录、i18n 清单计数、设置合同。整合负责人：主代理。各切片按顺序交付，不并行修改同一共享面。 |
| 本地验收 | 每个切片：模块测试与负向测试、根 `pnpm check`（umask 002 与 022）、Rust fmt/clippy/测试、`git diff --check`、当前态文档同步。对应 [VERIFICATION](../VERIFICATION.md#多平台交付阶段验收) 阶段 5 行的框架部分。 |
| 外部资格 | Q-CF（Cloudflare 能力）、Q-PROV（其他平台）；框架不产生也不替代任何资格。 |
| 收敛与接受 | 每个切片由独立评估者给出 PASS 后提交；台账逐行勾选。 |

## 切片

- **F1 能力目录 v2、每平台 manifest 骨架与 `acquisition` 角色**（台账第 206 行、第 208 行的 manifest 部分）：
  目录每项带角色，覆盖 ADR-0027“完整域名能力目录”的注册商、DNS、交易市场、获取与监控能力；manifest 为 十二个平台 ×
  全部目录能力逐项给出不可执行原因（平台事实待核对、待资格认证）；设置读取与界面接受 `acquisition` 角色。
- **F2 `listing` 绑定资源类型**（第 207 行）：本地迁移、连接身份进入 Listing 唯一键。
- **F3 平台 Service 骨架与资格登记**（第 208 行其余部分）：`secure-host-core` 中 十二个私有 Service 的准入入口，
  未资格化时一律拒绝；资格登记按 manifest 能力标识校验。
- **F4 跨平台所有权验证的本地操作计划**（第 209 行）。
- **F5 对账任务模型**（第 210 行）。
- **F6 逐笔资金确认组件（含出价）**（第 211 行）：现有通用报价确认不含拍卖、出价金额与拍卖结束时间；任何出价、
  补抢或购买路径出现前，确认必须绑定这些字段（ADR-0027“资金与高影响操作”），设置界面“每次出价单独确认”的说明以此为准。
- **F7 负向测试汇总**（第 212 行）：越权、跨租户、伪造 grant/bid、角色串用凭据、批量部分失败。
