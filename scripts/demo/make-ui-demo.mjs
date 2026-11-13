#!/usr/bin/env node
// Builds docs/media/app-demo.mp4 and app-demo.gif from the per-person browser recordings of the Playwright journey.
//   cd andum-web && RECORD=1 VIDEOS=/tmp/andum-videos SHOTS=../docs/media/app npx playwright test journey
//   node scripts/demo/make-ui-demo.mjs /tmp/andum-videos docs/media
// Needs ffmpeg. Caption cards are rendered with Playwright. Segment times are seconds on the shared test clock
// (all recordings start with the test), found from the screenshot timestamps; adjust SEG below if the journey timing changes.
import { chromium } from '../../andum-web/node_modules/playwright-core/index.mjs';
import { execFileSync } from 'child_process';
import fs from 'fs'; import os from 'os'; import path from 'path';

const [vidDir, outDir] = process.argv.slice(2);
if (!vidDir || !outDir) { console.error('usage: make-ui-demo.mjs <videos dir> <out dir>'); process.exit(1); }
const find = (who) => { const d = path.join(vidDir, who); return path.join(d, fs.readdirSync(d).find((f) => f.endsWith('.webm'))); };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'andum-demo-'));

// [person, from, to, speed, caption title, caption line]
const SEG = JSON.parse(process.env.SEG ?? 'null') ?? [
  ['sender',    4,  46, 1.5, '1  The sender builds a package',        'Sign in with an email code. The key is made in the browser. Get test USDC, add two parts, sign and send. Nobody pays gas.'],
  ['recipient', 40, 62, 1.2, '2  The recipient sees the funds first',  'Opens the link, sees 1,000 USDC locked in two parts, signs in, and a wrong invite code is refused.'],
  ['recipient', 62, 82, 1.2, '3  Accept, take part 1, try part 2 too early', 'The pass is minted on NEAR. Part 1 opens now. Part 2 is refused by the contract: not open yet.'],
  ['recipient', 228, 248, 1.5, '4  After the date, it still needs approval', 'The date has passed but the approver has not said yes. The contract refuses again.'],
  ['approver',  246, 258, 1.0, '5  The approver says yes',            'A different person, a different browser, a different key.'],
  ['recipient', 256, 264, 1.0, '6  The last part opens and is taken',   '2 of 2 parts taken. 1,000 USDC in the recipient’s account.'],
];

const card = (t, l) => `<body style="margin:0;background:#080B11;color:#EBEFF6;font-family:system-ui,sans-serif;display:grid;place-items:center;width:1280px;height:900px">
<div style="max-width:880px;padding:0 40px"><div style="font:600 18px ui-monospace,Menlo,monospace;color:#6FE3C1;letter-spacing:.14em;text-transform:uppercase">Andum · NEAR testnet · test money</div>
<h1 style="font-size:58px;line-height:1.08;margin:20px 0 22px;font-weight:500">${t}</h1><p style="font-size:26px;line-height:1.45;color:#8F9AAD;margin:0">${l}</p></div></body>`;

const b = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
const pg = await b.newPage({ viewport: { width: 1280, height: 900 } });
const parts = [];
const ff = (...a) => execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...a]);
for (const [i, [who, from, to, speed, t, l]] of SEG.entries()) {
  await pg.setContent(card(t, l)); const png = path.join(tmp, `c${i}.png`); await pg.screenshot({ path: png });
  const cardMp4 = path.join(tmp, `c${i}.mp4`); ff('-loop', '1', '-t', '3', '-i', png, '-vf', 'fps=25,format=yuv420p', '-c:v', 'libx264', '-crf', '24', cardMp4);
  const clip = path.join(tmp, `s${i}.mp4`);
  ff('-ss', String(from), '-t', String(to - from), '-i', find(who), '-vf', `setpts=PTS/${speed},fps=25,scale=1280:900,format=yuv420p`, '-an', '-c:v', 'libx264', '-crf', '26', clip);
  parts.push(cardMp4, clip);
}
await b.close();
fs.writeFileSync(path.join(tmp, 'list.txt'), parts.map((p) => `file '${p}'`).join('\n'));
const mp4 = path.join(outDir, 'app-demo.mp4');
ff('-f', 'concat', '-safe', '0', '-i', path.join(tmp, 'list.txt'), '-c', 'copy', '-movflags', '+faststart', mp4);
const pal = path.join(tmp, 'pal.png');
ff('-i', mp4, '-vf', 'fps=8,scale=800:-1:flags=lanczos,palettegen=max_colors=96', pal);
ff('-i', mp4, '-i', pal, '-lavfi', 'fps=8,scale=800:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=4', '-loop', '0', path.join(outDir, 'app-demo.gif'));
fs.rmSync(tmp, { recursive: true });
console.log('wrote', mp4, 'and app-demo.gif');
