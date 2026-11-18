# ADR-0019：业务模型、同步结果与存储修复

状态：Accepted

## 业务模型

完整业务模型落在 Desktop SQLCipher Active Workspace：DomainAsset 身份和生命周期、Desired
State、Provider Observed State、Provider 本地账号与凭据版本、Plan/Operation/Attempt/Result、
History、Inbox/Outbox、冲突、墓碑和本地备份目录均由本地拥有。

Cloud PostgreSQL 业务表统一使用 `workspace_replica_*` 语义，并且只保存允许字段、复制进度和恢复
证据。Cloud 不保存第三方账号、Provider Account ID、别名、连接 ID、Credential Binding、密钥、
Token、Cookie、密码、2FA 或 Browser Profile。

本地使用独立 `local_commit_sequence`；Cloud 使用 `server_revision`。字段版本同时记录两者和复制
状态，避免把 Cloud revision 误当成本地事务版本。删除使用显式墓碑，空副本不具有删除语义。
DomainAsset 以 canonical lowercase IDNA ASCII 域名作为 `entity_id`；本地、wire、Cloud 和恢复均
使用同一身份，不保留无法通过副本重建的第二域名身份列。
同步删除是带删除时间的显式 mutation variant，Cloud log 不以“字段为空”猜测删除；ingest 必须原子物化墓碑，不能接受后静默忽略。

## Schema 与证据约束

- Schema 覆盖目标能力不等于启用这些能力；域名 Provider 写入和 Registrar 已纳入首发目标，
  仍需逐项能力合同、资金确认与资格。市场连接已由 ADR-0027 纳入首发；团队和多工作区仍需另行产品决定。
- Provider 观察必须先写本地。允许字段通过重新构造的脱敏值进入 Outbox，不能序列化本地连接行。
- Operation history 区分失败、可重试、等待远端和结果未知；结果未知不能自动重放。
- Provider token 只由获准的操作系统秘密托管持有；本地数据库仅保存非秘密 connection anchor、轮换 intent、代次高水位、授权快照摘要与激活证明，任何账号元数据或 Cloud 投影不得包含凭据字节。
- 未拥有严格 wire/materializer/secret/recovery 验收的 Cloud 副本表不得授予 application role DML。
- Cloud application role 的写权限按列授予；Restore Candidate 证据列不可变，生命周期只能通过
  status/version/updated-at 的数据库状态图和下一版本 CAS 更新；Checkpoint 使用同样的 DDL CAS。
- Provider 批量观察必须保存逐目标结果，观察类型必须与 run capability 一致；运行级 error 不能
  代替 requested/failed/missing 的目标级证据。
- Cloud ACK、Cursor 和 Checkpoint 不参与本地业务事务提交。
- Cloud revision head 必须对应连续 Mutation 区间；提交时仍领先于 head 的 replay/receipt 被 deferred
  constraint 拒绝。application role 不能直接更新 compaction watermark 或删除 replay，只能通过同时
  验证 replay chain、Checkpoint、Cursor、Pin 和 Recovery 水位的受限函数清除已提交前缀，并永久
  保留 Receipt/Drain 证据。
- Backup、Diff、Restore Candidate 和 Checkpoint 使用有 digest 的 section/page/range partition；
  单次数组上限不是提高规模容量的手段。
- 扩展同步实体必须同步更新本地字段状态、wire schema、Cloud materializer、墓碑和恢复测试。

## mutation 拒绝回执与 drain 结果链

1. **Cloud 拒绝回执与原子终结**：只对**单项**推送、且通过身份、租约、wire 与工作区 schema 校验的
   `MUTATION_FIELD_STALE`、`MUTATION_ENTITY_UNKNOWN` 与 ADR-0029 的 `MUTATION_GENERATION_MISMATCH`
   写入拒绝回执。这些业务拒绝映射为 `SYNC_MUTATION_CONFLICT`。
   - 判定与拒绝回执、序号 ledger、连续水位及 drain 记录在**同一个 tenant 事务**中提交；沿用 ingest 的
     锁顺序：租约准入、设备序号 head、工作区 revision。单项业务拒绝返回可提交的结果，不通过会回滚
     整个事务的 `IngestRejected` 抛出。拒绝路径在副本写入与 server revision 分配前结束，不物化业务数据。
   - 拒绝回执持久化成功后才能向 Desktop 返回终止性业务拒绝。存储失败则回滚全部拒绝证据，返回可重试的
     存储错误；客户端保留并重试同一冻结请求。提交成功但响应丢失时，再提交得到同一拒绝结果。
   - 多项批次仍全部接受或全部回滚；业务拒绝时不写任何拒绝回执，由现有批次隔离最终发起单项请求。
2. **统一的序号与 mutation 身份**：接受与拒绝占用同一全局设备序号空间，唯一键沿用
   `(account_id, workspace_id, source_device_id, device_mutation_sequence)`，**不把 Lease epoch 纳入唯一键**；
   epoch 是不可变的提交身份。mutation ID 在 `(account_id, workspace_id)` 内也只能绑定一次。
   - 通过前置准入后，先解析已有的接受或拒绝回执，再判业务条件。同一 mutation ID、设备序号、epoch
     与冻结 wire digest 的重放返回原结果；不同内容返回既有 ID/序号冲突，绝不重写原结果。
   - `workspace_device_mutation_sequence_ledger` 扩展为不可变的结果联合：`accepted` 必须有正整数
     `server_revision` 与接受时间，`rejected` 必须无 server revision 并有白名单 rejection code 与拒绝时间。
     现有接受回执外键仅约束 accepted 分支。数据库 CHECK、唯一键与写权限保证两种结果互斥，拒绝行
     无法用于伪造接受回执；历史记录前向迁移为 accepted，原 wire digest 与回执保持原样。
