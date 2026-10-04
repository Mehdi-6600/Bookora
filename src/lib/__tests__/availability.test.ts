import { describe, it, expect } from "vitest";
import { computeAvailableSlots } from "@/lib/availability";

describe("computeAvailableSlots", () => {
  const base = {
    dateStr: "2026-10-15",
    timezone: "UTC",
    openTime: "09:00",
    closeTime: "12:00",
    breakStart: null,
    breakEnd: null,
    busyRanges: [],
  };

  it("creates 60-minute slots correctly", () => {
    const slots = computeAvailableSlots({
      ...base,
      durationMinutes: 60,
      slotIntervalMinutes: 60,
    });
    expect(slots).toHaveLength(3);
    expect(slots[0].getUTCHours()).toBe(9);
    expect(slots[1].getUTCHours()).toBe(10);
    expect(slots[2].getUTCHours()).toBe(11);
  });

  it("creates 30-minute slots correctly", () => {
    const slots = computeAvailableSlots({
      ...base,
      durationMinutes: 30,
      slotIntervalMinutes: 30,
    });
    expect(slots).toHaveLength(6);
  });

  it("excludes busy ranges", () => {
    const slots = computeAvailableSlots({
      ...base,
      durationMinutes: 60,
      slotIntervalMinutes: 60,
      busyRanges: [
        {
          start: new Date("2026-10-15T10:00:00Z"),
          end: new Date("2026-10-15T11:00:00Z"),
        },
      ],
    });
    expect(slots).toHaveLength(2);
    expect(slots[0].getUTCHours()).toBe(9);
    expect(slots[1].getUTCHours()).toBe(11);
  });

  it("returns empty when open >= close", () => {
    const slots = computeAvailableSlots({
      ...base,
      openTime: "12:00",
      closeTime: "09:00",
      durationMinutes: 60,
      slotIntervalMinutes: 60,
    });
    expect(slots).toHaveLength(0);
  });

  it("returns empty for invalid duration", () => {
    const slots = computeAvailableSlots({
      ...base,
      durationMinutes: 0,
      slotIntervalMinutes: 60,
    });
    expect(slots).toHaveLength(0);
  });
});
