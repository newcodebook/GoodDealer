import { canonicalizeDomainName } from "@gooddealer/client-core";
import { formatMoney, type Locale } from "@gooddealer/i18n";

export function parseRows(text: string) {
  return text.split(/\r?\n/u).map(line => line.trim()).filter(Boolean).map(line => {
    const comma = line.indexOf(",");
    if (comma < 1) throw new TypeError("missing price");
    const domain = canonicalizeDomainName(line.slice(0, comma).trim());
    const amount = /^([0-9]{1,14})(?:\.([0-9]{1,2}))?$/u.exec(line.slice(comma + 1).trim());
    if (!amount) throw new TypeError("invalid price");
    const cents = BigInt(amount[1]!) * 100n + BigInt((amount[2] ?? "").padEnd(2, "0"));
    if (cents > BigInt(Number.MAX_SAFE_INTEGER)) throw new TypeError("price exceeds exact cents");
    return { domain, priceCents: Number(cents) };
  });
}

export function formatCents(locale: Locale, cents: number) {
  const digits = String(cents).padStart(3, "0");
  const exact = `${digits.slice(0, -2)}.${digits.slice(-2)}`;
  const display = formatMoney(locale, exact, "USD");
  return display === "—" ? `USD ${exact}` : display;
}
