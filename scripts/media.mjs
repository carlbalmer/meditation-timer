// Lists the rendered scene and audio assets under a directory with a short
// content hash each, so the app knows what exists and caches bust on change.
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';

export const MEDIA_DIRS = ['scenes', 'audio'];

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const nested = await Promise.all(entries.map(entry => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  }));
  return nested.flat();
}

export async function mediaVersions(root) {
  const files = (await Promise.all(MEDIA_DIRS.map(dir => walk(join(root, dir))))).flat().sort();
  const versions = {};
  for (const file of files) {
    if (file.split(sep).some(part => part.startsWith('.'))) continue;
    versions[relative(root, file).split(sep).join('/')] = createHash('sha256').update(await readFile(file)).digest('hex').slice(0, 10);
  }
  return versions;
}
