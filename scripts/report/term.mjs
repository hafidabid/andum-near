// Renders ANSI logs as a terminal-looking page (static or typed-out animation) for screenshots/videos.
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const FG = { 30: '#6e7681', 31: '#ff7b72', 32: '#56d364', 33: '#e3b341', 34: '#79c0ff', 35: '#d2a8ff', 36: '#76e3ea', 37: '#e6edf3', 90: '#8b949e' };
export const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');
export function ansiLine(line) {
  let out = '', st = { b: false, d: false, fg: null }, last = 0, m; const re = /\x1b\[([0-9;]*)m/g;
  const flush = (t) => { if (!t) return; const css = [st.fg && `color:${st.fg}`, st.b && 'font-weight:700', st.d && 'opacity:.62'].filter(Boolean).join(';'); out += css ? `<span style="${css}">${esc(t)}</span>` : esc(t); };
  while ((m = re.exec(line))) { flush(line.slice(last, m.index)); last = re.lastIndex; for (const c of (m[1] || '0').split(';').map(Number)) { if (c === 0) st = { b: false, d: false, fg: null }; else if (c === 1) st.b = true; else if (c === 2) st.d = true; else if (c === 22) { st.b = false; st.d = false; } else if (c === 39) st.fg = null; else if (FG[c]) st.fg = FG[c]; } }
  flush(line.slice(last)); return out;
}
const CSS = `*{box-sizing:border-box}body{margin:0;background:#0b0f14;font-family:'SF Mono',Menlo,Consolas,monospace;color:#e6edf3}.win{background:#0d1117;display:flex;flex-direction:column}.bar{height:38px;background:#161b22;display:flex;align-items:center;padding:0 14px;gap:8px;border-bottom:1px solid #30363d;flex:none}.dot{width:12px;height:12px;border-radius:50%}.title{margin-left:12px;font-size:13px;color:#8b949e;font-family:-apple-system,Helvetica,sans-serif}.body{padding:16px 20px;font-size:var(--fs,14px);line-height:1.5;white-space:pre-wrap;word-break:break-all;flex:1}.banner{position:fixed;left:0;right:0;bottom:0;padding:14px 24px;background:rgba(88,166,255,.14);border-top:1px solid #1f6feb;color:#cae8ff;font:600 18px -apple-system,Helvetica,sans-serif}`;
export function termHtml({ title, lines, animate = false, fs = 14 }) {
  const html = lines.map(ansiLine);
  const bar = `<div class="bar"><span class="dot" style="background:#ff5f56"></span><span class="dot" style="background:#ffbd2e"></span><span class="dot" style="background:#27c93f"></span><span class="title">${esc(title)}</span></div>`;
  if (!animate) return `<!doctype html><meta charset=utf8><style>${CSS}</style><div class="win" style="--fs:${fs}px">${bar}<div class="body">${html.join('\n')}</div></div>`;
  return `<!doctype html><meta charset=utf8><style>${CSS}.win{height:100vh}.body{overflow:hidden}</style><div class="win" style="--fs:${fs}px">${bar}<div class="body" id="b"></div></div><div class="banner" id="cap" style="display:none"></div><script>
const L=${JSON.stringify(html)}, P=${JSON.stringify(lines.map(strip))}; const b=document.getElementById('b'), cap=document.getElementById('cap'); const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{await sleep(600);for(let i=0;i<L.length;i++){const d=document.createElement('div');d.innerHTML=L[i]||'&nbsp;';b.appendChild(d);b.scrollTop=b.scrollHeight;const p=P[i];const h=p.startsWith('━━');if(h){cap.style.display='block';cap.textContent=p.replace('━━ ','');}await sleep(h?1100:/✉|✖|✔/.test(p)?420:/↳/.test(p)?260:140);}await sleep(2500);document.title='done';})();
</script>`;
}
