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

function assertNumericValue(value: NumericValue): void {
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
  value: NumericValue,
  options: NumberFormatOptions = defaultNumberOptions,
): string {
  assertNumericValue(value);
  return new Intl.NumberFormat(parseLocale(locale), {
    ...defaultNumberOptions,
    ...options,
  }).format(value);
}

export function formatMoney(
  locale: Locale,
  value: NumericValue,
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
  }).format(value);
}
