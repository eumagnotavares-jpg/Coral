/* Coral · Tenor — app de treino (PWA). Tudo roda no aparelho. */
(async function () {
'use strict';
const $ = id => document.getElementById(id);
const PLAY = '<svg viewBox="0 0 24 24"><path d="M7 4l14 8-14 8z"/></svg>';
const PAUSE = '<svg viewBox="0 0 24 24"><path d="M6 4h4v16H6zM14 4h4v16h-4z"/></svg>';
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const PT = ['Dó','Dó#','Ré','Ré#','Mi','Fá','Fá#','Sol','Sol#','Lá','Lá#','Si'];
const nameOf = s => PT[((s % 12) + 12) % 12] + ' ' + (Math.floor(s / 12) - 1); // s = midi soando

if ('serviceWorker' in navigator) { try { navigator.serviceWorker.register('sw.js'); } catch (e) {} }
try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch (e) {}

const BASE = await (await fetch('base.json')).json();
const NOTES = BASE.notes, WARM = BASE.warm;
// Músicas: importadas pela pessoa e guardadas só neste aparelho (IndexedDB). O site público não tem nenhuma música.
const SongDB = {
  open() { return new Promise((res, rej) => { const r = indexedDB.open('coral-songs', 1); r.onupgradeneeded = () => r.result.createObjectStore('songs', { keyPath: 'id' }); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); },
  async all() { const db = await this.open(); return new Promise((res, rej) => { const q = db.transaction('songs').objectStore('songs').getAll(); q.onsuccess = () => res(q.result || []); q.onerror = () => rej(q.error); }); },
  async put(v) { const db = await this.open(); return new Promise((res, rej) => { const t = db.transaction('songs', 'readwrite'); t.objectStore('songs').put(v); t.oncomplete = () => res(); t.onerror = () => rej(t.error); }); },
  async del(id) { const db = await this.open(); return new Promise((res, rej) => { const t = db.transaction('songs', 'readwrite'); t.objectStore('songs').delete(id); t.oncomplete = () => res(); t.onerror = () => rej(t.error); }); }
};
let SONGS = []; try { SONGS = await SongDB.all(); } catch (e) {}
let curId = null; try { curId = localStorage.getItem('coral-cur'); } catch (e) {}
const PACK = SONGS.find(x => x.id === curId) || SONGS[0] || null;
const SECS = PACK ? PACK.secs : [], FULL = PACK ? PACK.full : { lines: [], blocks: [], len: 1, a: {} };
const KEYS = PACK && PACK.keys ? PACK.keys : [57,59,61,62,64,66,67,68,69,71];   // escrito (soa 1 oitava abaixo)
const SONG = PACK && PACK.range ? PACK.range : { lo: 45, hi: 59, introHi: 66 };  // soando
let bpm = 60, mode = 'nota';

/* ================= Armazenamento (só neste aparelho) ================= */
const KEY = 'coral-tenor-v1' + (PACK && PACK.id !== 'maracangalha' ? ':' + PACK.id : '');
const Store = {
  d: { status: {}, log: [], results: [], alcance: null, days: {} },
  load() { try { const t = localStorage.getItem(KEY); if (t) this.d = Object.assign(this.d, JSON.parse(t)); } catch (e) {} },
  save() { try { localStorage.setItem(KEY, JSON.stringify(this.d)); } catch (e) {} }
};
Store.load();

/* ================= Áudio ================= */
// Dois players fixos (o iPhone libera o som por elemento depois do primeiro toque)
const A = { main: new Audio(), note: new Audio(), ready: {}, loading: {}, endCb: null, owner: null };
A.main.preload = 'auto'; A.note.preload = 'auto';
A.main.setAttribute('playsinline', ''); A.note.setAttribute('playsinline', '');
A.main.addEventListener('ended', () => { const cb = A.endCb; A.endCb = null; A.owner = null; cb && cb(); });
function load(path) {
  if (A.ready[path]) return Promise.resolve(A.ready[path]);
  if (!A.loading[path]) A.loading[path] = fetch(path).then(r => r.blob()).then(b => (A.ready[path] = URL.createObjectURL(b)));
  return A.loading[path];
}
const SILENT = 'data:audio/mp3;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4Ljc2LjEwMAAAAAAAAAAAAAAA//tQxAADB8AhSmxhIIEVCSiJrDCQBTcu3UrAIwUdkRgQbFAZC1CQEwTJ9mjRvBA4UOLD8nKVOWfh+UlK3z/177OXrfOdKl7pyn3Xf//WreyTRUoAWgBgkOAGbZHBgG1OF6zM82DWbZaUmMBptgQhGjsyYqc9ae9XFz280948NMBWInljyzsNRFLPWdnZGWrddDsjK1unuSrVN9jJsK8KuQtQCtMBjCEtImISdNKJOopIpBFpNSMbIHCSRpRR5iakjTiyzLhchUUBwCgyKiweBv/7UsQbg8isVNoMPMjAAAA0gAAABEVFGmgqK////9bP/6XCykxBTUUzLjEwMKqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq';
let unlocked = false;
function unlock() {
  if (unlocked) return; unlocked = true;
  [A.main, A.note].forEach(a => { try { a.src = SILENT; const p = a.play(); p && p.then(() => { if (a.src === SILENT) a.pause(); }).catch(() => {}); } catch (e) {} });
}
document.addEventListener('touchend', unlock, { once: true, capture: true });
document.addEventListener('click', unlock, { once: true, capture: true });

const stoppers = new Set();
function stopAll(except) { stoppers.forEach(f => { if (f !== except) f(); }); }
function playMain(path, at, owner, onEnd) {
  A.main.pause(); A.endCb = null; A.owner = owner;
  const go = u => {
    if (A.owner !== owner) return;
    if (A.main.src !== u) { A.main.src = u; }
    const seek = () => { try { A.main.currentTime = at || 0; } catch (e) {} };
    if (A.main.readyState >= 1) seek(); else A.main.addEventListener('loadedmetadata', seek, { once: true });
    A.endCb = onEnd || null;
    const p = A.main.play(); p && p.catch(() => {});
  };
  const u = A.ready[path]; if (u) go(u); else load(path).then(go);
}
function stopMain() { A.main.pause(); A.endCb = null; A.owner = null; }
let seqT = [];
function stopNotes() { seqT.forEach(clearTimeout); seqT = []; A.note.pause(); }
stoppers.add(stopNotes);
function flashKey(m) { document.querySelectorAll('.key[data-m="' + m + '"]').forEach(k => { k.classList.add('on'); setTimeout(() => k.classList.remove('on'), 900); }); }
function noteNow(m) {
  const path = NOTES[m].a, go = u => { if (A.note.src !== u) A.note.src = u; try { A.note.currentTime = 0; } catch (e) {} const p = A.note.play(); p && p.catch(() => {}); };
  const u = A.ready[path]; if (u) go(u); else load(path).then(go);
  flashKey(m);
}
function playNote(m, keep) { if (!keep) stopAll(stopNotes); stopNotes(); noteNow(m); }
function playSeq(list, ms) { stopAll(); list.forEach((m, i) => seqT.push(setTimeout(() => noteNow(m), i * ms))); }
// pré-carrega: notas e trechos primeiro, o resto depois
(async () => {
  const first = Object.values(NOTES).map(n => n.a).concat(SECS.map(s => s.a[60]));
  const rest = SECS.map(s => s.a[80]).concat(WARM.map(w => w.a), [FULL.a[60], FULL.a[80]]);
  for (const p of first.concat(rest).filter(Boolean)) { try { await load(p); } catch (e) {} }
})();

/* ================= Microfone ================= */
const Mic = {
  on: false, ctx: null, stream: null, an: null, buf: null, proc: null, rec: null,
  async start() {
    if (this.on) return;
    try { if (navigator.audioSession) navigator.audioSession.type = 'play-and-record'; } catch (e) {}
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    const AC = window.AudioContext || window.webkitAudioContext; this.ctx = new AC();
    try { await this.ctx.resume(); } catch (e) {}
    const src = this.ctx.createMediaStreamSource(this.stream);
    this.an = this.ctx.createAnalyser(); this.an.fftSize = 2048; src.connect(this.an);
    this.proc = this.ctx.createScriptProcessor(4096, 1, 1); src.connect(this.proc);
    const g = this.ctx.createGain(); g.gain.value = 0; this.proc.connect(g); g.connect(this.ctx.destination);
    this.proc.onaudioprocess = e => { if (this.rec) this.rec.push(new Float32Array(e.inputBuffer.getChannelData(0))); };
    this.buf = new Float32Array(2048); this.on = true;
  },
  stop() {
    if (!this.on) return; this.on = false; this.rec = null;
    try { this.stream.getTracks().forEach(t => t.stop()); } catch (e) {}
    try { this.proc.onaudioprocess = null; this.ctx.close(); } catch (e) {}
    try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) {}
  },
  pitch() { if (!this.on) return NaN; this.an.getFloatTimeDomainData(this.buf); const r = AN.yinFrame(this.buf, this.ctx.sampleRate, 0, this.buf.length); return r.c > 0.75 ? r.m : NaN; }
};
function micError(e) {
  return (e && (e.name === 'NotAllowedError' || e.name === 'SecurityError'))
    ? 'O microfone foi bloqueado. No iPhone: Ajustes › Safari › Microfone › Perguntar ou Permitir, e abra o app de novo.'
    : 'Não consegui ligar o microfone neste aparelho.';
}

/* ================= Desenho das linhas da letra ================= */
function rangeOf(lines) { const ms = lines.flat().map(e => e.m); const lo = Math.min(...ms), hi = Math.max(...ms); return { hi, span: Math.max(hi - lo, 1) }; }
function drawLine(line, rg, opt) {
  const ln = document.createElement('div'); ln.className = 'ln'; const els = []; let prev = opt.prev || null;
  const h = opt.big ? 52 : 42;
  line.forEach((e, i) => {
    const b = document.createElement('span'); b.className = 'syl' + (e.br ? ' br' : '');
    const y = Math.round((rg.hi - e.m) / rg.span * h);
    b.style.flex = (0.6 + e.d) + ' 1 auto'; b.style.paddingTop = y + 'px'; b.style.setProperty('--y', y + 'px');
    const txt = (e.s === '~' || (e.s === prev && e.s === 'hum')) ? '~' : e.s; if (txt === '~') b.classList.add('mel'); prev = e.s;
    const t = document.createElement('span'); t.className = 't'; t.textContent = txt; b.appendChild(t);
    if (e.d >= 1) { const hh = document.createElement('span'); hh.className = 'h'; b.appendChild(hh); }
    const nn = document.createElement('span'); nn.className = 'nn'; nn.textContent = NOTES[e.m].n; b.appendChild(nn);
    b.addEventListener('click', ev => {
      if (opt.onTap && opt.onTap(e, ev) === false) return;
      ev.stopPropagation(); playNote(e.m); b.classList.add('ping'); setTimeout(() => b.classList.remove('ping'), 700);
    });
    ln.appendChild(b); els.push({ e, el: b, nn });
  });
  return { ln, els, prev };
}
function fit(root) { (root || document).querySelectorAll('.ln').forEach(l => { l.classList.remove('wrap'); if (l.scrollWidth > l.clientWidth + 1) l.classList.add('wrap'); }); }
function karaoke(els, beat) { let cur = null; els.forEach(({ e, el }) => { const on = beat >= e.b && beat < e.b + e.d; el.classList.toggle('cur', on); el.classList.toggle('done', beat >= e.b + e.d); if (on) cur = el; }); return cur; }

/* ================= Abas ================= */
const VIEWS = ['hoje','treinar','afinador','corrigir','ensaio','aquecer','alcance','diario'];
let view = 'hoje';
function show(v) {
  if (!VIEWS.includes(v)) v = 'hoje';
  if (view === 'afinador' && v !== 'afinador') tunerOff();
  if (view === 'alcance' && v !== 'alcance') rMicOff();
  view = v;
  document.querySelectorAll('.tabs button').forEach(b => { b.setAttribute('aria-selected', b.dataset.v === v); if (b.dataset.v === v) b.scrollIntoView({ inline: 'center', block: 'nearest' }); });
  VIEWS.forEach(x => $('v-' + x).hidden = x !== v);
  try { history.replaceState(null, '', '#' + v); } catch (e) {}
  if (v === 'hoje') renderDay();
  window.scrollTo(0, 0);
  requestAnimationFrame(() => fit());
}
document.querySelectorAll('.tabs button').forEach(b => b.onclick = () => show(b.dataset.v));

function setBpm(v) {
  stopAll(); bpm = v;
  document.querySelectorAll('.v60').forEach(b => b.setAttribute('aria-pressed', v === 60));
  document.querySelectorAll('.v80').forEach(b => b.setAttribute('aria-pressed', v === 80));
  SECS.forEach(s => s.els.forEach(({ el }) => el.classList.remove('cur', 'done')));
  refreshMapTimes();
}
document.querySelectorAll('.v60').forEach(b => b.onclick = () => setBpm(60));
document.querySelectorAll('.v80').forEach(b => b.onclick = () => setBpm(80));
function setMode(v) { mode = v; $('mN').setAttribute('aria-pressed', v === 'nota'); $('mL').setAttribute('aria-pressed', v === 'linha'); }
$('mN').onclick = () => setMode('nota'); $('mL').onclick = () => setMode('linha');

/* ================= TREINAR ================= */
let active = null, raf = 0, lastLine = null;
function stopSec() {
  if (!active) return; if (A.owner === 'sec') stopMain();
  active.card.classList.remove('on'); active.card.querySelector('.play').innerHTML = PLAY; cancelAnimationFrame(raf);
  active.card.querySelectorAll('.count i').forEach(d => d.classList.remove('hit')); active = null;
}
stoppers.add(stopSec);
function startSec(s, beat) {
  stopAll(); active = s; const spb = 60 / bpm;
  playMain(s.a[bpm], beat == null ? 0 : Math.max(0, (4 + beat) * spb), 'sec', () => { const id = s.id; stopSec(); Day.listened(id); });
  s.card.classList.add('on'); s.card.querySelector('.play').innerHTML = PAUSE; lastLine = null; tickSec();
}
function tickSec() {
  if (!active) return; const s = active, beat = A.main.currentTime / (60 / bpm) - 4;
  s.card.querySelectorAll('.count i').forEach((d, i) => d.classList.toggle('hit', beat < 0 && i <= Math.floor(beat + 4)));
  const cur = karaoke(s.els, beat);
  if (cur) { const ln = cur.parentElement; if (ln !== lastLine) { lastLine = ln; const r = ln.getBoundingClientRect(); if (r.top < 110 || r.bottom > innerHeight - 40) ln.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' }); } }
  raf = requestAnimationFrame(tickSec);
}
SECS.forEach(s => {
  const rg = rangeOf(s.lines); s.rg = rg;
  const el = document.createElement('section'); el.className = 'sec'; el.id = 'sec-' + s.id;
  el.innerHTML = '<div class="sh"><button class="play" aria-label="Tocar">' + PLAY + '</button><div><div class="n"></div><h3></h3></div><div class="count" aria-hidden="true"><i></i><i></i><i></i><i></i></div></div><p class="tip"></p><div class="lines"></div>';
  el.querySelector('.n').textContent = s.id === '0' ? 'Extra' : 'Trecho ' + s.id;
  el.querySelector('h3').textContent = s.t; el.querySelector('.tip').textContent = s.tip;
  const box = el.querySelector('.lines'); s.els = []; let prev = null;
  s.lines.forEach(line => {
    const r = drawLine(line, rg, { prev, onTap: () => mode === 'nota' }); prev = r.prev;
    r.ln.addEventListener('click', () => { if (mode === 'linha') startSec(s, line[0].b - 1); });
    box.appendChild(r.ln); s.els.push(...r.els);
  });
  el.querySelector('.play').onclick = () => { if (active === s) stopSec(); else startSec(s, null); };
  s.card = el; $('secs').appendChild(el);
});
const secById = id => SECS.find(x => x.id === id);
const secName = id => id === '0' ? 'Introdução' : 'Trecho ' + id;
KEYS.forEach((m, i) => {
  const k = document.createElement('button'); k.className = 'key'; k.dataset.m = m; k.style.height = (52 + i * 11) + 'px';
  const n = NOTES[m].n; k.innerHTML = n.replace('↑', '') + (n.includes('↑') ? '<small>agudo</small>' : ''); k.setAttribute('aria-label', 'Tocar ' + n);
  k.onclick = () => playNote(m); $('kbd').appendChild(k);
});
$('dGA').onclick = () => playSeq([57, 71, 57, 71], 1200);
$('dUp').onclick = () => playSeq(KEYS, 650);
$('dDn').onclick = () => playSeq([...KEYS].reverse(), 650);

/* ================= AFINADOR ================= */
let tTarget = null, tTimer = 0, tHist = [], tSmooth = [];
const tc = $('trail'), tx = tc.getContext('2d');
KEYS.forEach(m => { const b = document.createElement('button'); b.textContent = NOTES[m].n; b.dataset.m = m; b.setAttribute('aria-pressed', 'false'); b.onclick = () => setTarget(tTarget === m - 12 ? null : m - 12); $('tTargets').appendChild(b); });
function setTarget(s) {
  tTarget = s; $('tTargets').querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', s != null && +b.dataset.m - 12 === s));
  $('tTip').textContent = s == null ? 'Sem alvo: o afinador mostra a nota mais próxima.' : 'Alvo: ' + nameOf(s) + '. Ouça e cante até aparecer “Na nota ✓”.';
  if (s != null) playNote(s + 12, true);
}
$('tHear').onclick = () => { if (tTarget != null) playNote(tTarget + 12, true); else playSeq(KEYS, 650); };
async function tunerOn() {
  try { await Mic.start(); } catch (e) { $('tStat').textContent = micError(e); return; }
  $('tOn').textContent = '■ Desligar microfone'; $('tOn').classList.remove('pri'); $('tStat').textContent = 'Ouvindo…';
  clearInterval(tTimer); tTimer = setInterval(tunerTick, 66);
}
function tunerOff() { clearInterval(tTimer); tTimer = 0; if (!recording && !rTimer) Mic.stop(); $('tOn').textContent = '🎤 Ligar microfone'; $('tOn').classList.add('pri'); $('tStat').textContent = ''; }
$('tOn').onclick = () => tTimer ? tunerOff() : tunerOn();
function tunerTick() {
  const m = Mic.pitch(); tHist.push(m); if (tHist.length > 90) tHist.shift();
  if (m === m) { tSmooth.push(m); if (tSmooth.length > 5) tSmooth.shift(); } else if (tSmooth.length) tSmooth.shift();
  const sm = tSmooth.length >= 3 ? [...tSmooth].sort((a, b) => a - b)[tSmooth.length >> 1] : NaN;
  const css = getComputedStyle(document.documentElement);
  if (sm === sm) {
    const near = Math.round(sm), ref = tTarget != null && Math.abs(sm - tTarget) < 1 ? tTarget : near, c = Math.round((sm - ref) * 100);
    $('tNote').textContent = nameOf(near);
    $('tCents').textContent = (c > 0 ? '+' : '') + c + ' cents' + (tTarget != null ? ' do alvo' : '');
    let pos = Math.max(-50, Math.min(50, c)); if (tTarget != null && Math.abs(sm - tTarget) >= 1) pos = sm > tTarget ? 50 : -50;
    $('tNeedle').style.left = (50 + pos) + '%';
    const col = Math.abs(c) <= 15 ? css.getPropertyValue('--ok') : Math.abs(c) <= 35 ? css.getPropertyValue('--near') : css.getPropertyValue('--high');
    $('tNeedle').style.background = col; $('tNote').style.color = col;
    if (tTarget != null) {
      const d = sm - tTarget;
      $('tSay').textContent = Math.abs(d) <= 0.25 ? 'Na nota ✓' : (d > 0 ? 'Desça ▼' : 'Suba ▲') + (Math.abs(d) >= 1.5 ? ' (' + Math.round(Math.abs(d)) + ' semitons)' : '');
      $('tSay').style.color = Math.abs(d) <= 0.25 ? css.getPropertyValue('--ok') : '';
    } else { $('tSay').textContent = Math.abs(c) <= 15 ? 'Afinado ✓' : (c > 0 ? 'Um pouco alto' : 'Um pouco baixo'); $('tSay').style.color = ''; }
  } else { $('tCents').innerHTML = '&nbsp;'; $('tSay').innerHTML = '&nbsp;'; $('tNote').style.color = css.getPropertyValue('--muted'); }
  drawTrail(css);
}
function drawTrail(css) {
  const W = tc.width, H = tc.height; tx.clearRect(0, 0, W, H);
  const valid = tHist.filter(v => v === v); const center = tTarget != null ? tTarget : (valid.length ? Math.round([...valid].sort((a, b) => a - b)[valid.length >> 1]) : 50);
  const lo = center - 7, hi = center + 7, y = m => H - (m - lo) / (hi - lo) * H;
  tx.font = '22px -apple-system, Arial'; tx.textBaseline = 'middle';
  for (let s = Math.ceil(lo); s <= hi; s++) {
    const pc = ((s % 12) + 12) % 12, nat = [0, 2, 4, 5, 7, 9, 11].includes(pc), lab = [0, 4, 7, 9].includes(pc);
    tx.strokeStyle = css.getPropertyValue('--line'); tx.lineWidth = nat ? 2 : 1; tx.beginPath(); tx.moveTo(90, y(s)); tx.lineTo(W, y(s)); tx.stroke();
    if (lab) { tx.fillStyle = css.getPropertyValue('--muted'); tx.fillText(nameOf(s), 6, y(s)); }
  }
  if (tTarget != null) { tx.strokeStyle = css.getPropertyValue('--red'); tx.lineWidth = 4; tx.beginPath(); tx.moveTo(90, y(tTarget)); tx.lineTo(W, y(tTarget)); tx.stroke(); }
  tx.strokeStyle = css.getPropertyValue('--ink'); tx.lineWidth = 5; tx.lineJoin = 'round'; tx.beginPath(); let pen = false;
  tHist.forEach((m, i) => { const X = 90 + (W - 90) * i / 89; if (m === m && m > lo - 1 && m < hi + 1) { pen ? tx.lineTo(X, y(m)) : tx.moveTo(X, y(m)); pen = true; } else pen = false; });
  tx.stroke();
}

/* ================= CORRIGIR (gravar e analisar) ================= */
let recording = false, recSec = null, recHint = null, recRaf = 0, recLine = -1, recStartT = 0, lastGrade = null, lastSec = null, gView = 'pitch';
SECS.forEach(s => { const o = document.createElement('option'); o.value = s.id; o.textContent = s.id === '0' ? 'Introdução' : 'Trecho ' + s.id + ' · ' + s.t; $('cSec').appendChild(o); });
function stopRec(analyze) {
  if (!recording) return; recording = false; cancelAnimationFrame(recRaf); if (A.owner === 'rec') stopMain();
  $('cRec').disabled = false; $('cStage').hidden = true;
  const chunks = Mic.rec || [], sr = Mic.ctx ? Mic.ctx.sampleRate : 48000; Mic.rec = null;
  if (!tTimer && !rTimer) Mic.stop();
  if (analyze) analyzePCM(chunks, sr); else $('cMsg').textContent = 'Gravação cancelada.';
}
stoppers.add(() => stopRec(false));
$('cStop').onclick = () => stopRec(true);
$('cRec').onclick = async () => {
  const s = secById($('cSec').value); stopAll(); $('cOut').hidden = true; $('cMsg').classList.remove('err');
  try { await Mic.start(); } catch (e) { $('cMsg').textContent = micError(e); $('cMsg').classList.add('err'); return; }
  recording = true; recSec = s; recHint = null; recLine = -1; $('cRec').disabled = true;
  $('cMsg').textContent = 'Espere os 4 cliques e cante junto.';
  $('cStage').hidden = false; $('cNow').innerHTML = ''; $('cNext').innerHTML = '';
  Mic.rec = []; recStartT = performance.now();
  A.main.addEventListener('playing', () => { if (recording && recHint == null) recHint = (performance.now() - recStartT) / 1000; }, { once: true });
  playMain(s.a[bpm], 0, 'rec', () => setTimeout(() => stopRec(true), 700));
  const lines = s.lines;
  (function tick() {
    if (!recording) return; const beat = A.main.currentTime / (60 / bpm) - 4, last = lines[lines.length - 1], end = last[last.length - 1];
    $('cLbl').textContent = beat < 0 ? 'Gravando · contando ' + (Math.floor(beat + 4) + 1) : 'Gravando · cante junto';
    $('cProg').style.width = Math.max(0, Math.min(100, beat / (end.b + end.d) * 100)) + '%';
    let li = lines.findIndex(l => beat < l[l.length - 1].b + l[l.length - 1].d); if (li < 0) li = lines.length - 1;
    if (li !== recLine) {
      recLine = li; $('cNow').innerHTML = ''; $('cNext').innerHTML = '';
      const r = drawLine(lines[li], s.rg, { big: true, onTap: () => false }); $('cNow').appendChild(r.ln); s._recEls = r.els;
      if (lines[li + 1]) $('cNext').appendChild(drawLine(lines[li + 1], s.rg, { onTap: () => false }).ln);
      fit($('cStage'));
    }
    if (s._recEls) karaoke(s._recEls, beat);
    recRaf = requestAnimationFrame(tick);
  })();
};
async function analyzePCM(chunks, sr) {
  try {
    $('cMsg').textContent = 'Preparando a gravação…';
    const x = await AN.pcmToMono16k(chunks, sr);
    await runAnalysis(x, recSec, recHint);
  } catch (e) { fail('Não consegui analisar a gravação. Tente de novo.'); }
}
$('cFile').onchange = async ev => {
  const f = ev.target.files[0]; ev.target.value = ''; if (!f) return;
  stopAll(); $('cOut').hidden = true; $('cMsg').classList.remove('err');
  try { $('cMsg').textContent = 'Lendo a gravação…'; const x = await AN.decodeToMono16k(await f.arrayBuffer()); await runAnalysis(x, secById($('cSec').value), null); }
  catch (e) { fail(e && e.message === 'curta' ? 'A gravação é muito curta.' : e && e.message === 'pouca' ? 'Quase não ouvi voz. Confira o trecho e a velocidade escolhidos.' : 'Não consegui abrir esse arquivo. Tente um .m4a do Gravador.'); }
};
function fail(t) { $('cMsg').textContent = t; $('cMsg').classList.add('err'); }
async function runAnalysis(x, s, hint) {
  if (x.length < AN.SR * 3) throw new Error('curta');
  $('cMsg').textContent = 'Ouvindo sua voz… 0%';
  const tr = await AN.track(x, p => $('cMsg').textContent = 'Ouvindo sua voz… ' + Math.round(p * 100) + '%');
  const notes = s.lines.flat().map(e => ({ m: e.m - 12, b: e.b, d: e.d }));
  const g = AN.grade(tr, notes, 60 / bpm, hint);
  if (g.heard < notes.length * 0.3) { fail('Quase não ouvi sua voz nessa gravação. Cante mais perto do microfone do fone ou do celular.'); return; }
  lastGrade = g; lastSec = s; gView = 'pitch'; showResult();
  $('cMsg').textContent = 'Pronto. Veja o resultado abaixo.';
  Day.mark('corrigir');
}
const LEG = {
  pitch: [['--ok', 'Afinada'], ['--near', 'Quase'], ['--high', 'Ficou aguda ▲'], ['--low', 'Ficou grave ▼'], ['--silver', 'Não ouvi']],
  rhythm: [['--ok', 'No tempo'], ['--near', 'Adiantou ◂'], ['--low', 'Atrasou ▸'], ['--silver', 'Não medido']]
};
$('vPitch').onclick = () => { gView = 'pitch'; showResult(); };
$('vRhythm').onclick = () => { gView = 'rhythm'; showResult(); };
function showResult() {
  const g = lastGrade, s = lastSec; if (!g) return;
  $('vPitch').setAttribute('aria-pressed', gView === 'pitch'); $('vRhythm').setAttribute('aria-pressed', gView === 'rhythm');
  const pc = (n, d) => d ? Math.round(n / d * 100) + '%' : '–';
  let sum = '';
  if (gView === 'pitch') {
    const off = g.heard - g.good - g.near;
    $('t1').textContent = pc(g.good, g.heard); $('t2').textContent = pc(g.near, g.heard); $('t3').textContent = pc(off, g.heard);
    $('t1l').textContent = 'afinadas'; $('t2l').textContent = 'quase'; $('t3l').textContent = 'fora';
    sum = 'Ouvi ' + g.heard + ' de ' + g.total + ' notas. ';
    sum += Math.abs(g.mean) >= 20 ? 'Na média você ficou ' + (g.mean > 0 ? 'um pouco acima (mais agudo)' : 'um pouco abaixo (mais grave)') + ', cerca de ' + Math.abs(g.mean) + ' cents. ' : 'Na média você ficou centrado na nota. ';
    if (g.oct > 0) sum += 'Você cantou uma oitava acima da linha do tenor: confirme com o professor a altura certa. ';
    if (g.oct < 0) sum += 'Você cantou uma oitava abaixo da linha do tenor. ';
    const bad = g.per.filter(p => p.status === 'high' || p.status === 'low').length;
    sum += bad ? 'Treine as sílabas vermelhas e azuis: toque nelas para ouvir a nota certa, ou use o Afinador com ela como alvo.' : 'Nenhuma nota muito fora. Muito bom.';
  } else {
    const R = g.rhythm, early = g.per.filter(p => p.rStatus === 'early').length, late = g.per.filter(p => p.rStatus === 'late').length;
    $('t1').textContent = pc(R.ok, R.measured); $('t2').textContent = pc(early, R.measured); $('t3').textContent = pc(late, R.measured);
    $('t1l').textContent = 'no tempo'; $('t2l').textContent = 'adiantou'; $('t3l').textContent = 'atrasou';
    sum = 'Medi a entrada de ' + R.measured + ' notas (as que mudam de altura). ';
    if (R.measured) sum += Math.abs(R.meanMs) >= 60 ? 'Na média você entrou ' + (R.meanMs > 0 ? 'atrasado' : 'adiantado') + ' ' + (Math.abs(R.meanMs) / 1000).toFixed(2).replace('.', ',') + ' s. ' : 'Na média você entrou no tempo. ';
    sum += 'Tolerância: ' + (R.tolMs / 1000).toFixed(2).replace('.', ',') + ' s. Um atraso constante (fone Bluetooth, por exemplo) já é descontado.';
  }
  $('cSum').textContent = sum;
  $('cLeg').innerHTML = LEG[gView].map(([v, t]) => '<span><i style="background:var(' + v + ')"></i>' + t + '</span>').join('');
  const box = $('cLines'); box.innerHTML = ''; let i = 0, prev = null;
  s.lines.forEach(line => { const r = drawLine(line, s.rg, { prev }); prev = r.prev; r.els.forEach(o => o.k = i++); box.appendChild(r.ln);
    r.els.forEach(o => { const p = g.per[o.k];
      if (gView === 'pitch') { o.el.classList.add('g-' + p.status); o.nn.textContent = p.status === 'none' ? '—' : (p.cents > 0 ? '+' : '') + p.cents; }
      else { const st = p.rStatus; o.el.classList.add('g-' + (st === 'ok' ? 'ok' : st)); o.nn.textContent = (st === 'skip' || st === 'none') ? '·' : (p.dt > 0 ? '+' : '') + (p.dt / 1000).toFixed(2).replace('.', ','); }
    }); });
  $('cOut').hidden = false; fit(box);
  $('cSaved').textContent = ''; $('cSave').disabled = false;
  if (gView === 'pitch') $('cOut').scrollIntoView({ block: 'start', behavior: reduce ? 'auto' : 'smooth' });
}
$('cSave').onclick = () => {
  const g = lastGrade, s = lastSec; if (!g) return;
  const r = { date: new Date().toISOString(), trecho: s.id, bpm, ok: g.heard ? Math.round(g.good / g.heard * 100) : 0, near: g.heard ? Math.round(g.near / g.heard * 100) : 0, mean: g.mean, oct: g.oct, rOk: g.rhythm.measured ? Math.round(g.rhythm.ok / g.rhythm.measured * 100) : null };
  Store.d.results = [r, ...(Store.d.results || [])].slice(0, 300); Store.save();
  $('cSaved').textContent = 'Salvo ✓'; $('cSave').disabled = true; renderDiary();
};
$('cAgain').onclick = () => { $('cOut').hidden = true; $('cRec').click(); };

/* ================= ENSAIO ================= */
const fp = $('fPlay'); fp.innerHTML = PLAY; let fOn = false, fRaf = 0, fLineIdx = -1;
const FL = FULL.lines.map(l => ({ ...l, rg: rangeOf([l.ev]) }));
const fmt = s => { s = Math.max(0, Math.round(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
function stopFull() { if (!fOn) return; fOn = false; if (A.owner === 'full') stopMain(); fp.innerHTML = PLAY; cancelAnimationFrame(fRaf); $('fCount').querySelectorAll('i').forEach(d => d.classList.remove('hit')); }
stoppers.add(stopFull);
function startFull(beat) { stopAll(); fOn = true; playMain(FULL.a[bpm], beat == null ? 0 : Math.max(0, (4 + beat) * 60 / bpm), 'full', () => { stopFull(); Day.mark('ensaio'); }); fp.innerHTML = PAUSE; fLineIdx = -1; tickFull(); }
fp.onclick = () => fOn ? stopFull() : startFull(null);
FULL.blocks.forEach(b => {
  const li = document.createElement('li'); li.innerHTML = '<span class="k"></span><span><b></b><small></small></span><span class="tm"></span>';
  li.querySelector('.k').textContent = b.trecho === 'I' ? 'In' : b.trecho.replace('b', '');
  li.querySelector('b').textContent = b.label; li.querySelector('small').textContent = b.sub || '';
  li.onclick = () => startFull(b.start - 1); b.li = li; $('map').appendChild(li);
});
function refreshMapTimes() { FULL.blocks.forEach(b => b.li.querySelector('.tm').textContent = fmt((4 + b.start) * 60 / bpm)); }
refreshMapTimes();
function renderStage(i) {
  $('fNow').innerHTML = ''; $('fNext').innerHTML = ''; if (i < 0) return;
  const L = FL[i], r = drawLine(L.ev, L.rg, { big: true }); $('fNow').appendChild(r.ln); L.els = r.els;
  if (FL[i + 1]) $('fNext').appendChild(drawLine(FL[i + 1].ev, FL[i + 1].rg, {}).ln);
  fit($('fNow').parentElement);
}
function tickFull() {
  if (!fOn) return; const beat = A.main.currentTime / (60 / bpm) - 4;
  $('fCount').querySelectorAll('i').forEach((d, i) => d.classList.toggle('hit', beat < 0 && i <= Math.floor(beat + 4)));
  $('fProg').style.width = Math.min(100, Math.max(0, beat / FULL.len * 100)) + '%';
  let li = FL.findIndex(L => { const l = L.ev[L.ev.length - 1]; return beat < l.b + l.d; }); if (li < 0) li = FL.length - 1;
  if (li !== fLineIdx) { fLineIdx = li; renderStage(li); }
  if (FL[li].els) karaoke(FL[li].els, beat);
  let bi = FULL.blocks.findIndex(b => beat < b.end); if (bi < 0) bi = FULL.blocks.length - 1;
  FULL.blocks.forEach((b, i) => { b.li.classList.toggle('now', i === bi && beat >= -0.5); b.li.classList.toggle('past', i < bi); });
  $('fLbl').textContent = beat < 0 ? 'Contando… 1, 2, 3, 4' : FULL.blocks[bi].label;
  fRaf = requestAnimationFrame(tickFull);
}

/* ================= AQUECER ================= */
let bT = null;
function stopBreath() { if (!bT) return; clearInterval(bT); bT = null; $('bPlay').innerHTML = PLAY; $('orb').style.transform = 'scale(.7)'; $('orbT').textContent = 'Pronto?'; $('orbN').textContent = '4'; }
stoppers.add(stopBreath);
$('bPlay').innerHTML = PLAY;
function startBreath() {
  stopAll(); const plan = []; for (let c = 1; c <= 4; c++) { plan.push(['Inspire', 4, c]); plan.push(['Segure', 4, c]); plan.push(['Solte em “sss”', 8, c]); }
  let pi = 0, left = plan[0][1]; $('bPlay').innerHTML = PAUSE;
  const paint = () => { const [t, n, c] = plan[pi]; $('orbT').textContent = t + ' · ciclo ' + c + ' de 4'; $('orbN').textContent = left; $('orb').style.transform = 'scale(' + (t === 'Inspire' ? 0.7 + 0.3 * (n - left + 1) / n : t === 'Segure' ? 1 : 1 - 0.3 * (n - left + 1) / n) + ')'; };
  paint(); bT = setInterval(() => { left--; if (left <= 0) { pi++; if (pi >= plan.length) { stopBreath(); $('orbT').textContent = 'Pronto! Siga para o próximo.'; Day.mark('resp'); return; } left = plan[pi][1]; } paint(); }, 1000);
}
$('bPlay').onclick = () => bT ? stopBreath() : startBreath();
let wActive = null, wRaf = 0;
function stopWarm() { if (!wActive) return; const w = wActive; if (A.owner === 'warm') stopMain(); w.btn.innerHTML = PLAY; cancelAnimationFrame(wRaf); w.stat.textContent = ''; w.stat.classList.remove('warn'); wActive = null; }
stoppers.add(stopWarm);
function startWarm(w) {
  stopAll(); wActive = w; playMain(w.a, 0, 'warm', () => { stopWarm(); w.stat.textContent = 'Feito ✓'; Day.mark('w:' + w.id); }); w.btn.innerHTML = PAUSE; tickWarm();
}
WARM.forEach((w, i) => {
  const el = document.createElement('section'); el.className = 'sec'; el.id = 'warm-' + w.id;
  el.innerHTML = '<div class="sh"><button class="play" aria-label="Tocar exercício">' + PLAY + '</button><div><div class="n"></div><h3></h3></div></div><p class="tip"></p><div class="wstat"></div>';
  el.querySelector('.n').textContent = (i + 2) + ' · Aquecimento'; el.querySelector('h3').textContent = w.t; el.querySelector('.tip').textContent = w.how;
  w.btn = el.querySelector('.play'); w.stat = el.querySelector('.wstat'); w.card = el;
  w.btn.onclick = () => wActive === w ? stopWarm() : startWarm(w);
  $('warm').appendChild(el);
});
function tickWarm() {
  if (!wActive) return; const w = wActive, t = A.main.currentTime; let i = w.tl.findIndex(r => t < r.e); if (i < 0) i = w.tl.length - 1; const r = w.tl[i];
  const hi = Store.d.alcance && Store.d.alcance.hi, top = r.top - 12, over = hi != null && top > hi;
  w.stat.textContent = 'Repetição ' + (i + 1) + ' de ' + w.tl.length + ' · nota mais alta: ' + NOTES[r.top].o + (over ? ' · acima do seu limite: só ouça ou cante bem leve' : '');
  w.stat.classList.toggle('warn', over);
  wRaf = requestAnimationFrame(tickWarm);
}

/* ================= ALCANCE ================= */
const R = { dir: 'up', cur: 50, lastOk: null };
let rTimer = 0, rMatch = 0;
function rSet() { $('rNote').textContent = nameOf(R.cur); $('rUp').setAttribute('aria-pressed', R.dir === 'up'); $('rDn').setAttribute('aria-pressed', R.dir === 'down'); rMatch = 0; }
const rPlay = () => playNote(R.cur + 12, true);
$('rPlay').onclick = rPlay;
$('rUp').onclick = () => { R.dir = 'up'; R.cur = 50; R.lastOk = null; rSet(); $('rMsg').textContent = 'Subindo a partir do Ré 3.'; rPlay(); };
$('rDn').onclick = () => { R.dir = 'down'; R.cur = 50; R.lastOk = null; rSet(); $('rMsg').textContent = 'Descendo a partir do Ré 3. Nas graves, deixe a voz relaxada.'; rPlay(); };
$('rYes').onclick = () => { R.lastOk = R.cur; const nx = R.cur + (R.dir === 'up' ? 1 : -1); if (nx < 36 || nx > 72) { finishDir(); return; } R.cur = nx; rSet(); $('rMsg').textContent = 'Boa. Próxima: ' + nameOf(R.cur) + '.'; rPlay(); };
$('rNo').onclick = () => finishDir();
function finishDir() {
  const a = Object.assign({}, Store.d.alcance || {});
  if (R.lastOk == null) { $('rMsg').textContent = 'Tudo bem. Respire, beba água e tente de novo.'; return; }
  if (R.dir === 'up') a.hi = R.lastOk; else a.lo = R.lastOk; a.date = new Date().toISOString();
  Store.d.alcance = a; Store.save(); drawRange(); renderDiary();
  $('rMsg').textContent = (R.dir === 'up' ? 'Agudo confortável: ' : 'Grave confortável: ') + nameOf(R.lastOk) + '. ' + (R.dir === 'up' && a.lo == null ? 'Agora faça “Para o grave”.' : R.dir === 'down' && a.hi == null ? 'Agora faça “Para o agudo”.' : '');
  if (R.dir === 'up' && a.lo == null) { R.dir = 'down'; R.cur = 50; R.lastOk = null; rSet(); }
}
async function rMicOn() {
  try { await Mic.start(); } catch (e) { $('rMsg').textContent = micError(e); return; }
  $('rLive').hidden = false; $('rMic').textContent = '■ Desligar microfone';
  clearInterval(rTimer); rTimer = setInterval(() => {
    const m = Mic.pitch(); if (m !== m) { $('rLive').textContent = 'Microfone: cante “ô”…'; $('rLive').classList.remove('match'); rMatch = 0; return; }
    const d = m - R.cur, ok = Math.abs(d) <= 0.5; rMatch = ok ? rMatch + 1 : 0;
    $('rLive').textContent = 'Você: ' + nameOf(Math.round(m)) + (ok ? (rMatch > 12 ? ' · bateu a nota ✓ Se foi confortável, toque em “Consegui”.' : ' · quase lá, segure…') : d > 0 ? ' · acima do alvo ▼' : ' · abaixo do alvo ▲');
    $('rLive').classList.toggle('match', ok && rMatch > 12);
  }, 80);
}
function rMicOff() { if (!rTimer) return; clearInterval(rTimer); rTimer = 0; if (!tTimer && !recording) Mic.stop(); $('rLive').hidden = true; $('rMic').textContent = '🎤 Conferir com microfone'; }
$('rMic').onclick = () => rTimer ? rMicOff() : rMicOn();
function drawRange() {
  const g = $('rng'), Aa = Store.d.alcance || {}, L0 = 36, L1 = 72, pct = s => ((s - L0) / (L1 - L0) * 100);
  let h = '<div class="bar"></div>';
  [36, 40, 45, 48, 52, 55, 60, 64, 67, 72].forEach(s => h += '<span class="tick" style="left:' + pct(s) + '%">' + nameOf(s).replace(' ', '') + '</span>');
  if (Aa.lo != null || Aa.hi != null) { const lo = Aa.lo != null ? Aa.lo : 50, hi = Aa.hi != null ? Aa.hi : 50; h += '<div class="you" style="left:' + pct(lo) + '%;width:' + Math.max(1.5, pct(hi) - pct(lo)) + '%"></div>'; }
  h += '<div class="song" style="left:' + pct(SONG.lo) + '%;width:' + (pct(SONG.hi) - pct(SONG.lo)) + '%"></div><div class="intro" style="left:' + pct(SONG.hi) + '%;width:' + (pct(SONG.introHi) - pct(SONG.hi)) + '%"></div>';
  g.innerHTML = h;
  let msg = 'Ainda não medido.';
  if (Aa.lo != null && Aa.hi != null) {
    msg = 'Seu alcance confortável vai do ' + nameOf(Aa.lo) + ' ao ' + nameOf(Aa.hi) + '. ';
    const okLo = Aa.lo <= SONG.lo, okHi = Aa.hi >= SONG.hi;
    msg += okLo && okHi ? 'A letra de ' + (PACK ? PACK.title : 'música') + ' cabe inteira nele.' : !okHi ? 'As notas mais altas da letra (até ' + nameOf(SONG.hi) + ') passam do seu limite: faça o aquecimento e meça de novo.' : 'As notas mais graves da letra (até ' + nameOf(SONG.lo) + ') ficam abaixo do seu limite: cante leve, sem empurrar.';
    if (Aa.hi < SONG.introHi) msg += ' A introdução sobe até ' + nameOf(SONG.introHi) + ': pergunte ao professor se os tenores cantam essa parte.';
  } else if (Aa.hi != null) msg = 'Agudo confortável: ' + nameOf(Aa.hi) + '. Falta medir o grave.';
  else if (Aa.lo != null) msg = 'Grave confortável: ' + nameOf(Aa.lo) + '. Falta medir o agudo.';
  $('rRes').textContent = msg;
}

/* ================= DIÁRIO ================= */
const ST = [['nao', 'Ainda não'], ['treino', 'Treinando'], ['firme', 'Firme']];
function renderDiary() {
  const box = $('dStatus'); box.innerHTML = '';
  SECS.forEach(s => {
    const row = document.createElement('div'); row.className = 'st-row';
    const nm = document.createElement('div'); nm.className = 'nm'; nm.textContent = s.id === '0' ? 'Introdução' : s.id + ' · ' + s.t;
    const seg = document.createElement('div'); seg.className = 'seg'; seg.setAttribute('role', 'group'); seg.setAttribute('aria-label', nm.textContent);
    const cur = Store.d.status[s.id] || 'nao';
    ST.forEach(([v, l]) => { const b = document.createElement('button'); b.dataset.v = v; b.textContent = l; b.setAttribute('aria-pressed', cur === v); b.onclick = () => { Store.d.status[s.id] = v; Store.save(); renderDiary(); if (view === 'hoje') renderDay(); }; seg.appendChild(b); });
    row.append(nm, seg); box.appendChild(row);
  });
  const items = [...(Store.d.log || []).map(x => ({ ...x, k: 'log' })), ...(Store.d.results || []).map(x => ({ ...x, k: 'res' }))].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 50);
  const ul = $('dLog'); ul.innerHTML = '';
  if (!items.length) ul.innerHTML = '<li><time>–</time><span class="lead">Seus treinos e resultados aparecem aqui.</span></li>';
  items.forEach(x => {
    const li = document.createElement('li'), t = document.createElement('time'), d = new Date(x.date);
    t.textContent = d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    const sp = document.createElement('span');
    sp.textContent = x.k === 'log' ? 'Treino de ' + x.min + ' min' + (x.note ? ' · ' + x.note : '')
      : 'Correção · ' + secName(x.trecho) + ' (' + (x.bpm === 60 ? 'devagar' : 'mais rápido') + '): ' + x.ok + '% afinadas' + (x.rOk != null ? ', ' + x.rOk + '% no tempo' : '') + (x.oct ? ' · oitava ' + (x.oct > 0 ? 'acima' : 'abaixo') : '');
    li.append(t, sp); ul.appendChild(li);
  });
  const L = Store.d.log || [], tot = L.reduce((a, x) => a + (+x.min || 0), 0), days = new Set(L.map(x => x.date.slice(0, 10))).size;
  const firm = SECS.filter(s => Store.d.status[s.id] === 'firme').length;
  let sm = L.length ? days + ' dia(s) de treino, ' + tot + ' minutos no total. ' : 'Nenhum treino registrado ainda. ';
  sm += firm + ' de ' + SECS.length + ' trechos firmes.';
  const Rr = Store.d.results || []; if (Rr.length) { const best = {}; Rr.forEach(r => best[r.trecho] = Math.max(best[r.trecho] || 0, r.ok)); sm += ' Melhor afinação: ' + Object.entries(best).map(([k, v]) => (k === '0' ? 'Intro' : 'T' + k) + ' ' + v + '%').join(', ') + '.'; }
  const Aa = Store.d.alcance; if (Aa && Aa.lo != null && Aa.hi != null) sm += ' Alcance: ' + nameOf(Aa.lo) + ' a ' + nameOf(Aa.hi) + '.';
  $('dSum').textContent = sm;
}
let dMin = 10;
$('dMin').querySelectorAll('button').forEach(b => b.onclick = () => { dMin = +b.dataset.m; $('dMin').querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', x === b)); });
function addLog(min, note) { Store.d.log = [{ date: new Date().toISOString(), min, note }, ...(Store.d.log || [])].slice(0, 500); Store.save(); renderDiary(); }
$('dAdd').onclick = () => { addLog(dMin, $('dNote').value.trim().slice(0, 500)); $('dNote').value = ''; $('dAdd').textContent = 'Registrado ✓'; setTimeout(() => $('dAdd').textContent = 'Registrar treino', 1500); Day.mark('registrar'); };
$('bkOut').onclick = async () => {
  const name = 'Coral_Tenor_backup_' + new Date().toLocaleDateString('pt-BR').replace(/\//g, '-') + '.json';
  const blob = new Blob([JSON.stringify({ app: 'coral-tenor', v: 1, data: Store.d }, null, 1)], { type: 'application/json' });
  try {
    const file = new File([blob], name, { type: 'application/json' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: 'Backup Coral Tenor' }); $('bkMsg').textContent = 'Backup pronto ✓'; return; }
  } catch (e) { if (e && e.name === 'AbortError') return; }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove(); $('bkMsg').textContent = 'Backup baixado ✓';
};
let bkPending = null;
$('bkIn').onchange = async ev => {
  const f = ev.target.files[0]; ev.target.value = ''; if (!f) return;
  try { const j = JSON.parse(await f.text()); if (j.app !== 'coral-tenor' || !j.data) throw 0; bkPending = j.data; $('bkMsg').innerHTML = ''; const b = document.createElement('button'); b.className = 'btn pri'; b.textContent = 'Substituir meus dados por este backup'; b.onclick = () => { Store.d = Object.assign({ status: {}, log: [], results: [], alcance: null, days: {} }, bkPending); Store.save(); renderDiary(); drawRange(); renderDay(); $('bkMsg').textContent = 'Backup restaurado ✓'; }; $('bkMsg').appendChild(b); }
  catch (e) { $('bkMsg').textContent = 'Esse arquivo não é um backup do app.'; }
};

/* ================= HOJE (treino guiado) ================= */
const ORDER = ['1', '2', '3', '4', '5', '0'];
const todayKey = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
const Day = {
  get() { const k = todayKey(); Store.d.days = Store.d.days || {}; if (!Store.d.days[k]) { Store.d.days[k] = { done: [], listen: 0, start: null }; const ks = Object.keys(Store.d.days).sort(); while (ks.length > 60) delete Store.d.days[ks.shift()]; } return Store.d.days[k]; },
  begin() { const d = this.get(); if (!d.start) { d.start = Date.now(); Store.save(); } },
  mark(key) { const d = this.get(); if (!d.done.includes(key)) { d.done.push(key); Store.save(); if (view === 'hoje') renderDay(); } },
  unmark(key) { const d = this.get(); d.done = d.done.filter(k => k !== key); Store.save(); renderDay(); },
  listened(id) { const d = this.get(); if (id === dayTrecho()) { d.listen = (d.listen || 0) + 1; Store.save(); if (d.listen >= 2) this.mark('ouvir'); } }
};
function dayIndex() { return Math.floor(Date.now() / 864e5); }
function dayTrecho() { const nf = ORDER.find(id => Store.d.status[id] !== 'firme'); return nf || ORDER[dayIndex() % ORDER.length]; }
function dayWarm() { const opts = ['brrr', 'mi', 'longa']; return WARM.find(w => w.id === opts[dayIndex() % 3]); }
function goTo(v, el) { show(v); if (el) setTimeout(() => el.scrollIntoView({ block: 'start', behavior: reduce ? 'auto' : 'smooth' }), 60); }
function renderDay() {
  const d = Day.get(), tid = PACK ? dayTrecho() : null, s = tid ? secById(tid) : null, w2 = dayWarm(), hum = WARM.find(w => w.id === 'hum');
  const firm = SECS.filter(x => Store.d.status[x.id] === 'firme').length;
  const dt = new Date(); $('dayTitle').textContent = 'Treino de hoje · ' + dt.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' });
  const all = [
    { k: 'resp', t: 'Respiração · 1 min', p: '4 ciclos guiados: inspira, segura, solta “sss”.', go: 'Começar', fn: () => { goTo('aquecer', $('breathCard')); startBreath(); } },
    { k: 'w:hum', t: 'Aquecimento · ' + hum.t, p: 'Boca fechada, som leve, sem força.', go: 'Tocar', fn: () => { goTo('aquecer', hum.card); startWarm(hum); } },
    { k: 'w:' + w2.id, t: 'Aquecimento · ' + w2.t, p: w2.how, go: 'Tocar', fn: () => { goTo('aquecer', w2.card); startWarm(w2); } },
    { k: 'ouvir', t: 'Ouça o ' + secName(tid) + ' duas vezes', p: (s ? '“' + s.t + '”. ' : '') + 'Acompanhe a letra acendendo e cante baixinho junto.' + (d.listen ? ' Ouvido ' + Math.min(d.listen, 2) + ' de 2.' : ''), go: 'Tocar trecho', fn: () => { goTo('treinar', s.card); startSec(s, null); } },
    { k: 'corrigir', t: 'Cante e corrija o ' + secName(tid), p: 'De fone. O app grava e mostra afinação e ritmo de cada sílaba.', go: 'Abrir correção', fn: () => { $('cSec').value = tid; goTo('corrigir'); } },
    firm >= 2
      ? { k: 'ensaio', t: 'Ensaio completo', p: 'A música inteira, na ordem do coral.', go: 'Tocar ensaio', fn: () => { goTo('ensaio'); startFull(null); } }
      : { k: 'afinar', t: 'Afinador · 3 notas do trecho', p: 'Escolha como alvo as notas que ficaram vermelhas ou azuis e segure até “Na nota ✓”.', go: 'Abrir afinador', fn: () => goTo('afinador') },
    { k: 'registrar', t: 'Registrar o treino', p: d.start ? 'Tempo de hoje: cerca de ' + Math.max(1, Math.round((Date.now() - d.start) / 60000)) + ' min.' : 'Salva o tempo de hoje no Diário.', go: 'Registrar', fn: () => { const min = d.start ? Math.max(5, Math.round((Date.now() - d.start) / 60000)) : 15; addLog(min, 'Treino do dia' + (tid ? ' · ' + secName(tid) : '')); Day.mark('registrar'); } }
  ];
  const steps = PACK ? all : all.filter(x => ['resp', 'w:hum', 'w:' + w2.id, 'registrar'].includes(x.k)).concat([]).sort((a, b) => (a.k === 'registrar') - (b.k === 'registrar'));
  if (!PACK) steps.splice(steps.length - 1, 0, { k: 'afinar', t: 'Afinador · segure 3 notas', p: 'Escolha uma nota alvo, ouça e segure até “Na nota ✓”.', go: 'Abrir afinador', fn: () => goTo('afinador') });
  const ol = $('daySteps'); ol.innerHTML = ''; const next = steps.find(x => !d.done.includes(x.k));
  steps.forEach((st, i) => {
    const done = d.done.includes(st.k), li = document.createElement('li'); li.className = 'step' + (done ? ' done' : '') + (st === next ? ' next' : '');
    li.innerHTML = '<span class="k"></span><div><b></b><p></p><div class="row"></div></div>';
    li.querySelector('.k').textContent = done ? '✓' : i + 1; li.querySelector('b').textContent = st.t; li.querySelector('p').textContent = st.p;
    const row = li.querySelector('.row');
    if (!done) { const b = document.createElement('button'); b.className = 'btn' + (st === next ? ' pri' : ''); b.textContent = st.go; b.onclick = () => { Day.begin(); st.fn(); }; row.appendChild(b); }
    const m = document.createElement('button'); m.className = 'btn'; m.textContent = done ? 'Desfazer' : 'Marcar feito'; m.onclick = () => done ? Day.unmark(st.k) : (Day.begin(), Day.mark(st.k)); row.appendChild(m);
    ol.appendChild(li);
  });
  $('dayLead').textContent = next ? 'Uns 15 minutos. Siga na ordem; use fone de ouvido.' + (tid ? ' Trecho do dia: ' + secName(tid) + '.' : ' Importe sua música para treinar os trechos.') : 'Treino de hoje completo. Até amanhã às 21h!';
}

/* ================= MÚSICAS (arquivo importado) ================= */
async function importSong(f, msgEl) {
  try {
    msgEl.textContent = 'Lendo o arquivo…';
    const j = JSON.parse(await f.text());
    if (j.app !== 'coral-song' || !j.id || !Array.isArray(j.secs) || !j.full) throw new Error('formato');
    await SongDB.put(j); try { localStorage.setItem('coral-cur', j.id); } catch (e) {}
    msgEl.textContent = '“' + j.title + '” importada ✓ Abrindo…'; setTimeout(() => location.reload(), 600);
  } catch (e) { msgEl.textContent = e && e.message === 'formato' ? 'Esse arquivo não é uma música do app Coral.' : 'Não consegui importar. Tente salvar o arquivo de novo e importar.'; }
}
function renderSongs() {
  const ul = $('songList'); ul.innerHTML = '';
  if (!SONGS.length) ul.innerHTML = '<li class="lead">Nenhuma música importada ainda.</li>';
  SONGS.forEach(x => {
    const li = document.createElement('li'); li.className = 'st-row';
    const nm = document.createElement('div'); nm.className = 'nm'; nm.textContent = x.title + (PACK && x.id === PACK.id ? ' · aberta' : '');
    const row = document.createElement('div'); row.className = 'row';
    if (!PACK || x.id !== PACK.id) { const o = document.createElement('button'); o.className = 'btn'; o.textContent = 'Abrir'; o.onclick = () => { try { localStorage.setItem('coral-cur', x.id); } catch (e) {} location.reload(); }; row.appendChild(o); }
    const del = document.createElement('button'); del.className = 'btn'; del.textContent = 'Remover';
    del.onclick = () => { if (del.dataset.ok) { SongDB.del(x.id).then(() => location.reload()); } else { del.dataset.ok = 1; del.textContent = 'Toque de novo para remover'; } };
    row.appendChild(del); li.append(nm, row); ul.appendChild(li);
  });
}
['songIn', 'songIn2'].forEach((id, i) => { const el = $(id); if (el) el.onchange = ev => { const f = ev.target.files[0]; ev.target.value = ''; if (f) importSong(f, $(i ? 'songMsg2' : 'songMsg')); }; });
$('songName').textContent = PACK ? PACK.title : 'sem música';
$('credit').textContent = PACK ? (PACK.credit || PACK.title) + '. O áudio já está na oitava da sua voz.' : 'Nenhuma música importada. As músicas ficam só no seu aparelho.';
$('noSong').hidden = !!PACK;
if (!PACK) ['treinar', 'corrigir', 'ensaio'].forEach(v => document.querySelector('.tabs button[data-v="' + v + '"]').hidden = true);
renderSongs();

/* ================= início ================= */
const standalone = navigator.standalone || matchMedia('(display-mode: standalone)').matches;
$('install').hidden = standalone;
rSet(); drawRange(); renderDiary();
show(((location.hash || '').slice(1) && (PACK || !['treinar','corrigir','ensaio'].includes(location.hash.slice(1)))) ? location.hash.slice(1) : 'hoje');
addEventListener('resize', () => fit());
document.addEventListener('visibilitychange', () => { if (document.hidden) { stopAll(); tunerOff(); rMicOff(); } });
})();
