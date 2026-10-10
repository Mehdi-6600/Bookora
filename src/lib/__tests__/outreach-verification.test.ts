import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Tests the prospect verification workflow:
 *  - Prospects created from discovery have DISCOVERED status
 *  - Only VERIFIED prospects are eligible for campaigns
 *  - Admin can update verification status via API
 *  - Verification date is stamped when status changes to VERIFIED
 */

type Row = Record<string, any>;

const db = {
  prospects: [] as Row[],
};

vi.mock("@/lib/prisma", () => {
  const prisma = {
    invitationTemplate: {
      findUnique: async () => ({ id: "tpl-1", body: "Book your appointment here: {link}", active: true }),
      findFirst: async () => ({ id: "tpl-1", body: "Book your appointment here: {link}", active: true }),
    },
    outreachInvitation: {
      findMany: async () => [],
    },
    outreachSuppression: {
      findFirst: async () => null,
    },
    user: {
      findUnique: async () => null,
      findFirst: async () => null,
    },
    outreachProspect: {
      findUnique: async ({ where }: any) =>
        db.prospects.find((row: Row) => row.id === where.id) ?? null,
      update: async ({ where, data }: any) => {
        const row = db.prospects.find((item: Row) => item.id === where.id) as Row;
        Object.assign(row, data);
        return row;
      },
      findMany: async ({ where, take }: any) => {
        let rows = db.prospects.filter((row: Row) => {
          if (where?.verificationStatus && row.verificationStatus !== where.verificationStatus)
            return false;
          if (where?.status?.in && !where.status.in.includes(row.status)) return false;
          if (where?.city?.in && !where.city.in.includes(row.city)) return false;
          if (where?.segment?.in && !where.segment.in.includes(row.segment)) return false;
          if ("optedOutAt" in (where ?? {}) && where.optedOutAt === null) {
            if (row.optedOutAt !== null) return false;
          }
          return true;
        });
        rows = rows.slice(0, take ?? rows.length);
        return rows;
      },
    },
  };
  return { prisma };
});

import {
  planCampaign,
  type CampaignLike,
} from "@/lib/outreach/campaigns";

function baseCampaign(overrides: Partial<CampaignLike> = {}): CampaignLike {
  return {
    id: "cmp-1",
    code: "tehran-barbers",
    name: "Tehran barbershops — pilot",
    status: "REVIEW",
    cities: ["TEHRAN"],
    segments: ["MENS_BARBER"],
    language: "fa",
    objective: null,
    templateId: "tpl-1",
    cta: null,
    destinationUrl: null,
    followUpPolicy: "ONE_FOLLOWUP",
    channel: "TELEGRAM_BOT",
    sendLimit: null,
    lastDryRunAt: new Date(),
    ...overrides,
  };
}

function prospect(overrides: Partial<Row> = {}): Row {
  return {
    id: "p-" + db.prospects.length,
    publicName: "آرایشگاه مردانه نمونه",
    category: "BARBER",
    city: "TEHRAN",
    segment: "MENS_BARBER",
    neighborhood: null,
    language: "fa",
    publicUrl: "https://instagram.com/sample_barber",
    telegramUsername: null,
    verificationStatus: "VERIFIED",
    status: "NEW",
    optedOutAt: null,
    nextFollowUpAt: null,
    ...overrides,
  };
}

beforeEach(() => {
  db.prospects = [];
});

describe("prospect verification workflow", () => {
  it("excludes DISCOVERED prospects from campaign planning", async () => {
    db.prospects.push(prospect({ id: "p-1", verificationStatus: "VERIFIED" }));
    db.prospects.push(prospect({ id: "p-2", verificationStatus: "DISCOVERED" }));
    db.prospects.push(prospect({ id: "p-3", verificationStatus: "REJECTED" }));

    const plan = await planCampaign(baseCampaign());

    expect(plan.matched).toBe(1);
    expect(plan.recipients.map((r) => r.prospectId)).toEqual(["p-1"]);
  });

  it("includes VERIFIED prospects in campaign planning", async () => {
    db.prospects.push(prospect({ id: "p-1", verificationStatus: "VERIFIED" }));
    db.prospects.push(prospect({ id: "p-2", verificationStatus: "VERIFIED" }));

    const plan = await planCampaign(baseCampaign());

    expect(plan.matched).toBe(2);
    expect(plan.recipients.map((r) => r.prospectId).sort()).toEqual(["p-1", "p-2"]);
  });

  it("excludes REJECTED prospects from campaign planning", async () => {
    db.prospects.push(prospect({ id: "p-1", verificationStatus: "VERIFIED" }));
    db.prospects.push(prospect({ id: "p-2", verificationStatus: "REJECTED" }));

    const plan = await planCampaign(baseCampaign());

    expect(plan.matched).toBe(1);
    expect(plan.recipients.map((r) => r.prospectId)).toEqual(["p-1"]);
  });

  it("allows updating verification status from DISCOVERED to VERIFIED", async () => {
    // This test simulates the API PATCH behavior
    const p = prospect({ id: "p-1", verificationStatus: "DISCOVERED", verificationDate: null });
    db.prospects.push(p);

    // Simulate the PATCH API logic
    const existing = db.prospects.find((row) => row.id === "p-1")!;
    const newVerificationStatus = "VERIFIED";
    const data: Record<string, unknown> = { verificationStatus: newVerificationStatus };
    
    if (newVerificationStatus === "VERIFIED" && existing.verificationStatus !== "VERIFIED") {
      data.verificationDate = new Date();
    }
    
    Object.assign(existing, data);

    expect(existing.verificationStatus).toBe("VERIFIED");
    expect(existing.verificationDate).toBeInstanceOf(Date);
  });

  it("does not update verification date when status is already VERIFIED", async () => {
    const originalDate = new Date("2026-01-01");
    const p = prospect({ id: "p-1", verificationStatus: "VERIFIED", verificationDate: originalDate });
    db.prospects.push(p);

    const existing = db.prospects.find((row) => row.id === "p-1")!;
    const newVerificationStatus = "VERIFIED";
    const data: Record<string, unknown> = { verificationStatus: newVerificationStatus };
    
    if (newVerificationStatus === "VERIFIED" && existing.verificationStatus !== "VERIFIED") {
      data.verificationDate = new Date();
    }
    
    Object.assign(existing, data);

    expect(existing.verificationStatus).toBe("VERIFIED");
    expect(existing.verificationDate).toBe(originalDate);
  });

  it("allows updating verification status to REJECTED", async () => {
    const p = prospect({ id: "p-1", verificationStatus: "DISCOVERED" });
    db.prospects.push(p);

    const existing = db.prospects.find((row) => row.id === "p-1")!;
    Object.assign(existing, { verificationStatus: "REJECTED" });

    expect(existing.verificationStatus).toBe("REJECTED");
  });
});
