/**
 * Idempotent Cloudflare bootstrap: find-or-create D1, migrate, bind to Pages,
 * and (optionally) fill in missing secrets.
 *
 * Design rules (learned the hard way):
 *  - NEVER PATCH `env_vars`. It has wiped manually-set secrets before.
 *    Secrets are added only with `wrangler pages secret put`, and only when
 *    they do not already exist. Plain vars stay manual in the dashboard.
 *  - NEVER write `pages_build_output_dir` / `[[d1_databases]]` / `[vars]` into
 *    apps/dashboard/wrangler.toml — that flips the Pages project into
 *    config-driven mode and greys out the dashboard.
 *  - Binding is done via the REST API (PATCH deployment_configs.d1_databases),
 *    which is the same path the dashboard uses and does NOT cause the lock.
 *  - Dry-run by default. Pass --apply to make changes.
 *
 * Usage:
 *   CLOUDFLARE_ACCOUNT_ID=... CLOUDFLARE_API_TOKEN=... \
 *     node scripts/bootstrap-cloudflare.mjs            # preview only
 *   ... node scripts/bootstrap-cloudflare.mjs --apply
 *   ... node scripts/bootstrap-cloudflare.mjs --apply --with-secrets
 *
 * Extra flags:
 *   --with-secrets        put secrets that are missing (values from env vars)
 *   --generate-auth-secret  if BETTER_AUTH_SECRET is missing AND not in env,
 *                           generate one (printed ONCE — save it!)
 *   --skip-migrations     skip applying SQL migrations + seed
 *   --skip-bind           skip PATCHing the D1 binding to the Pages project
 *   --keep-compatibility  do not set compatibility_date/flags via the API
 *   --offline             preview the full plan without any API/network calls
 *   --json                print a final JSON summary
 *
 * Environment:
 *   CLOUDFLARE_ACCOUNT_ID   required
 *   CLOUDFLARE_API_TOKEN    required (needs D1:Edit + Cloudflare Pages:Edit)
 *   D1_DATABASE_NAME        default "pixletter-db"
 *   PAGES_PROJECT           default "pixletter"
 *   D1_BINDING              default "DB"
 *   Secret values, if --with-secrets: BETTER_AUTH_SECRET, BETTER_AUTH_URL,
 *     GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, STRIPE_SECRET_KEY,
 *     STRIPE_WEBHOOK_SECRET, STRIPE_PRO_PRICE_ID, SERVERCHAN_SENDKEY
 */
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const APPLY = process.argv.includes('--apply');
const WITH_SECRETS = process.argv.includes('--with-secrets');
const GENERATE_AUTH = process.argv.includes('--generate-auth-secret');
const SKIP_MIGRATIONS = process.argv.includes('--skip-migrations');
const SKIP_BIND = process.argv.includes('--skip-bind');
const KEEP_COMPAT = process.argv.includes('--keep-compatibility');
const OFFLINE = process.argv.includes('--offline');
const JSON_OUT = process.argv.includes('--json');

const COMPAT_DATE = '2026-05-14';
const COMPAT_FLAGS = ['nodejs_compat'];

function env(name, fallback) {
  const v = process.env[name];
  if (v && v.trim()) return v.trim();
  if (fallback !== undefined) return fallback;
  throw new Error(`Missing required environment variable: ${name}`);
}

