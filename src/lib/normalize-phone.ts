import { parsePhoneNumberFromString } from "libphonenumber-js/max";

export const INVALID_PHONE_MESSAGE =
  "شماره تلفن معتبر نیست. کد کشور را وارد کنید؛ مانند ‎+49، ‎+98 یا ‎+971.";

export class PhoneNormalizationError extends Error {
  constructor() {
    super(INVALID_PHONE_MESSAGE);
    this.name = "PhoneNormalizationError";
  }
}

function toAsciiDigits(value: string): string {
  return Array.from(value, (character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint >= 0x06f0 && codePoint <= 0x06f9) {
      return String(codePoint - 0x06f0);
    }
    if (codePoint >= 0x0660 && codePoint <= 0x0669) {
      return String(codePoint - 0x0660);
    }
    return character;
  }).join("");
}

function compactPhoneInput(value: string): string {
  return toAsciiDigits(value)
    .trim()
    .replace(/[\s().,،/\-\u2010-\u2015\u2212]/gu, "");
}

/**
 * Normalize phone numbers to valid E.164 storage form without guessing a
 * country for ambiguous national numbers. International numbers may use a
 * leading + or 00. For backward compatibility, Iranian domestic mobile
 * numbers (09xxxxxxxxx) and country-prefixed 98xxxxxxxxxx are also accepted.
 */
export function normalizePhoneNumber(value: string): string {
  if (typeof value !== "string") throw new PhoneNormalizationError();

  const compact = compactPhoneInput(value);
  if (!/^\+?[0-9]+$/.test(compact)) {
    throw new PhoneNormalizationError();
  }

  let international: string;
  if (compact.startsWith("00")) {
    international = `+${compact.slice(2)}`;
  } else if (compact.startsWith("+")) {
    international = compact;
  } else if (compact.startsWith("09")) {
    international = `+98${compact.slice(1)}`;
  } else if (compact.startsWith("98")) {
    international = `+${compact}`;
  } else {
    throw new PhoneNormalizationError();
  }

  const parsed = parsePhoneNumberFromString(international);
  if (!parsed || !parsed.isValid()) {
    throw new PhoneNormalizationError();
  }

  return parsed.number;
}

export function isValidNormalizedPhoneNumber(value: string): boolean {
  const parsed = parsePhoneNumberFromString(value);
  return Boolean(parsed?.isValid() && parsed.number === value);
}
