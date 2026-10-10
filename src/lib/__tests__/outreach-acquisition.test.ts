import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * Route-level regression tests for the acquisition pipeline.
 *
 * The real route handlers and pipeline modules run against an in-memory
 * Prisma double. Nothing touches a database or Telegram:
 *   - `deliverTelegramMessage` is mocked and asserted to be called only for
 *     APPROVED invitations (never in these tests).
 *   - The feed source uses a stubbed `fetch`.
 */

type Row = Record<string, any>;

const state = vi.hoisted(() => ({
  tables: {} as Record<string, Row[]>,
  audit: [] as Array<Record<string, unknown>>,
  deliveries: [] as Array<{ telegramId: string; text: string }>,
  seq: 0,
}));

function table(name: string): Row[] {
  if (!state.tables[name]) state.tables[name] = [];
  return state.tables[name];
}

vi.mock("@/lib/prisma", async () => {
  const { createPrismaDouble } = await import("./helpers/prisma-double");
  return { prisma: createPrismaDouble(state) };
});

vi.mock("@/lib/auth/admin-api", () => ({
  requireAdmin: async () => ({ ok: true as const, user: { id: "admin-1", isAdmin: true } }),
}));

vi.mock("@/lib/rate-limit", () => ({
  isRateLimited: async () => false,
  triggerRateLimitCleanup: () => undefined,
}));

vi.mock("@/lib/outreach/audit", () => ({
  recordAuditEvent: async (event: Record<string, unknown>) => {
    state.audit.push(event);
  },
  getAuditEvents: async () => [],
}));

vi.mock("@/lib/telegram/notify", () => ({
  deliverTelegramMessage: async (telegramId: string, text: string) => {
    state.deliveries.push({ telegramId, text });
    return { ok: true, messageId: 1 };
  },
}));

import { GET as getDiscovery, POST as runDiscoveryNow } from "@/app/api/admin/outreach/discovery/route";
import {
  GET as getSettings,
  POST as postSeed,
} from "@/app/api/admin/outreach/settings/route";
import { POST as promoteRoute, GET as getCandidates } from "@/app/api/admin/outreach/candidates/route";
import { GET as getProspects, POST as createProspect } from "@/app/api/admin/outreach/prospects/route";
import { PATCH as patchProspect } from "@/app/api/admin/outreach/prospects/[id]/route";
import { PUT as installStarterKeywords } from "@/app/api/admin/outreach/keywords/route";
import {
  dryRunCampaign,
  approveCampaign,
  planCampaign,
  sendCampaignInvitations,
} from "@/lib/outreach/campaigns";
import { sendApprovedInvitations } from "@/lib/outreach/invitations";
import type { CampaignLike } from "@/lib/outreach/campaigns";

