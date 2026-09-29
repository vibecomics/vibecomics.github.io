/**
 * Runs every src/**\/*.test.ts and http-storage/**\/*.test.ts with Node's built-in test runner. The tests are
 * TypeScript, so they are bundled with esbuild into a temp directory first.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const esbuild = createRequire(path.join(ROOT, 'package.json'))('esbuild');

function findTests(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) return findTests(file);
    return entry.name.endsWith('.test.ts') ? [file] : [];
  });
}

const outdir = fs.mkdtempSync(path.join(os.tmpdir(), 'comic-builder-tests-'));
try {
  const entryPoints = ['src', 'http-storage'].flatMap((dir) => findTests(path.join(ROOT, dir)));
  await esbuild.build({
    entryPoints,
    bundle: true,
    platform: 'node',
    format: 'esm',
    outdir,
    outExtension: { '.js': '.mjs' },
    logLevel: 'warning',
  });
  const bundled = fs
    .readdirSync(outdir, { recursive: true })
    .filter((name) => name.endsWith('.test.mjs'))
    .map((name) => path.join(outdir, name));
  execFileSync(process.execPath, ['--test', ...bundled], { stdio: 'inherit' });
} finally {
  fs.rmSync(outdir, { recursive: true, force: true });
}
