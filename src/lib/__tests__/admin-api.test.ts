import { beforeEach, describe, expect, it, vi } from "vitest";
import { requireAdmin } from "@/lib/auth/admin-api";

const sessionMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth/session", () => ({
  getCurrentUser: sessionMock,
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("requireAdmin", () => {
  it("returns 401 when there is no authenticated session", async () => {
    sessionMock.mockResolvedValue(null);

    const result = await requireAdmin();

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.response.status).toBe(401);
    expect(await result.response.json()).toEqual({ error: "Unauthorized" });
  });

  it("returns 403 for an authenticated non-admin", async () => {
    sessionMock.mockResolvedValue({ id: "user-1", isAdmin: false });

    const result = await requireAdmin();

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.response.status).toBe(403);
    expect(await result.response.json()).toEqual({ error: "Forbidden" });
  });

  it("passes through the authorized administrator identity", async () => {
    const admin = { id: "admin-1", isAdmin: true };
    sessionMock.mockResolvedValue(admin);

    const result = await requireAdmin();

    expect(result).toEqual({ ok: true, user: admin });
  });
});
