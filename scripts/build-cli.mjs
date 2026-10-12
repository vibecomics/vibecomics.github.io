/**
 * Bundles the vibecomics command line (src/cli/bin.ts and everything it uses)
 * into one file, public/vibecomics.mjs, which the site serves next to
 * llms.txt: an agent downloads it and runs it with `node vibecomics.mjs`. The
 * Google client values are baked in from the dotenv files, like the web build
 * (the device client's secret ships by design; see src/drive/deviceOAuth.ts).
 *
 * Run after scripts/extract-docs.mjs, which generates the command table.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { googleDefines } from './read-env.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'public', 'vibecomics.mjs');
const esbuild = createRequire(path.join(ROOT, 'package.json'))('esbuild');

await esbuild.build({
  entryPoints: [path.join(ROOT, 'src', 'cli', 'bin.ts')],
  outfile: OUT,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  define: googleDefines(),
  banner: {
    js: "#!/usr/bin/env node\nimport { createRequire as __vcCreateRequire } from 'node:module';\nconst require = __vcCreateRequire(import.meta.url);",
  },
  logLevel: 'warning',
});
fs.chmodSync(OUT, 0o755);
console.log(
  `build-cli: wrote ${path.relative(ROOT, OUT)} (${Math.round(fs.statSync(OUT).size / 1024)} KB)`
);
