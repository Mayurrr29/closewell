// Bundles the API into dist/server.js. The workspace package @closewell/shared
// is TypeScript source, so it is bundled in; real npm dependencies stay external.
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const external = Object.keys(pkg.dependencies).filter((d) => !d.startsWith('@closewell/'));

await build({
  entryPoints: ['src/server.ts', 'src/scripts/seed.ts'],
  outdir: 'dist',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  sourcemap: true,
  external,
  outbase: 'src',
  logLevel: 'info',
});
