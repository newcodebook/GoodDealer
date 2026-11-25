# Afternic 持久上架与改价独立审查

2026-11-19。工作包见 [TaskFrame](../phase0/AFTERNIC_LISTING_WRITE_TASK_FRAME.md)；Native独立调用链见 [专门审查](2026-11-19-afternic-listing-native-review.md)。本记录区分源码组合、真实数据库、当前Linux账号、目标系统与发行资格。

## 已交付的实际组合

同一Afternic连接与已存在资产 → 完整库存来源的15分钟持久预览 → 每项显式四字段create或所选键update → 一次整批批准 → 同事务真实签名approval/audit → 单次claim及fact/audit → 原ProviderLane精确GET、唯一POST/PATCH、写后GET → 原绑定/观察/结果/审计最终栅栏原子提交 → UI持久历史与详情。未知HTTP/崩溃后只GET，不重发写入。

字段匹配和平台状态分开：PENDING/INACTIVE/UNKNOWN/ON_HOLD继续平台等待，OWNERSHIP_REVIEW/UNVERIFIED继续待验证，SOLD/合规/所有权冲突不能变成上架成功。新增目标、改价与所选字段变化必须重新预览。下架与create/update互斥未决目标，沿同一绑定repository与writer。追加本地006保留旧remove签名字节和FK；Cloud030/031延伸两个原证据流，不建第二writer或任意签名/代理。

## 独立接受与复现

- Storage/Host由device_architecture_review实施；root独立追踪预览hash/真实批准/一次claim/原fact关联/绑定代次/平台状态/最后栅栏。新binary专项19/19通过，包含实际SQLCipher关闭重开、并发批准/claim、前像漂移、跨create/update/remove、未知结果及两流drain。Cloud另独立静态复核，并将Host实际输出84条DTO送公开client-core strict parser，84/84通过。
- Native/Core由standby_native实施，device_architecture_review独立沿三个raw IPC、同lane、每个await/power/cancel/authority检查、精确slot和固定signing purpose复核，Tauri153/153通过；原样Windows GNU三个crate严格Clippy为交叉编译证据。
- Cloud/protocol/client合同由standby_cloud实施；device_architecture_review独立协议14/14，PG18.6专用profile三个action实际production stream矩阵51/51，日志 `target/storage-independent-cloud-afternic-pg-final.log`。错purpose/action、跨租户、旧epoch/撤销、direct SQL私密字段、并发和seal继续失败关闭。
- root客户入口/adapter/i18n由Native独立Desktop48、client18、i18n19及三模块typecheck通过；Cloud独立54项中1项精确权限顺序断言失败由root修复后6/6复跑。Host与UI不以字段匹配推导上市/所有权。

## 收敛发现及待完成验证

root全量检查发现命令顺序断言和browser证据收集器遗漏3个新命令，均已修复精确清单/源输入，无权限放宽。TaskFrame中“原已发GET继续”的普通文档措辞已按ADR-0032修正：交接barrier冻结来源流后迟到响应不能追加旧epoch结果/审计，未来取得新Active时重新GET。ADR0027的Linux交叉引用同步到已接受的ADR0025具名Afternic托管。

新鲜根 `pnpm check` exit 0（`/tmp/gooddealer-listing-write-root-check-diagnostic-final.log`）：TypeScript 2422、结构214、Storage590/0失败/6既有ignored、Native153、automation53、Core92/2既有ignored及public surface3通过。此前Rust默认并发586通过/4失败/6既有ignored的失败均在fixture开库SchemaRejected，尚未进入业务；同binary四项4线程、组合70项12线程及本次完整默认并发均通过。初始失败原因未确定，保留cfg(test)固定migration/stage/SQLite代码诊断，不把未复现当作已定位修复。运行后恢复006既有错误文案的原字节（SHA256 `23cbe9142768db80888350865aa1d42e9e7c0d31cd9342437ee79d47b27dd720`），故主目录整合后须对最终精确源码再跑根检查。

真实账号/wecin.com官方读写、私有所有权验证和必要DNS尚未完成；Windows/macOS实机/休眠与发行资格仍开放。当前Linux应用已使用部署确定性公开registry编译启动，已恢复现有登录且设备Active；界面仍拒绝连接，真实业务尚未开始。现有开发Cloud商业catalog也未含Afternic observe/write；不能绕过真实商业权威。生产qualification清单保持空，受控首次取证另成完整工作包，不把开关或fake当作交付。
