import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  AlertTriangleIcon, AppShell, Banner, BatchBar, Button, Callout, CommandMenu,
  ComparisonValueCard, DiffValue, Dialog, EditableCell, KeyValueList, KeyValueRow,
  KpiStat, MetricStrip, Money, NavigationRail, Pagination, Panel, ProgressBar,
  SegmentedControl, StatusDot, Stepper, Table, Tag, Toolbar, Tooltip,
  getPageWindow, getVisibleColumns,
} from "../index";

describe("desktop component system root API", () => {
  it("renders every standard visual primitive through the package root", () => {
    const html = renderToStaticMarkup(<div>
      <Dialog open title="Review" footer={<Button>Confirm</Button>}><p>Body</p></Dialog>
      <Tooltip label="Hint"><Button>Focus</Button></Tooltip>
      <DiffValue oldValue="1" newValue="2"/><Money amount={12.5}/><ProgressBar value={40}/>
      <StatusDot kind="active" label="Active"/><Tag>alpha</Tag><KpiStat label="Value" value={10} currency="USD"/>
      <Panel title="Panel"><Toolbar left="Left" right="Right"/></Panel><BatchBar count={2}>Actions</BatchBar>
      <Pagination page={2} total={80}/><Banner tone="warning" title="Notice">Body</Banner><Callout>Callout</Callout>
    </div>);
    expect(html).toContain('role="dialog"');
    expect(html).toContain("gd-progress");
    expect(html).toContain("gd-panel");
    expect(html).toContain('type="button"');
  });

  it("renders the demonstrated generic primitives through the package root", () => {
    const html = renderToStaticMarkup(<AppShell navigation={<NavigationRail sections={[{ key: "main", items: [{ key: "one", label: "One", textLabel: "One", icon: <AlertTriangleIcon/> }] }]} />}>
      <EditableCell value="10" onCommit={vi.fn()}/><MetricStrip metrics={[{ label: "Total", value: "10" }]}/>
      <SegmentedControl value="one" onChange={vi.fn()} label="Mode" items={[{ value: "one", label: "One" }]}/>
      <Stepper activeIndex={0} items={[{ key: "one", label: "One" }]}/>
      <ComparisonValueCard label="Base" value="1"/><KeyValueList><KeyValueRow label="Key" value="Value"/></KeyValueList>
      <CommandMenu open items={[{ key: "one", label: "One", textValue: "One" }]}/>
    </AppShell>);
    expect(html).toContain("gd-appshell");
    expect(html).toContain('role="radiogroup"');
    expect(html).toContain("gd-comparison");
    expect(html).toContain("gd-command");
  });
});

describe("Table responsive and virtualization seams", () => {
  const columns = [
    { key: "name", label: "Name", priority: "essential" as const },
    { key: "status", label: "Status", priority: "secondary" as const },
    { key: "note", label: "Note", priority: "supplementary" as const },
  ];
  const rows = Array.from({ length: 10 }, (_, id) => ({ id, name: `Row ${id}`, status: "ok", note: "note" }));

  it("drops columns by the table's own measured-width contract", () => {
    expect(getVisibleColumns(columns, 500).map((column) => column.key)).toEqual(["name"]);
    expect(getVisibleColumns(columns, 700).map((column) => column.key)).toEqual(["name", "status"]);
    expect(getVisibleColumns(columns, 1000)).toHaveLength(3);
  });

  it("renders only the requested virtual row window and reserves spacer height", () => {
    const html = renderToStaticMarkup(<Table columns={columns} rows={rows} forceWidth={500} virtualWindow={{ startIndex: 4, endIndex: 7, beforeHeight: 160, afterHeight: 120 }}/>)
    expect(html).toContain("Row 4");
    expect(html).toContain("Row 6");
    expect(html).not.toContain("Row 3");
    expect(html).not.toContain(">Status<");
    expect(html).toContain("160px");
  });
});

describe("generic calculations and safe button semantics", () => {
  it("windows long page sets without losing boundary pages", () => expect(getPageWindow(6, 12)).toEqual([1, 2, "gap", 5, 6, 7, "gap", 11, 12]));
  it("defaults general action buttons to type=button but preserves explicit submit", () => {
    expect(Button({ children: "Action" }).props.type).toBe("button");
    expect(Button({ type: "submit", children: "Submit" }).props.type).toBe("submit");
  });
});
