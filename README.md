# Bookora

Let customers book you.

Online booking SaaS for small service businesses.

## Production configuration

Set `DATABASE_URL`, `DIRECT_URL`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`,
`APP_URL`, `BOT_USERNAME`, and a high-entropy `JWT_SECRET` of at least 32
characters. In production, `APP_URL` must use HTTPS. If self-hosting behind a
reverse proxy, configure it to overwrite forwarded client-IP headers; rate
limits depend on a trusted client IP.
Set `TELEGRAM_WEBHOOK_SECRET` and `CRON_SECRET` to separate random values of at
least 32 characters. `ADMIN_TELEGRAM_IDS` is an optional comma-separated
allowlist of Telegram user IDs. When set, it is authoritative on every
request (so removing an ID revokes access immediately; an empty value revokes
every configured admin) and is synchronized at Telegram sign-in. If unset,
persisted database admin flags are used. Never commit real credentials.

Configure the Telegram webhook with the same `TELEGRAM_WEBHOOK_SECRET` and
schedule `/api/cron/expire-pending` every 10 minutes with
`Authorization: Bearer $CRON_SECRET`. The endpoint fails closed if the secret is
missing or shorter than 32 characters. Set the business's IANA time zone in the
business settings; customer-facing dates and working hours use that zone.

## Database and builds

`npm run build` generates Prisma Client and builds the application; it does not
modify the database. This repository currently has no Prisma migration history.
Review schema changes and apply them explicitly in a non-production environment
first (for example, with `npm run db:push`), then use the deployment's approved
schema rollout process. Do not add `--accept-data-loss` to a production build.
