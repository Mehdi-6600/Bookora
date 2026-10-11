import { describe, expect, it } from "vitest";

/**
 * Critical fix H — safe operator controls.
 *
 * A failed read must never look like an empty result, and a sensitive control
 * must be disabled (with a visible reason) while eligibility, the plan or the
 * kill switch are unresolved. These tests are the contract for that behaviour;
 * the render suite checks the same rules reach the DOM.
 */

import {
  campaignActionAvailability,
  failedLoadState,
  initialLoadState,
  invitationActionAvailability,
  isUnresolved,
  loadErrorText,
  loadView,
  loadingLoadState,
  planIsStale,
  readyLoadState,
  settingsGate,
  type CampaignActionInput,
} from "@/lib/outreach/operator-controls";

const READY: CampaignActionInput = {
  busy: false,
  statusUnresolved: false,
  campaignStatus: "DRAFT",
  planLoaded: true,
  planStale: false,
  settingsPaused: false,
  approvable: 3,
  heldOver: 0,
};

describe("load states distinguish empty from failed", () => {
  it("starts in loading, never in error or empty", () => {
    const state = initialLoadState<string[]>();
    expect(state.phase).toBe("loading");
    expect(isUnresolved(state)).toBe(true);
    expect(loadView(state, (rows) => rows.length === 0)).toBe("loading");
  });

  it("reports a failure as an error, not as an empty list", () => {
    const state = failedLoadState<string[]>(new Error("503: settings unreadable"));
    expect(state.phase).toBe("error");
    expect(state.error).toBe("503: settings unreadable");
    expect(loadErrorText(state)).toBe("503: settings unreadable");
    expect(loadView(state, () => true)).toBe("error");
    expect(isUnresolved(state)).toBe(true);
  });

  it("keeps the last known rows visible but still unresolved after a failure", () => {
    const loaded = readyLoadState(["a", "b"]);
    const failed = failedLoadState(new Error("network"), loaded);
    expect(failed.data).toEqual(["a", "b"]);
    expect(failed.phase).toBe("error");
    expect(isUnresolved(failed)).toBe(true);
    expect(loadView(failed, (rows) => rows.length === 0)).toBe("error");
  });

  it("only calls a successful, empty read 'empty'", () => {
    expect(loadView(readyLoadState<string[]>([]), (rows) => rows.length === 0)).toBe("empty");
    expect(loadView(readyLoadState(["a"]), (rows) => rows.length === 0)).toBe("ready");
  });

  it("applies a generic message when the error carries none", () => {
    const state = failedLoadState<string[]>({});
    expect(state.error).toMatch(/do not approve or send/i);
    expect(loadView(state, () => false)).toBe("error");
  });

  it("keeps previous data while reloading", () => {
    const previous = readyLoadState(["a"]);
    const reloading = loadingLoadState(previous);
    expect(reloading.phase).toBe("loading");
    expect(reloading.data).toEqual(["a"]);
    expect(isUnresolved(reloading)).toBe(true);
  });
});

describe("campaign controls", () => {
  it("disables everything while the data is unresolved", () => {
    const actions = campaignActionAvailability({ ...READY, statusUnresolved: true });
    for (const key of Object.keys(actions) as Array<keyof typeof actions>) {
      expect(actions[key].enabled, key).toBe(false);
      expect(actions[key].reason, key).toBe("controlBlockedUnresolved");
    }
  });

  it("never exposes delivery from this UI", () => {
    expect(campaignActionAvailability(READY).send).toEqual({
      enabled: false,
      reason: null,
    });
  });

  it("allows approval only with a fresh plan and an eligible recipient", () => {
    expect(campaignActionAvailability(READY).approve.enabled).toBe(true);
    expect(
      campaignActionAvailability({ ...READY, planLoaded: false }).approve
    ).toEqual({ enabled: false, reason: "controlBlockedPlanMissing" });
    expect(
      campaignActionAvailability({ ...READY, planStale: true }).approve
    ).toEqual({ enabled: false, reason: "controlBlockedPlanStale" });
    expect(
      campaignActionAvailability({ ...READY, approvable: 0 }).approve
    ).toEqual({ enabled: false, reason: "controlBlockedNoEligible" });
    expect(
      campaignActionAvailability({ ...READY, campaignStatus: "APPROVED" }).approve
    ).toEqual({ enabled: false, reason: "controlBlockedAlreadyApproved" });
  });

  it("keeps every message-producing action disabled while the kill switch is off", () => {
    const actions = campaignActionAvailability({ ...READY, settingsPaused: true });
    expect(actions.approve.enabled).toBe(false);
    expect(actions.approve.reason).toBe("controlBlockedSettingsPaused");
    expect(actions.prepare.enabled).toBe(false);
    expect(actions.approve_invitations.enabled).toBe(false);
    // A dry run writes nothing but a timestamp, so the server still allows it.
    expect(actions.dry_run.enabled).toBe(true);
  });

  it("requires an approved campaign before preparing invitations", () => {
    const actions = campaignActionAvailability({ ...READY, campaignStatus: "REVIEW" });
    expect(actions.prepare).toEqual({
      enabled: false,
      reason: "controlBlockedNotApproved",
    });
  });

  it("explains a full quota with the quota reason, not a generic one", () => {
    const actions = campaignActionAvailability({
      ...READY,
      campaignStatus: "APPROVED",
      approvable: 0,
      heldOver: 4,
    });
    expect(actions.prepare).toEqual({
      enabled: false,
      reason: "controlBlockedQuotaFull",
    });
    expect(actions.approve_invitations).toEqual({
      enabled: false,
      reason: "controlBlockedNoEligible",
    });
  });

  it("disables everything while another request is in flight or the campaign is sending", () => {
    expect(campaignActionAvailability({ ...READY, busy: true }).approve.reason).toBe(
      "controlBlockedBusy"
    );
    const sending = campaignActionAvailability({
      ...READY,
      campaignStatus: "SENDING",
    });
    expect(sending.dry_run.enabled).toBe(false);
    expect(sending.approve.enabled).toBe(false);
    expect(sending.prepare.enabled).toBe(false);
  });

  it("disables actions on a finished campaign", () => {
    const done = campaignActionAvailability({ ...READY, campaignStatus: "COMPLETED" });
    expect(done.dry_run).toEqual({ enabled: false, reason: "controlBlockedTerminal" });
    expect(done.approve.enabled).toBe(false);
  });
});

