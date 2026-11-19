# Linux Afternic 原生凭据录入独立审查

范围：在已有 Afternic 私有 Service、凭据 slot 和 Secret Service custody 中，将 Linux unavailable 分支接成固定 GTK 掩码输入窗口。只实现原生输入与授权撤回生命周期，不授予 Provider 资格或绕过 Active/商业准入。所有权为 secure-host-core；Renderer、普通 TypeScript、环境变量与日志均不接收秘密。

固定窗口在已有 GTK 主循环调度，调用者必须是后台线程；主循环缺失 3 秒失败，输入 120 秒超时。50ms 复查取消与当前授权，结果返回后再次检查；所有关闭/撤权路径清空两个 Entry。晚到 idle 回调检查取消标记，不再打开窗口。两个标签与各自 masked Entry 建立 mnemonic 关系。Native 只向原私有 parser 交付 Zeroizing 字节。

Root 与 Cloud 均独立源码审查通过；双方实际运行 GTK 主循环测试（测试 canary，不是真实账号），覆盖提交字节完全一致、取消、授权撤回、控件清空、无主循环期限和迟到回调。4 项通道生命周期测试加实际 GTK 1 项通过。Core 全量 92、public 3、doc 4 及严格 Clippy 通过；全量中的 GTK/logind 两项 ignored 分别已显式实跑，不把 ignored 当作通过。日志 `target/linux-capture-real-gtk.log`、`target/root-independent-linux-gtk.log`、`target/cloud-independent-linux-capture.log`。

实际组件测试发现 glib 0.18 foreign GString::into_bytes 会截去最后字节，已改完整 slice 读取，并以精确字节 canary 保留回归。仅通道 helper 测试不足以发现此问题。残余同 UID Secret Service 访问边界已写入 ADR-0025；本机测试不构成真实 Afternic 连接、Windows/macOS 实机或发行资格。
