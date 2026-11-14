/**
 * Exact arithmetic on money amounts as decimal text. Every amount has at most 8 fraction digits,
 * so each one is an integer count of 10⁻⁸ units and BigInt holds sums, differences and products
 * exactly; a JavaScript number would round beyond about 15 significant digits. The contracts cap an
 * amount at 16 whole digits, but a sum or product of capped amounts can exceed that, so these
 * functions accept any number of whole digits and leave the cap to the contract schemas. Results
 * are canonical: no leading zeros, no trailing fraction zeros, `-` only when negative.
 */

const UNITS_PER_WHOLE = 100_000_000n;
const amountPattern = /^(-?)(0|[1-9]\d*)(?:\.(\d{1,8}))?$/u;

/** The amount as an integer number of 10⁻⁸ units; throws on anything but plain decimal text. */
export function amountUnits(amount: string): bigint {
  const match = amountPattern.exec(amount);
  if (match === null) throw new RangeError("amount must be plain decimal text with at most 8 fraction digits");
  const [, sign, whole = "0", fraction = ""] = match;
  const units = BigInt(whole) * UNITS_PER_WHOLE + BigInt(fraction.padEnd(8, "0"));
  return sign === "-" ? -units : units;
}

/** Canonical decimal text for a number of 10⁻⁸ units. */
export function unitsAmount(units: bigint): string {
  const negative = units < 0n;
  const absolute = negative ? -units : units;
  const whole = absolute / UNITS_PER_WHOLE;
  const fraction = (absolute % UNITS_PER_WHOLE).toString().padStart(8, "0").replace(/0+$/u, "");
  return `${negative && absolute !== 0n ? "-" : ""}${whole}${fraction.length > 0 ? `.${fraction}` : ""}`;
}

export function sumAmounts(amounts: readonly string[]): string {
  return unitsAmount(amounts.reduce((sum, amount) => sum + amountUnits(amount), 0n));
}

/** `left - right`, which may be negative. */
export function subtractAmounts(left: string, right: string): string {
  return unitsAmount(amountUnits(left) - amountUnits(right));
}

/** The amount times a whole number, such as an annual price times a term in years. */
export function multiplyAmount(amount: string, times: number): string {
  if (!Number.isSafeInteger(times)) throw new RangeError("multiplier must be a safe integer");
  return unitsAmount(amountUnits(amount) * BigInt(times));
}

/** The amount's sign and its magnitude as canonical text, for showing a sign of one's own. */
export function amountSign(amount: string): { readonly sign: -1 | 0 | 1; readonly magnitude: string } {
  const units = amountUnits(amount);
  return { sign: units < 0n ? -1 : units > 0n ? 1 : 0, magnitude: unitsAmount(units < 0n ? -units : units) };
}

/** Whether the amount is exactly zero, however it is written. */
export function isZeroAmount(amount: string): boolean {
  return amountUnits(amount) === 0n;
}

/** Integer division rounding half up (towards +∞), as `Math.round` does. */
function divideRoundingHalfUp(numerator: bigint, denominator: bigint): bigint {
  const divisor = denominator < 0n ? -denominator : denominator;
  const dividend = denominator < 0n ? -numerator : numerator;
  let quotient = dividend / divisor;
  if (dividend % divisor !== 0n && dividend < 0n) quotient -= 1n;
  const remainder = dividend - quotient * divisor;
  return remainder * 2n >= divisor ? quotient + 1n : quotient;
}

/**
 * The amount changed by a percent given in tenths (`-125` is −12.5 %), rounded half up to cents
 * and never below zero.
 */
export function adjustAmountByTenthsOfPercent(amount: string, tenths: number): string {
  if (!Number.isSafeInteger(tenths)) throw new RangeError("percent must be whole tenths");
  const CENT = UNITS_PER_WHOLE / 100n;
  const cents = divideRoundingHalfUp(amountUnits(amount) * (1000n + BigInt(tenths)), 1000n * CENT);
  return unitsAmount((cents < 0n ? 0n : cents) * CENT);
}

/** Halfway between two amounts, rounded half up to whole units. */
export function midpointWholeAmount(left: string, right: string): string {
  return unitsAmount(divideRoundingHalfUp(amountUnits(left) + amountUnits(right), 2n * UNITS_PER_WHOLE) * UNITS_PER_WHOLE);
}

/** `value` relative to `base` as a whole percent rounded half up, or null when `base` is zero. */
export function relativeWholePercent(value: string, base: string): number | null {
  const denominator = amountUnits(base);
  if (denominator === 0n) return null;
  return Number(divideRoundingHalfUp((amountUnits(value) - denominator) * 100n, denominator));
}