describe("invitation controls", () => {
  const base = {
    busy: false,
    statusUnresolved: false,
    invitationStatus: "DRAFT",
    settingsPaused: false,
  };

  it("disables everything while the invitation list is unresolved", () => {
    const actions = invitationActionAvailability({ ...base, statusUnresolved: true });
    for (const key of Object.keys(actions) as Array<keyof typeof actions>) {
      expect(actions[key].enabled, key).toBe(false);
      expect(actions[key].reason, key).toBe("controlBlockedUnresolved");
    }
  });

  it("approves only a DRAFT invitation", () => {
    expect(invitationActionAvailability(base).approve.enabled).toBe(true);
    expect(
      invitationActionAvailability({ ...base, invitationStatus: "APPROVED" }).approve
    ).toEqual({ enabled: false, reason: "controlBlockedNotDraft" });
  });

  it("records a manual send only from APPROVED, and never while paused", () => {
    expect(
      invitationActionAvailability({ ...base, invitationStatus: "APPROVED" })
        .mark_manual_sent.enabled
    ).toBe(true);
    expect(
      invitationActionAvailability({ ...base, invitationStatus: "DRAFT" })
        .mark_manual_sent
    ).toEqual({ enabled: false, reason: "controlBlockedNotApprovedInvitation" });
    expect(
      invitationActionAvailability({
        ...base,
        invitationStatus: "APPROVED",
        settingsPaused: true,
      }).mark_manual_sent
    ).toEqual({ enabled: false, reason: "controlBlockedSettingsPaused" });
    expect(
      invitationActionAvailability({ ...base, settingsPaused: true }).approve
    ).toEqual({ enabled: false, reason: "controlBlockedSettingsPaused" });
  });

  it("keeps the stop controls available so an operator can always back out", () => {
    const approved = invitationActionAvailability({
      ...base,
      invitationStatus: "APPROVED",
    });
    expect(approved.reject.enabled).toBe(true);
    expect(approved.reset.enabled).toBe(true);

    const delivered = invitationActionAvailability({
      ...base,
      invitationStatus: "DELIVERED",
    });
    expect(delivered.reject).toEqual({
      enabled: false,
      reason: "controlBlockedNotReviewable",
    });
    expect(delivered.reset.enabled).toBe(false);
  });
});

describe("plan staleness", () => {
  const campaign = {
    id: "cmp-1",
    approvedAt: new Date("2026-10-11T00:00:00.000Z"),
    lastDryRunAt: new Date("2026-10-11T00:00:00.000Z"),
    lastPreparedAt: null,
  };

  it("is fresh when it was generated after the campaign's last change", () => {
    expect(
      planIsStale(
        { campaignId: "cmp-1", generatedAt: new Date("2026-10-11T00:05:00.000Z") },
        campaign
      )
    ).toBe(false);
  });

  it("is stale when the campaign changed after the plan was evaluated", () => {
    expect(
      planIsStale(
        { campaignId: "cmp-1", generatedAt: new Date("2026-10-10T23:00:00.000Z") },
        { ...campaign, lastPreparedAt: new Date("2026-10-11T01:00:00.000Z") }
      )
    ).toBe(true);
  });

  it("treats a plan for another campaign, or without a timestamp, as stale", () => {
    expect(planIsStale({ campaignId: "cmp-2", generatedAt: campaign.approvedAt }, campaign)).toBe(true);
    expect(planIsStale({ campaignId: "cmp-1", generatedAt: null }, campaign)).toBe(true);
    expect(planIsStale({ campaignId: "cmp-1", generatedAt: "not-a-date" }, campaign)).toBe(true);
    expect(planIsStale(null, campaign)).toBe(true);
    expect(planIsStale({ campaignId: "cmp-1", generatedAt: campaign.approvedAt }, null)).toBe(true);
  });
});

describe("the settings gate (fail closed)", () => {
  it("is open only for an explicit enabled=true", () => {
    expect(
      settingsGate({ settings: { enabled: true, autoSendEnabled: false } })
    ).toEqual({ sendingAllowed: true, unreadable: false, paused: false });
  });

  it("treats an explicit off as paused, not unreadable", () => {
    expect(settingsGate({ settings: { enabled: false } })).toEqual({
      sendingAllowed: false,
      unreadable: false,
      paused: true,
    });
  });

  it("treats a missing, malformed or unreadable answer as unreadable and paused", () => {
    expect(settingsGate(null).unreadable).toBe(true);
    expect(settingsGate(undefined).sendingAllowed).toBe(false);
    expect(settingsGate({}).paused).toBe(true);
    expect(settingsGate({ settings: null }).unreadable).toBe(true);
    expect(settingsGate({ settings: { enabled: "true" } }).unreadable).toBe(true);
    expect(settingsGate({ settings: { enabled: true, readError: "db down" } }).unreadable).toBe(true);
    expect(settingsGate({ readError: "db down" }).paused).toBe(true);
    expect(settingsGate("unexpected").sendingAllowed).toBe(false);
  });
});
