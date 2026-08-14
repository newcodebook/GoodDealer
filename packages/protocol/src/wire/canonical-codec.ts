const encoder = new TextEncoder();

function frame(tag: string, payload: Uint8Array): Uint8Array {
  const header = encoder.encode(`${tag}${payload.byteLength}:`);
  const output = new Uint8Array(header.byteLength + payload.byteLength);
  output.set(header);
  output.set(payload, header.byteLength);
  return output;
}

function concatenate(parts: readonly Uint8Array[]): Uint8Array {
  const output = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.byteLength;
  }
  return output;
}

/** Deterministic, type-tagged and length-delimited encoding for already-validated wire values. */
export function encodeCanonicalWireValue(value: unknown): Uint8Array {
  if (value === null) return encoder.encode("z0:");
  if (typeof value === "boolean") return encoder.encode(value ? "b1:1" : "b1:0");
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new TypeError("canonical wire numbers must be safe integers");
    return frame("n", encoder.encode(Object.is(value, -0) ? "0" : String(value)));
  }
  if (typeof value === "string") return frame("s", encoder.encode(value));
  if (Array.isArray(value)) {
    const entries = value.map((entry) => frame("e", encodeCanonicalWireValue(entry)));
    return frame("a", concatenate(entries));
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const entries = Object.keys(record)
      .sort()
      .map((key) =>
        frame(
          "e",
          concatenate([frame("k", encoder.encode(key)), frame("v", encodeCanonicalWireValue(record[key]))]),
        ),
      );
    return frame("o", concatenate(entries));
  }
  throw new TypeError("canonical wire values cannot contain undefined, bigint, symbol, or function");
}

export function encodeDomainSeparatedWireValue(domain: string, value: unknown): Uint8Array {
  return concatenate([frame("d", encoder.encode(domain)), frame("v", encodeCanonicalWireValue(value))]);
}
