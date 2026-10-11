/**
 * Operator-facing state for the outreach panel (critical fix H).
 *
 * Two things live here, both pure and unit-tested:
 *
 *  1. `LoadState` — an explicit loading / ready / error state so the UI can
 *     tell "nothing was ever loaded" apart from "the request failed" apart
 *     from "the server returned an empty list". A failed load is never
 *     rendered as an empty list.
 *
 *  2. `campaignActionAvailability` / `invitationActionAvailability` — which
 *     sensitive controls may be enabled right now, and why not. The rules
 *     mirror the server: while eligibility, settings or the plan are
 *     unresolved, the action is disabled rather than sent and rejected.
 *     Nothing here replaces server validation; it only stops the operator from
 *     firing a request that the server would refuse.
 */

export type LoadPhase = "loading" | "ready" | "error";

export type LoadState<T> = {
  phase: LoadPhase;
  data: T | null;
  error: string | null;
  /** When the successful read finished, for staleness checks. */
  loadedAt: number | null;
};

export function initialLoadState<T>(): LoadState<T> {
  return { phase: "loading", data: null, error: null, loadedAt: null };
}

export function loadingLoadState<T>(previous?: LoadState<T>): LoadState<T> {
  return {
    phase: "loading",
    data: previous?.data ?? null,
    error: null,
    loadedAt: previous?.loadedAt ?? null,
  };
}

export function readyLoadState<T>(data: T): LoadState<T> {
  return { phase: "ready", data, error: null, loadedAt: Date.now() };
}

export function failedLoadState<T>(
  error: unknown,
  previous?: LoadState<T>
): LoadState<T> {
  return {
    phase: "error",
    // Keep the last known data visible but marked as failed: an operator must
    // never mistake a stale list for a fresh one.
    data: previous?.data ?? null,
    error:
      error instanceof Error && error.message
        ? error.message
        : "Unable to read outreach data; do not approve or send.",
    loadedAt: previous?.loadedAt ?? null,
  };
}

/** True while a load is in flight or has failed: nothing may be actioned yet. */
export function isUnresolved<T>(state: LoadState<T>): boolean {
  return state.phase !== "ready";
}

export function loadErrorText<T>(state: LoadState<T>): string | null {
  return state.phase === "error" ? state.error : null;
}

export type LoadView = "loading" | "error" | "empty" | "ready";

/**
 * How the UI should render a load state. `isEmpty` is only consulted for a
 * successful read, so an error can never be displayed as an empty state.
 */
export function loadView<T>(
  state: LoadState<T>,
  isEmpty: (data: T) => boolean
): LoadView {
  if (state.phase === "loading") return "loading";
  if (state.phase === "error") return "error";
  if (state.data === null) return "empty";
  return isEmpty(state.data) ? "empty" : "ready";
}

/* ------------------------------------------------------------------------- */
/* Campaign controls                                                          */
/* ------------------------------------------------------------------------- */

export const CAMPAIGN_ACTIONS = [
  "dry_run",
  "approve",
  "prepare",
  "approve_invitations",
  "send",
] as const;
export type CampaignAction = (typeof CAMPAIGN_ACTIONS)[number];

export type ActionAvailability = {
  enabled: boolean;
  /** i18n key explaining a disabled control; null when enabled. */
  reason: string | null;
};

export type CampaignActionInput = {
  busy: boolean;
  /** The campaign list or the selected campaign's plan failed to load. */
  statusUnresolved: boolean;
  campaignStatus: string;
  /** True once the reviewer has the current plan for THIS campaign. */
  planLoaded: boolean;
  /** Plan is from an earlier server evaluation than the last mutation. */
  planStale?: boolean;
  /** Outreach kill switch is engaged (or settings could not be read). */
  settingsPaused: boolean;
  /** Recipients this run would genuinely prepare (eligible AND in quota). */
  approvable: number;
  /** Eligible recipients the quota currently holds back. */
  heldOver?: number;
};

const DISABLED: ActionAvailability = { enabled: false, reason: null };

function availability(
  enabled: boolean,
  reason: string | null
): ActionAvailability {
  return enabled ? { enabled: true, reason: null } : { enabled: false, reason };
}

