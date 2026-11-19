// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import type { AfternicConnectionPort, AfternicConnectionsStatus } from "@gooddealer/client-core";
import { AfternicPanel } from "./afternic-panel";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT=true;
const id="aa000000-0000-4000-8000-000000000001";
const status:AfternicConnectionsStatus={schemaVersion:1,connections:[{connectionId:id,displayLabel:"My market",state:"active",purgePending:false,lastScan:{observed:300,imported:2,skippedDeleted:1,completedAt:"2026-11-19T00:00:00Z"}}],observeQualified:true,observeEntitled:true,capturable:true,laneState:"ready",lastOperation:null};
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
it("allows cleanup after entitlement removal but hides connect and inventory execution",async()=>{
 const native=port();vi.mocked(native.status).mockResolvedValue({...status,observeEntitled:false,observeQualified:false});await mount(native);expect(element.querySelector("form")).toBeNull();expect(element.textContent).not.toContain("Refresh inventory");await click("Disconnect");expect(native.revoke).toHaveBeenCalledExactlyOnceWith(id);expect(native.connect).not.toHaveBeenCalled();
});
