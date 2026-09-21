# ADR-0006：按所有权和信任边界组织工程结构

状态：Accepted.

## 决策

应用入口和组合根保持薄，领域模块按业务能力拥有数据、端口、协议和测试。跨边界只能使用
声明的包导出、合同或端口；不得通过深层导入、直接访问其他模块数据库或泛化共享权威绕过
所有权。

## 当前结构

- `apps/desktop` 拥有 Tauri/React 本地业务组合、SQLCipher Repository、Native OAuth 与脱敏 IPC。
- `apps/cloud` 拥有模块化持久化、公共业务/OAuth/webhook 边界入口，以及 Licensing provider inbox/
  reconciliation 两个窄周期作业定义；通用 job runtime 不解释这些领域 payload。
- `packages/protocol`、`client-core`、`cloud-client`、`ui` 和 `i18n` 各自拥有严格合同、
  模型、展示或文案，不拥有生产组合。
- `secure-host-core` 公开 OAuth custody、授权验证与非秘密 Cloudflare 观察合同，不包含备份实现或依赖；
  `local-storage` 的 Desktop Local Host 独占备份 authority、GDBK/KEK、native handle/journal、投影、
  candidate 和 restore，`automation-host` 不可用。

## 后果

未来产品能力必须在其实际所有者中新增最小 API，并同步更新协议、测试、配置和当前文档。
任何外部资格仍需独立证据；仓库结构不形成部署、原生、提供商或发行结论。
