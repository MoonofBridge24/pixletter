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

### Environment Variables (apps/dashboard/wrangler.toml)

| Variable | Required | Description |
|----------|----------|-------------|
| `HOSTING_MODE` | No | `self` (default) or `hosted` |
| `ALLOW_SIGNUP` | No | Set to `true` to allow new signups (fail-closed) |
| `ALLOWED_ORIGINS` | No | Comma-separated allowed CORS origins (for the Chrome extension) |
| `SLACK_WEBHOOK_URL` | No | Slack webhook for open notifications |
| `PIXEL_DOMAIN` | No | Custom domain for pixel URLs |

Set secrets on the **Pages project** (not as a Worker):

```bash
npx wrangler pages secret put BETTER_AUTH_SECRET --project-name=pixletter
npx wrangler pages secret put BETTER_AUTH_URL --project-name=pixletter
# Optional: Google OAuth
npx wrangler pages secret put GOOGLE_CLIENT_ID --project-name=pixletter
npx wrangler pages secret put GOOGLE_CLIENT_SECRET --project-name=pixletter
```

### Hosted Mode (multi-tenant)

To enable multi-tenant mode with authentication:

```bash
# Update apps/dashboard/wrangler.toml
# HOSTING_MODE = "hosted"
# ALLOWED_ORIGINS = "https://your-dashboard.pages.dev"

# Redeploy after changing vars/secrets
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
