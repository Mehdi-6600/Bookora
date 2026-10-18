# Bookora Growth Guide — V1

The admin outreach overview includes a small, deterministic advisor that turns
recorded acquisition-pipeline state into up to three next steps. It is the first
safe layer of the first-party Bookora Growth Agent; it does not need an external
LLM, adds no database schema, and introduces no new runtime dependency.

## What it reads

The advisor only receives counts and statuses already loaded by the admin
outreach stats endpoint: discovery blockers and run status, new candidates,
pending verification, due follow-ups, draft invitations, targetable prospects,
and campaign count. Its pure rules live in `src/lib/outreach/growth-advisor.ts`.

## What it can recommend

- Inspect a failed discovery run or configure an authorized public source.
- Review new candidates and verify prospect records.
- Personally follow up on due prospects.
- Review invitation drafts or create a small pilot campaign.
- Add a few verified public prospects when the pipeline is empty.

Recommendations are capped at three and link to the corresponding admin tab.
They are translated into Persian, English and Arabic.

## Safety and limits

- The guide does **not** discover or fabricate leads itself.
- It does **not** write to the database, change quotas, approve campaigns, or
  send messages. It only reports actions for an administrator to take.
- It uses counts already available to the admin stats endpoint; no prospect
  names or contact details are included in recommendations.
- Rules are deterministic and covered by unit tests. A future AI model may help
  draft copy or summarize evidence, but it must not bypass verification,
  suppression, consent, approval, rate limits, or source authorization.

## Next expansion

The Discovery tab also accepts a conservative CSV hand-off for public business
pages. It imports only business name, public URL and optional city into the
existing reviewable seed list; additional columns (including email and phone)
are ignored. Files are capped at 1 MB and 1,000 data rows, and the existing
server-side URL validation, audit trail, discovery scoring, deduplication and
human verification still apply. The importer does not contact the businesses.

Example (the name and URL headers are required; city is optional):

```csv
business_name,public_url,city
"Example Barber",https://example.com,Tehran
"Salon Example",https://instagram.com/salon.example,Dubai
```

Names and page URLs may be international, but automatic city recognition and
campaign market approval are limited to Bookora's configured registry (currently
Iranian cities). An international city is not campaign-targetable until its
market has been added to the registry and explicitly approved. Importing a CSV
does not create or approve markets, verify a prospect, or contact anyone.

The next meaningful increment is a source adapter for a directory or data
provider Bookora is explicitly authorized to use, followed by evidence-backed
qualification and measured pilot experiments. Until such a source is selected
and configured, manual/authorized-feed discovery remains the honest default.
