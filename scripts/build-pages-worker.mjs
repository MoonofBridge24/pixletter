/**
 * Bundle the Hono API (apps/api/src/index.ts) into a single Cloudflare Pages
 * `_worker.js` (Pages Functions advanced mode).
 *
 * The resulting file owns ALL incoming requests: Hono handles the API /
 * tracking / auth / webhook routes, and unmatched paths fall back to the
 * static dashboard assets via `env.ASSETS.fetch(request)`.
 *
 * Run AFTER `vite build` so that apps/dashboard/dist exists.
 */
import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const distDir = resolve(root, 'apps/dashboard/dist');
const outfile = resolve(distDir, '_worker.js');

await mkdir(distDir, { recursive: true });

await build({
  entryPoints: [resolve(root, 'apps/api/src/index.ts')],
  outfile,
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  // Workers runtime conditions first; keep browser/module for packages that
  // only publish a browser entry point.
  conditions: ['worker', 'browser', 'module', 'import'],
  mainFields: ['module', 'main'],
  define: {
    'process.env.NODE_ENV': '"production"',
  },
  logLevel: 'info',
});

// Keep the worker script out of the static asset manifest.
await writeFile(resolve(distDir, '.assetsignore'), '_worker.js\n');

console.log(`Built Pages worker: ${outfile}`);
