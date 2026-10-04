import { describe, it, expect } from "vitest";
import { signSession, verifySession } from "@/lib/auth/jwt";

describe("jwt", () => {
  it("signSession and verifySession round-trip", async () => {
    const token0 = await signSession({
      userId:abcdefghij"
    "user-1",
      telegramId: "12345",
      isAdmin: false,
    });

    const payload = await verifySession(token);
    expect(payload).not.toBeNull();
    expect(payload?.userId).toBe("user-1");
    expect(payload?.telegramId).toBe("12345");
    expect(payload?.isAdmin).toBe(false);
  });

  it("rejects tampered tokens", async () => {
    const token = await signSession({
      userId: "user-1",
      telegramId: "12345",
      isAdmin: false,
    });

    const tampered = token.slice(0, -5) + "xxxxx";
    const payload = await verifySession(tampered);
    expect(payload).toBeNull();
  });

  it("rejects empty tokens", async () => {
    const payload = await verifySession("");
    expect(payload).toBeNull();
  });
});
