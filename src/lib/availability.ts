import { addMinutes } from "date-fns";
import { fromZonedTime } from "date-fns-tz";

const STEP_MINUTES = 30;

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

  const open = fromZonedTime(`${dateStr}T${openTime}:00`, timezone);
  const close = fromZonedTime(`${dateStr}T${closeTime}:00`, timezone);
  const breakStartAt = breakStart
    ? fromZonedTime(`${dateStr}T${breakStart}:00`, timezone)
    : null;
  const breakEndAt = breakEnd
    ? fromZonedTime(`${dateStr}T${breakEnd}:00`, timezone)
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

    const overlapsBreak =
      breakStartAt && breakEndAt
        ? cursor < breakEndAt && slotEnd > breakStartAt
        : false;

    const overlapsBusy = busyRanges.some(
      (busy) => cursor < busy.end && slotEnd > busy.start
    );

    if (!overlapsBreak && !overlapsBusy) {
      slots.push(cursor);
    }

    cursor = addMinutes(cursor, STEP_MINUTES);
  }

  return slots;
}
