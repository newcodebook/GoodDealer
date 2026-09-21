# GoodDealer 产品需求

## 产品定位

GoodDealer 是本地优先的 Desktop 域名资产管理产品。用户登录 GoodDealer 账号并获得商业与设备
授权后，业务数据、业务事务、任务和 Provider 操作在本地客户端完成；Cloud 提供账号控制面和
脱敏数据同步/恢复，不是 Desktop 的业务数据库。

## 首发目标

- 一个 GoodDealer 账号和由 Cloud 绑定的个人默认工作区。
- 本地 SQLCipher 中可读写的域名资产资料、状态与历史。
- 本地 Secure Host 使用用户本地保存的 Cloudflare 账号和最小 Token 读取 Zone/DNS。
- 本地结果立即可见；网络恢复后异步同步允许字段。
- 商业计划、Entitlement、设备绑定和 Lease/Epoch 继续由 Cloud 授权。

## 首发商业计划

- 所有付费方案提供相同功能权益：USD 9.80 月付、USD 98 年付、USD 498 的 10 年固定期限预付。
- 月付和年付自动续费并可随时取消；取消后使用到已付周期结束。10 年方案不自动续费且不是永久买断。
- 首发结账只展示 Stripe；PayPal adapter 作为可选扩展能力保留，但未配置时不得出现在 catalog、
  客户界面或发行资格中。同一账号任何时候最多有一个正在创建、待批准或有效的支付 Provider。
- 不提供免费试用。每账号终身唯一的首次 settled acquisition 从 Provider 结算时间起 336 小时内可
  全额退款；续费不重置或新增窗口，退款请求接受即进入商业只读。
- 优惠不可叠加，由 GoodDealer 服务端统一校验并映射到两家 Provider 的受控对象。
- 标价不含适用税费；只有已经完成支付与税务合规准备的国家或地区可以进入结账。

## 产品不变量

- 有效授权下，Cloud 同步服务不可达不能使本地业务 Repository 停止读写；仅显示待同步状态。
- 授权失效可以锁定入口；不承诺无限离线，也不能由客户端扩大授权期限。
- 本地业务事务不等待 Cloud ACK。
- 第三方平台账号、Provider Account ID、账号别名及所有凭据、Cookie、2FA、Browser Profile、
  Credential Binding 均不得同步到 Cloud。
- Cloud 不代表 Desktop 调用 Provider。
- Cloud 空副本不能删除本地数据；恢复必须先重建本地 SQLCipher。
- Renderer 不获得数据库、文件、密钥链、凭据或通用网络权威。

## 首发排除项

团队、邀请、多工作区、跨账号共享、提供商写入、注册商或市场连接、批量外部变更、嵌入式
浏览器、网页自动化、凭据跨设备迁移和无限离线均不在首发范围。未来加入时必须有拥有模块、
严格协议、负向测试和适用 ADR。

## 交付判定

本地业务纵向必须证明：Cloud transport 全失败时，在有效授权窗口内本地读写仍成功；业务写入
和 Outbox 原子；Provider 账号与秘密不生成同步 Mutation；秘密 canary 失败关闭；Cloud 空副本
不清空本地库；授权或 Lease 失效仍锁定入口。部署、Provider 真实执行、原生签名和发行另需各自
外部证据。
