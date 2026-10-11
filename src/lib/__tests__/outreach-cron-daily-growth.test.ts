import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * Cron daily-growth route: authentication and BLOCKED handling. Discovery runs
 * through the real pipeline against the in-memory Prisma double. Preparation,
 * delivery, attribution and reporting are mocked, so nothing can be sent.
 */

const state = vi.hoisted(() => ({
  tables: {} as Record<string, Array<Record<string, any>>>,
  seq: 0,
  reports: [] as unknown[],
}));

vi.mock("@/lib/prisma", async () => {
  const { createPrismaDouble } = await import("./helpers/prisma-double");
  return { prisma: createPrismaDouble(state) };
});

vi.mock("@/lib/outreach/invitations", () => ({
  prepareInvitations: async () => ({ prepared: [] }),
  sendApprovedInvitations: async () => [],
}));

vi.mock("@/lib/outreach/attribution", () => ({
  getConversionCounts: async () => ({ botStarts: 0, registrations: 0, activations: 0, firstBookings: 0 }),
}));

vi.mock("@/lib/outreach/report", () => ({
  sendDailyReport: async (report: unknown) => {
    state.reports.push(report);
    return 0;
  },
}));

import { GET as dailyGrowth } from "@/app/api/cron/daily-growth/route";
const { outreachSettingsRows } = await import("./helpers/outreach-settings");

const SECRET = "s".repeat(40);

function cronRequest(authorization?: string): NextRequest {
  return new NextRequest(new URL("/api/cron/daily-growth", "https://app.test"), {
    headers: authorization === undefined ? undefined : { authorization },
  });
}

beforeEach(() => {
  for (const key of Object.keys(state.tables)) delete state.tables[key];
  // The kill switch is fail-closed, so the run only happens when an
  // administrator explicitly switched outreach on.
  state.tables.adminSetting = outreachSettingsRows();
  state.reports.length = 0;
  vi.stubEnv("CRON_SECRET", SECRET);
});

describe("cron daily growth: authentication", () => {
  it("rejects a request without the cron bearer secret", async () => {
    const response = await dailyGrowth(cronRequest());
    expect(response.status).toBe(401);
    expect(state.tables.discoveryRun ?? []).toHaveLength(0);
  });

  it("rejects a wrong bearer secret", async () => {
    const response = await dailyGrowth(cronRequest(`Bearer ${"x".repeat(40)}`));
    expect(response.status).toBe(401);
  });
});

describe("cron daily growth: BLOCKED discovery", () => {
  it("records a BLOCKED run (not OK) with the blocker, and still reports", async () => {
    const response = await dailyGrowth(cronRequest(`Bearer ${SECRET}`));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.discoveryBlockers).toEqual(["no_input_source"]);
    expect(body.discovery.discovered).toBe(0);
    expect(body.errors).toEqual([]);

    const [run] = state.tables.discoveryRun ?? [];
    expect(run.status).toBe("BLOCKED");
    expect(run.error).toBeNull();
    expect(state.tables.discoveryCandidate ?? []).toHaveLength(0);
    expect(state.reports).toHaveLength(1);
  });

  it("does not run twice for the same date once a run row exists", async () => {
    await dailyGrowth(cronRequest(`Bearer ${SECRET}`));
    const second = await (await dailyGrowth(cronRequest(`Bearer ${SECRET}`))).json();

    expect(second).toEqual(expect.objectContaining({ skipped: true, reason: "already executed" }));
    expect(state.tables.discoveryRun).toHaveLength(1);
  });
});
