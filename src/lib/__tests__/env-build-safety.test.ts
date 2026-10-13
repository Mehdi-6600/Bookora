import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prismaClientConstructor: vi.fn(),
}));

vi.mock("@prisma/client", () => ({
  PrismaClient: class {
    constructor(options?: unknown) {
      mocks.prismaClientConstructor(options);
    }
  },
}));

const envErrorLog = "❌ Invalid server env:";

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("DIRECT_URL", "");
  mocks.prismaClientConstructor.mockClear();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("server environment validation during build", () => {
  it("allows the admin API route to be imported without database URLs", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const route = await import("@/app/api/admin/businesses/[id]/route");

    expect(route.GET).toBeTypeOf("function");
    expect(route.PATCH).toBeTypeOf("function");
    expect(route.DELETE).toBeTypeOf("function");
    expect(mocks.prismaClientConstructor).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalledWith(envErrorLog, expect.anything());
  });

  it("still rejects missing database URLs before creating a runtime Prisma client", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { prisma } = await import("@/lib/prisma");

    expect(mocks.prismaClientConstructor).not.toHaveBeenCalled();
    expect(() => (prisma as any).$connect).toThrow(
      "Invalid server environment variables"
    );
    expect(mocks.prismaClientConstructor).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(
      envErrorLog,
      expect.objectContaining({
        DATABASE_URL: expect.any(Array),
        DIRECT_URL: expect.any(Array),
      })
    );
  });

  it("validates a consumed setting without requiring unrelated database settings", async () => {
    const { env } = await import("@/lib/env");

    expect(env.APP_URL).toBe("https://example.com");
  });
});