function jsonRequest(url: string, method: string, body?: unknown): NextRequest {
  return new NextRequest(new URL(url, "https://app.test"), {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function json(response: Response): Promise<any> {
  return response.json();
}

function setSetting(key: string, value: string) {
  const rows = table("adminSetting");
  const existing = rows.find((row) => row.key === key);
  if (existing) existing.value = value;
  else rows.push({ id: `s-${rows.length}`, key, value });
}

function storedSeed(): any[] {
  const row = table("adminSetting").find((item) => item.key === "outreach.manual_seed");
  if (!row) return [];
  const parsed: unknown = JSON.parse(row.value);
  return Array.isArray(parsed) ? parsed : [];
}

const SEED_BARBER = { publicName: "Mehdi Barber", publicUrl: "https://instagram.com/mehdi_barber", city: "Tehran" };

beforeEach(() => {
  for (const key of Object.keys(state.tables)) delete state.tables[key];
  state.audit.length = 0;
  state.deliveries.length = 0;
  state.seq = 0;
  vi.unstubAllGlobals();
});

describe("on-demand discovery diagnostics", () => {
  it("reports an empty, never-run pipeline without exposing secrets", async () => {
    const response = await getDiscovery();
    const body = await json(response);

    expect(response.status).toBe(200);
    expect(body.ready).toBe(false);
    expect(body.blockers).toContain("no_input_source");
    expect(body.lastRun).toBeNull();
    expect(body.keywords.source).toBe("starter");
    expect(body.candidates.total).toBe(0);
    // Feed URL is never returned, only whether one is configured.
    expect(JSON.stringify(body)).not.toMatch(/https:\/\/example\.com\/feed/);
    expect(body.switches).toEqual(
      expect.objectContaining({ discoveryEnabled: true, feedConfigured: false })
    );
  });

  it("blocks an on-demand run with no input source and records the attempt", async () => {
    const response = await runDiscoveryNow();
    const body = await json(response);

    expect(response.status).toBe(409);
    expect(body.ok).toBe(false);
    expect(body.status).toBe("BLOCKED");
    expect(body.blockers).toEqual(["no_input_source"]);
    expect(table("discoveryCandidate")).toHaveLength(0);
    expect(table("discoveryRun")[0]).toEqual(expect.objectContaining({ status: "BLOCKED" }));
  });
});

describe("successful on-demand discovery", () => {
  it("imports a valid public seed using the starter keywords and normalises the city", async () => {
    await postSeed(jsonRequest("/api/admin/outreach/settings", "POST", { items: [SEED_BARBER] }));

    const response = await runDiscoveryNow();
    const body = await json(response);

    expect(response.status).toBe(200);
    expect(body).toEqual(
      expect.objectContaining({ ok: true, status: "OK", discovered: 1, keywordSource: "starter" })
    );
    const [candidate] = table("discoveryCandidate");
    expect(candidate.publicName).toBe("Mehdi Barber");
    expect(candidate.city).toBe("TEHRAN");
    expect(candidate.status).toBe("NEW");
    expect(state.audit.some((event) => event.action === "discovery.manual_run")).toBe(true);
  });

  it("does not duplicate candidates when run again the same day", async () => {
    await postSeed(jsonRequest("/api/admin/outreach/settings", "POST", { items: [SEED_BARBER] }));
    await runDiscoveryNow();

    const second = await json(await runDiscoveryNow());

    expect(second.status).toBe("OK");
    expect(second.discovered).toBe(0);
    expect(second.blockers).toEqual(["all_duplicates"]);
    expect(table("discoveryCandidate")).toHaveLength(1);
    // Counts are accumulated, not overwritten, when a day is re-run.
    expect(table("discoveryRun")[0].discovered).toBe(1);
  });

  it("enforces the daily allowance across manual runs on the same date", async () => {
    setSetting("outreach.daily_discovery_limit", "1");
    await postSeed(
      jsonRequest("/api/admin/outreach/settings", "POST", {
        items: [SEED_BARBER, { publicName: "Ali Barber", publicUrl: "https://instagram.com/ali_barber", city: "Tehran" }],
      })
    );

    await runDiscoveryNow();
    const second = await json(await runDiscoveryNow());

    expect(second.status).toBe("BLOCKED");
    expect(second.blockers).toEqual(["daily_limit_reached"]);
    expect(table("discoveryCandidate")).toHaveLength(1);
  });
});

describe("discovery blockers", () => {
  it("blocks when discovery is globally disabled", async () => {
    setSetting("outreach.enabled", "false");
    await postSeed(jsonRequest("/api/admin/outreach/settings", "POST", { items: [SEED_BARBER] }));

    const response = await runDiscoveryNow();
    const body = await json(response);

    expect(response.status).toBe(409);
    expect(body.blockers).toEqual(["discovery_disabled"]);
    expect(table("discoveryCandidate")).toHaveLength(0);
  });

  it("blocks when the daily limit is zero", async () => {
    setSetting("outreach.daily_discovery_limit", "0");
    await postSeed(jsonRequest("/api/admin/outreach/settings", "POST", { items: [SEED_BARBER] }));

    const body = await json(await runDiscoveryNow());

    expect(body.blockers).toEqual(["zero_daily_limit"]);
    expect(table("discoveryCandidate")).toHaveLength(0);
  });

  it("reports no keyword match explicitly instead of a silent success", async () => {
    await postSeed(
      jsonRequest("/api/admin/outreach/settings", "POST", {
        items: [{ publicName: "Corner Grocery", publicUrl: "https://instagram.com/grocery" }],
      })
    );

    const response = await runDiscoveryNow();
    const body = await json(response);

    expect(response.status).toBe(200);
    expect(body.discovered).toBe(0);
    expect(body.blockers).toEqual(["no_keyword_match"]);
  });

  it("respects a deliberate disablement of every keyword and does not re-enable them", async () => {
    table("discoveryKeyword").push(
      { id: "k1", term: "barber", group: "BARBER", language: "en", priority: 5, enabled: false },
      { id: "k2", term: "salon", group: "BEAUTY", language: "en", priority: 2, enabled: false }
    );
    await postSeed(jsonRequest("/api/admin/outreach/settings", "POST", { items: [SEED_BARBER] }));

    const body = await json(await runDiscoveryNow());
    expect(body.blockers).toEqual(["keywords_disabled"]);
    expect(body.keywordSource).toBe("configured");

    // Installing the starter set must not flip existing rows back on.
    const install = await json(await installStarterKeywords());
    expect(install.kept).toBeGreaterThan(0);
    expect(table("discoveryKeyword").find((row) => row.id === "k1")!.enabled).toBe(false);
    expect(table("discoveryKeyword").find((row) => row.id === "k2")!.enabled).toBe(false);
  });

  it("returns FAILED (not success) when the only configured feed cannot be read", async () => {
    setSetting("outreach.feed_enabled", "true");
    setSetting("outreach.feed_url", "https://feeds.example.org/businesses.json");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 503 }))
    );

    const response = await runDiscoveryNow();
    const body = await json(response);

    expect(response.status).toBe(502);
    expect(body.ok).toBe(false);
    expect(body.status).toBe("FAILED");
    expect(body.sourceIssues).toEqual(["feed_http_error"]);
    expect(table("discoveryRun")[0].status).toBe("FAILED");
  });
});

