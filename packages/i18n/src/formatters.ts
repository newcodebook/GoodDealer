import { parseLocale, type Locale } from "./copy-types";
import { formatDecimalExactly } from "./exact-decimal";

export type DateValue = Date | number;
export type NumericValue = number | bigint;

export type DateFormatOptions = Omit<
  Intl.DateTimeFormatOptions,
  "timeZone"
> & {
  readonly timeZone?: string;
};

export type NumberFormatOptions = Intl.NumberFormatOptions;

export type MoneyFormatOptions = Omit<
  Intl.NumberFormatOptions,
  "currency" | "style"
>;

const defaultDateOptions = {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  timeZone: "UTC",
} as const satisfies DateFormatOptions;

const defaultNumberOptions = {
  maximumFractionDigits: 2,
} as const satisfies NumberFormatOptions;

const defaultMoneyOptions = {
  currencyDisplay: "symbol",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
} as const satisfies MoneyFormatOptions;

/**
 * A plain decimal string, such as a money contract amount. It is formatted exactly, so amounts
 * beyond a double's 15–17 significant digits are not rounded on the way to the screen; the shown
 * fraction digits still follow the format options (two for money by default). On a WebView that
 * cannot format it exactly the formatters show it as unavailable (`—`) rather than rounded
 * (`exact-decimal.ts`).
 */
export type DecimalString = string;

const decimalStringPattern = /^-?(0|[1-9]\d*)(\.\d+)?$/u;

function assertNumericValue(value: NumericValue | DecimalString): void {
  if (typeof value === "string" && !decimalStringPattern.test(value)) {
    throw new RangeError("Decimal string must be a plain decimal");
  }
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new RangeError("Numeric value must be finite");
  }
}

function toValidDate(value: DateValue): Date {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new RangeError("Date value must be valid");
  }
  return date;
}

function assertCurrency(currency: string): void {
  if (!/^[A-Z]{3}$/u.test(currency)) {
    throw new RangeError("Currency must be a three-letter uppercase ISO 4217 code");
  }
}

/** Defaults to UTC so rendering cannot vary with the host time zone. */
export function formatDate(
  locale: Locale,
  value: DateValue,
  options: DateFormatOptions = defaultDateOptions,
): string {
  const usesStyle = options.dateStyle !== undefined || options.timeStyle !== undefined;
  const mergedOptions = usesStyle
    ? { ...options, timeZone: options.timeZone ?? "UTC" }
    : {
        ...defaultDateOptions,
        ...options,
        timeZone: options.timeZone ?? "UTC",
      };
  return new Intl.DateTimeFormat(parseLocale(locale), mergedOptions).format(
    toValidDate(value),
  );
}

export function formatNumber(
  locale: Locale,
  value: NumericValue | DecimalString,
  options: NumberFormatOptions = defaultNumberOptions,
): string {
  assertNumericValue(value);
  const format = new Intl.NumberFormat(parseLocale(locale), { ...defaultNumberOptions, ...options });
  return typeof value === "string" ? formatDecimalExactly(format, value) : format.format(value);
}

export function formatMoney(
  locale: Locale,
  value: NumericValue | DecimalString,
  currency: string,
  options: MoneyFormatOptions = defaultMoneyOptions,
): string {
  assertNumericValue(value);
  assertCurrency(currency);
  const format = new Intl.NumberFormat(parseLocale(locale), {
    ...defaultMoneyOptions,
    ...options,
    style: "currency",
    currency,
  });
  return typeof value === "string" ? formatDecimalExactly(format, value) : format.format(value);
}
