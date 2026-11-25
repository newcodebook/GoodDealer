import { describe, expect, it } from "vitest";

import { parseDesktopAuthorizationContinuation, requiresDesktopReauthentication } from "../src/desktop-authorization-continuation";

const origin = "https://account.gooddealer.com";
const authorize = "/v1/desktop-oauth/authorize?response_type=code&state=abc";

function search(value: string): string {
  return `?${new URLSearchParams({ continue: value }).toString()}`;
}

describe("Desktop authorization continuation", () => {
  it("returns only the same-origin Desktop authorize request", () => {
    expect(parseDesktopAuthorizationContinuation(search(authorize), origin)).toBe(authorize);
  });

  it("ignores pages without a continuation", () => {
    expect(parseDesktopAuthorizationContinuation("", origin)).toBeNull();
    expect(parseDesktopAuthorizationContinuation("?other=1", origin)).toBeNull();
  });

  it.each([
    ["another origin", "https://evil.example/v1/desktop-oauth/authorize?state=abc"],
    ["scheme-relative origin", "//evil.example/v1/desktop-oauth/authorize?state=abc"],
    ["backslash origin", "/\\evil.example/v1/desktop-oauth/authorize?state=abc"],
    ["another path", "/v1/identity/logout?state=abc"],
    ["path prefix trick", "/v1/desktop-oauth/authorize-other?state=abc"],
    ["dot segments", "/v1/desktop-oauth/authorize/../../identity/logout?x=1"],
    ["missing query", "/v1/desktop-oauth/authorize"],
    ["empty query", "/v1/desktop-oauth/authorize?"],
    ["fragment", `${authorize}#frag`],
    ["javascript scheme", "javascript:alert(1)"],
    ["oversized", `${authorize}&pad=${"a".repeat(2_048)}`],
  ])("rejects %s", (_name, value) => {
    expect(parseDesktopAuthorizationContinuation(search(value), origin)).toBeNull();
  });

  it("rejects duplicate continuations and non-string input", () => {
    const params = new URLSearchParams();
    params.append("continue", authorize);
    params.append("continue", "/v1/identity/logout?x=1");
    expect(parseDesktopAuthorizationContinuation(`?${params.toString()}`, origin)).toBeNull();
    expect(parseDesktopAuthorizationContinuation(42, origin)).toBeNull();
    expect(parseDesktopAuthorizationContinuation(search(authorize), null)).toBeNull();
  });

  it("accepts only the exact reauthentication marker bound to its validated continuation", () => {
    const target = `${authorize}&require_reauth=true`;
    const input = `${search(target)}&reauth=required`;
    expect(parseDesktopAuthorizationContinuation(input, origin)).toBe(target);
    expect(requiresDesktopReauthentication(input, origin)).toBe(true);
    expect(requiresDesktopReauthentication(search(target), origin)).toBe(false);
    for (const invalid of [
      `${search(target)}&reauth=false`, `${input}&reauth=required`,
      `${search(authorize)}&reauth=required`, `${search(`${target}&require_reauth=true`)}&reauth=required`,
      `${search("//evil.example/v1/desktop-oauth/authorize?require_reauth=true")}&reauth=required`,
    ]) {
      expect(parseDesktopAuthorizationContinuation(invalid, origin)).toBeNull();
      expect(requiresDesktopReauthentication(invalid, origin)).toBe(false);
    }
  });

  it("rejects opaque origins rather than matching two serialized null origins", () => {
    expect(parseDesktopAuthorizationContinuation(search(authorize), "file:///account.html")).toBeNull();
  });
});