describe("candidate promotion and normalisation", () => {
  async function discoverOne(item: Record<string, unknown>) {
    await postSeed(jsonRequest("/api/admin/outreach/settings", "POST", { items: [item] }));
    await runDiscoveryNow();
    return table("discoveryCandidate");
  }

  it("creates an UNVERIFIED prospect with a normalised city and inferred segment", async () => {
    const candidates = await discoverOne(SEED_BARBER);

    const response = await promoteRoute(
      jsonRequest("/api/admin/outreach/candidates", "POST", { candidateIds: [candidates[0].id] })
    );
    const body = await json(response);

    expect(response.status).toBe(201);
    expect(body.promoted).toBe(1);
    expect(body.unknownCity).toBe(0);
    expect(body.unknownSegment).toBe(0);
    const prospect = table("outreachProspect")[0];
    expect(prospect).toEqual(
      expect.objectContaining({
        city: "TEHRAN",
        segment: "MENS_BARBER",
        verificationStatus: "DISCOVERED",
        status: "NEW",
      })
    );
    expect(prospect.verificationDate).toBeFalsy();
  });

  it("accepts Persian and Latin city names from a seed and maps them to registry codes", async () => {
    await postSeed(
      jsonRequest("/api/admin/outreach/settings", "POST", {
        items: [
          { publicName: "Karaj Barber", publicUrl: "https://instagram.com/karaj_barber", city: "کرج" },
          { publicName: "Mashhad Barber", publicUrl: "https://instagram.com/mashhad_barber", city: "Mashhad" },
        ],
      })
    );
    await runDiscoveryNow();

    const cities = table("discoveryCandidate").map((row) => row.city).sort();
    expect(cities).toEqual(["KARAJ", "MASHHAD"]);
  });

  it("reports unknown city and segment explicitly and keeps those prospects out of targeting", async () => {
    table("discoveryKeyword").push(
      { id: "k1", term: "hairdresser", group: "BARBER", language: "en", priority: 4, enabled: true }
    );
    const candidates = await discoverOne({ publicName: "Downtown Hairdresser", publicUrl: "https://instagram.com/downtown_hd" });

    const body = await json(
      await promoteRoute(
        jsonRequest("/api/admin/outreach/candidates", "POST", { candidateIds: [candidates[0].id] })
      )
    );

    expect(body.unknownCity).toBe(1);
    expect(body.unknownSegment).toBe(1);
    expect(body.results[0]).toEqual(
      expect.objectContaining({ outcome: "promoted", unknownCity: true, unknownSegment: true })
    );
    const prospect = table("outreachProspect")[0];
    expect(prospect.city).toBeNull();
    expect(prospect.segment).toBeNull();
    expect(prospect.notes).toMatch(/City not resolved/);
  });

  it("does not create the same prospect twice on repeated promotion or existing duplicates", async () => {
    const candidates = await discoverOne(SEED_BARBER);
    const id = candidates[0].id;

    await promoteRoute(jsonRequest("/api/admin/outreach/candidates", "POST", { candidateIds: [id] }));
    const again = await json(
      await promoteRoute(jsonRequest("/api/admin/outreach/candidates", "POST", { candidateIds: [id] }))
    );

    expect(again.promoted).toBe(0);
    expect(again.results[0].outcome).toBe("already_linked");
    expect(table("outreachProspect")).toHaveLength(1);
  });

  it("links to an existing prospect instead of creating a second one", async () => {
    const candidates = await discoverOne(SEED_BARBER);
    // An administrator already added the same business by hand.
    await createProspect(
      jsonRequest("/api/admin/outreach/prospects", "POST", {
        publicName: "Mehdi Barber",
        publicUrl: "https://instagram.com/mehdi_barber",
        city: "Tehran",
      })
    );

    const body = await json(
      await promoteRoute(
        jsonRequest("/api/admin/outreach/candidates", "POST", { candidateIds: [candidates[0].id] })
      )
    );

    expect(body.promoted).toBe(0);
    expect(body.results[0].outcome).toBe("duplicate_prospect");
    expect(table("outreachProspect")).toHaveLength(1);
  });

  it("lists candidates through the same API the panel reads", async () => {
    await discoverOne(SEED_BARBER);
    const body = await json(await getCandidates(jsonRequest("/api/admin/outreach/candidates", "GET")));
    expect(body.candidates).toHaveLength(1);
  });
});

