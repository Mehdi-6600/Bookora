import { describe, it, expect, beforeAll } from "vitest";

describe("jwt", () => {
  beforeAll(() => {
    process.env.JWT_SECRET = "a".repeat(32);
    process.env.DATABASE_URL = "postgres://u:p@h:5432/d";
    process.env.DIRECT_URL = "postgres://u:p@h:5432/d";
    process.env.TELEGRAM_BOT_TOKEN = "123456:ABC-DEF";
    process.env.TELEGRAM_BOT_USERNAME = "BookoraBot";
    process.env.APP_URL = "https://example.com";
    process.env.BOT_USERNAME = "BookoraBot";
  });

  it("signSession and verifySession round-trip", async () => {
    const { signSession, verifySession } = await import("@/lib/auth/jwt");

    const token = await signSession({
      userId: "user-1",
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
    const { signSession, verifySession } = await import("@/lib/auth/jwt");

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
    const { verifySession } = await import("@/lib/auth/jwt");
    const payload = await verifySession("");
    expect(payload).toBeNull();
  });
});
