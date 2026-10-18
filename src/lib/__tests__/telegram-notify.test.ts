import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  sendMessage: vi.fn(),
}));

vi.mock("@/lib/telegram/bot", () => ({
  getBot: () => ({ api: { sendMessage: mocks.sendMessage } }),
}));

import { deliverTelegramMessage } from "@/lib/telegram/notify";

beforeEach(() => {
  mocks.sendMessage.mockReset();
});

describe("Telegram delivery error handling", () => {
  it("returns Telegram retry_after without retrying the request", async () => {
    const error = Object.assign(new Error("Flood control exceeded"), {
      error_code: 429,
      parameters: { retry_after: 17 },
    });
    mocks.sendMessage.mockRejectedValueOnce(error);

    const result = await deliverTelegramMessage("private-recipient", "private body");

    expect(mocks.sendMessage).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      ok: false,
      errorCode: 429,
      error: "Telegram rate limit reached.",
      blocked: false,
      retryAfterSeconds: 17,
    });
    expect(JSON.stringify(result)).not.toContain("private-recipient");
    expect(JSON.stringify(result)).not.toContain("private body");
  });

  it("does not trust invalid retry_after values", async () => {
    mocks.sendMessage.mockRejectedValueOnce(
      Object.assign(new Error("Flood control exceeded"), {
        error_code: 429,
        parameters: { retry_after: 0 },
      })
    );

    const result = await deliverTelegramMessage("123", "hello");
    expect(result).toMatchObject({ ok: false, errorCode: 429, blocked: false });
    expect(result).not.toHaveProperty("retryAfterSeconds");
    expect(mocks.sendMessage).toHaveBeenCalledTimes(1);
  });

  it("classifies a blocked bot relationship without retrying", async () => {
    mocks.sendMessage.mockRejectedValueOnce(
      Object.assign(new Error("Forbidden"), { error_code: 403 })
    );

    const result = await deliverTelegramMessage("123", "hello");
    expect(result).toMatchObject({ ok: false, errorCode: 403, blocked: true });
    expect(mocks.sendMessage).toHaveBeenCalledTimes(1);
  });
});
