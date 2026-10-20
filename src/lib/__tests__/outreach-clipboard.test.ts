import { describe, expect, it, vi } from "vitest";
import { writeClipboardText } from "@/lib/outreach/clipboard";

describe("clipboard feedback", () => {
  it("reports success only after the browser writes the text", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);

    await expect(writeClipboardText("campaign URL", { writeText })).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith("campaign URL");
  });

  it("reports failure when clipboard access is unavailable or denied", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("permission denied"));

    await expect(writeClipboardText("campaign URL", { writeText })).resolves.toBe(false);
    await expect(writeClipboardText("campaign URL", undefined)).resolves.toBe(false);
  });
});
