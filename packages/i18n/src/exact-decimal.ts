/**
 * Exact formatting of decimal strings on every WebView.
 *
 * ECMA-402 NumberFormat v3 formats a decimal string exactly. An engine without it converts the
 * string to a double first, which silently rounds amounts beyond 15 significant digits and
 * miscomputes half cents (1.005 is the double 1.00499…). Desktop runs on the platform WebView
 * (WebKitGTK, WKWebView, WebView2), whose version the app does not choose, so the formatters
 * never rely on v3 alone: they round the decimal to the format's fraction digits exactly here, and
 * on an engine without v3 they hand Intl that rounded value as a double only when a double holds
 * it exactly. A value that would still round shows as unavailable (`—`), never wrong; a render
 * that threw would blank the whole page instead of one value.
 */

/** What a value the engine cannot format exactly shows instead. */
export const unformattableDecimal = "—";

/** A double holds every decimal of at most 15 significant digits exactly enough to print it back. */
const MAX_EXACT_DOUBLE_DIGITS = 15;

const decimalPattern = /^(-?)(0|[1-9]\d*)(?:\.(\d+))?$/u;

/**
 * The decimal rounded to `fractionDigits`, half away from zero (Intl's default `halfExpand`), as
 * canonical text without trailing fraction zeros.
 */
export function roundDecimal(value: string, fractionDigits: number): string {
  const match = decimalPattern.exec(value);
  if (match === null) throw new RangeError("Decimal string must be a plain decimal");
  if (!Number.isSafeInteger(fractionDigits) || fractionDigits < 0 || fractionDigits > 100) {
    throw new RangeError("Fraction digits must be between 0 and 100");
  }
  const [, sign = "", whole = "0", fraction = ""] = match;
  const kept = fraction.slice(0, fractionDigits).padEnd(fractionDigits, "0");
  let units = BigInt(`${whole}${kept}`);
  // Half away from zero: the magnitude rounds up when the first dropped digit is 5 or more.
  if ((fraction[fractionDigits] ?? "0") >= "5") units += 1n;
  const digits = units.toString().padStart(fractionDigits + 1, "0");
  const integer = digits.slice(0, digits.length - fractionDigits);
  const decimals = digits.slice(digits.length - fractionDigits).replace(/0+$/u, "");
  const negative = sign === "-" && units !== 0n;
  return `${negative ? "-" : ""}${integer}${decimals.length > 0 ? `.${decimals}` : ""}`;
}

function significantDigits(value: string): number {
  const digits = value.replace(/^-/u, "").replace(".", "").replace(/^0+/u, "");
  return Math.max(digits.length, 1);
}

let stringInputSupport: boolean | undefined;

/** Whether this engine formats a decimal string exactly (NumberFormat v3); probed once. */
export function supportsExactStringInput(): boolean {
  stringInputSupport ??= new Intl.NumberFormat("en-US", { useGrouping: false, maximumFractionDigits: 0 })
    .format("9007199254740993" as unknown as number) === "9007199254740993";
  return stringInputSupport;
}

/**
 * Formats a plain decimal string exactly with `format`, or returns `unformattableDecimal` when this
 * engine cannot. The value is first rounded to the format's maximum fraction digits, so Intl only
 * adds grouping, symbols and minimum digits. Options that round some other way (significant digits,
 * any notation but standard, a rounding mode or increment) would be overridden by that or, without v3, round
 * a double, so they are refused.
 */
export function formatDecimalExactly(
  format: Intl.NumberFormat,
  value: string,
  exactStringInput: boolean = supportsExactStringInput(),
): string {
  // Engines without NumberFormat v3 report none of the v3 rounding options, which reads as default.
  const resolved = format.resolvedOptions() as Intl.ResolvedNumberFormatOptions & {
    readonly roundingMode?: string;
    readonly roundingIncrement?: number;
  };
  if (
    resolved.maximumSignificantDigits !== undefined
    // Other notations apply the fraction digits to a mantissa, not to the value.
    || (resolved.notation ?? "standard") !== "standard"
    || (resolved.roundingMode ?? "halfExpand") !== "halfExpand"
    || (resolved.roundingIncrement ?? 1) !== 1
  ) {
    throw new RangeError("Exact decimal formatting rounds only to fraction digits, half away from zero");
  }
  const rounded = roundDecimal(value, resolved.maximumFractionDigits ?? 3);
  if (exactStringInput) return format.format(rounded as unknown as number);
  if (significantDigits(rounded) > MAX_EXACT_DOUBLE_DIGITS) return unformattableDecimal;
  return format.format(Number(rounded));
}
