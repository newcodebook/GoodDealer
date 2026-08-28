import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  Badge, Banner, BatchBar, ComparisonValueCard, DiffValue, KeyValueList, KeyValueRow,
  KpiStat, Money, Panel, ProgressBar, StatusDot, Stepper, Tag, Toolbar, Tooltip,
} from "../index";

describe("desktop visual primitive contracts", () => {
  it("formats signed money while preserving a preformatted string", () => {
    expect(renderToStaticMarkup(<Money amount={1234.5} sign showCurrency/>)).toContain("USD</span>+1,234.50");
    expect(renderToStaticMarkup(<Money amount="quoted"/>)).toContain("quoted");
    expect(renderToStaticMarkup(<Money amount={null}/>)).toContain("—");
  });

  it("clamps progress and exposes the progressbar range", () => {
    const html = renderToStaticMarkup(<ProgressBar value={150} max={100} label="Import"/>);
    expect(html).toContain('aria-valuenow="100"');
    expect(html).toContain('width:100%');
  });

  it("renders multi-tone segmented progress", () => {
    const html = renderToStaticMarkup(<ProgressBar segments={[{ value: 60, tone: "success" }, { value: 20, tone: "danger" }]}/>);
    expect(html).toContain("gd-progress-segment--success");
    expect(html).toContain("gd-progress-segment--danger");
  });

  it("keeps null batch state out of the tree and count in visible state", () => {
    expect(renderToStaticMarkup(<BatchBar count={0}/>)).toBe("");
    expect(renderToStaticMarkup(<BatchBar count={4} unit="rows">Actions</BatchBar>)).toContain(">4<");
  });

  it("ports exact panel, toolbar, status, badge, and tag modifiers", () => {
    const html = renderToStaticMarkup(<Panel flush seamed title="Ledger"><Toolbar region/><StatusDot kind="standby" pulse/><Badge tone="danger" dot>Risk</Badge><Tag color="currentColor">Tag</Tag></Panel>);
    expect(html).toContain("gd-panel--flush gd-panel--seamed");
    expect(html).toContain("gd-toolbar--region");
    expect(html).toContain("gd-statusdot-i--standby");
    expect(html).toContain("gd-badge-dot");
    expect(html).toContain("gd-tag-dot");
  });

  it("uses button semantics only when generic cards are selectable", () => {
    expect(renderToStaticMarkup(<ComparisonValueCard label="Base" value="1"/>).startsWith("<div")).toBe(true);
    expect(renderToStaticMarkup(<ComparisonValueCard label="Candidate" value="2" onSelect={vi.fn()}/>).startsWith('<button type="button"')).toBe(true);
  });

  it("reserves metric metadata and supports dense key/value rows", () => {
    const html = renderToStaticMarkup(<><KpiStat label="Value" value={10}/><KeyValueList><KeyValueRow label="Revision" value="8" mono/></KeyValueList></>);
    expect(html).toContain("gd-kpi");
    expect(html).toContain("gd-key-value--mono");
  });

  it("renders horizontal and vertical steppers from the same contract", () => {
    expect(renderToStaticMarkup(<Stepper activeIndex={1} items={[{ key: "a", label: "A" }, { key: "b", label: "B" }]}/>)).toContain('aria-current="step"');
    expect(renderToStaticMarkup(<Stepper orientation="vertical" activeIndex={0} items={[{ key: "a", label: "A" }]}/>)).toContain("gd-stepper--vertical");
  });

  it("keeps diff, tooltip, and banner semantics generic", () => {
    const html = renderToStaticMarkup(<><DiffValue/><Tooltip label="Hint">Target</Tooltip><Banner tone="danger">Warning</Banner></>);
    expect(html).toContain("gd-diff-old");
    expect(html).toContain('role="tooltip"');
    expect(html).toContain('role="alert"');
  });
});
