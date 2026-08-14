# GoodDealer 多代理开发工作流程规范与执行计划

状态：Active Process
适用范围：由主对话代理（Master Agent）通过 Specability 运行时编排子代理推进正式编码的全部工作。

## 1. 角色与职责（RACI）

| 角色 | 职责 | 边界 |
| --- | --- | --- |
| 用户（Owner） | 产品决策、one-way-door 决策、Gate 关闭所需的人类动作（真机证据、签名、独立审查、GateClosureAttestation）、最终验收 | `owner_ref` 见 [PHASE0_EXECUTION_PLAN.md §3](phase0/PHASE0_EXECUTION_PLAN.md) |
| Master Agent（主对话代理） | Accountable：意图对齐、任务框架、切片排序、契约裁决、派发/监控/升级、提交前的独立复验、向用户汇报 | **不写业务代码**；不代替 evaluator；不签发任何 Attestation |
| Architect 子代理 | 单个切片的契约与设计决策（Port/DTO/模块边界），产出 design artifact | 只设计不实现 |
| Builder 子代理 | 有界实现任务：代码 + 同切片测试 + 文档同步 | 不得越出 assignment 模块范围；不得触碰 Fallback 禁区 |
| Evaluator 子代理 | 独立验证：不信任 Builder 声明，逐条 criterion 判定 PASS/FAIL/UNCERTAIN | 与 Builder 上下文严格隔离 |
| Reconciler 子代理 | 文档与实现漂移校正（按需） | 只在 Master 判断有漂移风险时使用 |

## 2. 运行时协议（Specability）

所有第一级子代理必须由 SQLite 运行时的 assignment 和 handoff packet 背书，禁止手写弱化 prompt 替代。

标准派发路径：

```text
specability task start "<任务描述>" --execution-mode <mode> --recording-mode <mode> --json
specability delegate --stdin --json     # 一次性完成 assignment + ready review + handoff packet
# 用返回的 hostSpawn.payload 作为 Agent 工具的完整 prompt 启动子代理
# 子代理首个动作：specability agent start --dispatch <dispatch_id> --host claude --json
```

- assignment 必须包含：role、name、objective、desired-outcome、done-when、至少一个 deliverable、至少一个 success criterion；已知的 modules / context / constraints / open questions 不得省略。
- **workProfileKeywords 必填**（凡可能触及门禁面）：用具体表面事实描述，如 `stored user content`、`OS keychain`、`auth token`、`SQLite migration`、`tenant isolation`、`Tauri IPC command`；框架名（React/Fastify）只是次要上下文。涉及凭据、信任域、认证的 assignment 会被运行时强制路由 security-review advisor，其威胁面记录是 Builder 契约的一部分。
- 派发不是 fire-and-forget：派发后用 `specability task recover --task <id> --json` 监控；`needs_input`/`blocked` 的子代理在等待答复，必须及时读取并解决。
- 子代理不与用户对话。可逆且在授权范围内的决策自行保守选择并记录假设；实质改变目标/边界/安全态势/验收证据的决策一律升级给 Master，由 Master 决定是否上升到用户。

## 3. 质量闭环（PDCA + 熔断）

1. Evaluator 独立评审，逐条 criterion 给出结构化判定；FAIL 必须附复现步骤。
2. 每轮修订只针对一个具名 finding，重新派发 Builder（范围限定到该 finding）。
3. 复验必须用**新的** Evaluator（职责分离），不接受"Builder 说已修复"。
4. 熔断：≤2 轮不收敛即停止重试，携带轮次历史升级给用户。
5. Master 最终验收前必须亲自跑一次新鲜验证（至少根 `pnpm check`），不接受任何自报结果。
6. 任务收口：`specability task finish --status <done|concerns|blocked|needs_input> ...`，并向用户提交整合的 Task Outcome Report（目标回顾 / 执行摘要 / 结果影响 / 验证证据 / 残余风险 / 收口判断），不转发子代理流水账。

模型选择：Builder 一律走 Codex 子代理（`codex:codex-rescue` 转发，`--model gpt-5.6-sol --effort high --write`），handoff packet 以 `--host codex` 生成后作为任务文本一次性转发；Evaluator 与 Architect 用 Claude opus（独立性与跨模块判断）。Builder 与 Evaluator 因此天然跨模型，进一步强化职责分离。

## 4. 项目特定约束（叠加在 Specability 协议之上，全部进 handoff packet 的 constraints）

