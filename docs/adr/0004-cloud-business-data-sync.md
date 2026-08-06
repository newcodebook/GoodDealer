# ADR-0004：服务端同步可读的域名业务数据，凭据保持设备本地

状态：Accepted, amended by ADR-0005  
日期：2026-07-31

## 背景

日常账号/Cloud 路径允许一个账号绑定两台设备，但按 ADR-0005 任意时刻只有一台 Active 设备拥有修改与平台执行权；Standby 可以只读查询云端业务数据。正式停服后的 LocalContinuation 使用独立 Sunset 本地授权，不参与本 ADR 的 Cloud 同步与双设备协调。依靠用户手动传递和恢复完整备份无法提供自然的设备交接体验，也无法方便地支持未来的域名资产展示功能。

域名资产信息泄露通常不会直接赋予攻击者注册商、DNS 或销售平台的操作权限。产品决定接受服务端可读取域名与商业数据的隐私风险，优先换取可靠的跨设备同步、服务端查询以及未来公开展示能力。

## 决策

- GoodDealer Sync Service 强制同步域名、Portfolio、价格、Listing、业务状态和已脱敏操作记录。
- 同步业务数据不做端到端加密，服务端可以读取和处理。
- HTTPS、服务端数据库/磁盘/备份静态加密仍是强制安全基线。
- API Key、OAuth Token、Cookie、密码、2FA、Auth Code、Browser Profile、数据库密钥和 Recovery Secret 永不上传 GoodDealer 服务端。
- 活动设备维护完整 SQLCipher 工作库，通过 Mutation、Revision 和 Device Cursor 增量同步；Standby 只使用只读 API、Reader Cursor 和可丢弃缓存。禁止同步数据库文件。
- ProviderConnection 的非秘密元数据共享；DeviceCredentialBindingStatus 只存在本机 Active Workspace，DeviceCredentialCandidateStatus 只存在普通本机加密状态并供 Standby 显示非秘密存在性提示，HostCredentialBinding 只存在 Rust Secure Host；三者均不上传 Cloud。
- 日常账号/Cloud 路径由 ActiveDeviceLease 和单调递增的 Lease Epoch 保证只有当前 Active 设备产生 Mutation、读取平台、批准和执行任务；Standby 只读取云端已有快照。不再为每个 Operation 申请执行租约。Sync Service 不持有凭据，也不调用域名平台。
- 云端同步状态不能直接触发平台副作用；外部写操作必须由执行设备本地预览并签署 ApprovedOperation，默认不跨设备迁移批准。
- 产品保留本地加密备份文件导出/恢复，不集成第三方远程备份服务。
- 云同步不等于公开展示；未来 Publication Projection 必须由用户显式选择和发布。

## 结果

优点：

- 两台绑定设备无需切换即可查看云端资产、价格和状态；切换活动权后才能编辑和访问平台。
- 服务端可以执行增量同步、恢复候选、设备协调和未来资产展示查询。
- 集中服务不持有能够直接操作域名平台的凭据，降低服务端被攻破后的直接资产控制风险。
- 第二台设备只需重新配置凭据，不需要迁移整个数据库。

代价：

- GoodDealer 成为域名资产和商业数据的数据处理方，需要承担访问控制、隐私、删除、保留和泄露响应责任。
- 服务端入侵或内部权限滥用可能暴露域名清单、成本、价格、状态和投资策略。
- 本地执行与云同步架构增加云端 Schema、Mutation Log、ActiveDeviceLease、恢复候选和运维成本。
- 云端数据不能恢复未同步的平台凭据、Cookie 和浏览器会话。

## 不采用的方案

### 业务数据端到端加密

不采用。它会限制服务端查询、展示和未来产品能力，且产品负责人接受普通域名资产数据由服务端读取。

### 完整备份文件作为日常同步

不采用。加密备份只用于用户主动导出和灾难恢复，不承担实时多设备冲突与任务协调。

### 云端同步平台凭据

不采用。平台凭据具有直接资产操作能力，继续严格保持设备本地。

详细设计见 [账号、设备与云同步](../ACCOUNT_AND_SYNC.md)。