3. **drain 水位与摘要**：全局设备序号连续水位把两种结果都计入；租约域的 drain ledger 仍按原始 epoch
   记录。为 mutation drain 引入独立、带版本及 domain separation 的结果 envelope，绑定原始冻结 wire 的
   digest 与 `accepted`/`rejected`。拒绝 code 保存在回执中，不进入结果 envelope，避免依赖宽泛的 IPC 错误码
   反推 Cloud 内部 code。Desktop 只有 ACK 或明确的 `SYNC_MUTATION_CONFLICT` 响应落盘后才能记录结果；
   本地未获 Cloud 确认的状态不能自行计入 proof。
   - **冻结的 mutation wire 与其 digest 不变**。结果 envelope 只用于 drain，必须使用独立编码器，不能修改
     当前同时被 mutation 提交证据使用的 `encodeDrainStreamEnvelope` 来偷偷改变已有回执摘要。
   - drain proof/manifest 明确声明新的结果 envelope 版本；新旧版本不可混算。旧 drain 记录保留不重写；
     新版本链从保留的原 envelope 与持久回执重建 accepted 结果，并纳入 rejected 结果。无法重建任何一项
     则失败关闭；旧签名 proof 不升级或重签为新 proof。execution_fact 与 device_audit 的编码保持既有合同。
   - 新版本读写链、历史接受记录兼容与 proof 版本校验全部交付后才启用拒绝回执计入 drain。
4. **不覆盖的拒绝**：输入/schema 错误不生成拒绝回执；ID/序号冲突不生成第二条回执。无法认证、非 Active、
   租约失效、drain 已封存等前置拒绝均不占用新序号。输入与版本错误的本地项保留为 rejected，其序号缺口
   继续失败关闭，走 rebootstrap 或人工处理，不把它伪装成业务冲突。
5. **不新增跳过协议**：Desktop 不能单方面声明序号已放弃，只有 Cloud 持久化的接受或拒绝回执才能结束序号。

## 存储坏行修复

### 修复分类： 按数据性质选择修复方式

- **复制的业务数据**（同步字段）：只通过本设备一次普通的本地编辑修复——写 Outbox 行、经 Cloud
  ingest、由其他副本经 Inbox 应用——不做只改本地的改写，否则副本分叉。今后若发现这类坏行，修复入口
  生成的就是这样一次编辑，服从 Active Lease、generation 与冲突规则。
- **已确认的 Outbox 历史**（`acknowledged`，以及已终止的 `rejected`/`conflicted` 证据行）：不改写、不删除。
  修复写入一条标记，历史读取据此把该行的提交时间显示为“时间无效”，其余列照常校验。未确认的行同样
  只标记：其 wire 已冻结，改写时间会让同一 mutation 有两个版本。
- **不可变的 Provider 观察证据**：不改写、不删除。修复写入隔离标记，读取把被隔离的观察视为没有可用
  观察：注册商名称显示为未知、Zone 显示为未观察、该市场不显示挂牌；更早的观察不顶替它（它描述的是
  平台已离开的状态）。下一次成功的观察照常取代它。
- **本地且不复制的可变字段**（`domain_assets.expires_on`）：改写为 `NULL`（“到期未知”），由下一次
  注册商观察重新写入。它不在 wire 中，改写不会让副本分叉。
- **本地绑定**：不删除、不改身份（两者都由触发器禁止）；修复隔离无效绑定，读取把它视为没有绑定。
  隔离的绑定仍占据该资产的 Zone 绑定位置，所以在本 ADR 范围内不能在其上重新绑定；需要时另行决定。
  绑定行校验也包括它所经由的连接（平台一致、连接名称有效）；连接名称无效时，经该连接的每个绑定都会
  逐一被隔离。隔离一个非 Cloudflare 的活绑定后，该资产此前不参与校验的 Cloudflare 观察开始参与；
  若它也无效，计数在修复后仍不为 0，再执行一次修复即可。

### 修复事务： 修复是用户发起的、可审计的本地事务

- 入口在设置“关于”的计数旁，每类一个“修复”动作；不在启动或后台自动执行，因为它会让某些值变为
  未知或不可用，用户应先看到将受影响的数量。
- Host 命令在一个 IMMEDIATE 事务中用与读取相同的校验谓词重新选出坏行，只处理这些行；计数为 0 时
  幂等返回。Renderer 只发送类别及读取代次，不发送行标识或值；过期 `expectedReadGeneration`、未知字段或
  类别拒绝，最终 Host 提交栅栏再次核对准入，成功修复推进读取代次。
- 每处理一行写一条不可变修复回执：类别、行键、原值的 SHA-256（原值本身不复制进回执，避免把坏数据
  扩散到新表），以及修复时间。回执不进 wire、不进备份白名单以外的位置。
- 修复不需要也不使用任何凭据。

### 校验移除： 读取侧全表校验何时移除

修复与回执交付后，读取跳过已隔离、已标记或已解除的行，其余行照旧失败关闭；所以修复前读取的行为
不变，修复后整页恢复可读。只有同时满足以下两点时，才能移除对应读取的全表校验：写入侧触发器拒绝
该类新坏行；迁移在升级时确认该类未修复行数为 0，否则保留校验。不满足条件时保留读取校验。
