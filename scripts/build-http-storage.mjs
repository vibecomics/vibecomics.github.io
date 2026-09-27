/**
 * Bundles the http-storage server (http-storage/start.ts and everything it uses) into one
 * dependency-free file, http-storage/dist/http-storage.mjs: copy it anywhere with a Node runtime
 * and run it, no `npm install` or source tree required.
 *
 * ESM output, not CJS: start.ts uses top-level await and import.meta.url.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'http-storage', 'dist', 'http-storage.mjs');
const esbuild = createRequire(path.join(ROOT, 'package.json'))('esbuild');

await esbuild.build({
  entryPoints: [path.join(ROOT, 'http-storage', 'start.ts')],
  outfile: OUT,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node18',
  // start.ts already carries its own shebang; esbuild keeps it at the top of the bundle.
  logLevel: 'warning',
});
fs.chmodSync(OUT, 0o755);
console.log(
  `build-http-storage: wrote ${path.relative(ROOT, OUT)} (${Math.round(fs.statSync(OUT).size / 1024)} KB)`
);
