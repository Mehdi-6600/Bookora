import { fromZonedTime, formatInTimeZone } from "date-fns-tz";

export const MAX_BOOKING_WINDOW_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

export function normalizeTimeZone(value: string): string | null {
  try {
    const timezone = new Intl.DateTimeFormat("en-US", {
      timeZone: value,
    }).resolvedOptions().timeZone;
    return timezone || null;
  } catch {
    return null;
  }
}

export function isValidDateOnly(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;

  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));

  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function utcDayNumber(dateOnly: string): number {
  const [year, month, day] = dateOnly.split("-").map(Number);
  return Math.floor(Date.UTC(year, month - 1, day) / DAY_MS);
}

export function addCalendarDays(dateOnly: string, days: number): string {
  if (!isValidDateOnly(dateOnly) || !Number.isInteger(days)) {
    throw new Error("Invalid calendar date");
  }

  const date = new Date((utcDayNumber(dateOnly) + days) * DAY_MS);
  return [
    String(date.getUTCFullYear()).padStart(4, "0"),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

export function getBusinessDate(date: Date, timezone: string): string {
  return formatInTimeZone(date, timezone, "yyyy-MM-dd");
}

export function getBusinessDayOfWeek(dateOnly: string): number {
  if (!isValidDateOnly(dateOnly)) return -1;
  return new Date(`${dateOnly}T00:00:00.000Z`).getUTCDay();
}

export function getBusinessDayBounds(
  dateOnly: string,
  timezone: string
): { start: Date; endExclusive: Date } {
  if (!isValidDateOnly(dateOnly)) throw new Error("Invalid calendar date");

  return {
    start: fromZonedTime(`${dateOnly}T00:00:00`, timezone),
    endExclusive: fromZonedTime(
      `${addCalendarDays(dateOnly, 1)}T00:00:00`,
      timezone
    ),
  };
}

/** Returns a signed local-calendar-day offset from the business's current date. */
export function getBookingDateOffset(
  dateOnly: string,
  timezone: string,
  now = new Date()
): number | null {
  if (!isValidDateOnly(dateOnly)) return null;

  try {
    const today = getBusinessDate(now, timezone);
    return utcDayNumber(dateOnly) - utcDayNumber(today);
  } catch {
    return null;
  }
}

export function isWithinBookingWindow(
  dateOnly: string,
  timezone: string,
  now = new Date()
): boolean {
  const offset = getBookingDateOffset(dateOnly, timezone, now);
  return offset !== null && offset >= 0 && offset < MAX_BOOKING_WINDOW_DAYS;
}

export function toBusinessLocalDateTime(
  date: Date,
  timezone: string
): string {
  return formatInTimeZone(date, timezone, "yyyy-MM-dd'T'HH:mm");
}

export function parseBusinessLocalDateTime(
  value: string,
  timezone: string
): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/.test(value)) {
    return null;
  }

  const dateOnly = value.slice(0, 10);
  if (!isValidDateOnly(dateOnly)) return null;

  try {
    const date = fromZonedTime(value, timezone);
    // Reject nonexistent local wall times during a DST gap instead of silently
    // moving them to another clock time. Ambiguous fall-back times consistently
    // resolve to the single instant returned by date-fns-tz.
    if (toBusinessLocalDateTime(date, timezone) !== value) return null;
    return date;
  } catch {
    return null;
  }
}
