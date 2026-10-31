# ADR-0025：Linux Desktop 使用 Secret Service 托管启动与登录秘密

状态：Accepted

## 背景

Desktop Host 的原生秘密托管此前只实现 macOS 数据保护 Keychain；其他平台的 `load/store`
统一返回不可用，Host 在创建本地数据库前失败关闭。结果是 Linux 构件可以编译，但无法启动，
也无法完成浏览器登录。ADR-0012 要求任何新平台的原生秘密存储先有具体设计决定，本 ADR
即为 Linux 的该决定。

## 决策

Linux 构件通过 freedesktop Secret Service（GNOME Keyring、KWallet Secret Service 等会话总线
实现）保存以下且仅以下条目：

| 条目 | 所有模块 | 说明 |
| --- | --- | --- |
| `com.gooddealer.desktop.local-database` | `gooddealer-local-storage` | SQLCipher 数据库 key |
| `com.gooddealer.desktop.rebootstrap` | `gooddealer-local-storage` | 只读检查残留；Linux 不写入 |
| `com.gooddealer.desktop.device-identity` | `secure-host-core` | 设备 Ed25519 seed、Device ID、Key ID |
| `com.gooddealer.desktop.local-host-binding` | `secure-host-core` 写、`local-storage` 读 | 安装绑定摘要 |
| `com.gooddealer.desktop.oauth-refresh` | `secure-host-core` | OAuth refresh custody |
| `com.gooddealer.desktop.local-workspace-binding` | `secure-host-core` | 本地工作区绑定 |

Cloudflare 凭据（`cloudflare.dns.v1`）、备份 KEK 与 rebootstrap 写入在 Linux 上保持
`unavailable`，需要各自的后续决定。

### 适配器约束

- 每个 crate 保留私有、目的绑定的适配器，不在 `secure-host-core` 公开面增加通用秘密或密钥链
  API（ADR-0010）。适配器只接受代码中的固定 service/account 常量。
- 连接只走会话总线并强制 Diffie-Hellman 加密会话；不提供明文传输回退。
- 条目以精确属性 `{application, service, account}` 标识，`application` 固定为
  `app.gooddealer.desktop`，内容类型固定为 `application/octet-stream`。
- 读取在所有集合中按精确属性搜索：零个匹配为“不存在”；恰好一个已解锁匹配才返回值；任何锁定
  匹配返回不可用；多个匹配（含其他集合中的同名条目）视为被植入或状态不确定并拒绝。返回前复核
  条目的三个属性逐一相等。
- 写入只进入默认集合并替换同属性条目，写后重新读取并逐字节比较；不一致即拒绝。
- 默认集合锁定、服务不存在、会话总线不可达或握手失败时一律返回不可用。本版本不主动弹出解锁
  提示：登录密钥环通常随会话解锁，锁定即对应 macOS `WhenUnlocked` 的失败关闭语义。
- 秘密值只在 `Zeroizing` 缓冲中借用；错误与日志不含 service、account、属性值或秘密内容。

## 与 macOS 的差异与残余风险

- **无按应用访问控制。** Secret Service 不把条目绑定到签名应用；同一用户、可访问会话总线的
  任何进程都能读取这些条目。macOS 数据保护 Keychain 的 designated requirement 绑定在 Linux 上
  没有对应物。同 UID 代码执行因此可取得数据库 key、设备 seed 与 refresh custody；Linux 构件的
  秘密边界等同于“当前用户会话”。
- **非同步不可证明。** Secret Service 集合通常是本机文件，但第三方后端可能把数据库同步到别处，
  Host 无法检测。
- **Flatpak/Snap 沙箱** 需要 Secret portal，本决定不覆盖；在沙箱中不可达即失败关闭。
- 本地 Linux 测试与运行只证明适配器行为，不构成发行资格；Linux 发行仍受 Q-NATIVE 原生资格和
  独立审查约束。

## 后果

Linux 构件可以启动、创建加密本地数据库并完成浏览器登录；Provider 凭据、备份与 rebootstrap
在 Linux 上仍不可用。任何把 Cloudflare 凭据或备份 KEK 纳入 Secret Service 的扩展，必须先更新
本 ADR 的条目表并说明对应的威胁接受。
