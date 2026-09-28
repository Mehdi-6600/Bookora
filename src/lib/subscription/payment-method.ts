export type PaymentPreference = "AUTO" | "MANUAL" | "STARS";

export function isPaymentPreference(value: string): value is PaymentPreference {
  return value === "AUTO" || value === "MANUAL" || value === "STARS";
}

export function resolvePaymentMethod(
  preference: PaymentPreference,
  businessCountry: string | null
): "MANUAL" | "STARS" {
  if (preference === "MANUAL") return "MANUAL";
  if (preference === "STARS") return "STARS";
  return businessCountry === "IR" ? "MANUAL" : "STARS";
}
