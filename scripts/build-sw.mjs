// Bundles src/sw/worker.ts into dist/sw.js with this build's file lists: the
// shell to precache, and the versioned scene and audio files to cache later.
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { mediaVersions, MEDIA_DIRS } from './media.mjs';

const entries = await readdir('dist', { recursive: true, withFileTypes: true });
const files = entries
  .filter(entry => entry.isFile())
  .map(entry => `${entry.parentPath}/${entry.name}`.slice('dist/'.length))
  .filter(path => path !== 'sw.js' && !MEDIA_DIRS.some(dir => path.startsWith(`${dir}/`)))
  .sort();
const shell = ['./', ...files.filter(path => path !== 'index.html')];
const media = Object.entries(await mediaVersions('dist')).map(([path, version]) => `${path}?v=${version}`);

const hash = createHash('sha256');
for (const path of files) hash.update(await readFile(`dist/${path}`));
hash.update(media.join());
const version = hash.digest('hex').slice(0, 12);

await build({
  entryPoints: ['src/sw/worker.ts'],
  outfile: 'dist/sw.js',
  bundle: true,
  format: 'iife',
  target: 'es2022',
  define: { __VERSION__: JSON.stringify(version), __SHELL__: JSON.stringify(shell), __MEDIA__: JSON.stringify(media) },
});
console.log(`sw.js ${version}: ${shell.length} shell files, ${media.length} media files`);
