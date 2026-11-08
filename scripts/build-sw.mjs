// Bundles src/sw.ts into dist/sw.js with the list of built files and a version hash of their contents.
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { build } from 'esbuild';

const OUT = process.env.OUT_DIR ?? 'dist';
const entries = await readdir(OUT, { recursive: true, withFileTypes: true });
const files = entries
  .filter(entry => entry.isFile())
  .map(entry => `${entry.parentPath}/${entry.name}`.slice(OUT.length + 1))
  .filter(path => path !== 'sw.js' && !path.endsWith('.md'))
  .sort();

const hash = createHash('sha256');
for (const path of files) hash.update(path).update(await readFile(`${OUT}/${path}`));
const version = hash.digest('hex').slice(0, 12);
const urls = ['./', ...files.filter(path => path !== 'index.html')];

await build({
  entryPoints: ['src/sw.ts'],
  outfile: `${OUT}/sw.js`,
  bundle: true,
  format: 'iife',
  target: 'es2022',
  define: { __VERSION__: JSON.stringify(version), __FILES__: JSON.stringify(urls) },
});
console.log(`sw.js ${version}: ${urls.length} files`);
