import { createRoot } from "react-dom/client";
import { useState } from "react";
import "../src/tokens/index.css";
import {
  AlertTriangleIcon, AppShell, Badge, Banner, BatchBar, Button, CommandMenu,
  ComparisonValueCard, Dialog, DiffValue, EditableCell, GlobeIcon, KeyValueList,
  KeyValueRow, KpiStat, MetricStrip, Money, NavigationRail, Pagination, Panel,
  ProgressBar, SearchIcon, SegmentedControl, StatusBar, StatusDot, Stepper, Table,
  Tag, Toolbar, Tooltip, WindowChrome,
} from "../src/index";
import "./gallery.css";

const rows = Array.from({ length: 8 }, (_, id) => ({ id, name: ["alpha.example", "beta.example", "gamma.example", "delta.example"][id % 4], value: 1200 + id * 175, state: id % 3 ? "Synced" : "Review", note: `rev ${8241 + id}` }));
const columns = [
  { key: "name", label: "Domain", render: (row: (typeof rows)[number]) => <span className="gd-num">{row.name}</span> },
  { key: "value", label: "Value", numeric: true, render: (row: (typeof rows)[number]) => <Money amount={row.value}/> },
  { key: "state", label: "State", priority: "secondary" as const, render: (row: (typeof rows)[number]) => <Badge tone={row.state === "Review" ? "warning" : "success"} mono={false}>{row.state}</Badge> },
  { key: "note", label: "Revision", muted: true, priority: "supplementary" as const },
];

function Gallery() {
  const [dialog, setDialog] = useState(false); const [command, setCommand] = useState(false); const [segment, setSegment] = useState("local"); const [status, setStatus] = useState("ready"); const [editable, setEditable] = useState("1,200.00");
  return <div className="gallery">
    <header className="gallery-head"><h1>GoodDealer desktop component system</h1><p>Production root exports · locked brand tokens · Chromium behavior surface</p></header>
    <div className="gallery-grid">
      <Panel title="Status and actions" actions={<Tooltip label="System search"><Button icon={<SearchIcon/>}>Search</Button></Tooltip>}><div className="gallery-column"><div className="gallery-stack"><Button variant="primary" onClick={() => { setDialog(true); setStatus("dialog-open"); }}>Open dialog</Button><Button onClick={() => { setCommand(true); setStatus("command-open"); }}>Command menu</Button><Button variant="danger">Danger</Button><StatusDot kind="active" label="Active"/><StatusDot kind="standby" label="Standby"/><Tag color="var(--gd-gold)">Portfolio</Tag></div><div className="gallery-stack"><Money amount={12500}/><DiffValue oldValue="$1,200" newValue="$1,375"/><ProgressBar value={68}/></div><Banner tone="warning" icon={<AlertTriangleIcon/>} title="Attention">A generic, injected presentation notice.</Banner></div></Panel>
      <Panel title="Metrics and comparison"><div className="gallery-column"><MetricStrip metrics={[{ label: "Portfolio", value: "847", meta: "domains" }, { label: "Value", value: "$2.4M", tone: "gold", meta: "estimate" }, { label: "Review", value: "6", tone: "warning", meta: "items" }]}/><div className="gallery-stack"><KpiStat label="Annual value" value={28410} currency="USD" meta="Current projection"/><ComparisonValueCard label="Base" value="$1,200"/><ComparisonValueCard label="Candidate" value="$1,375" tone="gold" selected/></div><KeyValueList><KeyValueRow label="Source" value="Local"/><KeyValueRow label="Revision" value="8,241" mono/><KeyValueRow label="Status" value="Validated" tone="gold"/></KeyValueList></div></Panel>
      <Panel title="Table · responsive priority · virtualization seam" flush style={{ minWidth: 0 }}><div className="gallery-table"><Table label="Domains" columns={columns} rows={rows} forceWidth={720} selectable selected={[1]} virtualWindow={{ startIndex: 1, endIndex: 7, beforeHeight: 20, afterHeight: 20 }} footer={<Pagination page={1} pageSize={25} total={847}/>} /></div></Panel>
      <Panel title="Generic interaction contracts"><div className="gallery-column"><SegmentedControl label="Source" value={segment} onChange={(value) => { setSegment(value); setStatus(`segment-${value}`); }} items={[{ value: "local", label: "Local" }, { value: "cloud", label: "Cloud" }, { value: "manual", label: "Manual" }]}/><Stepper activeIndex={1} items={[{ key: "file", label: "File" }, { key: "map", label: "Map" }, { key: "preview", label: "Preview" }]}/><div className="gallery-stack">Editable: <EditableCell value={editable} display={`$${editable}`} editLabel="Edit valuation" onCommit={(value) => { setEditable(value); setStatus(`edited-${value}`); }}/></div><BatchBar count={3} onClear={() => setStatus("cleared")}><Button size="sm">Plan</Button></BatchBar></div></Panel>
      <div className="gallery-wide gallery-shell"><WindowChrome context="Component gallery" footer={<StatusBar left={["SYNCED", "rev 8,241"]} right={["Desktop UI"]}/>}><AppShell navigation={<NavigationRail activeKey="assets" sections={[{ key: "main", label: "Workspace", items: [{ key: "assets", label: "Assets", textLabel: "Assets", icon: <GlobeIcon/> }, { key: "review", label: "Review", textLabel: "Review", icon: <AlertTriangleIcon/>, count: 6, tone: "warning" }] }]}/>} toolbar={<Toolbar left="Asset library" right={<Button size="sm">Refresh</Button>}/>} banner={<Banner tone="sync" title="Read projection">Presentation data is injected by the host feature.</Banner>}><div style={{ padding: 16 }}><Panel title="Native desktop composition">AppShell and NavigationRail own layout and generic navigation presentation only.</Panel></div></AppShell></WindowChrome></div>
    </div>
    <Dialog open={dialog} onClose={() => { setDialog(false); setStatus("dialog-closed"); }} title="Keyboard contract" footer={<><Button onClick={() => setStatus("dialog-secondary")}>Secondary</Button><Button variant="primary" onClick={() => setStatus("dialog-primary")}>Primary</Button></>}>Focus begins inside, Tab is trapped, Escape closes, and focus returns to the opener.</Dialog>
    <CommandMenu open={command} onClose={() => { setCommand(false); setStatus("command-closed"); }} items={[{ key: "assets", label: "Assets", textValue: "Assets", icon: <GlobeIcon/>, group: "Navigate" }, { key: "review", label: "Review", textValue: "Review", icon: <AlertTriangleIcon/>, group: "Navigate" }]} onSelect={(item) => { setStatus(`command-${item.key}`); setCommand(false); }}/>
    <output className="gallery-status" data-testid="gallery-status">{status}</output>
  </div>;
}

createRoot(document.getElementById("root")!).render(<Gallery/>);
