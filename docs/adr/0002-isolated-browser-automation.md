# ADR-0002：未来浏览器功能必须隔离

状态：Accepted design direction; browser automation is currently unavailable.

## 决策

如果未来引入浏览器功能，远程页面必须与本地应用展示域和受保护资源隔离。用户完成认证
步骤；软件不得代填密码、绕过认证挑战或把远程内容连接到宽泛本地接口。导航、弹窗、下载、
上传和页面脚本都必须在拥有模块的受限边界内处理。

## 当前实现

`automation-host` 报告 `Unavailable`。没有浏览器会话、远程页面桥接、Desktop 组合或提供商
执行。因此本 ADR 不授权当前浏览器行为。

## 交付条件

未来交付需要具体产品范围、平台条款、最小权限设计、真实 WebView2/WKWebView 观察、秘密
泄漏控制、最终构件证据和独立审查。任何缺口都保持浏览器不可用。