describe("prospect URL validation and safe edits", () => {
  it.each([
    ["javascript:", "javascript:alert(1)"],
    ["data:", "data:text/html;base64,PHNjcmlwdD4="],
    ["embedded credentials", "https://user:secret@instagram.com/mehdi"],
    ["local host", "https://localhost/barber"],
  ])("rejects a prospect with a %s URL", async (_label, url) => {
    const response = await createProspect(
      jsonRequest("/api/admin/outreach/prospects", "POST", { publicName: "Bad Url", publicUrl: url })
    );

    expect(response.status).toBe(400);
    expect(table("outreachProspect")).toHaveLength(0);
  });

  it("stores a valid public URL in canonical form", async () => {
    const response = await createProspect(
      jsonRequest("/api/admin/outreach/prospects", "POST", {
        publicName: "Mehdi Barber",
        publicUrl: "  https://instagram.com/mehdi_barber  ",
        city: "Tehran",
      })
    );

    expect(response.status).toBe(201);
    expect(table("outreachProspect")[0].publicUrl).toBe("https://instagram.com/mehdi_barber");
  });

  it("rejects an unsafe URL on update and an unknown city, and normalises a valid city", async () => {
    const created = await json(
      await createProspect(
        jsonRequest("/api/admin/outreach/prospects", "POST", { publicName: "Barber Two", city: "Shiraz" })
      )
    );
    const id = created.prospect.id;

    const unsafe = await patchProspect(
      jsonRequest(`/api/admin/outreach/prospects/${id}`, "PATCH", { publicUrl: "javascript:void(0)" }),
      { params: Promise.resolve({ id }) }
    );
    expect(unsafe.status).toBe(400);

    const unknownCity = await patchProspect(
      jsonRequest(`/api/admin/outreach/prospects/${id}`, "PATCH", { city: "Atlantis" }),
      { params: Promise.resolve({ id }) }
    );
    expect(unknownCity.status).toBe(400);

    const ok = await patchProspect(
      jsonRequest(`/api/admin/outreach/prospects/${id}`, "PATCH", { city: "کرج", segment: "mens_barber" }),
      { params: Promise.resolve({ id }) }
    );
    expect(ok.status).toBe(200);
    const row = table("outreachProspect").find((item) => item.id === id)!;
    expect(row.city).toBe("KARAJ");
    expect(row.segment).toBe("MENS_BARBER");
    // Editing never verifies a prospect.
    expect(row.verificationStatus).toBe("DISCOVERED");
  });
});

