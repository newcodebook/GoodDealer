# ADR-0006：工程所有权、运行时与信任边界

状态：Accepted

## 模块与运行时所有权

应用入口、路由、命令处理器和组合根保持薄；领域逻辑不依赖宿主，业务模块拥有自己的数据、端口、合同和测试。
跨模块只能使用声明的包导出、合同或端口，不得深层导入或访问其他模块的 repository；不建立泛化的
`shared`、`common`、`utils` 或通用权威来绕过所有权。

- `apps/desktop` 组合 Tauri/React、Native OAuth 与脱敏 IPC；`local-storage` 拥有 SQLCipher 路径、
  密钥、数据库身份、事务和本地业务数据。
- `apps/cloud` 拥有身份、商业授权、设备控制与允许字段的同步副本；领域模块通过窄端口注册路由和作业。
- `packages/protocol`、`client-core`、`cloud-client`、`ui`、`i18n` 分别拥有合同、领域模型、运输、展示和文案，
  不拥有生产组合或原生秘密。
- `secure-host-core` 拥有 OAuth custody、设备身份、授权验证及具名平台 Service。备份与恢复完全归
  `local-storage`；不得经 `secure-host-core` 建立备份桥接或通用解密接口。
- `DesktopLocalHost` 保持单一数据库所有者及最终提交栅栏，在 crate 内按授权、业务、同步、Provider 协调、
  备份与恢复拆分私有实现；拆分不能打散原子事务或扩大公开接口。

## Cloud 入口隔离

客户公开面、内部管理面和后台作业使用独立身份、授权、路由和组合边界。可以复用严格合同和拥有模块的端口，
不得共享无租户范围的数据库访问、会话或业务权限。每个入口验证不可信输入、服务器端租户范围和副作用证据；
通用 job runtime 不解释领域 payload。

## 网络与秘密

外部操作由拥有模块固定目的、HTTPS origin、路径、method、输入输出、秘密作用域和最小权限。调用方不得选择
任意 URL、主机、端口、代理、凭据注入或适配器，配置与生成物也不能扩大网络权威。具名平台的官方和私有
HTTP 适配遵循 [ADR-0027](0027-multi-platform-domain-providers-and-marketplaces.md)。

秘密原值、引用、密钥材料和秘密响应只留在受限 Native 所有者内。Renderer 和普通 TypeScript 只接收最小、
脱敏且目的明确的结果，不持有秘密、不选择秘密存储位置、不调用通用秘密或密钥链接口。输入从 `unknown`
严格校验，未知字段与无效 wire 失败关闭；日志、错误与非秘密持久化不得泄漏秘密。

Rust 默认保持 `forbid(unsafe_code)`。唯一例外是 `secure-host-core` 私有电源通知边界：该 crate 根使用
`deny(unsafe_code)`，仅 `src/native_power/windows.rs` 与 `src/native_power/macos.rs` 可覆盖。例外只允许
注册/注销固定系统休眠与唤醒通知、读取固定通知名，以及实现所需的固定回调；不允许凭据托管、任意 FFI、
外部回调注册、OS handle 导出或外部 payload 解引用。Windows Credential Manager 不在例外中。

电源通知所有者留在 Native 主线程；其他 Native 模块只持有 ready/paused/epoch 的安全门禁和有界变化通知。
系统事件先发布原子失效意图，再协调短提交栅栏；旧 epoch 在休眠和唤醒后都不能重新获得发送能力。
最终本地提交与 epoch 发布线性化，事件回调不访问业务库、秘密、Cloud 或 Provider；任何网络等待不持有该栅栏。
销毁先永久关闭门禁，再注销通知；并发或晚到回调不得解引用已释放对象，也不得重新启用执行。
注册失败拒绝新写入，已经发送的操作只在当前授权下继续只读对账；关闭与实际暂停仍拒绝新的本地步骤。

两处 unsafe 文件须逐处说明生命周期、线程及内存安全依据，并接受独立审查、精确文件清单检查与各目标编译。
真实休眠/唤醒及请求途中暂停须分别在 Windows/macOS 取证，Linux 测试不能替代。若可验证的安全平台封装能提供
相同通知及时性和生命周期保证，应移除本例外；其他新增 unsafe 边界仍需修改对应最终 ADR 和独立审查。

## 工程与证据

版本控制的清单、锁文件、工具链和结构检查共同保证可复现构建。变更同步更新合同、配置、测试、生成源与当前文档，
生成文件从源重新生成。仓库检查只证明运行过的范围；原生秘密托管、真实 Provider、部署和发行须有绑定最终构件
或环境的独立证据。工程基线见 [Phase 0](../phase0/PHASE0_ENGINEERING_BASELINE.md)。
