// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import type { AfternicConnectionPort, AfternicConnectionsStatus } from "@gooddealer/client-core";
import { AfternicPanel } from "./afternic-panel";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT=true;
const id="aa000000-0000-4000-8000-000000000001";
const status:AfternicConnectionsStatus={schemaVersion:1,connections:[{connectionId:id,displayLabel:"My market",state:"active",purgePending:false,lastScan:{observed:300,imported:2,skippedDeleted:1,completedAt:"2026-11-19T00:00:00Z"}}],controlledAcceptance: null, observeQualified:true,observeEntitled:true,capturable:true,laneState:"ready",lastOperation:null};
let element:HTMLDivElement; let root:Root;
beforeEach(()=>{element=document.createElement("div");document.body.append(element);root=createRoot(element);});
afterEach(async()=>{await act(async()=>root.unmount());element.remove();});
function port():AfternicConnectionPort{return {status:vi.fn(async()=>status),connect:vi.fn(async()=>{}),refresh:vi.fn(async()=>{}),revoke:vi.fn(async()=>{})};}
async function mount(native:AfternicConnectionPort,readOnly=false){await act(async()=>root.render(<AfternicPanel locale="en-US" port={native} readOnly={readOnly} onChanged={vi.fn()}/>));}
async function click(text:string){const button=[...element.querySelectorAll("button")].find((entry)=>entry.textContent===text);expect(button).toBeDefined();await act(async()=>button!.click());}
it("shows persisted inventory without claiming ownership and removes writes on role downgrade",async()=>{
 const native=port();await mount(native);expect(element.textContent).toContain("Observed 300 domains");expect(element.textContent).toContain("not proof of registrar ownership");expect(element.querySelector('input[type="password"]')).toBeNull();
 await mount(native,true);expect(element.querySelector("form")).toBeNull();expect(element.textContent).not.toContain("Disconnect");expect(element.textContent).not.toContain("Refresh inventory");
});
it("reconciles a lost refresh response without sending it again",async()=>{
 const native=port();vi.mocked(native.refresh).mockRejectedValue(new Error("closed failure"));await mount(native);await click("Refresh inventory");expect(native.refresh).toHaveBeenCalledExactlyOnceWith(id);expect(native.status).toHaveBeenCalledTimes(2);expect(element.textContent).toContain("outcome is unconfirmed");
});
it("explains a rejected first inventory response and retries the saved connection without another capture", async () => {
  const native = port();
  vi.mocked(native.status).mockResolvedValue({ ...status, connections: [{ ...status.connections[0]!, state: "prepared", lastScan: null }],
    lastOperation: { kind: "afternic_connect", outcome: "provider_response_rejected" } });
  await mount(native);
  expect(element.textContent).toContain("First inventory read incomplete");
  expect(element.textContent).toContain("The Afternic inventory response could not be validated");
  await click("Refresh inventory");
  expect(native.refresh).toHaveBeenCalledExactlyOnceWith(id);
  expect(native.connect).not.toHaveBeenCalled();
});
it("allows cleanup after entitlement removal but hides connect and inventory execution",async()=>{
 const native=port();vi.mocked(native.status).mockResolvedValue({...status,observeEntitled:false,controlledAcceptance: null, observeQualified:false});await mount(native);expect(element.querySelector("form")).toBeNull();expect(element.textContent).not.toContain("Refresh inventory");await click("Disconnect");expect(native.revoke).toHaveBeenCalledExactlyOnceWith(id);expect(native.connect).not.toHaveBeenCalled();
});
const acceptance = { runId: "afternic-wecin-linux-20261119", domain: "wecin.com", expiresAt: "2026-11-26T23:59:59Z", connectionId: null } as const;
it("opens only the label form for an entitled unbound acceptance run without claiming qualification",async()=>{
 const native=port();vi.mocked(native.status).mockResolvedValue({...status,connections:[],observeQualified:false,controlledAcceptance:acceptance});await mount(native);
 expect(element.textContent).toContain("Controlled development acceptance");expect(element.textContent).toContain("wecin.com");expect(element.textContent).toContain("Production qualification is pending");
 const input=element.querySelector<HTMLInputElement>('input[name="displayLabel"]')!;expect(input).not.toBeNull();expect(input.getAttribute("aria-invalid")).toBe("false");
 await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")!.set!.call(input,"My acceptance market");input.dispatchEvent(new Event("input",{bubbles:true}));});
 await act(async()=>element.querySelector("form")!.dispatchEvent(new Event("submit",{bubbles:true,cancelable:true})));
 expect(native.connect).toHaveBeenCalledExactlyOnceWith("My acceptance market");expect(element.querySelector('input[type="password"]')).toBeNull();
});
it("keeps the bound run on its exact connection and cannot expand access after entitlement removal",async()=>{
 const native=port();const other={...status.connections[0]!,connectionId:"bb000000-0000-4000-8000-000000000002",displayLabel:"Other market"};
 vi.mocked(native.status).mockResolvedValue({...status,connections:[...status.connections,other],observeQualified:false,controlledAcceptance:{...acceptance,connectionId:id}});await mount(native);
 expect(element.querySelector("form")).toBeNull();expect(element.querySelectorAll('button[aria-label^="Refresh inventory"]')).toHaveLength(1);
 await click("Refresh inventory");expect(native.refresh).toHaveBeenCalledExactlyOnceWith(id);
 vi.mocked(native.status).mockResolvedValue({...status,observeEntitled:false,observeQualified:false,controlledAcceptance:{...acceptance,connectionId:id}});await click("Refresh status");
 expect(element.querySelector("form")).toBeNull();expect(element.querySelectorAll('button[aria-label^="Refresh inventory"]')).toHaveLength(0);
});
