# Self-Host Guide

Deploy pixletter on your own Cloudflare account in under 10 minutes.

The API and the dashboard run on **one Cloudflare Pages instance**: the build
output contains the static dashboard plus a generated `_worker.js` (Pages
Functions advanced mode) that serves every API, tracking, auth and webhook
route. No separate Workers deployment is needed.

## Prerequisites

- [Node.js](https://nodejs.org/) v20+
- [pnpm](https://pnpm.io/) v9+
- [Cloudflare account](https://dash.cloudflare.com/sign-up) (free)

## Quick Start

### Option A: CLI Wizard

```bash
npx create-pixletter@latest
```

The wizard will guide you through: clone, install, D1 setup, migrations, and seed.

### Option B: Manual Setup

```bash
# 1. Clone & install
git clone https://github.com/dkamehat/pixletter.git
cd pixletter
pnpm install

# 2. Login to Cloudflare
npx wrangler login

# 3. Create D1 database
npx wrangler d1 create pixletter-db --config=apps/dashboard/wrangler.toml
# Copy the database_id from the output and update apps/dashboard/wrangler.toml
# (and apps/api/wrangler.toml if you still use it for local API dev)

# 4. Apply migrations
npx wrangler d1 execute pixletter-db --remote \
  --file=packages/db/migrations/0000_peaceful_apocalypse.sql \
  --config=apps/dashboard/wrangler.toml

npx wrangler d1 execute pixletter-db --remote \
  --file=packages/db/migrations/0001_better_auth_tables.sql \
  --config=apps/dashboard/wrangler.toml

# 5. Seed self tenant
npx wrangler d1 execute pixletter-db --remote \
  --command="INSERT OR IGNORE INTO tenants (id, name, plan, monthly_email_limit) VALUES ('self', 'Self', 'self', 100000);" \
  --config=apps/dashboard/wrangler.toml

# 6. Build & deploy ONE Pages instance (dashboard assets + API worker)
pnpm --filter @pixletter/dashboard build
cd apps/dashboard
npx wrangler pages deploy dist --branch=main
```

### Option C: GitHub Actions

1. Fork the repo
2. Add repository secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`
3. Go to Actions → "Deploy to Cloudflare" → Run workflow

## Configuration

### Pages bindings vs Workers (important)

`wrangler pages deploy` does **not** work like `wrangler deploy`. For Workers,
`wrangler.toml` is the source of truth and every deploy applies its bindings.
For **Pages**, the live project's settings are the source of truth — `wrangler.toml`
is used for local development only, and a deploy will not bind D1 or set vars
for you.

**All bindings, vars and secrets are configured ONCE by hand in the Cloudflare
dashboard.** The GitHub Actions workflow deliberately does NOT touch them, so
manual edits are never overwritten on redeploy. Do this one-time setup before
the first deploy:

1. **D1 binding** — Workers & Pages → `pixletter` → Settings → Functions →
   Bindings → Add → D1 database. Variable name **must** be `DB`; pick the
   `pixletter-db` database. Add it in **both Production and Preview**.
2. **Vars** — Settings → Environment variables → Add, in **both** Production
   and Preview: `HOSTING_MODE=hosted`, `ALLOW_SIGNUP=false`,
   `ALLOWED_ORIGINS=https://pixletter.pages.dev` (plus any custom domain).
3. **Compatibility flags** — Settings → Functions → Compatibility flags:
   enable `nodejs_compat`. Set compatibility date to `2026-05-14`.
4. **Secrets** — see below. Set these with `wrangler pages secret put` (they
   cannot be read back, only replaced).

After a one-time dashboard setup, CI deploys keep working without ever
clearing your secrets. `apps/dashboard/wrangler.toml` only drives local
`wrangler pages dev`; no CLI step pushes its bindings to the project.

> Note: `wrangler.toml` cannot hold `[observability]` for a Pages project
> (that key is Workers-only and fails config validation). Observability stays
> enabled only in `apps/api/wrangler.toml`.

### Environment Variables

Set these as **Environment variables** in the Pages project dashboard
(Production + Preview), not via `wrangler.toml`:

| Variable | Required | Description |
|----------|----------|-------------|
| `HOSTING_MODE` | No | `self` (default) or `hosted` |
| `ALLOW_SIGNUP` | No | Set to `true` to allow new signups (fail-closed) |
| `ALLOWED_ORIGINS` | No | Comma-separated allowed CORS origins (for the Chrome extension) |
| `SLACK_WEBHOOK_URL` | No | Slack webhook for open notifications |
| `PIXEL_DOMAIN` | No | Custom domain for pixel URLs |

Secrets go on the **Pages project** (not a Worker). Generate a secret and set
each one — if `BETTER_AUTH_SECRET` is missing, **every `/api/auth/*` request
returns 500**:

```bash
# Generate a strong secret (>=32 chars)
npx auth secret   # or: openssl rand -base64 32

npx wrangler pages secret put BETTER_AUTH_SECRET --project-name=pixletter
npx wrangler pages secret put BETTER_AUTH_URL --project-name=pixletter
# Optional: Google OAuth
npx wrangler pages secret put GOOGLE_CLIENT_ID --project-name=pixletter
npx wrangler pages secret put GOOGLE_CLIENT_SECRET --project-name=pixletter
# Optional: Stripe billing
npx wrangler pages secret put STRIPE_SECRET_KEY --project-name=pixletter
npx wrangler pages secret put STRIPE_WEBHOOK_SECRET --project-name=pixletter
npx wrangler pages secret put STRIPE_PRO_PRICE_ID --project-name=pixletter
```

### Hosted Mode (multi-tenant)

To enable multi-tenant mode with authentication, set `HOSTING_MODE=hosted` in
the Pages dashboard, ensure all secrets above exist, then redeploy:

```bash
cd apps/dashboard && npx wrangler pages deploy dist --branch=main
```

> API requests from the dashboard use same-origin relative paths. Leave
> `VITE_API_URL` unset so the browser talks to the same Pages instance.

## Chrome Extension Setup

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked** → select `apps/extension/`
4. Click the extension icon → enter your API URL and API key
5. Compose an email in Gmail — the Track toggle appears automatically

## Local Development

```bash
# Separate services (Vite on 5173 + API Worker on 8787)
pnpm dev

# Single Pages instance locally (builds dashboard + _worker.js, then serves both)
pnpm dev:pages
# Put secrets in apps/dashboard/.dev.vars (gitignored) before starting.
```

## Verify Installation

```bash
# Same origin as the dashboard — no workers.dev URL needed
curl https://pixletter.pages.dev/health

# Expected response:
# {"status":"ok","version":"0.3.0","mode":"hosted"}
```

### Troubleshooting

- **Every `/api/auth/*` returns 500 (`Internal server error`)** but `/health`
  is fine → `BETTER_AUTH_SECRET` is missing on the Pages project. Re-set it
  with `wrangler pages secret put BETTER_AUTH_SECRET --project-name=pixletter`
  and redeploy. This is the single most common auth failure.
- **`/health` returns `"mode":"self"` when you expect `hosted`** →
  `HOSTING_MODE` var is missing in the Pages dashboard (Production env).

## Updating

```bash
git pull origin main
pnpm install
# Apply any new migrations
npx wrangler d1 execute pixletter-db --remote \
  --file=packages/db/migrations/<new-migration>.sql \
  --config=apps/dashboard/wrangler.toml
pnpm --filter @pixletter/dashboard build
cd apps/dashboard && npx wrangler pages deploy dist --branch=main
```
