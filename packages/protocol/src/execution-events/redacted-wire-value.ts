import { z } from "zod";

export const REDACTED_WIRE_VALUE_MAXIMUM_DEPTH = 32 as const;
export const REDACTED_WIRE_VALUE_MAXIMUM_NODES = 4096 as const;
export const REDACTED_WIRE_VALUE_MAXIMUM_ARRAY_LENGTH = 256 as const;
export const REDACTED_WIRE_VALUE_MAXIMUM_STRING_LENGTH = 16_384 as const;

export type RedactedWireValue =
  | null
  | boolean
  | number
  | string
  | RedactedWireValue[]
  | { [key: string]: RedactedWireValue };

type PendingValue = Readonly<{
  value: unknown;
  depth: number;
}>;

const identifierPattern = /^[\x21-\x7E]+$/;

function isIdentifier(value: string): boolean {
  return value.length > 0 && value.length <= 160 && identifierPattern.test(value);
}

/**
 * Checks the complete recursive wire shape without recursive calls. The root is depth zero and
 * every value, including the root, consumes one node; object keys are validated but do not consume
 * nodes. This check therefore runs before canonical encoding can recurse over attacker input.
 */
export function isRedactedWireValue(value: unknown): value is RedactedWireValue {
  const pending: PendingValue[] = [{ value, depth: 0 }];
  let nodes = 0;

  try {
    while (pending.length > 0) {
      const current = pending.pop();
      if (current === undefined) return false;
      if (current.depth > REDACTED_WIRE_VALUE_MAXIMUM_DEPTH) return false;

      nodes += 1;
      if (nodes > REDACTED_WIRE_VALUE_MAXIMUM_NODES) return false;

      if (current.value === null || typeof current.value === "boolean") continue;
      if (typeof current.value === "number") {
        if (!Number.isSafeInteger(current.value) || current.value < 0) return false;
        continue;
      }
      if (typeof current.value === "string") {
        if (current.value.length > REDACTED_WIRE_VALUE_MAXIMUM_STRING_LENGTH) return false;
        continue;
      }
      if (Array.isArray(current.value)) {
        const array = current.value;
        if (array.length > REDACTED_WIRE_VALUE_MAXIMUM_ARRAY_LENGTH) return false;
        const ownKeys = Reflect.ownKeys(array);
        if (
          ownKeys.length !== array.length + 1 ||
          !ownKeys.every((key) =>
            key === "length" ||
            (typeof key === "string" &&
              Number.isSafeInteger(Number(key)) &&
              Number(key) >= 0 &&
              Number(key) < array.length &&
              String(Number(key)) === key)
          )
        ) return false;
        for (let index = array.length - 1; index >= 0; index -= 1) {
          pending.push({ value: array[index], depth: current.depth + 1 });
        }
        continue;
      }
      if (typeof current.value !== "object") return false;

      const prototype = Object.getPrototypeOf(current.value);
      if (prototype !== Object.prototype && prototype !== null) return false;
      const descriptors = Object.getOwnPropertyDescriptors(current.value);
      const ownKeys = Reflect.ownKeys(descriptors);
      if (ownKeys.some((key) => typeof key !== "string")) return false;
      for (let index = ownKeys.length - 1; index >= 0; index -= 1) {
        const key = ownKeys[index];
        if (typeof key !== "string" || !isIdentifier(key)) return false;
        const descriptor = descriptors[key];
        if (descriptor === undefined || !descriptor.enumerable || !("value" in descriptor)) {
          return false;
        }
        pending.push({
          value: descriptor.value,
          depth: current.depth + 1,
        });
      }
    }
  } catch {
    return false;
  }

  return true;
}

/** Closed recursive JSON subset accepted for stored, redacted execution evidence. */
export const redactedWireValueSchema = z.custom<RedactedWireValue>(isRedactedWireValue, {
  error: "expected a bounded redacted wire value",
});
