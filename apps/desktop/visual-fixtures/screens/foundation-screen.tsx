import {
  AlertTriangleIcon,
  Badge,
  CheckIcon,
  CoinsIcon,
  GlobeIcon,
  HistoryIcon,
  InboxIcon,
  Money,
  Panel,
  SearchIcon,
  SettingsIcon,
  ShieldIcon,
  StatusDot,
} from "@gooddealer/ui";

const textRoles = [
  ["gd-t-title", "资产库 · Asset Library"],
  ["gd-t-section", "批量差异预览"],
  ["gd-t-panel", "注册信息"],
  ["gd-t-label", "到期日 · Expiry"],
  ["gd-t-body", "选择域名后生成计划，将提交 823 项修改。"],
  ["gd-t-body-2", "数据来自 GoodDealer Cloud，截至 14:02。"],
  ["gd-t-meta", "Revision 8,241 · Epoch 7"],
  ["gd-t-metric", "$2,418,500"],
  ["gd-t-code", "northstar.example"],
] as const;

const colorTokens = [
  "--gd-ink", "--gd-panel", "--gd-panel-raised", "--gd-line", "--gd-line-strong",
  "--gd-gold", "--gd-blue", "--gd-success", "--gd-warning", "--gd-danger",
  "--text-1", "--text-2", "--text-3",
] as const;

const icons = [GlobeIcon, ShieldIcon, CoinsIcon, InboxIcon, HistoryIcon, SettingsIcon, SearchIcon, AlertTriangleIcon, CheckIcon];

const platformFaces = [
  ["macOS", "SF Pro + 苹方 PingFang SC"],
  ["Windows", "Segoe UI Variable / Segoe UI + 微软雅黑 Microsoft YaHei UI"],
  ["Linux", "Noto Sans / Ubuntu / Cantarell + Noto Sans CJK SC / 思源黑体"],
  ["全部平台 · 等宽", "JetBrains Mono（随应用打包）"],
] as const;

/** Verifies the system sans stack, bundled mono, token layer, and Lucide icons render together offline. */
export function FoundationScreen() {
  return (
    <div className="design-foundation">
      <Panel title="字体 · 各平台回退">
        <div className="design-foundation-roles">
          {platformFaces.map(([platform, faces]) => (
            <div key={platform} className="design-foundation-role">
              <span className="gd-t-label">{platform}</span>
              <p className="gd-t-body">{faces}</p>
            </div>
          ))}
        </div>
      </Panel>
      <Panel title="文本角色">
        <div className="design-foundation-roles">
          {textRoles.map(([role, sample]) => (
            <div key={role} className="design-foundation-role">
              <span className="gd-t-code">.{role}</span>
              <p className={role}>{sample}</p>
            </div>
          ))}
        </div>
      </Panel>
      <Panel title="颜色 token">
        <div className="design-foundation-swatches">
          {colorTokens.map((token) => (
            <div key={token} className="design-foundation-swatch">
              <span style={{ background: `var(${token})` }} />
              <code className="gd-t-code">{token}</code>
            </div>
          ))}
        </div>
      </Panel>
      <Panel title="图标 · 语义">
        <div className="design-foundation-row">
          {icons.map((Icon, index) => <Icon key={index} size={16} />)}
        </div>
        <div className="design-foundation-row">
          <StatusDot kind="active" label="Active" />
          <StatusDot kind="standby" label="Standby" />
          <Badge tone="sync">SYNCED</Badge>
          <Badge tone="warning">PENDING 3</Badge>
          <Money amount={12500} size={16} />
        </div>
      </Panel>
    </div>
  );
}
