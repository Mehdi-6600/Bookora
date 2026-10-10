import { describe, expect, it } from "vitest";
import {
  aggregateByDimension,
  buildCampaignReport,
  buildFunnelStages,
  conversionRate,
  type InvitationDimensionRow,
  type ProspectDimensionRow,
} from "@/lib/outreach/analytics";

/**
 * Analytics honesty rules:
 *  - a stage without a data source is `measured: false`, never a fake zero;
 *  - prepared ≠ delivered, and each stays its own stage;
 *  - rates are computed from recorded counts only, and null when the
 *    denominator is missing.
 */

const mc = (count: number, source = "test") => ({ count, source });

describe("funnel stages", () => {
  it("marks missing sources as unmeasured", () => {
    const stages = buildFunnelStages({
      discovered: mc(100),
      // duplicateCandidates intentionally absent → unmeasured
      invitationsDrafted: mc(40),
    });

    const duplicates = stages.find((s) => s.key === "duplicateCandidates")!;
    expect(duplicates.measured).toBe(false);
    expect(duplicates.count).toBeNull();

    const discovered = stages.find((s) => s.key === "discovered")!;
    expect(discovered.measured).toBe(true);
    expect(discovered.count).toBe(100);
  });

  it("keeps drafted/approved/prepared/delivered as separate stages", () => {
    const stages = buildFunnelStages({
      invitationsDrafted: mc(10),
      invitationsApproved: mc(4),
      invitationsPrepared: mc(3),
      deliveryAttempted: mc(2),
      deliveryConfirmed: mc(1),
    });
    const by = Object.fromEntries(stages.map((s) => [s.key, s.count]));
    expect(by.invitationsDrafted).toBe(10);
    expect(by.invitationsApproved).toBe(4);
    expect(by.invitationsPrepared).toBe(3);
    expect(by.deliveryAttempted).toBe(2);
    expect(by.deliveryConfirmed).toBe(1);
    // Delivered is NOT promoted to "prepared" or vice versa.
    expect(stages.find((s) => s.key === "deliveryConfirmed")!.source).toBeTruthy();
  });

  it("computes step-to-step conversion only over measured positives", () => {
    const stages = buildFunnelStages({
      discovered: mc(100),
      duplicateCandidates: mc(20),
      reviewedApproved: mc(50),
    });
    const byKey = Object.fromEntries(stages.map((s) => [s.key, s]));
    expect(byKey.duplicateCandidates.conversionFromPrev).toBeCloseTo(0.2, 4);
    expect(byKey.reviewedApproved.conversionFromPrev).toBeCloseTo(2.5, 4);

    // A break in measurement must NOT chain across it: with no source for the
    // previous stage, the conversion is null, not a guessed ratio.
    const broken = buildFunnelStages({
      discovered: mc(100),
      reviewedApproved: mc(50),
    });
    const brokenByKey = Object.fromEntries(broken.map((s) => [s.key, s]));
    expect(brokenByKey.reviewedApproved.conversionFromPrev).toBeNull();
  });
});

describe("conversionRate", () => {
  it("is null for an empty denominator", () => {
    expect(conversionRate(0, 5)).toBeNull();
  });
  it("rounds to 4 decimals", () => {
    expect(conversionRate(3, 1)).toBe(0.3333);
  });
});

describe("dimension aggregation", () => {
  const prospects: ProspectDimensionRow[] = [
    { id: "p1", city: "TEHRAN", segment: "MENS_BARBER", language: "fa", status: "CONTACTED", verificationStatus: "VERIFIED", optedOutAt: null },
    { id: "p2", city: "TEHRAN", segment: "WOMENS_SALON", language: "fa", status: "NEW", verificationStatus: "DISCOVERED", optedOutAt: null },
    { id: "p3", city: "KARAJ", segment: "MENS_BARBER", language: "fa", status: "DO_NOT_CONTACT", verificationStatus: "VERIFIED", optedOutAt: new Date() },
    { id: "p4", city: null, segment: "MENS_BARBER", language: "en", status: "NEW", verificationStatus: "DISCOVERED", optedOutAt: null },
  ];
  const invitations: InvitationDimensionRow[] = [
    { prospectId: "p1", status: "DELIVERED", campaignId: "c1" },
    { prospectId: "p1", status: "APPROVED", campaignId: "c1" },
    { prospectId: "p2", status: "DRAFT", campaignId: "c1" },
    // invitation for a prospect outside the page — must be ignored, not crash
    { prospectId: "ghost", status: "DELIVERED", campaignId: "c1" },
  ];

  it("groups by city with drafted/approved/delivered kept apart", () => {
    const rows = aggregateByDimension(prospects, invitations, "city");
    const tehran = rows.find((r) => r.key === "TEHRAN")!;
    expect(tehran.discovered).toBe(2);
    expect(tehran.verified).toBe(1);
    expect(tehran.drafted).toBe(3); // DRAFT + APPROVED + DELIVERED of p1/p2
    expect(tehran.approved).toBe(2); // APPROVED + DELIVERED
    expect(tehran.delivered).toBe(1);
    const karaj = rows.find((r) => r.key === "KARAJ")!;
    expect(karaj.optedOut).toBe(1);
    const unassigned = rows.find((r) => r.key === "UNASSIGNED")!;
    expect(unassigned.discovered).toBe(1);
  });

  it("groups by language and segment", () => {
    expect(aggregateByDimension(prospects, [], "language").find((r) => r.key === "en")!.discovered).toBe(1);
    expect(
      aggregateByDimension(prospects, [], "segment").find((r) => r.key === "MENS_BARBER")!.discovered
    ).toBe(3);
  });
});

describe("campaign report", () => {
  it("sums invitation statuses into the right columns", () => {
    const rows = buildCampaignReport(
      [
        {
          id: "c1",
          code: "tehran-barbers",
          name: "Tehran barbershops",
          status: "APPROVED",
          cities: ["TEHRAN"],
          language: "fa",
          _count: { botStarts: 1 },
        },
      ],
      [
        { campaignId: "c1", status: "DRAFT", count: 3 },
        { campaignId: "c1", status: "APPROVED", count: 2 },
        { campaignId: "c1", status: "DELIVERED", count: 2 },
      ],
      [
        { campaignId: "c1", status: "NEW", count: 8 },
        { campaignId: "c1", status: "REGISTERED", count: 1 },
        { campaignId: "c1", status: "ACTIVATED", count: 1 },
      ]
    );

    const report = rows[0];
    expect(report.invitationsDrafted).toBe(7); // 3 DRAFT + 2 APPROVED + 2 DELIVERED
    expect(report.invitationsApproved).toBe(4); // 2 APPROVED + 2 DELIVERED
    expect(report.invitationsDelivered).toBe(2); // only actually delivered
    expect(report.prospects).toBe(10);
    expect(report.registrations).toBe(2);
    expect(report.botStarts).toBe(1);
    // delivered→bot-start ratio; null instead of a fake 0 when undelivered.
    expect(report.activationRate).toBe(0.5);
  });
});
