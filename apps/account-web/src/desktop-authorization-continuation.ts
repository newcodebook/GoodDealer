/** The only route Account Web may return to after sign-in; Cloud owns its validation. */
export const DESKTOP_AUTHORIZATION_PATH = "/v1/desktop-oauth/authorize";

/** Mirrors Cloud's authorize URL bound so a continuation can never exceed what Cloud accepts. */
const MAX_CONTINUATION_LENGTH = 2_048;

/**
 * Reads the `continue` parameter Cloud attaches when Desktop's browser sign-in arrives without
 * an Account Web session. Returns a same-origin path to navigate to, or null.
 *
 * This is an open-redirect boundary: anything other than exactly one same-origin request to the
 * Desktop authorize path, with a query and no fragment, is ignored rather than followed.
 */
export function parseDesktopAuthorizationContinuation(search: unknown, origin: unknown): string | null {
  if (typeof search !== "string" || typeof origin !== "string") return null;
  let params: URLSearchParams;
  let base: URL;
  try {
    params = new URLSearchParams(search);
    base = new URL(origin);
  } catch {
    return null;
  }
  const values = params.getAll("continue");
  if (values.length !== 1) return null;
  const [value] = values;
  if (value === undefined || value.length === 0 || value.length > MAX_CONTINUATION_LENGTH) return null;
  // Require a plain absolute path so scheme-relative (`//host`) or backslash forms cannot be
  // reinterpreted as another origin by URL resolution.
  if (!value.startsWith(`${DESKTOP_AUTHORIZATION_PATH}?`) || value.includes("\\") || value.includes("#")) {
    return null;
  }
  let target: URL;
  try {
    target = new URL(value, base);
  } catch {
    return null;
  }
  if (target.origin !== base.origin || target.pathname !== DESKTOP_AUTHORIZATION_PATH || target.search.length <= 1) {
    return null;
  }
  return `${target.pathname}${target.search}`;
}
