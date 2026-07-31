# ADR-0005：最多两台绑定且仅一台执行

状态：Accepted  
日期：2026-07-31

## 背景

GoodDealer 强制同步域名业务数据，但平台 API Key、Cookie 和 Browser Profile 只存在设备本地。如果两个客户端并行运行同步、平台读取和外部写任务，会产生平台配额竞争、重复提交、Desired State 相互覆盖和复杂的逐 Operation 协调。

同时，完全依赖 GoodDealer 云端在线会让单设备用户在服务故障时无法改价或紧急下架。终身 License 若永久依赖在线 Lease，也会在 GoodDealer 停运后失去长期可用性。

## 决策

- 云同步是产品基础能力，不提供永久关闭或纯本地模式。
- Windows、macOS、iOS 和 Android 合计最多绑定两台设备，任意时刻只有一台活动设备拥有业务修改和平台执行权。
- Standby 可以使用 Cloud Read-Only View 查看 GoodDealer Cloud 已有资产、状态、告警和任务进度，但不能产生 Mutation、读取外部平台、批准操作或执行任务。
- 服务端为账号签发 `ActiveDeviceLease`，使用单调递增的 `lease_epoch` 隔离设备代际。
- 活动设备获得最长 24 小时的签名离线执行许可。GoodDealer 云故障时可继续平台读写；许可到期后暂停新的平台访问。
- 正常切换先停止领取任务、完成或隔离当前原子步骤、上传 Outbox 并释放 Lease，然后递增 Epoch 并激活新设备。
- 旧设备不可达时，强制切换必须等待旧设备的 `offline_execute_until` 到期，不能立即给新设备并行写权限。
- 不再为每个 Operation 申请云端执行租约。Worker 校验 ActiveDeviceLease、Epoch、本机签名 ApprovedOperation 和本地资源锁。
- 旧 Epoch 的 Operation 结果和审计事件作为 `LateExecutionEvent` 追加保存；可变业务修改成为 `StaleDeviceCandidate`；备份差异成为 `RestoreCandidate`。后两者不能静默覆盖云端。
- 只有活动设备读取平台；切换时同步非秘密限流摘要，避免新设备立即重复刷新。
- GoodDealer 账号采用消费级安全：邮箱验证、安全密码哈希、限流、Refresh Token 轮换、会话/设备管理和可选 Passkey，不要求 TOTP 或强制 2FA。
- License 过期后客户端完全锁定，但账号网页端继续提供服务端数据的合规导出、删除和安全管理。
- 永久停运时通过隔离的 Sunset Signing Key 提供本地延续版本或永久离线凭证；`LocalContinuationMode` 取消账号、Lease 和云同步依赖。

## 结果

优点：

- 从结构上消除两台 GoodDealer 客户端同时读取或写入平台的常规竞争。
- Standby 无需切换即可查看资产、状态、告警和任务进度，适合移动端轻量访问。
- 不需要按 Operation 建立分布式租约和隔离令牌，执行模型更简单。
- 单设备用户在 GoodDealer 云短时故障期间仍可继续核心平台操作。
- 设备切换、旧设备恢复和备份恢复都有明确且可审计的边界。

代价：

- Standby 只能查看云端已有数据；编辑、正式批准、平台刷新和自动紧急下架仍必须显式切换。
- 活动设备丢失时最长等待 24 小时才能安全强制接管。
- 桌面双机用户若已占满额度，不能再绑定手机，除非移除一台或未来调整商业额度。
- 强制云同步缩小了“完全不向 GoodDealer 提交业务数据”的目标用户范围。
- 停服延续承诺需要长期维护独立签名密钥、发布流程和商业条款。

## 不采用的方案

### 两个客户端并行执行

不采用。它需要协调双倍读取配额、并发 Desired State、逐 Operation 租约和多个本地凭据副本，复杂度与风险高于当前产品收益。

### 云故障立即停止全部平台操作

不采用。它会让单设备用户的核心功能被 GoodDealer 短时故障绑架。24 小时许可是连续可用性和强制切换速度之间的折中。

### 永久纯本地模式

不采用。它与默认多设备同步、设备门禁和统一账号产品模型冲突。永久停服时的 `LocalContinuationMode` 是特定 Sunset 机制，不是日常可选模式。

详细设计见 [账号、设备与云同步](../ACCOUNT_AND_SYNC.md)、[操作编排](../OPERATIONS.md) 和 [License](../LICENSING.md)。
