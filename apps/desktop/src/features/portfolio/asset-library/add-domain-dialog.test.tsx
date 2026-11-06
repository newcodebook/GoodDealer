// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AddDomainDialog, type AddDomainOutcome } from "./add-domain-dialog";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function render(onSubmit: (domain: string) => Promise<AddDomainOutcome>, onClose = vi.fn()) {
  act(() => root.render(<AddDomainDialog locale="zh-CN" open onClose={onClose} onSubmit={onSubmit} />));
  return onClose;
}

function type(text: string) {
  const input = document.body.querySelector("input");
  if (input === null) throw new Error("no input");
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  act(() => {
    setter?.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function add() {
  const button = [...document.body.querySelectorAll("button")].find((candidate) => candidate.textContent === "添加");
  if (button === undefined) throw new Error("no add button");
  await act(async () => { button.click(); await Promise.resolve(); });
}

describe("Add domain dialog", () => {
  it("submits only a canonical domain and closes once it is added", async () => {
    const onSubmit = vi.fn(async () => "added" as const);
    const onClose = render(onSubmit);
    type("  Example.COM ");
    await add();
    expect(onSubmit).toHaveBeenCalledWith("example.com");
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("converts an internationalized name to its ASCII form", async () => {
    const onSubmit = vi.fn(async () => "added" as const);
    render(onSubmit);
    type("例子.中国");
    await add();
    expect(onSubmit).toHaveBeenCalledWith("xn--fsqu00a.xn--fiqs8s");
  });

  it("keeps invalid input in the dialog without calling the Host", async () => {
    const onSubmit = vi.fn(async () => "added" as const);
    const onClose = render(onSubmit);
    for (const bad of ["https://example.com/path", "10.0.0.1", "exa mple.com", "example"]) {
      type(bad);
      await add();
      expect(document.body.textContent, bad).toContain("这不是有效的域名");
    }
    expect(onSubmit).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("says a held domain was not added again, a deleted one waits for sync, and a failure can be retried", async () => {
    const outcomes: AddDomainOutcome[] = ["exists", "deleted", "failed"];
    const onClose = render(async () => outcomes.shift() ?? "failed");
    type("held.example");
    await add();
    expect(document.body.textContent).toContain("该域名已在工作区中，没有重复添加");
    await add();
    expect(document.body.textContent).toContain("该域名已删除，目前不能重新添加");
    expect(document.body.textContent).not.toContain("未能添加");
    await add();
    expect(document.body.textContent).toContain("重试不会产生重复的域名");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("treats a rejected submission as a failure, not a success", async () => {
    const onClose = render(async () => { throw new Error("host"); });
    type("thrown.example");
    await add();
    expect(document.body.textContent).toContain("未能添加");
    expect(onClose).not.toHaveBeenCalled();
  });
});