/**
 * Decide which campaign buttons may be pressed.
 *
 * Fail-closed by construction: any unresolved input disables every action, the
 * kill switch disables every action that could lead to an outbound message, and
 * an empty plan disables approval because the reviewer would be approving
 * recipients they have not seen.
 *
 * Delivery (`send`) is never enabled from this UI: the panel exposes no send
 * button, and a green answer here would not change that.
 */
export function campaignActionAvailability(
  input: CampaignActionInput
): Record<CampaignAction, ActionAvailability> {
  const {
    busy,
    statusUnresolved,
    campaignStatus,
    planLoaded,
    planStale = false,
    settingsPaused,
    approvable,
    heldOver = 0,
  } = input;

  if (statusUnresolved) {
    return {
      dry_run: availability(false, "controlBlockedUnresolved"),
      approve: availability(false, "controlBlockedUnresolved"),
      prepare: availability(false, "controlBlockedUnresolved"),
      approve_invitations: availability(false, "controlBlockedUnresolved"),
      send: availability(false, "controlBlockedUnresolved"),
    };
  }

  const inFlight = busy || campaignStatus === "SENDING";
  const terminal = campaignStatus === "COMPLETED";

  const dryRun = availability(!inFlight && !terminal, inFlight ? "controlBlockedBusy" : "controlBlockedTerminal");

  const alreadyApproved = !["DRAFT", "REVIEW", "FAILED"].includes(campaignStatus);
  const approveReason = inFlight
    ? "controlBlockedBusy"
    : alreadyApproved
      ? "controlBlockedAlreadyApproved"
      : !planLoaded
        ? "controlBlockedPlanMissing"
        : planStale
          ? "controlBlockedPlanStale"
          : settingsPaused
            ? "controlBlockedSettingsPaused"
            : approvable <= 0
              ? "controlBlockedNoEligible"
              : null;
  const approve = availability(approveReason === null, approveReason);

  const prepareReason =
    campaignStatus !== "APPROVED"
      ? "controlBlockedNotApproved"
      : inFlight
        ? "controlBlockedBusy"
        : !planLoaded
          ? "controlBlockedPlanMissing"
          : settingsPaused
            ? "controlBlockedSettingsPaused"
            : approvable <= 0
              ? heldOver > 0
                ? "controlBlockedQuotaFull"
                : "controlBlockedNoEligible"
              : null;
  const prepare = availability(prepareReason === null, prepareReason);

  // Approving the prepared invitations is the step that arms delivery, so it
  // needs the same evidence as approval PLUS a non-empty set of approvable
  // recipients. It is never available while the kill switch is on.
  const approveInvitationsReason =
    campaignStatus !== "APPROVED"
      ? "controlBlockedNotApproved"
      : inFlight
        ? "controlBlockedBusy"
        : !planLoaded
          ? "controlBlockedPlanMissing"
          : settingsPaused
            ? "controlBlockedSettingsPaused"
            : approvable <= 0
              ? "controlBlockedNoEligible"
              : null;
  const approveInvitations = availability(
    approveInvitationsReason === null,
    approveInvitationsReason
  );

  return {
    dry_run: dryRun,
    approve,
    prepare,
    approve_invitations: approveInvitations,
    // No send button exists in the panel; keep the entry explicitly disabled.
    send: DISABLED,
  };
}

/**
 * Is the plan in front of the operator still the plan the server would
 * approve?
 *
 * A campaign that was dry-run, approved or prepared AFTER this plan was
 * evaluated has moved on: its recipient list, quota or eligibility may have
 * changed, so the plan is stale and approval must be re-loaded first.
 *
 * Unknown or unparseable timestamps are treated as stale — never as fresh.
 */
export function planIsStale(
  plan: { generatedAt?: Date | string | null; campaignId?: string | null } | null | undefined,
  campaign:
    | {
        id?: string | null;
        approvedAt?: Date | string | null;
        lastDryRunAt?: Date | string | null;
        lastPreparedAt?: Date | string | null;
      }
    | null
    | undefined
): boolean {
  if (!plan?.generatedAt) return true;
  const generated = new Date(plan.generatedAt).getTime();
  if (Number.isNaN(generated)) return true;
  if (!campaign) return true;
  if (plan.campaignId && campaign.id && plan.campaignId !== campaign.id) return true;

  const stamps = [campaign.approvedAt, campaign.lastDryRunAt, campaign.lastPreparedAt]
    .filter((value): value is Date | string => Boolean(value))
    .map((value) => new Date(value).getTime())
    .filter((value) => !Number.isNaN(value));

  return stamps.some((stamp) => stamp > generated);
}

