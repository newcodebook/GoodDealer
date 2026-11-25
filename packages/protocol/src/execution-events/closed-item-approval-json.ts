export const maximumApprovalBytes = 6144;

export function decodeClosedItemApprovalJson(bytes: Uint8Array): unknown {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0 || bytes.byteLength > maximumApprovalBytes)
    throw new TypeError("item approval size rejected");
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  const value: unknown = JSON.parse(text);
  // Signed item envelopes are flat. Decode escaped key spellings before comparing them, so
  // duplicate keys cannot acquire a different meaning in Native, Cloud or another JSON parser.
  const keys = new Set<string>();
  for (const token of text.matchAll(/"(?:[^"\\]|\\.)*"/gu)) {
    if (!text.slice(token.index + token[0].length).trimStart().startsWith(":")) continue;
    const key = JSON.parse(token[0]) as string;
    if (keys.has(key)) throw new TypeError("duplicate item approval key");
    keys.add(key);
  }
  return value;
}