describe("seed configuration: read, save, persist", () => {
  it("returns an empty seed on a fresh install", async () => {
    const body = await json(await getSettings());
    expect(body.manualSeed).toEqual({ items: [], count: 0 });
  });

  it("saves a seed, reads it back and confirms the persisted count", async () => {
    const response = await postSeed(
      jsonRequest("/api/admin/outreach/settings", "POST", { items: [SEED_BARBER] })
    );
    const body = await json(response);

    expect(response.status).toBe(200);
    expect(body).toEqual(expect.objectContaining({ saved: 1, persisted: true, mode: "append" }));
    const read = await json(await getSettings());
    expect(read.manualSeed.items[0]).toEqual(
      expect.objectContaining({ publicName: "Mehdi Barber", city: "Tehran" })
    );
  });

  it("appends without wiping existing entries and skips duplicates", async () => {
    await postSeed(jsonRequest("/api/admin/outreach/settings", "POST", { items: [SEED_BARBER] }));
    const body = await json(
      await postSeed(
        jsonRequest("/api/admin/outreach/settings", "POST", {
          items: [
            SEED_BARBER,
            { publicName: "Nila Beauty Salon", publicUrl: "https://instagram.com/nila_beauty" },
          ],
        })
      )
    );

    expect(body.saved).toBe(2);
    expect(storedSeed().map((item: any) => item.publicName).sort()).toEqual([
      "Mehdi Barber",
      "Nila Beauty Salon",
    ]);
  });

  it("refuses to clear the stored list without explicit confirmation", async () => {
    await postSeed(jsonRequest("/api/admin/outreach/settings", "POST", { items: [SEED_BARBER] }));

    const refused = await postSeed(
      jsonRequest("/api/admin/outreach/settings", "POST", { items: [], mode: "replace" })
    );
    expect(refused.status).toBe(409);
    expect((await json(await getSettings())).manualSeed.count).toBe(1);

    const cleared = await postSeed(
      jsonRequest("/api/admin/outreach/settings", "POST", {
        items: [],
        mode: "replace",
        confirmClear: true,
      })
    );
    expect(cleared.status).toBe(200);
    expect((await json(await getSettings())).manualSeed.count).toBe(0);
  });

  it("rejects the whole save when any row has a dangerous URL, and stores nothing", async () => {
    await postSeed(jsonRequest("/api/admin/outreach/settings", "POST", { items: [SEED_BARBER] }));

    const response = await postSeed(
      jsonRequest("/api/admin/outreach/settings", "POST", {
        items: [
          { publicName: "Good Barber", publicUrl: "https://instagram.com/good_barber" },
          { publicName: "Evil", publicUrl: "javascript:alert(1)" },
        ],
      })
    );
    const body = await json(response);

    expect(response.status).toBe(400);
    expect(body.problems).toEqual([expect.objectContaining({ index: 1, field: "publicUrl" })]);
    expect(storedSeed().map((item: any) => item.publicName)).toEqual(["Mehdi Barber"]);
  });

  it("rejects a body without an items array", async () => {
    const response = await postSeed(jsonRequest("/api/admin/outreach/settings", "POST", { foo: 1 }));
    expect(response.status).toBe(400);
  });
});

describe("database-backed prospect counts", () => {
  beforeEach(() => {
    const rows = [
      { publicName: "A Barber", city: "TEHRAN", segment: "MENS_BARBER", verificationStatus: "VERIFIED", status: "NEW" },
      { publicName: "B Barber", city: "TEHRAN", segment: null, verificationStatus: "VERIFIED", status: "NEW" },
      { publicName: "C Salon", city: "KARAJ", segment: "WOMENS_SALON", verificationStatus: "DISCOVERED", status: "NEW" },
      { publicName: "D Salon", city: null, segment: null, verificationStatus: "REJECTED", status: "NEW" },
      { publicName: "E Salon", city: "SHIRAZ", segment: "WOMENS_SALON", verificationStatus: "VERIFIED", status: "NEW", optedOutAt: new Date() },
    ];
    rows.forEach((row, index) =>
      table("outreachProspect").push({
        id: `p${index}`,
        dedupeKey: `name:${index}`,
        optedOutAt: null,
        nextFollowUpAt: null,
        campaignId: null,
        telegramUsername: null,
        publicUrl: null,
        category: "BARBER",
        language: "fa",
        ...row,
      })
    );
  });

  it("counts the whole database even when the list is filtered", async () => {
    const body = await json(
      await getProspects(jsonRequest("/api/admin/outreach/prospects?verification=DISCOVERED&q=Salon", "GET"))
    );

    expect(body.prospects).toHaveLength(1);
    expect(body.counts).toEqual(
      expect.objectContaining({
        total: 5,
        pendingVerification: 1,
        verified: 3,
        rejected: 1,
        // Only A Barber is verified, has a city, a segment, and is not opted out.
        targetable: 1,
        excludedEstimate: 4,
        optedOut: 1,
      })
    );
  });

  it("never treats an unverified or segment-less prospect as targetable", async () => {
    const body = await json(await getProspects(jsonRequest("/api/admin/outreach/prospects", "GET")));
    expect(body.counts.targetable).toBe(1);
  });
});

