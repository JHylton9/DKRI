import { context } from 'esbuild';
const ctx = await context({ entryPoints: ['data/dtown-issue-map/public/static/js/report.js','data/dtown-issue-map/public/static/js/map.js','data/dtown-issue-map/public/static/js/login.js','data/dtown-issue-map/public/static/js/admin.js'], bundle: true, splitting: true, format: 'esm', outdir: 'dist/static/js' });
await ctx.watch();
const { port } = await ctx.serve({ servedir: 'dist', host: '127.0.0.1', port: 8080 });
console.log(`Static preview: http://127.0.0.1:${port}`);
