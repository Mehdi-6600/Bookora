import { addMinutes } from "date-fns";
import { fromZonedTime } from "date-fns-tz";

export type BusyRange = { start: Date; end: Date };

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
  const dateStr = params.dateStr;
  const timezone = params.timezone;
  const openTime = params.openTime;
  const closeTime = params.closeTime;
  const breakStart = params.breakStart;
  const breakEnd = params.breakEnd;
  const durationMinutes = params.durationMinutes;
  const busyRanges = params.busyRanges;

  // فاصله‌ی نوبت‌ها:
  // - اگر صاحب کسب‌وکار مقدار مشخصی داده باشد (و معتبر باشد)، همان استفاده می‌شود.
  // - در غیر این صورت، فاصله = مدت سرویس (پیش‌فرض منطقی).
  let step = durationMinutes;
  if (
    typeof params.slotIntervalMinutes === "number" &&
    params.slotIntervalMinutes > 0 &&
    params.slotIntervalMinutes <= durationMinutes
  ) {
    step = params.slotIntervalMinutes;
  }

  const open = fromZonedTime(dateStr + "T" + openTime + ":00", timezone);
  const close = fromZonedTime(dateStr + "T" + closeTime + ":00", timezone);

  const breakStartAt = breakStart
    ? fromZonedTime(dateStr + "T" + breakStart + ":00", timezone)
    : null;
  const breakEndAt = breakEnd
    ? fromZonedTime(dateStr + "T" + breakEnd + ":00", timezone)
    : null;

  if (open >= close) {
    return [];
  }

  const slots: Date[] = [];
  let cursor = open;

  while (true) {
    const slotEnd = addMinutes(cursor, durationMinutes);

    if (slotEnd > close) {
      break;
    }

    let overlapsBreak = false;
    if (breakStartAt && breakEndAt) {
      overlapsBreak = cursor < breakEndAt && slotEnd > breakStartAt;
    }

    const overlapsBusy = busyRanges.some(
      (busy) => cursor < busy.end && slotEnd > busy.start
    );

    if (!overlapsBreak && !overlapsBusy) {
      slots.push(cursor);
    }

    cursor = addMinutes(cursor, step);
  }

  return slots;
}
