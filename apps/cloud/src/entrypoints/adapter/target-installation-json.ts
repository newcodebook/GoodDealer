import type { FastifyInstance } from "fastify";

/** Preserve Fastify's JSON/prototype protections while refusing ambiguous signed-operation bytes. */
export function registerTargetInstallationJsonBoundary(app: FastifyInstance, paths: readonly string[]): void {
  const installationRoutes = new Set(paths);
  const decode = app.getDefaultJsonParser("error", "error");
  app.removeContentTypeParser("application/json");
  app.addContentTypeParser<string>("application/json", { parseAs: "string" }, (request, body, done) => {
    if (installationRoutes.has(request.routeOptions.url ?? "")) {
      try { assertDistinctKeys(body); }
      catch {
        done(Object.assign(new Error("invalid target installation JSON"), { code: "FST_ERR_CTP_INVALID_JSON_BODY", statusCode: 400 }));
        return;
      }
    }
    decode(request, body, done);
  });
}

// JSON.parse has already forgotten duplicate fields. Scan each object's decoded keys first,
// including escaped aliases; the standard decoder still owns the resulting unknown value.
function assertDistinctKeys(text: string): void {
  let offset = 0;
  const fail = (): never => { throw new TypeError("invalid installation JSON"); };
  const whitespace = () => { while (/[ \t\r\n]/u.test(text[offset] ?? "x")) offset += 1; };
  const string = (): string => {
    const start = offset;
    if (text[offset++] !== '"') fail();
    while (offset < text.length) {
      const character = text[offset++];
      if (character === "\\") { offset += 1; continue; }
      if (character === '"') return JSON.parse(text.slice(start, offset)) as string;
    }
    return fail();
  };
  const value = (depth: number): void => {
    if (depth > 32) fail();
    whitespace();
    if (text[offset] === '"') { string(); return; }
    const opening = text[offset];
    if (opening === "{" || opening === "[") {
      offset += 1;
      const closing = opening === "{" ? "}" : "]";
      const keys = new Set<string>();
      whitespace();
      if (text[offset] === closing) { offset += 1; return; }
      for (;;) {
        whitespace();
        if (opening === "{") {
          const key = string();
          if (keys.has(key)) fail();
          keys.add(key);
          whitespace();
          if (text[offset++] !== ":") fail();
        }
        value(depth + 1);
        whitespace();
        const delimiter = text[offset++];
        if (delimiter === closing) return;
        if (delimiter !== ",") fail();
      }
    }
    const start = offset;
    while (offset < text.length && !/[,\]} \t\r\n]/u.test(text[offset]!)) offset += 1;
    if (offset === start) fail();
    JSON.parse(text.slice(start, offset));
  };
  value(0);
  whitespace();
  if (offset !== text.length) fail();
}
