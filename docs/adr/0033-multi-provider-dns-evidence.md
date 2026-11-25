# ADR-0033：DNS Zone 绑定的接替与按委派归属

状态：Proposed，2026-11-24 提出，等待用户决定。本 ADR 被接受之前，下文"现行做法"照常推进，不受影响。

## 背景

GoDaddy 与 Porkbun 都已有 DNS 记录的 Native 只读客户端，提交分别为 9f9e124 和 5880f0f。

现有 Zone 绑定的规则有两条：

- `domain_asset_provider_bindings` 的 `domain_asset_provider_bindings_singleton` 索引保证每项资产最多一个 `zone` 绑定。
- 身份不可变与不可删除触发器覆盖全部绑定行。Listing 迁移只给 `listing` 改用"在用行唯一"索引，触发器没有放宽。

ADR-0027 允许旧 Listing 解除绑定后由新 Listing 接替，同时写明"Registrar/DNS 保持各自单资源唯一性"。台账阶段 2 另列一项：注册商委派观察接入后，与 Zone 分配的 nameserver 比对。

在现有规则内，下面的现行做法可以推进，不需要本 ADR：

- 追加迁移，让连接按官方最小权限事实扩展角色。ADR-0027 允许一个连接承担多种角色，且已记录 Porkbun 的 Read-only 密钥同时覆盖归集与 DNS 读取。
- 只为尚无 Zone 绑定的资产建立非 Cloudflare 的 Zone 绑定。绑定状态为 `unverified`，直到委派核对存在为止。
- DNS 健康按绑定连接选取 `dns_zone_observations`，Cloudflare 原有的投影头保持不变。
- 非 Cloudflare 的证据只留在本地。

这些做法覆盖不了用户把 DNS 从一家平台迁到另一家的情况：旧绑定会永远占位，后来的平台在 `admits_existing` 处失败关闭。

## 决策（提议）

1. **按委派决定归属。**
   - 只有当注册商观察到的 nameserver 属于某平台已核实的权威 nameserver 集合时，该平台的 Zone 绑定才能进入 `verified`。
   - 官方不提供该集合的平台，由用户在界面确认。
   - 委派与绑定不一致时，绑定标为 `conflicted`，不自动改绑。
2. **Zone 绑定可以接替。**
   - 追加迁移，把 `zone` 移出 `domain_asset_provider_bindings_singleton`，改为与 `live_listing` 相同的"在用行唯一"索引。
   - 不可变与不可删除触发器保持不变：旧绑定置为 `detached` 并保留，新绑定接替，两者不能同时在用。
   - 接替只能由决策 1 的委派事实或用户确认触发。

本 ADR 修订 ADR-0027"平台账户与资源模型"一节中"Registrar/DNS 保持各自单资源唯一性"一句的 DNS 部分。被接受时同步更新 ADR-0027 该句；已应用的 `listing_provider_binding.sql` 受迁移校验和保护，保持不变，由新的追加迁移在文件头说明它取代该迁移对 `zone` 的单例语义。

## 可选方案

- **A（推荐）**：接受决策 1 和决策 2，实施顺序为委派观察、绑定接替、界面确认。
- **B**：只采用现行做法，不支持接替。DNS 迁移到新平台后，用户只能看到冲突，无法改绑。
- **C**：只采用决策 1，不支持接替。归属判断更准确，但仍无法改绑。

## 影响

本 ADR 被接受之前，以下工作照常推进：

- Porkbun DNS 读取按现行做法组合。
- GoDaddy DNS 读取在 PAT scope 核实后按同样方式组合。
- 注册商委派观察可以独立推进。

在此之前，已有其他平台 Zone 绑定的资产不能改由新平台承载 DNS，界面需说明原因。
