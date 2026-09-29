/**
 * One-off migration of an http-storage root from the old layout (UUID-named blobs in
 * <project>/files/, names in <project>/.meta.json, <root>/.files-index.json) to the current one
 * (images under their real names next to project.json).
 *
 *   node scripts/migrate-http-storage.mjs <root>            report what would change
 *   node scripts/migrate-http-storage.mjs <root> --apply    do it
 *
 * When two blobs share a name the newest upload keeps it (the one the app was already showing,
 * since it looked names up newest-first); older ones go to <project>/.trash/. A blob whose name is
 * already taken by a loose file in the project folder is left in files/ and reported, so nothing
 * is ever overwritten. .meta.json is kept as .meta.json.migrated; files/ is removed once empty.
 */
import fs from 'node:fs';
import path from 'node:path';

const [root, ...flags] = process.argv.slice(2);
const apply = flags.includes('--apply');
if (!root) {
  console.error('usage: node scripts/migrate-http-storage.mjs <root> [--apply]');
  process.exit(1);
}

const move = (from, to) => {
  if (apply) fs.renameSync(from, to);
};
let moved = 0;
let trashed = 0;
let skipped = 0;

for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
  if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
  const dir = path.join(root, entry.name);
  const metaPath = path.join(dir, '.meta.json');
  if (!fs.existsSync(metaPath)) continue;
  const { files = {} } = JSON.parse(fs.readFileSync(metaPath, 'utf8'));

  // Oldest first, so that a later entry replaces an earlier one with the same name.
  const byName = new Map();
  for (const [id, f] of Object.entries(files).sort((a, b) =>
    (a[1].createdAt ?? '').localeCompare(b[1].createdAt ?? '')
  )) {
    const key = f.name.toLowerCase();
    byName.set(key, [...(byName.get(key) ?? []), { id, ...f }]);
  }

  const loose = new Set(fs.readdirSync(dir).map((n) => n.toLowerCase()));
  if (apply) fs.mkdirSync(path.join(dir, '.trash'), { recursive: true });
  for (const group of byName.values()) {
    const newest = group.at(-1);
    for (const older of group.slice(0, -1)) {
      const to = path.join(dir, '.trash', `${older.name}.${older.id.slice(0, 8)}`);
      console.log(`${entry.name}: duplicate "${older.name}" (${older.createdAt}) -> .trash`);
      move(path.join(dir, 'files', older.id), to);
      trashed++;
    }
    if (loose.has(newest.name.toLowerCase())) {
      console.log(`${entry.name}: SKIPPED "${newest.name}": a loose file already has that name`);
      skipped++;
      continue;
    }
    move(path.join(dir, 'files', newest.id), path.join(dir, newest.name));
    moved++;
  }
  if (apply) {
    fs.renameSync(metaPath, `${metaPath}.migrated`);
    try {
      fs.rmdirSync(path.join(dir, 'files'));
    } catch {
      console.log(`${entry.name}: files/ still has skipped blobs, kept`);
    }
  }
}
const index = path.join(root, '.files-index.json');
if (apply && fs.existsSync(index)) fs.unlinkSync(index);
console.log(
  `${apply ? 'Done' : 'Dry run'}: ${moved} files renamed, ${trashed} duplicates to trash, ${skipped} skipped.`
);