const ACCOUNT = OFFLINE ? 'offline' : env('CLOUDFLARE_ACCOUNT_ID');
const TOKEN = OFFLINE ? 'offline' : env('CLOUDFLARE_API_TOKEN');
const DB_NAME = env('D1_DATABASE_NAME', 'pixletter-db');
const PROJECT = env('PAGES_PROJECT', 'pixletter');
const BINDING = env('D1_BINDING', 'DB');
const API = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}`;

const log = (...a) => console.log(...a);
const warn = (...a) => console.warn(...a);
const mode = APPLY ? 'APPLY' : 'DRY-RUN';

async function cf(path, init = {}) {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
  let body;
  try {
    body = await res.json();
  } catch {
    body = {};
  }
  if (!res.ok || body.success === false) {
    const msg = (body.errors || []).map((e) => e.message).join('; ') || `HTTP ${res.status}`;
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }
  return body.result;
}

function wrangler(args, input) {
  const r = spawnSync('npx', ['wrangler', ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    input,
    env: process.env,
    maxBuffer: 20 * 1024 * 1024,
  });
  if (r.status !== 0) {
    throw new Error(`wrangler ${args.join(' ')} failed:\n${r.stderr || r.stdout}`);
  }
  return r.stdout || '';
}

const summary = {
  mode,
  database: DB_NAME,
  databaseId: null,
  databaseCreated: false,
  pagesProject: PROJECT,
  binding: BINDING,
  migrationsApplied: [],
  bindingPatched: false,
  secretsPut: [],
  secretsSkipped: [],
};

async function findOrCreateDatabase() {
  log(`\n[1/4] D1 database "${DB_NAME}"`);
  if (OFFLINE) {
    log('  [offline] would GET /d1/database, find-or-create by name');
    return '<db-uuid-from-create-or-list>';
  }
  const list = await cf('/d1/database');
  const found = (list || []).find((d) => d.name === DB_NAME);
  if (found) {
    summary.databaseId = found.uuid;
    log(`  found existing: ${found.uuid} (reuse, no creation)`);
    return found.uuid;
  }
  if (!APPLY) {
    log('  would CREATE a new D1 database (dry-run, no id yet)');
    return null;
  }
  const created = await cf('/d1/database', {
    method: 'POST',
    body: JSON.stringify({ name: DB_NAME }),
  });
  summary.databaseId = created.uuid;
  summary.databaseCreated = true;
  log(`  created: ${created.uuid}`);
  return created.uuid;
}

async function ensureProject() {
  log(`\n[2/4] Pages project "${PROJECT}"`);
  if (OFFLINE) {
    log('  [offline] would GET/POST /pages/projects (create if missing)');
    return;
  }
  try {
    await cf(`/pages/projects/${PROJECT}`);
    log('  project exists');
  } catch (err) {
    if (err.status !== 404) throw err;
    if (!APPLY) {
      log('  would CREATE the Pages project (dry-run)');
      return;
    }
    await cf('/pages/projects', {
      method: 'POST',
      body: JSON.stringify({ name: PROJECT, production_branch: 'main' }),
    });
    log('  created project');
  }
}

async function applyMigrationsAndSeed() {
  if (SKIP_MIGRATIONS) {
    log('\n[3/4] Migrations: skipped (--skip-migrations)');
    return;
  }
  log('\n[3/4] Migrations + seed');
  const migrationFiles = (await import('node:fs/promises')).readdir
    ? (await (await import('node:fs/promises')).readdir(join(ROOT, 'packages/db/migrations')))
        .filter((f) => f.endsWith('.sql')).sort()
    : [];
  if (OFFLINE) {
    log(`  [offline] would apply: ${migrationFiles.join(', ')}`);
    log('  [offline] would seed "self" tenant');
    return;
  }
  if (!APPLY) {
    log('  would apply packages/db/migrations/*.sql and seed tenant (dry-run)');
    return;
  }
  const tmp = await mkdtemp(join(tmpdir(), 'pixletter-mig-'));
  try {
    const { readdir } = await import('node:fs/promises');
    const files = (await readdir(join(ROOT, 'packages/db/migrations')))
      .filter((f) => f.endsWith('.sql'))
      .sort();
    for (const f of files) {
      const raw = await readFile(join(ROOT, 'packages/db/migrations', f), 'utf8');
      const cleaned = raw.replace(/^\s*--> statement-breakpoint\s*$/gm, '');
      const tmpFile = join(tmp, f);
      await writeFile(tmpFile, cleaned, 'utf8');
      log(`  applying ${f} ...`);
      wrangler(['d1', 'execute', DB_NAME, '--remote', '--file', tmpFile, '--yes']);
      summary.migrationsApplied.push(f);
    }
    log('  seeding "self" tenant ...');
    wrangler([
      'd1',
      'execute',
      DB_NAME,
      '--remote',
      '--yes',
      '--command',
      "INSERT OR IGNORE INTO tenants (id, name, plan, monthly_email_limit, reset_at) VALUES ('self', 'Self', 'self', 100000, unixepoch() + 2592000); INSERT OR IGNORE INTO users (id, tenant_id, email, name) VALUES ('self', 'self', 'self@localhost', 'Self User');",
    ]);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

async function bindDatabase(dbId) {
  if (SKIP_BIND) {
    log('\n[4/4] Binding: skipped (--skip-bind)');
    return;
  }
  log('\n[4/4] Bind D1 to Pages');
  if (OFFLINE && !dbId) {
    log('  [offline] would PATCH deployment_configs.d1_databases (production + preview)');
    return;
  }
  if (!dbId) {
    warn('  no database id available (dry-run) — cannot build binding payload');
    return;
  }
  const cfg = {
    d1_databases: { [BINDING]: { id: dbId } },
  };
  if (!KEEP_COMPAT) {
    cfg.compatibility_date = COMPAT_DATE;
    cfg.compatibility_flags = COMPAT_FLAGS;
  }
  // NOTE: no `env_vars` key — that is what previously wiped secrets.
  const body = { deployment_configs: { production: cfg, preview: cfg } };
  if (!APPLY) {
    log(`  would PATCH deployment_configs.d1_databases = ${JSON.stringify(cfg)}`);
    return;
  }
  await cf(`/pages/projects/${PROJECT}`, { method: 'PATCH', body: JSON.stringify(body) });
  summary.bindingPatched = true;
  log(`  patched ${BINDING} -> ${dbId} (production + preview); env_vars untouched`);
}

const SECRET_SPECS = [
  'BETTER_AUTH_SECRET',
  'BETTER_AUTH_URL',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'STRIPE_PRO_PRICE_ID',
  'SERVERCHAN_SENDKEY',
];

async function fillMissingSecrets() {
  if (!WITH_SECRETS) {
    log('\n[+] Secrets: skipped (pass --with-secrets to provision missing ones)');
    return;
  }
  log('\n[+] Missing secrets');
  if (OFFLINE) {
    log(`  [offline] would GET existing secret names, then put missing ones from: ${SECRET_SPECS.join(', ')}`);
    return;
  }
  const project = await cf(`/pages/projects/${PROJECT}`);
  const dc = project?.deployment_configs?.production?.env_vars || {};
  const existing = new Set(
    Object.entries(dc)
      .filter(([, v]) => v && v.type === 'secret_text')
      .map(([k]) => k),
  );
  log(`  existing secrets: ${[...existing].join(', ') || '(none)'}`);

  for (const key of SECRET_SPECS) {
    if (existing.has(key)) {
      summary.secretsSkipped.push(key);
      log(`  ${key}: already set, skip`);
      continue;
    }
    let value = process.env[key];
    if (!value && key === 'BETTER_AUTH_SECRET' && GENERATE_AUTH) {
      value = randomBytes(32).toString('base64url');
      warn(`  ${key}: generated a new value — SAVE THIS FOR LOCAL DEV:\n    ${value}`);
    }
    if (!value) {
      log(`  ${key}: no value provided, skip`);
      continue;
    }
    if (!APPLY) {
      log(`  ${key}: would set (dry-run)`);
      continue;
    }
    wrangler(['pages', 'secret', 'put', key, '--project-name', PROJECT], value);
    wrangler(['pages', 'secret', 'put', key, '--project-name', PROJECT, '--env', 'preview'], value);
    summary.secretsPut.push(key);
    log(`  ${key}: set (production + preview)`);
  }
}

async function main() {
  log(`=== Cloudflare bootstrap [${mode}] ===`);
  log(`project=${PROJECT} db=${DB_NAME} binding=${BINDING}`);
  const dbId = await findOrCreateDatabase();
  await ensureProject();
  await applyMigrationsAndSeed();
  await bindDatabase(dbId);
  await fillMissingSecrets();

  log('\n=== Done ===');
  log(`database_id: ${summary.databaseId || '(not resolved in dry-run)'}`);
  if (summary.databaseCreated) {
    log('Update apps/api/wrangler.toml database_id for local dev if you use it.');
  }
  log('Keep apps/dashboard/wrangler.toml free of pages_build_output_dir / d1 / vars.');
  if (!APPLY) log('This was a DRY-RUN. Re-run with --apply to make changes.');
  if (JSON_OUT) log(`\nSUMMARY_JSON=${JSON.stringify(summary)}`);
}

main().catch((err) => {
  console.error(`\nBootstrap failed: ${err.message}`);
  process.exit(1);
});
