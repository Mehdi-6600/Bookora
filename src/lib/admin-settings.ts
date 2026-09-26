export const MANUAL_PAYMENT_SETTING_KEYS = [
  "payment_card_number",
  "payment_card_holder",
  "payment_bank_name",
  "payment_instructions",
] as const;

export type ManualPaymentSettingKey =
  (typeof MANUAL_PAYMENT_SETTING_KEYS)[number];

export function isManualPaymentSettingKey(
  value: string
): value is ManualPaymentSettingKey {
  return (MANUAL_PAYMENT_SETTING_KEYS as readonly string[]).includes(value);
}
