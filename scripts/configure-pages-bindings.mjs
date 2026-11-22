/**
 * Apply Pages Functions bindings (D1 + vars) to the deployed Cloudflare Pages
 * project via the REST API.
 *
 * Why this exists:
 *   Unlike Workers (`wrangler deploy`), a Pages project's `wrangler.toml`
 *   bindings/vars are NOT guaranteed to be applied to the live project by
 *   `wrangler pages deploy` — Pages treats the dashboard/project settings as
 *   the source of truth, and a deploy-only token may create a deployment
 *   without ever syncing bindings. This PATCH makes configuration explicit
 *   and idempotent, for BOTH production and preview environments.
 *
 * Reads values from apps/dashboard/wrangler.toml (single source of truth) and
 * requires CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID in the environment.
 */
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const configPath = resolve(root, 'apps/dashboard/wrangler.toml');

const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
const apiToken = process.env.CLOUDFLARE_API_TOKEN;
if (!accountId || !apiToken) {
  console.error('CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN are required.');
  process.exit(1);
}

// --- minimal TOML reader for the fields we need ---------------------------
const text = await readFile(configPath, 'utf8');

function topLevelString(key) {
  const m = text.match(new RegExp(`^${key}\\s*=\\s*"([^"]*)"`, 'm'));
  return m?.[1];
}

// Return the body of a section (everything after its header up to the next
// section header). Avoids `$`-with-multiline pitfalls.
function section(header) {
  const start = text.indexOf(`[${header}]`);
  if (start === -1) return '';
  const newline = text.indexOf('\n', start);
  if (newline === -1) return '';
  const rest = text.slice(newline + 1);
  const next = rest.search(/^\[/m);
  return next === -1 ? rest : rest.slice(0, next);
}

const projectName = topLevelString('name');

// compatibility_flags = ["nodejs_compat", ...]
const flagsMatch = text.match(/^compatibility_flags\s*=\s*\[([^\]]*)\]/m);
const compatibilityFlags = flagsMatch
  ? [...flagsMatch[1].matchAll(/"([^"]+)"/g)].map((m) => m[1])
  : [];

// compatibility_date
const compatibilityDate = topLevelString('compatibility_date');

// [[d1_databases]] — binding + database_id
const d1Block = section('[d1_databases]');
const d1Binding = d1Block.match(/^binding\s*=\s*"([^"]+)"/m)?.[1];
const d1DatabaseId = d1Block.match(/^database_id\s*=\s*"([^"]+)"/m)?.[1];
if (!projectName || !d1Binding || !d1DatabaseId) {
  console.error('Could not parse name / d1 binding / database_id from wrangler.toml');
  process.exit(1);
}

// [vars] — plain text env vars
const varsBlock = section('vars');
const envVars = {};
for (const line of varsBlock.split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"([^"]*)"/);
  if (m) {
    envVars[m[1]] = { type: 'plain_text', value: m[2] };
  }
}

// --- build request body ---------------------------------------------------
const deploymentConfig = {
  compatibility_date: compatibilityDate,
  compatibility_flags: compatibilityFlags,
  d1_databases: { [d1Binding]: { id: d1DatabaseId } },
  env_vars: envVars,
};
const body = {
  deployment_configs: {
    production: deploymentConfig,
    preview: deploymentConfig,
  },
};

const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/pages/projects/${projectName}`;
const res = await fetch(url, {
  method: 'PATCH',
  headers: {
    Authorization: `Bearer ${apiToken}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify(body),
});

const data = await res.json().catch(() => ({}));
if (!res.ok || data.success === false) {
  console.error('Failed to configure Pages bindings:');
  console.error(JSON.stringify(data, null, 2));
  process.exit(1);
}

console.log(
  `Pages bindings configured: project=${projectName} d1=${d1Binding} vars=${Object.keys(envVars).join(',') || '(none)'}`
);
console.log('Applied to production and preview. Redeploy for changes to take effect on existing deployments.');
