import { build } from 'esbuild';
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
const output = resolve('dist');
if (dirname(output) !== process.cwd()) throw new Error('Build output must stay inside the project.');
rmSync(output, { recursive: true, force: true });
const source = 'data/dtown-issue-map/public';
mkdirSync('dist/static', { recursive: true });
for (const folder of ['css', 'images']) cpSync(`${source}/static/${folder}`, `dist/static/${folder}`, { recursive: true });
for (const page of ['index', 'map', 'login', 'admin']) cpSync(`${source}/${page}.html`, `dist/${page}.html`);
for (const [route,page] of [['map','map'],['portal','login'],['portal/dashboard','admin']]) {
  mkdirSync(`dist/${route}`, { recursive: true });
  cpSync(`${source}/${page}.html`, `dist/${route}/index.html`);
}
await build({ entryPoints: ['report','map','login','admin'].map(name => `${source}/static/js/${name}.js`), bundle: true, splitting: true, format: 'esm', platform: 'browser', minify: true, outdir: 'dist/static/js' });
console.log('Static site ready in dist. Supabase provides data, auth and photo storage.');