1. **契约先行**：每个纵切以冻结 `packages/protocol` 契约开头；契约未冻结，消费端 Builder 不启动。
2. **不越 Gate**：所有 Fallback 保持——生产 Endpoint Registry deny-all、不接真实凭据、不产生真实外部写入、Admin Route 不注册。子代理无权解除任何 Fallback。
3. **根门禁**：每个切片必须通过根 `pnpm check`；原生/Cloud 事务结论必须走 [PHASE0_EXECUTION_PLAN.md §4](phase0/PHASE0_EXECUTION_PLAN.md) 对应环境 Profile，Portable 单测不能替代。
4. **工程规则**：`AGENTS.md` 全文对每个子代理生效（命名、边界、`unknown` 校验、fail-closed、秘密不入 TS/日志、测试随模块、不改生成文件）。
5. **证据纪律**：子代理报告不构成 Gate 证据；Gate 状态只以 [PHASE0_GATE_REGISTER.md](phase0/PHASE0_GATE_REGISTER.md) 为准。真机安装、签名/公证、长期归档、独立 Security Review、GateClosureAttestation 是人类动作，识别到即升级用户，不得由代理模拟。
6. **文档一致性**：切片落地时同步更新受影响的 docs/契约/示例；文档只描述当前有效状态。
7. **单人 Owner 现实**：`owner_ref` 全部为同一人，Gate 要求的"独立 Reviewer/Approver"不能由子代理充当；涉及时升级用户决定处理方式。

## 5. 执行计划

### 5.1 当前锚点

- P0-05（Port DTO → Tauri Adapter → Rust Handler 最小纵切）已完成并进根门禁。
- P0-06 compile-check 集合已完成；R0-11 仍 In Progress（缺真机打包/签名/归档/Attestation）。
- P0-07（SQLCipher）Hosted 三平台 bundle 技术证据已完成，仍缺 Windows 11 24H2 真机、签名/公证、长期归档、独立 Security Review 与 Attestation；**收口前不进入 P0-08**。
- WS-A、WS-B、WS-C 的首批实现/审计均已完成；`pnpm evidence:wp2` 已建立 account-gate Portable/Cloud Fixture 证据生产器，但不解除任何 Fallback。
- Gate 台账无 Closed 项；生产能力全部处于 Fallback。

### 5.2 工作流（Workstream）划分

按"无共享契约可并行、不得越过前置 Gate"的规则，首批三个工作流：

| WS | 内容 | Gate 依赖 | 编排形态 |
| --- | --- | --- | --- |
| WS-A（已完成） | 设计系统迁移：按 `brand/` 事实源在 `packages/ui` 建立生产组件与 token 接线，替换占位实现 | 无 | 生产组件、token 与测试已进入根门禁 |
| WS-B（已完成首纵切） | P0-15/P0-19 账号门禁与 Auth 纵切：冻结 `protocol/account`、`protocol/devices` 契约与 Auth DTO；建立 cloud `identity/licensing/devices` Fixture、client-core `runtime-mode` 只读消费端及 `pnpm evidence:wp2` | R0-06/R0-16（Fallback 内实现，不解除） | 仅 Portable/Cloud Fixture；不含密码输入、Keychain、生产 Route 或真实凭据 |
| WS-C（已完成审计） | P0-07 收尾审计：三平台 Artifact 与 Manifest 技术资格已核对，剩余人类动作已列明 | R0-08/R0-16 | Hosted 技术证据不替代真机、签名/公证、长期归档、独立审查或 Attestation |

上述首批工作流已经收口；下一波仍按“无共享契约可并行、契约先行、不得越 Gate”执行。

### 5.3 每个切片的固定节奏

```text
契约冻结（Architect） → 实现+测试（Builder，对 Fixture） → 独立评审（Evaluator）
→ Master 新鲜验证（pnpm check + 抽查） → 文档同步 → Task Outcome Report → 用户验收
```

### 5.4 已知升级点（需要用户决策/动作）

- Windows 11 24H2 真机打包与安装证据（P0-06/P0-07）。
- 签名/公证身份与受保护环境（Release Engineering）。
- 长期不可变归档位置与流程。
- Gate 独立 Reviewer/Approver 的现实安排（单人 Owner 与独立性要求的冲突）。
- W5 真实写入前的 TP 测试账号与可丢弃资产准备。

### 5.5 后续波次

当前按 [PHASE0_EXECUTION_PLAN.md §2](phase0/PHASE0_EXECUTION_PLAN.md) 进入 W2：先做 P0-16 的 Bootstrap、DeviceSwitch、Lease 与 Key lifecycle Fixture/contract 纵切，再推进设备同步、Query 与 Cloud Boundary。其后依次为 W3（Backup/Recovery、Tenant Job）→ W4（双引擎 Browser/Consent/Ticket）→ W5（Connector 与受控真实写入，内部顺序固定）。每个波次开工前由 Master 重新对照 Gate 台账确认前置未被越过。
