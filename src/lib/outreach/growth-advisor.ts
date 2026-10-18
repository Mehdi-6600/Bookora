/**
 * Deterministic next-step advisor for the acquisition dashboard.
 *
 * V1 intentionally uses only recorded pipeline state. It does not invent
 * prospects, infer success from missing data, or send messages. Keeping this
 * pure makes the recommendations testable and safe to run on every stats read.
 */

export type GrowthActionCode =
  | "fix_failed_run"
  | "configure_source"
  | "review_candidates"
  | "verify_prospects"
  | "follow_up"
  | "review_drafts"
  | "create_pilot"
  | "collect_first_leads";

export type GrowthActionTarget = "discovery" | "prospects" | "invitations" | "campaigns";

export type GrowthAction = {
  code: GrowthActionCode;
  target: GrowthActionTarget;
  count?: number;
};

export type GrowthAdvisorInput = {
  discoveryEnabled: boolean;
  discoveryBlockers: string[];
  lastRunStatus: string | null;
  newCandidates: number;
  pendingVerification: number;
  dueFollowUps: number;
  draftInvitations: number;
  targetableProspects: number;
  campaignCount: number;
};

/** Return up to three highest-value actions, in deterministic priority order. */
export function recommendGrowthActions(input: GrowthAdvisorInput): GrowthAction[] {
  const actions: GrowthAction[] = [];
  const blockers = new Set(input.discoveryBlockers);

  if (input.lastRunStatus === "FAILED") {
    actions.push({ code: "fix_failed_run", target: "discovery" });
  }

  if (
    input.discoveryEnabled &&
    (blockers.has("no_input_source") || blockers.has("no_valid_input"))
  ) {
    actions.push({ code: "configure_source", target: "discovery" });
  }

  if (input.newCandidates > 0) {
    actions.push({ code: "review_candidates", target: "discovery", count: input.newCandidates });
  }

  if (input.pendingVerification > 0) {
    actions.push({ code: "verify_prospects", target: "prospects", count: input.pendingVerification });
  }

  if (input.dueFollowUps > 0) {
    actions.push({ code: "follow_up", target: "prospects", count: input.dueFollowUps });
  }

  if (input.draftInvitations > 0) {
    actions.push({ code: "review_drafts", target: "invitations", count: input.draftInvitations });
  }

  if (input.targetableProspects > 0 && input.campaignCount === 0) {
    actions.push({ code: "create_pilot", target: "campaigns", count: input.targetableProspects });
  }

  if (
    actions.length === 0 &&
    input.discoveryEnabled &&
    input.targetableProspects === 0 &&
    input.newCandidates === 0 &&
    input.pendingVerification === 0
  ) {
    actions.push({ code: "collect_first_leads", target: "discovery" });
  }

  return actions.slice(0, 3);
}
