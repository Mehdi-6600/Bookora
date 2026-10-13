import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => {
  class PrismaClientKnownRequestError extends Error {
    code: string;
    meta?: Record<string, unknown>;

    constructor(
      message: string,
      options: { code: string; meta?: Record<string, unknown> }
    ) {
      super(message);
      this.name = "PrismaClientKnownRequestError";
      this.code = options.code;
      this.meta = options.meta;
    }
  }

  const tx = {
    $queryRaw: vi.fn(),
    business: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
  };

  return {
    PrismaClientKnownRequestError,
    tx,
    prisma: {
      $transaction: vi.fn(),
      business: {
        findMany: vi.fn(),
      },
    },
    getCurrentUser: vi.fn(),
    isRateLimited: vi.fn(),
    triggerRateLimitCleanup: vi.fn(),
    markRegistered: vi.fn(),
  };
});

vi.mock("@prisma/client", () => ({
  Prisma: {
    PrismaClientKnownRequestError: mocks.PrismaClientKnownRequestError,
  },
}));
vi.mock("@/lib/prisma", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/auth/session", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("@/lib/rate-limit", () => ({
  isRateLimited: mocks.isRateLimited,
  triggerRateLimitCleanup: mocks.triggerRateLimitCleanup,
}));
vi.mock("@/lib/outreach/attribution", () => ({
  markRegistered: mocks.markRegistered,
}));

import { GET, POST } from "@/app/api/business/route";

const owner = { id: "owner-1" };
const payload = {
  name: "North Studio",
  description: null,
  country: "OTHER",
  timezone: "America/New_York",
};

const records: Array<Record<string, unknown>> = [];
let nextBusinessId = 1;

function createRequest(key: string, body = payload): NextRequest {
  return new NextRequest("https://bookora.example/api/business", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": key,
    },
    body: JSON.stringify(body),
  });
}

function missingColumn(column: string) {
  return new mocks.PrismaClientKnownRequestError(
    `The column businesses.${column} does not exist.`,
    {
      code: "P2022",
      meta: { modelName: "Business", column: `businesses.${column}` },
    }
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  records.length = 0;
  nextBusinessId = 1;

  mocks.getCurrentUser.mockResolvedValue(owner);
  mocks.isRateLimited.mockResolvedValue(false);
  mocks.markRegistered.mockResolvedValue(undefined);
  mocks.prisma.$transaction.mockImplementation(
    async (operation: (transaction: typeof mocks.tx) => unknown) =>
      operation(mocks.tx)
  );
  mocks.tx.$queryRaw.mockResolvedValue([{ locked: "" }]);
  mocks.tx.business.findUnique.mockImplementation(async (args: any) => {
    const unique = args.where?.ownerId_creationKey;
    if (unique) {
      return (
        records.find(
          (record) =>
            record.ownerId === unique.ownerId &&
            record.creationKey === unique.creationKey
        ) ?? null
      );
    }

    const slug = args.where?.slug;
    return records.find((record) => record.slug === slug) ?? null;
  });
  mocks.tx.business.create.mockImplementation(async ({ data }: any) => {
    const record = {
      id: `business-${nextBusinessId++}`,
      ...data,
      setupCompletedAt: null,
    };
    records.push(record);
    return record;
  });
  mocks.prisma.business.findMany.mockResolvedValue([]);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("business registration route", () => {
  it("returns a clear migration error when the initial business lookup hits a missing lifecycle column", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.prisma.business.findMany.mockRejectedValue(missingColumn("deletedAt"));

    const response = await GET();

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "The business database needs a schema update.",
      code: "BUSINESS_SCHEMA_MIGRATION_REQUIRED",
    });
    expect(log).toHaveBeenCalledWith("GET /api/business schema mismatch:", {
      code: "P2022",
      modelName: "Business",
      column: "businesses.deletedAt",
    });
  });

  it("reports the missing idempotency field instead of returning a generic 500", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.tx.business.findUnique.mockRejectedValueOnce(
      missingColumn("creationKey")
    );

    const response = await POST(
      createRequest("7b129e40-d5c1-4c36-b1a9-1cc23f728a21")
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      code: "BUSINESS_SCHEMA_MIGRATION_REQUIRED",
    });
    expect(log).toHaveBeenCalledWith("POST /api/business schema mismatch:", {
      code: "P2022",
      modelName: "Business",
      column: "businesses.creationKey",
    });
    expect(mocks.tx.business.create).not.toHaveBeenCalled();
  });

  it("creates independent businesses and returns the same business for an idempotent retry", async () => {
    const firstKey = "7b129e40-d5c1-4c36-b1a9-1cc23f728a21";
    const secondKey = "f2820686-2f51-42ee-bd71-f51464c60c0c";

    const firstResponse = await POST(createRequest(firstKey));
    const first = await firstResponse.json();
    const secondResponse = await POST(createRequest(secondKey));
    const second = await secondResponse.json();
    const retryResponse = await POST(createRequest(firstKey));
    const retry = await retryResponse.json();

    expect(firstResponse.status).toBe(201);
    expect(secondResponse.status).toBe(201);
    expect(retryResponse.status).toBe(200);
    expect(first.business.id).not.toBe(second.business.id);
    expect(first.business.slug).not.toBe(second.business.slug);
    expect(retry.business.id).toBe(first.business.id);
    expect(mocks.tx.business.create).toHaveBeenCalledTimes(2);
    expect(records).toHaveLength(2);
    expect(records.every((record) => record.ownerId === owner.id)).toBe(true);
    expect(records.map((record) => record.creationKey)).toEqual([
      firstKey,
      secondKey,
    ]);
    expect(records.map((record) => record.status)).toEqual(["DRAFT", "DRAFT"]);
    expect(mocks.markRegistered).toHaveBeenCalledTimes(2);
  });
});