describe("campaign safety", () => {
  const campaignBase: CampaignLike = {
    id: "cmp-1",
    code: "cmp_test",
    name: "Pilot",
    status: "REVIEW",
    cities: [],
    segments: [],
    language: "fa",
    objective: null,
    templateId: "tpl-1",
    cta: null,
    destinationUrl: null,
    followUpPolicy: "ONE_FOLLOWUP",
    channel: "TELEGRAM_BOT",
    sendLimit: null,
    lastDryRunAt: null,
  };

  beforeEach(() => {
    table("invitationTemplate").push({
      id: "tpl-1",
      code: "tpl_pilot_fa",
      category: "ALL",
      language: "fa",
      active: true,
      body: "پیام نمونه {businessName} {link}",
      createdAt: new Date(0),
    });
    table("outreachCampaign").push({ ...campaignBase, requestedById: null });
    const prospects = [
      { id: "verified", publicName: "Verified Barber", city: "TEHRAN", segment: "MENS_BARBER", verificationStatus: "VERIFIED", status: "NEW" },
      { id: "discovered", publicName: "Unverified Barber", city: "TEHRAN", segment: "MENS_BARBER", verificationStatus: "DISCOVERED", status: "NEW" },
      { id: "no-city", publicName: "Verified No City", city: null, segment: "MENS_BARBER", verificationStatus: "VERIFIED", status: "NEW" },
      { id: "no-segment", publicName: "Verified No Segment", city: "TEHRAN", segment: null, verificationStatus: "VERIFIED", status: "NEW" },
    ];
    for (const prospect of prospects) {
      table("outreachProspect").push({
        optedOutAt: null,
        nextFollowUpAt: null,
        campaignId: null,
        telegramUsername: null,
        publicUrl: null,
        category: "BARBER",
        language: "fa",
        dedupeKey: `name:${prospect.id}`,
        ...prospect,
      });
    }
  });

  it("plans only verified prospects with a registry city and a segment", async () => {
    const plan = await planCampaign(campaignBase);
    expect(plan.recipients.map((recipient) => recipient.prospectId)).toEqual(["verified"]);
  });

  it("dry run excludes unverified prospects and creates no invitations or deliveries", async () => {
    const result = await dryRunCampaign("cmp-1", "admin-1");

    expect(result.ok).toBe(true);
    expect(result.ok && result.plan.recipients.map((r) => r.prospectId)).toEqual(["verified"]);
    expect(table("outreachInvitation")).toHaveLength(0);
    expect(state.deliveries).toHaveLength(0);
  });

  it("requires an explicit approval before any invitation can be sent", async () => {
    // A dry run alone is not approval.
    const beforeApproval = await sendCampaignInvitations({ campaignId: "cmp-1", limit: 10 });
    expect(beforeApproval.ok).toBe(false);

    await dryRunCampaign("cmp-1", "admin-1");
    const approval = await approveCampaign("cmp-1", "admin-1");
    expect(approval.ok).toBe(true);
    expect(state.deliveries).toHaveLength(0);

    // A DRAFT invitation (not yet approved) must never be delivered.
    table("outreachInvitation").push({
      id: "inv-draft",
      prospectId: "verified",
      campaignId: "cmp-1",
      status: "DRAFT",
      body: "hello",
      approvedAt: null,
      createdAt: new Date(0),
    });
    await sendApprovedInvitations({ limit: 10 });
    expect(state.deliveries).toHaveLength(0);
    expect(table("outreachInvitation")[0].status).toBe("DRAFT");
  });
});
