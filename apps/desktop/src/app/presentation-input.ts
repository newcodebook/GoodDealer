/**
 * Copies an untrusted object without evaluating accessors. Presentation boundaries use the copy
 * so a caller cannot change a value after it has been validated.
 */
export function copyPlainRecord(value: unknown): Readonly<Record<string, unknown>> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;

  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;
    if (Object.getOwnPropertySymbols(value).length !== 0) return null;

    const descriptors = Object.getOwnPropertyDescriptors(value) as Record<string, PropertyDescriptor>;
    const copy: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (!("value" in descriptor) || !descriptor.enumerable) return null;
      copy[key] = descriptor.value;
    }
    return Object.freeze(copy);
  } catch {
    return null;
  }
}

export function copyDenseArray(value: unknown): readonly unknown[] | null {
  if (!Array.isArray(value)) return null;

  try {
    if (Object.getPrototypeOf(value) !== Array.prototype) return null;
    if (Object.getOwnPropertySymbols(value).length !== 0) return null;

    const descriptors = Object.getOwnPropertyDescriptors(value) as Record<string, PropertyDescriptor>;
    const lengthDescriptor = descriptors["length"];
    if (lengthDescriptor === undefined || !("value" in lengthDescriptor)) return null;
    const length = lengthDescriptor.value;
    if (typeof length !== "number" || !Number.isSafeInteger(length) || length < 0) return null;

    const copy: unknown[] = [];
    for (let index = 0; index < length; index += 1) {
      const descriptor = descriptors[String(index)];
      if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) {
        return null;
      }
      copy.push(descriptor.value);
    }
    if (Object.keys(descriptors).length !== length + 1) return null;
    return Object.freeze(copy);
  } catch {
    return null;
  }
}

export function hasExactKeys(
  record: Readonly<Record<string, unknown>>,
  expectedKeys: readonly string[],
): boolean {
  const actualKeys = Object.keys(record);
  return actualKeys.length === expectedKeys.length && expectedKeys.every((key) => actualKeys.includes(key));
}
