import { parseLocale, type Locale } from "./copy-types";

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
 * A plain decimal string, such as a money contract amount. Intl formats it exactly, so amounts
 * beyond a double's 15–17 significant digits are not rounded on the way to the screen; the shown
 * fraction digits still follow the format options (two for money by default).
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
  return new Intl.NumberFormat(parseLocale(locale), {
    ...defaultNumberOptions,
    ...options,
    // As in `formatMoney`: Intl formats a decimal string exactly, and the shape is already checked.
  }).format(value as Parameters<Intl.NumberFormat["format"]>[0]);
}

export function formatMoney(
  locale: Locale,
  value: NumericValue | DecimalString,
  currency: string,
  options: MoneyFormatOptions = defaultMoneyOptions,
): string {
  assertNumericValue(value);
  assertCurrency(currency);
  return new Intl.NumberFormat(parseLocale(locale), {
    ...defaultMoneyOptions,
    ...options,
    style: "currency",
    currency,
    // Intl formats a decimal string exactly (ECMA-402 NumberFormat v3); TypeScript's lib typing
    // predates that overload, and `assertNumericValue` has already checked the string's shape.
  }).format(value as Parameters<Intl.NumberFormat["format"]>[0]);
}
