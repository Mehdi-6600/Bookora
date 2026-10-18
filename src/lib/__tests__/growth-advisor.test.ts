import { describe, expect, it } from "vitest";
import { recommendGrowthActions, type GrowthAdvisorInput } from "@/lib/outreach/growth-advisor";

const base: GrowthAdvisorInput = {
  discoveryEnabled: true,
  discoveryBlockers: [],
  lastRunStatus: null,
  newCandidates: 0,
  pendingVerification: 0,
  dueFollowUps: 0,
  draftInvitations: 0,
  targetableProspects: 0,
  campaignCount: 0,
};

describe("Bookora growth advisor", () => {
  it("prioritizes fixing a failed run and setting up a missing authorized source", () => {
    const actions = recommendGrowthActions({
      ...base,
      lastRunStatus: "FAILED",
      discoveryBlockers: ["no_input_source"],
    });

    expect(actions.map((action) => action.code)).toEqual([
      "fix_failed_run",
      "configure_source",
    ]);
  });

  it("suggests reviewing real work in the funnel and caps recommendations at three", () => {
    const actions = recommendGrowthActions({
      ...base,
      newCandidates: 4,
      pendingVerification: 3,
      dueFollowUps: 2,
      draftInvitations: 1,
      targetableProspects: 5,
    });

    expect(actions).toHaveLength(3);
    expect(actions.map((action) => action.code)).toEqual([
      "review_candidates",
      "verify_prospects",
      "follow_up",
    ]);
    expect(actions[0].count).toBe(4);
  });

  it("does not suggest an acquisition source when discovery is disabled", () => {
    const actions = recommendGrowthActions({
      ...base,
      discoveryEnabled: false,
      discoveryBlockers: ["no_input_source"],
    });

    expect(actions).toEqual([]);
  });

  it("suggests a pilot only when there are targetable prospects and no campaign", () => {
    const actions = recommendGrowthActions({ ...base, targetableProspects: 6 });
    expect(actions).toEqual([{ code: "create_pilot", target: "campaigns", count: 6 }]);

    expect(
      recommendGrowthActions({ ...base, targetableProspects: 6, campaignCount: 1 })
    ).toEqual([]);
  });

  it("recommends human review rather than delivery", () => {
    const actions = recommendGrowthActions({
      ...base,
      dueFollowUps: 3,
      draftInvitations: 8,
    });
    expect(actions.map((action) => action.code)).toEqual(["follow_up", "review_drafts"]);
    expect(actions.map((action) => action.target)).toEqual(["prospects", "invitations"]);
  });
});
