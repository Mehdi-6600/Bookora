import { addMinutes } from "date-fns";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { isValidDateOnly } from "@/lib/booking/time";

export type BusyRange = { start: Date; end: Date };

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export function computeAvailableSlots(params: {
  dateStr: string;
  timezone: string;
  openTime: string;
  closeTime: string;
  breakStart: string | null;
  breakEnd: string | null;
  durationMinutes: number;
  busyRanges: BusyRange[];
  slotIntervalMinutes?: number;
}): Date[] {
  const {
    dateStr,
    timezone,
    openTime,
    closeTime,
    breakStart,
    breakEnd,
    durationMinutes,
    busyRanges,
  } = params;

  if (
    !isValidDateOnly(dateStr) ||
    !TIME_PATTERN.test(openTime) ||
    !TIME_PATTERN.test(closeTime) ||
    !Number.isInteger(durationMinutes) ||
    durationMinutes <= 0 ||
    (breakStart !== null && !TIME_PATTERN.test(breakStart)) ||
    (breakEnd !== null && !TIME_PATTERN.test(breakEnd)) ||
    Boolean(breakStart) !== Boolean(breakEnd)
  ) {
    return [];
  }

  // Working-hour intervals that cross midnight are deliberately unsupported by
  // the current single-day schedule model, so fail closed for malformed rows.
  if (openTime >= closeTime) return [];
  if (breakStart && breakEnd) {
    if (
      breakStart >= breakEnd ||
      breakStart < openTime ||
      breakEnd > closeTime
    ) {
      return [];
    }
  }

  const configuredStep = params.slotIntervalMinutes;
  const step =
    Number.isInteger(configuredStep) && Number(configuredStep) > 0
      ? Number(configuredStep)
      : durationMinutes;

  let open: Date;
  let close: Date;
  let breakStartAt: Date | null = null;
  let breakEndAt: Date | null = null;

  try {
    open = fromZonedTime(`${dateStr}T${openTime}:00`, timezone);
    close = fromZonedTime(`${dateStr}T${closeTime}:00`, timezone);

    // Avoid silently shifting a schedule through a DST gap. Ambiguous fall-back
    // wall times resolve consistently through date-fns-tz.
    if (
      formatInTimeZone(open, timezone, "yyyy-MM-dd HH:mm") !==
        `${dateStr} ${openTime}` ||
      formatInTimeZone(close, timezone, "yyyy-MM-dd HH:mm") !==
        `${dateStr} ${closeTime}`
    ) {
      return [];
    }

    if (breakStart && breakEnd) {
      breakStartAt = fromZonedTime(`${dateStr}T${breakStart}:00`, timezone);
      breakEndAt = fromZonedTime(`${dateStr}T${breakEnd}:00`, timezone);

      if (
        formatInTimeZone(breakStartAt, timezone, "yyyy-MM-dd HH:mm") !==
          `${dateStr} ${breakStart}` ||
        formatInTimeZone(breakEndAt, timezone, "yyyy-MM-dd HH:mm") !==
          `${dateStr} ${breakEnd}`
      ) {
        return [];
      }
    }
  } catch {
    return [];
  }

  if (open >= close || !Number.isFinite(step) || step <= 0) return [];

  const slots: Date[] = [];
  const seenLocalStarts = new Set<string>();
  let cursor = open;

  // At most one day of minute-aligned candidates; this protects against bad
  // legacy data while still allowing services with a one-minute interval.
  for (let count = 0; cursor < close && count < 1_441; count += 1) {
    const slotEnd = addMinutes(cursor, durationMinutes);

    if (slotEnd > close) break;

    const localStart = formatInTimeZone(cursor, timezone, "yyyy-MM-dd HH:mm");
    const overlapsBreak = Boolean(
      breakStartAt &&
        breakEndAt &&
        cursor < breakEndAt &&
        slotEnd > breakStartAt
    );
    const overlapsBusy = busyRanges.some(
      (busy) => cursor < busy.end && slotEnd > busy.start
    );

    // During a fall-back transition the same wall-clock label occurs twice.
    // Keep one candidate so the public UI never presents indistinguishable slots.
    if (!seenLocalStarts.has(localStart) && !overlapsBreak && !overlapsBusy) {
      slots.push(cursor);
    }
    seenLocalStarts.add(localStart);
    cursor = addMinutes(cursor, step);
  }

  return slots;
}