/* ------------------------------------------------------------------------- */
/* Invitation controls                                                        */
/* ------------------------------------------------------------------------- */

export const INVITATION_ACTIONS = [
  "approve",
  "reject",
  "reset",
  "mark_manual_sent",
] as const;
export type InvitationAction = (typeof INVITATION_ACTIONS)[number];

export type InvitationActionInput = {
  busy: boolean;
  statusUnresolved: boolean;
  invitationStatus: string;
  settingsPaused: boolean;
};

/**
 * Decide which invitation buttons may be pressed.
 *
 * `approve` and `mark_manual_sent` both lead towards an outbound message (the
 * second one records an attestation that a human already sent it), so both
 * honour the kill switch. `reject` and `reset` only move a record backwards and
 * stay available so an operator can always stop something.
 */
export function invitationActionAvailability(
  input: InvitationActionInput
): Record<InvitationAction, ActionAvailability> {
  const { busy, statusUnresolved, invitationStatus, settingsPaused } = input;

  if (statusUnresolved) {
    return {
      approve: availability(false, "controlBlockedUnresolved"),
      reject: availability(false, "controlBlockedUnresolved"),
      reset: availability(false, "controlBlockedUnresolved"),
      mark_manual_sent: availability(false, "controlBlockedUnresolved"),
    };
  }

  const draft = invitationStatus === "DRAFT";
  const approved = invitationStatus === "APPROVED";

  const approveReason = busy
    ? "controlBlockedBusy"
    : !draft
      ? "controlBlockedNotDraft"
      : settingsPaused
        ? "controlBlockedSettingsPaused"
        : null;

  const rejectReason = busy
    ? "controlBlockedBusy"
    : ["DRAFT", "APPROVED", "REJECTED", "SKIPPED", "FAILED"].includes(invitationStatus)
      ? null
      : "controlBlockedNotReviewable";

  const resetReason = busy
    ? "controlBlockedBusy"
    : ["DRAFT", "APPROVED", "REJECTED", "SKIPPED", "FAILED"].includes(invitationStatus)
      ? null
      : "controlBlockedNotReviewable";

  const manualReason = busy
    ? "controlBlockedBusy"
    : !approved
      ? "controlBlockedNotApprovedInvitation"
      : settingsPaused
        ? "controlBlockedSettingsPaused"
        : null;

  return {
    approve: availability(approveReason === null, approveReason),
    reject: availability(rejectReason === null, rejectReason),
    reset: availability(resetReason === null, resetReason),
    mark_manual_sent: availability(manualReason === null, manualReason),
  };
}

/* ------------------------------------------------------------------------- */
/* Settings gate                                                              */
/* ------------------------------------------------------------------------- */

export type SettingsGate = {
  /** True when sending is allowed right now. */
  sendingAllowed: boolean;
  /** True when the settings could not be read at all (worse than "off"). */
  unreadable: boolean;
  /** True when the kill switch is engaged or not configured. */
  paused: boolean;
};

/**
 * Read the kill switch out of `GET /api/admin/outreach/settings`.
 *
 * The route returns `{ settings: { enabled, autoSendEnabled, sources, warnings,
 * readError? }, ... }` and answers 503 when the settings cannot be read at all.
 *
 * Fail-closed by construction: anything that is not an explicit
 * `enabled === true` counts as paused, so a missing field, an unknown shape or
 * an unreadable value can never light up an approve/send control. The server
 * re-checks the same gate on every mutation, so this only decides what the
 * operator sees.
 */
export function settingsGate(settings: unknown): SettingsGate {
  if (!settings || typeof settings !== "object") {
    return { sendingAllowed: false, unreadable: true, paused: true };
  }
  const payload = settings as {
    settings?: { enabled?: unknown; readError?: unknown } | null;
    readError?: unknown;
  };
  const inner = payload.settings;
  if (payload.readError || !inner || inner.readError) {
    return { sendingAllowed: false, unreadable: true, paused: true };
  }
  if (typeof inner.enabled !== "boolean") {
    return { sendingAllowed: false, unreadable: true, paused: true };
  }
  return {
    sendingAllowed: inner.enabled,
    unreadable: false,
    paused: !inner.enabled,
  };
}
