# Growth expansion — 100-city registry, message builder, audit, honest analytics

Branch: `arena/c7eef417-bookora` (extends the outreach system in
[OUTREACH-SYSTEM.md](./OUTREACH-SYSTEM.md)). Everything here is **additive**:
the four launch cities behave exactly as before, and one new table
(`outreach_audit_events`) is the only schema change.

---

## A. City registry — up to 100 markets, admin-approved one by one

`src/lib/outreach/city-registry.ts` holds 100 real Iranian cities
(`code / fa / en / region / country`). This is configuration — city names —
**not** prospect data: registering a city creates zero prospects.

Approval is a separate layer:

| Layer | Rule |
| --- | --- |
| Registry | 100 codes, stable, unique, upper-ASCII |
| Default approved | the four launch cities (Tehran, Mashhad, Karaj, Shiraz) |
| Admin override | `outreach.cities_enabled` / `outreach.cities_disabled` in `admin_settings` |
| Cap | a campaign may hold up to 100 approved cities (`MAX_CAMPAIGN_CITIES`) |

Hard rules enforced in code (`src/lib/outreach/cities.ts`):

- **Never substituted.** An unknown code is reported (`unknown`), an
  unapproved one too (`unapproved`) — the API rejects both explicitly instead
  of dropping them silently. A stored code that is later disabled still
  *renders verbatim*; it never borrows another city's name.
- **Never auto-expanded.** Disabling a market only prevents *new* selections;
  history is untouched.
- **Auto-detection stays narrow.** Free-text city detection (directory blobs)
  still only matches the four launch cities. Growing the registry does not
  widen what gets assigned automatically — "Isfahan" in a bio stays
  UNASSIGNED until a human (or an exact admin input) claims it.
- Exact input (admin pickers, campaign forms, CSV `city` columns) resolves any
  registered city by name in either language or by its code, HIGH confidence.

**UI:** the campaign form uses a searchable multi-select over approved
markets; a dedicated **Markets** card (admin panel → Campaigns tab) lists the
whole registry with a per-city approve/disable switch. It calls
`PUT /api/admin/outreach/markets` with a single `{code, approved}` — the
server computes the minimal override list, and every toggle is audit-logged.

## B. Campaign message builder

Admins can now write the invitation per campaign instead of picking only from
global templates (`src/lib/outreach/message.ts`):

- fields reused, nothing new on `outreach_campaigns`: the composed body is
  stored as a campaign-scoped template `msg_<campaign-code>` in the existing
  `invitation_templates` table, and `templateId` points at it; `cta` and
  `destinationUrl` keep their existing columns;
- destinations are **explicit checkboxes**: bot deep link (`{link}`, unique
  start code per recipient), Bookora channel (`outreach.channel_url`), other
  destination (validated per-campaign URL). A link is inserted only if it was
  selected, and only once — an inline copy the admin typed is never duplicated;
- a missing channel URL is a validation error (`channelUrl.notConfigured`) —
  the builder never guesses a channel;
- URL safety: `http(s)` only; `javascript:` / `data:` / `vbscript:` /
  `file:` / `blob:` are rejected at both the API (`zod`) and library level
  (`validateDestinationUrl`);
- placeholders restricted to `{businessName} {link} {category}`; unknown
  tokens are rejected, not stripped;
- **preview == prepared**: the preview runs the same compose + `renderTemplate`
  pipeline that `prepareInvitations` runs, so what you see is what gets stored;
  the only per-recipient difference is the bot start code by design;
- **freeze rule**: messages are editable only while DRAFT/REVIEW. After
  approval the message is locked, exactly like targeting
  (`campaign.locked`).

Endpoints: `PATCH /api/admin/outreach/campaigns/[id]/message` (save) and
`POST` (validate-only) on the same route.

## C. Controlled workflow + audit trail

The existing gates stay (global enable → auto-send → per-campaign approval →
per-recipient eligibility re-check → dry-run freshness → limits/opt-out).
Added:

- `outreach_audit_events` (`prisma/schema.prisma`, `prisma/sql/0003_outreach_audit.sql`):
  who approved/launched/paused what, message saves, city approvals, channel
  URL changes, dry runs. Append-only, detail strings are free-form and capped.
- **Fail-soft by design** (`src/lib/outreach/audit.ts`): every hook is a
  try/catch write. If `db push`/0003 has not been applied yet, the whole
  product behaves exactly as before — a missing audit table can never block
  an approval.
- Settings writes that flip safety-relevant keys (`enabled`,
  `automatic_send_enabled`, `channel_url`, city lists) are also audited.
- No bulk Telegram sending, no pacing evasion, no re-contacting opted-out
  owners — unchanged, and tested.

## D. Analytics — measured vs estimated

`src/lib/outreach/analytics.ts` + `GET /api/admin/outreach/stats`
(`acquisition` block) + the Overview tab:

- a 12-stage funnel `discovered → … → firstBookings`;
- each stage carries `{count, measured, source, conversionFromPrev}` — a stage
  with **no data source says `no source`**, it is never shown as `0`, and
  conversion is never chained across a measurement gap;
- `invitationsPrepared` and `deliveryConfirmed` are different stages: prepared
  ≠ delivered, and the UI says so;
- grouping per **campaign / city / language / segment**
  (`aggregateByDimension`, `buildCampaignReport`), including UNASSIGNED buckets
  so ungrouped prospects remain visible instead of invisible.

## API surface (new / changed)

| Method & path | Change |
| --- | --- |
| `GET  /api/admin/outreach/campaigns` | + `cityRegistry`, `approvedCities`, `maxCampaignCities`, `messageDefaults` |
| `POST /api/admin/outreach/campaigns` | strict `parseCampaignCities` (explicit unknown/unapproved/too-many errors), audited |
| `PATCH /api/admin/outreach/campaigns/[id]` | strict cities; `destinationUrl` validated; audit |
| `GET  /api/admin/outreach/campaigns/[id]` | + `templateBody`, + last `auditEvents` |
| `PATCH/POST /api/admin/outreach/campaigns/[id]/message` | new — save / validate the campaign message |
| `PUT  /api/admin/outreach/markets` | new — approve/disable a single city |
| `GET  /api/admin/outreach/stats` | + `acquisition` funnel & dimensions |
| `PUT  /api/admin/outreach/settings` | audited on safety keys; `outreach.channel_url` now honoured |

## Owner steps for the expansion itself

1. **Apply the audit table** (optional but recommended — everything else works
   without it): `npm run db:push`, or run `prisma/sql/0003_outreach_audit.sql`
   in the production SQL console. Additive `CREATE TABLE IF NOT EXISTS` +
   index; it does not touch the other 10 outreach tables.
2. **Set the channel URL** in the admin Outreach settings
   (`outreach.channel_url`, real `https://t.me/...` link) if you want
   channel links inside messages. Until then, choosing the channel destination
   simply fails validation with a clear error.
3. **Approve markets one at a time** (Campaigns tab → Markets). Approval only
   unlocks targeting — no campaign starts, no prospects appear, nothing sends.
4. For each new city, follow the normal loop: import verified prospects →
   create campaign (pick the city) → build the message → dry run → approve →
   send the first ten manually.

## What this deliberately does NOT do

- It does not fabricate prospects, contacts or channel links.
- It does not send anything without the existing approval chain, and it adds
  no "send all" button — delivery stays cron-gated per recipient.
- It does not auto-launch campaigns when a city is approved.
- It does not widen free-text city assignment beyond the four launch cities.
