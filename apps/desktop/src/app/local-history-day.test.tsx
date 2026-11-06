// @vitest-environment happy-dom
import { localHistoryDay } from "@gooddealer/client-core";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useLocalHistoryDay, type LocalHistoryDay } from "./local-history-day";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLElement;
let root: Root;
let clock: Date;
const seen: LocalHistoryDay[] = [];
const now = () => clock;

function Probe() {
  seen.push(useLocalHistoryDay(now));
  return null;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  seen.length = 0;
  container = document.createElement("div");
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  vi.useRealTimers();
});

const latest = () => seen.at(-1);

describe("local History day", () => {
  it("keeps the same day when its timer fires early, and arms again", () => {
    clock = new Date(2026, 10, 6, 23, 0);
    act(() => root.render(<Probe />));
    const today = localHistoryDay(clock);
    expect(latest()).toEqual(today);
    // The timer fires on schedule, but the clock says it is still today (it was moved back).
    clock = new Date(2026, 10, 6, 22, 0);
    act(() => { vi.advanceTimersByTime(60 * 60 * 1000); });
    expect(latest()).toEqual(today);
    // It armed again: when the day really ends, the next day arrives.
    clock = new Date(2026, 10, 7, 0, 0, 1);
    act(() => { vi.advanceTimersByTime(2 * 60 * 60 * 1000); });
    expect(latest()).toEqual(localHistoryDay(clock));
  });

  it("moves straight to the current day after a long sleep", () => {
    clock = new Date(2026, 10, 6, 23, 59);
    act(() => root.render(<Probe />));
    // The machine slept for three days; the late timer lands on today, not on the next day.
    clock = new Date(2026, 10, 9, 8, 0);
    act(() => { vi.advanceTimersByTime(60 * 1000); });
    expect(latest()).toEqual(localHistoryDay(clock));
  });

  it("rechecks the day when the window comes back, without waiting for the timer", () => {
    clock = new Date(2026, 10, 6, 12, 0);
    act(() => root.render(<Probe />));
    const renders = seen.length;
    // Coming back on the same day changes nothing.
    act(() => { window.dispatchEvent(new Event("focus")); });
    expect(seen.length).toBe(renders);
    clock = new Date(2026, 10, 8, 9, 0);
    act(() => { document.dispatchEvent(new Event("visibilitychange")); });
    expect(latest()).toEqual(localHistoryDay(clock));
  });
});
