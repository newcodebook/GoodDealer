# GoodDealer Phase 0 工程基线

状态：Active foundation。本基线定义仓库内可复现的工程边界，不声明外部资格完成，也不把外部资格变成本地实现门槛。

## 目的与适用范围

Phase 0 保留严格协议、模块边界、秘密隔离、失败关闭和可审计的仓库证据。它服务于
[ROADMAP.md](../ROADMAP.md) 中本地业务库、账号控制面、同步恢复和安装绑定备份工作，而不是产品发布阶段。

托管数据库、部署、提供商资格、原生资格、发行与 Gate closure 仍需要各自外部证据；它们只限制相应的外部/公开主张，不限制已定范围的本地 Desktop、Host、Cloud API 或持久化实现开始和继续。

## 当前工程基线与可作出的主张

| 基线 | 当前解释 | 不可由其作出的主张 |
| --- | --- | --- |
| 依赖、工具链与生成来源 | 清单、锁文件、声明的导出和生成来源受仓库检查约束。 | 某个环境已部署或某个构件已发布。 |
| 模块/信任边界 | 应用入口保持薄；领域只经声明的公共合同交互；不可信数据从 `unknown` 验证。 | 客户、提供商或原生运行时已可用。 |
| Cloud 迁移目录 | 中央目录按字面顺序注册 25 项 migration；M015 是规范化商业领域 greenfield baseline，M019 建立 Identity transaction capability，M020 建立 Account access challenge 和加密邮件 outbox，后续 migrations 建立 recovery challenge、commercial entitlement snapshot 和 default-workspace capability policy，不存在 M018 compatibility migration。 | Cloud 是 Desktop 正常业务 Repository，或受管部署已存在。 |
| Secure Host 与本地秘密 | Host 只暴露经拥有者批准的窄操作；秘密不进入普通 TypeScript、日志、错误或非秘密持久化。 | 存在通用网络/文件/数据库权威，或 Cloudflare Token 已被实际使用。 |
| Browser | 浏览器自动化不属于四项 v1 能力；保留的不可用证据只说明其记录的仓库状态。 | 浏览器仍是明确排除的能力，不构成 Provider 或备份回退。 |
| GDBK 备份与恢复 | `gooddealer-local-storage` 的 `DesktopLocalHost` 独占 SQLCipher key、authority continuity、strict GDBK v1、Backup KEK、rollback-anchor capability、native handle/journal、allowlisted candidate/诚实恢复；client-core/Desktop 合同和仅在 `cfg(test)` 编译的 continuity/rebootstrap 协议已组合，生产只保留 fixed-resource residue absence gate。 | 产品备份/恢复/continuity/rebootstrap 已可用，或私有 fake、普通 Keychain/upsert、retained-fd 检查已证明生产 create-only、monotonicity、同 UID swap 防护或目标平台资格。 |
| v1 组合证据 | 当前 slice 已组合 Cloud 的八条公共业务路径、独立 Desktop OAuth/支付 webhook 边界，以及 Desktop Native 的 PKCE、device/refresh custody、Bearer Grant 拉取、Grant/Lease 双重验签与 runtime 激活；共享开发环境另有 Account Web、Stripe test mode、self-hosted worker 与开发 OpenBao 观察。 | 这些组合已形成客户可用产品、生产部署、live 商户路径、生产 OpenBao custody、原生资格、提供商资格、发行或 Gate closure。 |
| Desktop 源图范围一致性 | 生产入口只使用窄本地业务 adapter；Tauri command/manifest/capability 精确一致。 | 未组合 feature、视觉夹具、Cloud business read 或 Provider 凭据是客户路径。 |

当前源码状态应在任何就绪主张前由拥有者重新核验；只能记录精确本地证据，不能以基础记录替代产品、部署或资格结论。

## 工程规则

- 每个领域拥有自己的数据、端口和测试；跨模块只使用声明的公共 API，不建立 `shared`/`common` 权威、深导入或通用 Host bridge。
- 秘密、授权和租户范围失败关闭；Client/缓存/UI/请求参数不拥有或扩大服务器端身份与工作区范围。
- 本地业务、账号授权、同步恢复和 GDBK 工作只等待其本地协议、范围和依赖合同，并按 [PHASE0_EXECUTION_PLAN.md](PHASE0_EXECUTION_PLAN.md) 汇合。
- 不引入别名、临时适配器、双路径、运行时夹具、运行时 `brand/` 依赖、浏览器回退、提供商写入或其他排除能力。

## 验证边界

根 `pnpm check`、拥有模块测试、README/链接/术语检查和 `git diff --check` 形成仓库或本地实现证据。它们不证明托管数据库、生产 OpenBao 集群/key/workload identity、生产 Backup KEK custody、独立 monotonic anchor、true create-only slot custody、safe active-database move detection、原生 handle/fsync/crash 行为、部署、真实 Cloudflare 观察、原生签名/公证、归档、独立审查、`1.0.0` / `stable` 发行或 Gate closure。各外部事实的证据与责任人见 [PHASE0_GATE_REGISTER.md](PHASE0_GATE_REGISTER.md)。
