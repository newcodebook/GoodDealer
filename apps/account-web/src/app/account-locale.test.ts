import { describe, expect, it } from "vitest";

import { ACCOUNT_LOCALE_KEY, initialAccountLocale, rememberAccountLocale } from "./account-locale";

describe("initialAccountLocale", () => {
  it("prefers a remembered supported locale", () => {
    expect(initialAccountLocale({ getItem: () => "en-US" }, ["zh-CN"])).toBe("en-US");
  });

  it("ignores an unsupported remembered value and follows the browser", () => {
    expect(initialAccountLocale({ getItem: () => "fr-FR" }, ["fr-FR", "en-GB"])).toBe("en-US");
    expect(initialAccountLocale(null, ["zh-TW"])).toBe("zh-CN");
  });

  it("falls back to the default when storage throws and no language matches", () => {
    expect(initialAccountLocale({ getItem: () => { throw new Error("blocked"); } }, ["de-DE"])).toBe("zh-CN");
  });
});

describe("rememberAccountLocale", () => {
  it("stores only the locale under its own key and tolerates blocked storage", () => {
    const writes: [string, string][] = [];
    rememberAccountLocale({ setItem: (key, value) => { writes.push([key, value]); } }, "en-US");
    expect(writes).toEqual([[ACCOUNT_LOCALE_KEY, "en-US"]]);
    expect(() => rememberAccountLocale({ setItem: () => { throw new Error("quota"); } }, "zh-CN")).not.toThrow();
  });
});
