/**
 * One-off rename of every image in an http-storage root to the storage naming rule
 * (src/utils/fileName.ts: lowercase, dashes, no spaces, an extension), and of the names
 * project.json refers to.
 *
 *   node scripts/normalize-http-storage.mjs <root>            report what would change
 *   node scripts/normalize-http-storage.mjs <root> --apply    do it
 *
 * A file with no image extension gets one from its own bytes. Names that end up equal get a
 * -2, -3 ... suffix. project.json's media fileName / thumbnailFileName are rewritten to match; a
 * backup is kept as project.json.before-normalize. Nothing is deleted.
 */
import fs from 'node:fs';
import path from 'node:path';
import { isValidFileName, toFileName } from '../src/utils/fileName.ts';

const [root, ...flags] = process.argv.slice(2);
const apply = flags.includes('--apply');
if (!root) {
  console.error('usage: node scripts/normalize-http-storage.mjs <root> [--apply]');
  process.exit(1);
}

/** The extension a file's first bytes call for, or undefined when they are not a known image. */
function sniffExtension(file) {
  const head = Buffer.alloc(16);
  const fd = fs.openSync(file, 'r');
  fs.readSync(fd, head, 0, 16, 0);
  fs.closeSync(fd);
  if (head.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))) return 'png';
  if (head[0] === 0xff && head[1] === 0xd8) return 'jpg';
  if (head.subarray(0, 4).toString() === 'RIFF' && head.subarray(8, 12).toString() === 'WEBP') {
    return 'webp';
  }
  if (head.subarray(0, 3).toString() === 'GIF') return 'gif';
  return undefined;
}

for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
  if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
  const dir = path.join(root, entry.name);
  const files = fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && !e.name.startsWith('.') && e.name !== 'project.json')
    .map((e) => e.name)
    .sort();

  const taken = new Set(files.filter(isValidFileName));
  const renames = new Map();
  for (const old of files) {
    if (isValidFileName(old)) continue;
    const extension = sniffExtension(path.join(dir, old));
    if (!extension && !/\.(png|jpe?g|webp|gif|avif|svg)$/i.test(old)) {
      console.log(`${entry.name}: SKIPPED "${old}": no image extension and not a known image`);
      continue;
    }
    let next = toFileName(old, extension);
    for (let n = 2; taken.has(next); n++) {
      next = toFileName(old, extension).replace(/((?:\.thumb)?\.[a-z0-9]+)$/, `-${n}$1`);
    }
    taken.add(next);
    renames.set(old, next);
  }
  for (const [old, next] of renames) console.log(`${entry.name}: ${old}  ->  ${next}`);

  if (apply && renames.size > 0) {
    // Two steps, through temporary names, so a rename that only changes case works everywhere.
    let i = 0;
    const temp = new Map();
    for (const [old, next] of renames) {
      const tmp = path.join(dir, `.rename-${i++}`);
      fs.renameSync(path.join(dir, old), tmp);
      temp.set(tmp, next);
    }
    for (const [tmp, next] of temp) fs.renameSync(tmp, path.join(dir, next));

    const projectPath = path.join(dir, 'project.json');
    const project = JSON.parse(fs.readFileSync(projectPath, 'utf8'));
    fs.copyFileSync(projectPath, `${projectPath}.before-normalize`);
    for (const item of project.metadata?.media ?? []) {
      for (const key of ['fileName', 'thumbnailFileName']) {
        if (renames.has(item[key])) item[key] = renames.get(item[key]);
      }
    }
    fs.writeFileSync(projectPath, JSON.stringify(project, null, 2));
  }
  console.log(
    `${entry.name}: ${renames.size} of ${files.length} files ${apply ? 'renamed' : 'to rename'}`
  );
}
