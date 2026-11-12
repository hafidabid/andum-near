// node scripts/report/video.mjs <out.mp4> <title> <log1> [log2...]   (needs Chrome, ffmpeg; playwright's ffmpeg: npx playwright-core install ffmpeg)
import { chromium } from 'playwright-core'; import fs from 'fs'; import os from 'os'; import path from 'path'; import { execSync } from 'child_process';
import { termHtml } from './term.mjs';
const [outFile, title, ...logs] = process.argv.slice(2);
const lines = logs.flatMap((l, i) => [...(i ? ['', ''] : []), ...fs.readFileSync(l, 'utf8').replace(/\r/g, '').split('\n').filter((x) => !/signed_delegate_b64/.test(x))]);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'andum-video-')); const f = path.join(tmp, 'a.html'); fs.writeFileSync(f, termHtml({ title, lines, animate: true, fs: 15 }));
const b = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
const c = await b.newContext({ viewport: { width: 1600, height: 900 }, recordVideo: { dir: tmp, size: { width: 1600, height: 900 } } }); const p = await c.newPage();
await p.goto('file://' + f); await p.waitForFunction(() => document.title === 'done', null, { timeout: 600000 }); await p.waitForTimeout(500); await c.close(); await b.close();
const w = fs.readdirSync(tmp).find((x) => x.endsWith('.webm'));
execSync(`ffmpeg -y -loglevel error -ss 0.4 -i "${tmp}/${w}" -c:v libx264 -crf 28 -pix_fmt yuv420p -movflags +faststart "${outFile}"`); fs.rmSync(tmp, { recursive: true }); console.log('wrote', outFile, lines.length, 'lines');
