# Outreach review UI — fixes E, F(UI) and H

Follow-up to PR #14 ("Outreach remediation"). PR #14 completed the server side of
recipient review and the strict manual-send contract but left the admin panel
behind: it rendered an unpaginated preview, mislabelled blocked recipients, and
posted `mark_manual_sent` without the evidence the server now requires (a
guaranteed `400` for the operator). This change finishes the job. **No server
validation was relaxed anywhere.**

## What the operator sees now

### Recipient review (fix E)

`src/components/outreach/recipient-review.tsx` + `src/lib/outreach/recipient-review.ts`

* **Every matched recipient**, blocked ones included, in a scrollable list with
  pagination (10/25/50/100 per page, page x of y, range indicator).
* **Filters**: all / eligible / manual-only / blocked / held-over, each with a
  live count, so a long list stays reviewable on a phone.
* **All eligibility and consent states**, derived from the server's own fields —
  never guessed:
  * consent: granted / withdrawn / expired / bot not started / no Telegram id /
    not granted;
  * verification: verified / discovered / rejected / unknown;
  * do-not-contact: on the list / not listed / **could not be read (fail-closed,
    never rendered as "clear")**;
  * quota: inside the quota / held for a later run / not sendable;
  * channel and destination.
* **Blocking reasons**: the machine-readable code *and* a plain-language label in
  the reviewer's language (`en`/`fa`/`ar`). `CampaignRecipient` now carries
  `reasonLabels` (additive) and `already_pending` finally has a real label
  instead of "Blocked (already_pending)".
* **The exact outgoing message** per recipient (`previewBody` plus the campaign
  CTA, copyable), or an explicit explanation that no message is prepared.
* **Persian/Arabic RTL**: logical CSS (`text-start`, `ms-*`, `pe-*`), `dir="rtl"`
  on the review surface, `dir="ltr"`/`dir="auto"` for latin-only values
  (destinations, timestamps, message bodies), and counter/URL text that wraps
  instead of overflowing.

### Visible failures, honest empty states, safe controls (fix H)

`src/components/outreach/operator-notices.tsx` + `src/lib/outreach/operator-controls.ts`

* Campaign and invitation lists now carry a real **load state**
  (`loading` / `ready` / `error`). A failed read renders a red `role="alert"`
  banner with the server's message and a retry button — it can never be confused
  with "nothing here", and the last known rows stay marked as stale.
* Empty states are plain, separate components with their own test ids.
* **Sensitive controls are disabled while anything is unresolved** and say why,
  as visible text (not a tooltip): data still loading/failed, plan missing, plan
  stale (`lastDryRunAt`/`lastPreparedAt`/`approvedAt` newer than the plan's
  `generatedAt`), kill switch engaged or unreadable, nothing eligible, quota
  full, wrong campaign/invitation state. Delivery (`send`) is never exposed from
  this UI at all.
* The kill switch is read from `GET /api/admin/outreach/settings` and fails
  closed: a `503`, a missing `settings.enabled`, or a non-boolean value all mean
  "paused", never "allowed".

### The manual-send evidence prompt (fix F, UI half)

`src/components/outreach/manual-send-prompt.tsx` + `src/lib/outreach/manual-send-evidence.ts`

* The dialog collects the two inputs the server requires — 3–500 characters of
  evidence and an explicit operator confirmation checkbox — and builds exactly
  `{ action: "mark_manual_sent", confirmedByOperator: true, evidence }`.
  `confirmedByOperator` is only ever the literal `true`, and the payload cannot
  be built without evidence.
* The dialog states plainly that no Telegram message is sent, that the
  attestation is recorded as **SENT** (never DELIVERED), and that the server
  re-checks verification, do-not-contact, opt-out, consent and the kill switch.
* Server rejections are shown verbatim inside the dialog, so the operator sees
  the exact rule that blocked the attestation.
* The client-side rule is a mirror, not a replacement: `z.string().trim().min(3).max(500)`,
  `confirmedByOperator` required, invitation must be `APPROVED`, and every
  policy gate still runs inside the transaction. Regression tests assert both
  halves (see below).

## What did not change

* No server-side check was weakened, removed or made optional.
* No new way to send a message, prepare invitations or approve anything
  automatically; every outbound step still needs an explicit administrator
  action, and the kill switch still gates approval, preparation and delivery.
* No schema change, no migration applied, no Telegram message sent while
  building or testing this (all Bot API calls in tests are intercepted).

## How this was verified

| Check | Result |
| --- | --- |
| `npx vitest run` | 40 files / **447 tests passing** (was 36/369). New suites: `outreach-recipient-review-ui` (22), `outreach-operator-controls` (24), `outreach-review-ui-render` (24), `outreach-manual-send-ui-contract` (8). |
| `npx tsc --noEmit` | **0 errors** (branch) vs **0 errors** on `main`, both measured with a real generated Prisma Client — see the note below. |
| `npm run build` | **PASS on CI** (`Generate Prisma Client` → `Typecheck` → `Run tests` → `Build`, all steps success). Locally the full build also completes — page-data collection and prerendering included — through an uncommitted harness, because this sandbox cannot download the native engine. |
| Prisma query correctness | Not asserted from a hand-written stub. CI runs the standard `prisma generate` with the real engine; locally the client used for the type-check and the build was generated from `prisma/schema.prisma` by the Prisma CLI (bundled WASM schema engine and query compiler), which is a real client with real model types. |

### Why the type-check numbers differ from PR #14

PR #14 reported 73 `tsc` errors and attributed them to a missing generated
client. That was right, and it is now measurable: with a client generated from
the real schema, **`main` type-checks with 0 errors too**. Every one of the
73 (and the 127 seen with the 40 KB placeholder shipped by `@prisma/client`) was
an artifact of the absent client, not a code defect. The new UI code adds zero
type errors.
