import { describe, expect, it } from "vitest";

import { relativeTime } from "./relative-time";

const labels = { today: "今日", yesterday: "昨日" };

describe("relativeTime", () => {
  it("labels today and yesterday in local time and otherwise shows month and day", () => {
    const now = new Date(2026, 7, 20, 15, 0);
    expect(relativeTime(new Date(2026, 7, 20, 14, 2).toISOString(), labels, now)).toBe("今日 14:02");
    expect(relativeTime(new Date(2026, 7, 19, 18, 22).toISOString(), labels, now)).toBe("昨日 18:22");
    expect(relativeTime(new Date(2026, 6, 30, 9, 11).toISOString(), labels, now)).toBe("07-30 09:11");
    // Month boundaries still resolve yesterday by calendar day.
    expect(relativeTime(new Date(2026, 6, 31, 23, 59).toISOString(), labels, new Date(2026, 7, 1, 0, 5))).toBe("昨日 23:59");
  });
});
