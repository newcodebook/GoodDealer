# Linux 原生电源通知独立审查

范围：secure-host-core 的固定 logind 适配，复用原 NativePowerGate、power epoch、最终提交栅栏与唯一 ProviderLane。保持 macOS/Windows 目标，不引入 IPC、通用 D-Bus 代理、原始文件描述符或 ready 绕过。

独立 GLib MainContext 线程只连接系统总线固定 org.freedesktop.login1；订阅唯一 owner 的 PrepareForSleep，在取得真实 delay inhibitor、读取 PreparingForSleep、复查 owner 后才完成注册。精确验证所有 Variant signature，owner 更换或总线断开终止并失败关闭。睡眠意图先使旧 epoch 失效，再等待原提交栅栏，最后释放持有的 UnixFDList。恢复时重新取得 inhibitor 后才开放新 epoch；不恢复旧 claim。取消与线程退出释放订阅和 inhibitor。

Root、Cloud 源码独立评审通过。双方实际运行原 gate 4 项、Linux signature/失败恢复 2 项、真实 system logind 取得 delay inhibitor 及关闭释放 1 项；7 项通过。真实 GTK 与 logind ignored 测试已显式执行；Core 全量 92、public 3、doc 4 和严格 Clippy 通过。日志 target/linux-power-tests.log、target/root-independent-linux-power-all.log、target/root-independent-linux-logind.log、target/cloud-independent-linux-logind.log。

负向测试发现 GLib tuple extraction 单独使用会接受尾随成员，已在解码前严格核对 signature；同形额外字段亦拒绝。本轮未让当前开发机实际挂起，不能从注册测试推导真实 sleep/wake、Windows/macOS 实机或发行资格。当前没有真实 Afternic 账号操作，此切片仅解除 Linux 原生电源监控失败导致的执行暂停。
