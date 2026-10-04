# Bookora

Let customers book you.

Online booking SaaS for small service businesses.

## Production configuration

Set `DATABASE_URL`, `DIRECT_URL`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`, `APP_URL`, `BOT_USERNAME`, and a high-entropy `JWT_SECRET` of at least 32 characters. In production, `APP_URL` must use HTTPS. If self-hosting behind a reverse proxy, configure it to overwrite forwarded client-IP headers; rate limits depend on a trusted client IP. Set `TELEGRAM_WEBHOOK_SECRET` and `CRON_SECRET` to separate random values of at least 32 characters. `ADMIN_TELEGRAM_IDS` is an optional comma-separated allowlist of Telegram user IDs. When set, it is authoritative on every request (so removing an ID revokes access immediately; an empty value revokes every configured admin) and is synchronized at Telegram sign-in. If unset, persisted database admin flags are used. Never commit real credentials.

Configure the Telegram webhook with the same `TELEGRAM_WEBHOOK_SECRET` and schedule `/api/cron/expire-pending` with `Authorization: Bearer $CRON_SECRET`. The endpoint fails closed if the secret is missing or shorter than 32 characters. Set the business's IANA time zone in the business settings; customer-facing dates and working hours use that zone.

### Expiry cron cadence

Stale payment holds are also expired inside the booking, receipt, payment-review, and time-off transactions, so slot availability never depends on the cron alone and any cadence is safe. `vercel.json` currently schedules the backstop once per day (`0 2 * * *`), because a Vercel Hobby plan fails the whole deployment for any cron expression that runs more often than once per day ("Hobby accounts are limited to daily cron jobs"). Two options for a tighter cadence:

  * On a Vercel Pro plan, change the `vercel.json` schedule back to `*/10 * * * *`.
  * On Hobby, keep `vercel.json` as is and call `https://<APP_URL>/api/cron/expire-pending` every 10 minutes from an external scheduler (cron-job.org, UptimeRobot, GitHub Actions, ...) with the same `Authorization: Bearer $CRON_SECRET` header. Vercel cron also sends the `CRON_SECRET` environment variable automatically when it invokes the route.

## Database and builds

`npm run build` only generates Prisma Client and builds the application. It never modifies the database, so production is never exposed to a schema push during a deploy.

To apply schema changes, run one of the following explicitly (never during a production build):

  * `npm run db:push` (from a local environment with `DATABASE_URL` and `DIRECT_URL` pointing to a development or staging database).
  * `npm run db:push:safe` (the same, but skipping client generation).
  * Or apply the SQL directly in the Neon SQL Editor for a one-off column addition such as `idempotencyKey`.

Never add `--accept-data-loss` to a production build command. If you want a formal migration history in the future, run `prisma migrate dev` locally to generate migrations, then `prisma migrate deploy` as a separate manual step.

## Tests

```bash
npm test          # run all tests once
npm run test:watch
npm run test:coverage
