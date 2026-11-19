# 开发 Cloud 五用途授权部署独立审查

日期：2026-11-19。实施：standby_cloud；独立脚本与发布边界审查：root。

用户明确授权自行核对现有环境变量/VPS，并在开发密钥丢失时重新生成。实施使用隔离 OpenBao v2，未覆盖原 Raft、数据库卷、其他站点或秘密。受控材料不进入仓库/日志；公开 registry 的本地与已部署生成摘要一致。

root 复核单次 cutover 脚本：固定 clean `f872727` release、原 current、27 条精确 ledger 前缀及 registry 摘要；停 Cloud/worker 后生成仅属主可读 archive/schema-only 和摘要；正常受限 migrator 应用44条至71条，精确核验后原子发布四个非秘密 selector 和 Account Web。任何中间失败保持 writers 停止，不用旧代码盲目恢复已推进 schema。首次 preflight 因缺少公开 expected catalog 而拒绝，补同一目录后执行，没有跳过 guard。

真实部署后检查：Cloud/worker/新旧 OpenBao active，所有数据库/签名/API后端 loopback，公网 401/400/401/200、源站与伪造来源403；五 runtime URL 保持，进程无 Owner URL，12个相关角色 NOSUPERUSER NOBYPASSRLS。实际生产 signer/AppRole 五用途签名及20个错用途拒绝通过，未为当前账户伪造授权。

备份的 archive TOC 可读与 schema SHA 不等于恢复演练；共享 PG 仍18.4，未宣称18.6资格。远端不含 Listing write 030/031。账户/双设备/Provider 实际旅程及 Windows/macOS/生产发行资格仍独立。操作路径及当前事实见 [Cloud运行手册](../DEVELOPMENT_CLOUD.md)和[OpenBao运行手册](../DEVELOPMENT_OPENBAO.md)。
