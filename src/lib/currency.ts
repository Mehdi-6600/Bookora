export type CountryCode = "IR" | "OTHER";

export const COUNTRY_CURRENCY: Record<CountryCode, string> = {
  IR: "IRR",
  OTHER: "USD",
};

export const COUNTRY_LABELS: Record<CountryCode, string> = {
  IR: "ایران",
  OTHER: "سایر کشورها",
};

export function isCountryCode(value: string): value is CountryCode {
  return value === "IR" || value === "OTHER";
}

export function currencyLabel(currency: string): string {
  switch (currency) {
    case "IRR":
      return "تومان";
    case "USD":
      return "$";
    case "EUR":
      return "€";
    default:
      return currency;
  }
}

export function formatPrice(price: string | number, currency: string): string {
  const amount = typeof price === "string" ? Number(price) : price;
  const label = currencyLabel(currency);
  const formatted = new Intl.NumberFormat("en-US").format(
    Number.isFinite(amount) ? amount : 0
  );

  if (currency === "USD" || currency === "EUR") {
    return `${label}${formatted}`;
  }

  return `${formatted} ${label}`;
}
