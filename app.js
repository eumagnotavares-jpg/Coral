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
  open() { return new Promise((res, rej) => { const r = indexedDB.open('coral-songs', 2); r.onupgradeneeded = () => { const d = r.result; if (!d.objectStoreNames.contains('songs')) d.createObjectStore('songs', { keyPath: 'id' }); if (!d.objectStoreNames.contains('pdfs')) d.createObjectStore('pdfs', { keyPath: 'id' }); }; r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); },
  async all() { const db = await this.open(); return new Promise((res, rej) => { const q = db.transaction('songs').objectStore('songs').getAll(); q.onsuccess = () => res(q.result || []); q.onerror = () => rej(q.error); }); },
  async put(v) { const db = await this.open(); return new Promise((res, rej) => { const t = db.transaction('songs', 'readwrite'); t.objectStore('songs').put(v); t.oncomplete = () => res(); t.onerror = () => rej(t.error); }); },
  async getPdf(id) { const db = await this.open(); return new Promise((res, rej) => { const q = db.transaction('pdfs').objectStore('pdfs').get(id); q.onsuccess = () => res(q.result || null); q.onerror = () => rej(q.error); }); },
  async putPdf(v) { const db = await this.open(); return new Promise((res, rej) => { const t = db.transaction('pdfs', 'readwrite'); t.objectStore('pdfs').put(v); t.oncomplete = () => res(); t.onerror = () => rej(t.error); }); },
  async del(id) { const db = await this.open(); return new Promise((res, rej) => { const t = db.transaction('songs', 'readwrite'); t.objectStore('songs').delete(id); t.oncomplete = () => res(); t.onerror = () => rej(t.error); }); },
  async allPdfs() { const db = await this.open(); return new Promise((res, rej) => { const q = db.transaction('pdfs').objectStore('pdfs').getAll(); q.onsuccess = () => res(q.result || []); q.onerror = () => rej(q.error); }); },
  // grava músicas e PDFs numa transação só: ou entra tudo, ou nada (clear = substitui tudo)
  async write(songs, pdfs, clear) {
    const db = await this.open();
    return new Promise((res, rej) => {
      const t = db.transaction(['songs', 'pdfs'], 'readwrite'), S = t.objectStore('songs'), P = t.objectStore('pdfs');
      if (clear) { S.clear(); P.clear(); }
      (songs || []).forEach(v => S.put(v)); (pdfs || []).forEach(v => P.put(v));
      t.oncomplete = () => res(); t.onerror = () => rej(t.error || new Error('gravação')); t.onabort = () => rej(t.error || new Error('gravação cancelada'));
    });
  },
  // apaga a música e a partitura dela juntas
  async delSong(id) { const db = await this.open(); return new Promise((res, rej) => { const t = db.transaction(['songs', 'pdfs'], 'readwrite'); t.objectStore('songs').delete(id); t.objectStore('pdfs').delete(id); t.oncomplete = () => res(); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error); }); }
};

/* ================= DADOS: validação, chaves e ciclo do dia ================= */
// Todas as chaves deste app no aparelho começam com "coral-". Por música: progresso, letra por trecho e letra colada.
const LS = {
  storeKey: id => 'coral-tenor-v1' + (id && id !== 'maracangalha' ? ':' + id : ''),
  songKeys: id => [LS.storeKey(id), 'coral-lyr:' + id, 'coral-letra:' + id, 'coral-ouvir:' + id, 'coral-prog:' + id],
  idOfKey(k) { if (k === 'coral-tenor-v1') return 'maracangalha'; const m = /^coral-(?:tenor-v1|lyr|letra|ouvir|prog):(.+)$/.exec(k); return m ? m[1] : null; },
  all() { const o = {}; try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith('coral-')) o[k] = localStorage.getItem(k); } } catch (e) {} return o; }
};
const isNum = v => typeof v === 'number' && isFinite(v);
const isAudio = v => typeof v === 'string' && /^data:audio\/[a-z0-9.+-]+;base64,/i.test(v) && v.length > 100;
// Confere a música por inteiro antes de gravar. Devolve null se estiver tudo certo, ou o motivo.
function songProblem(j) {
  try {
    if (!j || j.app !== 'coral-song') return 'não é uma música do app';
    if (typeof j.id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,60}$/.test(j.id)) return 'identificação inválida';
    if (typeof j.title !== 'string' || !j.title.trim()) return 'sem título';
    const evOk = e => e && isNum(e.m) && e.m >= 24 && e.m <= 108 && isNum(e.b) && e.b >= 0 && isNum(e.d) && e.d > 0;
    const measOk = (meas, len) => meas == null || (Array.isArray(meas) && meas.every(x => Array.isArray(x) && x.length >= 3 && isNum(x[1]) && isNum(x[2]) && x[2] > x[1] && x[1] >= 0 && x[2] <= len + 1e-3));
    const aOk = a => a && isAudio(a[60]) && isAudio(a[80]);
    if (!Array.isArray(j.secs) || !j.secs.length) return 'sem trechos';
    const ids = new Set();
    for (const s of j.secs) {
      if (!s || typeof s.id !== 'string' || ids.has(s.id)) return 'trecho sem identificação'; ids.add(s.id);
      if (!Array.isArray(s.lines) || !s.lines.length || !s.lines.every(l => Array.isArray(l) && l.length && l.every(evOk))) return 'notas inválidas no trecho ' + s.id;
      if (!isNum(s.len) || s.len <= 0 || !measOk(s.meas, s.len) || !aOk(s.a)) return 'tempo ou áudio inválido no trecho ' + s.id;
    }
    const F = j.full;
    if (!F || !Array.isArray(F.lines) || !F.lines.length || !F.lines.every(l => l && Array.isArray(l.ev) && l.ev.every(evOk))) return 'ensaio completo inválido';
    if (!isNum(F.len) || F.len <= 0 || !measOk(F.meas, F.len) || !aOk(F.a)) return 'tempo ou áudio do ensaio inválido';
    if (!Array.isArray(F.blocks) || !F.blocks.every(b => b && typeof b.label === 'string' && isNum(b.start) && isNum(b.end) && b.end >= b.start)) return 'partes do ensaio inválidas';
    if (j.score != null) {
      const sc = j.score; if (!sc.boxes || typeof sc.boxes !== 'object' || !Number.isInteger(sc.pages) || sc.pages < 1) return 'mapa da partitura inválido';
      for (const b of Object.values(sc.boxes)) if (!b || !Number.isInteger(b.p) || b.p < 1 || b.p > sc.pages || !(b.x0 >= 0 && b.x1 <= 1.0001 && b.x1 > b.x0 && b.y0 >= 0 && b.y1 <= 1.0001 && b.y1 > b.y0)) return 'mapa da partitura inválido';
    }
    if (j.prof != null) {
      if (!isAudio(j.prof.a) || !Array.isArray(j.prof.map) || j.prof.map.length < 2) return 'áudio do professor inválido';
      for (let i = 0; i < j.prof.map.length; i++) { const r = j.prof.map[i]; if (!Array.isArray(r) || !isNum(r[0]) || !isNum(r[1]) || (i && r[0] < j.prof.map[i - 1][0])) return 'sincronia do professor inválida'; }
    }
    if (j.range && !(isNum(j.range.lo) && isNum(j.range.hi))) return 'extensão inválida';
    return null;
  } catch (e) { return 'arquivo com formato inesperado'; }
}
function b64ToBuf(b64) { const bin = atob(b64), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u.buffer; }
function bufToB64(buf) { const u = new Uint8Array(buf); let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); }
function isPdfBuf(buf) { const u = new Uint8Array(buf, 0, Math.min(1024, buf.byteLength)); let t = ''; for (let i = 0; i < u.length; i++) t += String.fromCharCode(u[i]); return t.indexOf('%PDF-') >= 0; }
async function pdfPages(buf) { const lib = await Score.lib(); const doc = await lib.getDocument({ data: new Uint8Array(buf.slice(0)) }).promise; return doc.numPages; }
// confere um PDF que vai junto com uma música (pacote ou backup)
async function pdfProblem(buf, song) {
  if (!buf || !buf.byteLength || !isPdfBuf(buf)) return 'não é um PDF';
  if (song && song.score) { let n; try { n = await pdfPages(buf); } catch (e) { return 'PDF danificado'; } if (n !== song.score.pages) return 'o PDF tem ' + n + ' página(s) e a partitura de ' + song.title + ' tem ' + song.score.pages; }
  return null;
}
const yieldUI = () => new Promise(r => setTimeout(r, 30));
const mb = n => (n / 1048576).toFixed(1).replace('.', ',') + ' MB';
// lê um arquivo JSON grande avisando cada etapa; erro de memória vira mensagem compreensível
async function readJsonFile(f, say) {
  say('Lendo o arquivo (' + mb(f.size) + ')… isso pode levar alguns segundos.'); await yieldUI();
  let txt; try { txt = await f.text(); } catch (e) { throw new Error('Não consegui ler o arquivo. Se ele for muito grande, feche outros apps e tente de novo.'); }
  say('Abrindo o conteúdo…'); await yieldUI();
  try { return JSON.parse(txt); } catch (e) { throw new Error(e instanceof RangeError ? 'O arquivo é grande demais para a memória do aparelho agora. Feche outros apps e tente de novo.' : 'Esse arquivo não é do app Coral (ou está incompleto).'); }
}
// Ciclo do treino: o "dia" do app vai das 04:00 às 03:59 do horário do aparelho.
// Assim um treino feito à noite (inclusive depois da meia-noite) fica no mesmo dia, e música, aula, aquecimento,
// marcações e tempo de treino usam sempre a mesma chave.
const CYCLE_START_H = 4;
function cycleDate(t) { const d = new Date(t == null ? Date.now() : t); if (d.getHours() < CYCLE_START_H) d.setDate(d.getDate() - 1); return d; }
function cycleKey(t) { const d = cycleDate(t); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
function cycleIndex(t) { const d = cycleDate(t); return Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 864e5); }
async function pdfBytes(rec) { if (rec.buf) return new Uint8Array(rec.buf.slice(0)); return new Uint8Array(await rec.blob.arrayBuffer()); }
let SONGS = []; try { SONGS = await SongDB.all(); } catch (e) {}
let curId = null; try { curId = localStorage.getItem('coral-cur'); } catch (e) {}
const PACK = SONGS.find(x => x.id === curId) || SONGS[0] || null;
const SECS = PACK ? PACK.secs : [], FULL = PACK ? PACK.full : { lines: [], blocks: [], len: 1, a: {} };
const KEYS = PACK && PACK.keys ? PACK.keys : [57,59,61,62,64,66,67,68,69,71];   // escrito (soa 1 oitava abaixo)
const SONG = PACK && PACK.range ? PACK.range : { lo: 45, hi: 59, introHi: 66 };  // soando
let bpm = 60, mode = 'nota';

/* ================= Armazenamento (só neste aparelho) ================= */
const KEY = LS.storeKey(PACK ? PACK.id : null);
const Store = {
  d: { status: {}, log: [], results: [], alcance: null, days: {} },
  load() { try { const t = localStorage.getItem(KEY); if (t) this.d = Object.assign(this.d, JSON.parse(t)); } catch (e) {} },
  lock: false,
  save() { if (this.lock) return; try { localStorage.setItem(KEY, JSON.stringify(this.d)); } catch (e) {} }
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
  if (Mic.on && owner !== 'rec' && !Mic.rec && !(typeof tTimer !== 'undefined' && tTimer) && !(typeof rTimer !== 'undefined' && rTimer)) Mic.stop();
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
  on: false, ctx: null, stream: null, an: null, buf: null, proc: null, rec: null, gen: 0, _p: null,
  start() {
    if (this.on) return Promise.resolve(); if (this._p) return this._p;
    const gen = this.gen;
    this._p = this._open(gen).finally(() => { this._p = null; });
    return this._p;
  },
  async _open(gen) {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    if (gen !== this.gen) { stream.getTracks().forEach(t => t.stop()); const e = new Error('cancelado'); e.name = 'AbortError'; throw e; }   // alguém mandou parar enquanto o iPhone pedia o microfone
    this.stream = stream;
    const AC = window.AudioContext || window.webkitAudioContext; this.ctx = new AC();
    try { await this.ctx.resume(); } catch (e) {}
    if (gen !== this.gen) { try { stream.getTracks().forEach(t => t.stop()); this.ctx.close(); } catch (e) {} this.stream = null; this.ctx = null; const e = new Error('cancelado'); e.name = 'AbortError'; throw e; }
    const src = this.ctx.createMediaStreamSource(this.stream);
    this.an = this.ctx.createAnalyser(); this.an.fftSize = 2048; src.connect(this.an);
    this.proc = this.ctx.createScriptProcessor(4096, 1, 1); src.connect(this.proc);
    const g = this.ctx.createGain(); g.gain.value = 0; this.proc.connect(g); g.connect(this.ctx.destination);
    this.proc.onaudioprocess = e => { if (this.rec) this.rec.push(new Float32Array(e.inputBuffer.getChannelData(0))); };
    this.buf = new Float32Array(2048); this.on = true;
  },
  stop() {
    this.gen++;   // cancela um início que ainda esteja pedindo o microfone
    if (!this.on) return; this.on = false; this.rec = null;
    try { this.stream.getTracks().forEach(t => t.stop()); } catch (e) {}
    try { this.proc.onaudioprocess = null; this.proc.disconnect(); } catch (e) {}
    try { this.ctx.close(); } catch (e) {}
    this.stream = null; this.proc = null; this.an = null;
    try { if (navigator.audioSession) navigator.audioSession.type = 'auto'; } catch (e) {}
  },
  pitch() { if (!this.on) return NaN; this.an.getFloatTimeDomainData(this.buf); const r = AN.yinFrame(this.buf, this.ctx.sampleRate, 0, this.buf.length); return r.c > 0.75 ? r.m : NaN; }
};
function micError(e) {
  if (e && e.name === 'AbortError') return '';
  return (e && (e.name === 'NotAllowedError' || e.name === 'SecurityError'))
    ? 'O microfone foi bloqueado. No iPhone: Ajustes › Safari › Microfone › Perguntar ou Permitir, e abra o app de novo.'
    : 'Não consegui ligar o microfone neste aparelho.';
}

/* ================= Desenho das linhas da letra ================= */
// "vou" esticado em 3 notas = vou · ou · ou (a vogal continua soando). Sem vogal reconhecível, repete a sílaba.
function vowelOf(t) { const m = /[aeiouáéíóúâêôãõàüy]+(?=[^aeiouáéíóúâêôãõàüy]*$)/i.exec(t || ''); return m ? m[0].toLowerCase() : (t || ''); }
function rangeOf(lines) { const ms = lines.flat().map(e => e.m); const lo = Math.min(...ms), hi = Math.max(...ms); return { hi, span: Math.max(hi - lo, 1) }; }
function drawLine(line, rg, opt) {
  const ln = document.createElement('div'); ln.className = 'ln'; const els = []; let prev = opt.prev || null, lastReal = opt.prev && opt.prev !== '~' ? opt.prev : '';
  const h = opt.big ? 52 : 42;
  line.forEach((e, i) => {
    const b = document.createElement('span'); b.className = 'syl' + (e.br ? ' br' : '');
    const y = Math.round((rg.hi - e.m) / rg.span * h);
    b.style.flex = (0.6 + e.d) + ' 1 auto'; b.style.paddingTop = y + 'px'; b.style.setProperty('--y', y + 'px');
    const ext = e.s === '~' || (e.s === prev && e.s === 'hum');
    const txt = ext ? vowelOf(lastReal) : e.s; if (ext) b.classList.add('mel'); else if (e.s && e.s !== '•') lastReal = e.s; prev = e.s;
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
const VIEWS = ['ouvir','hoje','musicas','eco','jogo','ensaio','aulas','corrigir','diario','treinar','afinador','aquecer','alcance'];
let view = 'hoje';
// Telas que saíram do app (o foco agora é só aquecer e aprender as músicas): quem chamar uma delas cai no Ouvir.
const GONE = ['hoje', 'jogo', 'aulas', 'corrigir', 'treinar', 'afinador', 'alcance', 'eco'];
function show(v) {
  if (!VIEWS.includes(v) || GONE.includes(v)) v = PACK ? 'ouvir' : 'diario';
  if (view === 'aquecer' && v !== 'aquecer') { aqSeq = false; stopBreath(); stopWarm(); if (AF.on) afStop(); }
  if (view === 'afinador' && v !== 'afinador') tunerOff();
  if (view === 'alcance' && v !== 'alcance') rMicOff();
  if (view === 'eco' && v !== 'eco') ecoStop();
  if (view === 'jogo' && v !== 'jogo') gameStop();
  if (view === 'corrigir' && v !== 'corrigir') stopRec(false);
  if (view === 'ouvir' && v !== 'ouvir') Ouvir.stop();
  if (v === 'eco' && PACK && !E.sec && SECS.length) { E.sec = secById(firstSec()) || SECS[0]; E.li = 0; document.querySelectorAll('#eSecs button').forEach(b => b.setAttribute('aria-pressed', b.dataset.id === E.sec.id)); setTimeout(ecoRender, 0); }
  view = v;
  document.querySelectorAll('.tabs button').forEach(b => { b.setAttribute('aria-selected', b.dataset.v === v); if (b.dataset.v === v) b.scrollIntoView({ inline: 'center', block: 'nearest' }); });
  VIEWS.forEach(x => $('v-' + x).hidden = x !== v);
  try { history.replaceState(null, '', '#' + v); } catch (e) {}
  if (v === 'hoje') renderDay();
  if (v === 'musicas') Letras.open();
  if (v === 'ouvir') Ouvir.open();
  window.scrollTo(0, 0);
  requestAnimationFrame(() => fit());
}
document.querySelectorAll('.tabs button[data-v]').forEach(b => b.onclick = () => show(b.dataset.v));

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

/* ================= PARTITURA (o PDF da pessoa, guardado só no aparelho) ================= */
const Score = {
  pdf: null, pages: {}, _lib: null,
  has() { return !!(PACK && PACK.score && PACK.score.boxes && Object.keys(PACK.score.boxes).length); },
  lib() { if (!this._lib) this._lib = import('./pdf.min.mjs').then(m => { m.GlobalWorkerOptions.workerSrc = new URL('pdf.worker.min.mjs', location.href).href; return m; }); return this._lib; },
  async load() {
    if (!this.has()) return false; if (this.pdf) return true;
    const rec = await SongDB.getPdf(PACK.id); if (!rec) return false;
    const lib = await this.lib(); this.pdf = await lib.getDocument({ data: await pdfBytes(rec) }).promise; return true;
  },
  async importFile(f) {
    const lib = await this.lib(); const buf = await f.arrayBuffer();
    const doc = await lib.getDocument({ data: new Uint8Array(buf.slice(0)) }).promise;
    const r = await savePdfFor(PACK, buf, doc, f.name);
    if (r === 'cancel') throw new Error('cancelado');
    if (r !== 'ok' && r !== 'same') throw new Error(doc.numPages !== PACK.score.pages ? 'paginas' : r);
    this.pdf = doc; this.pages = {}; document.dispatchEvent(new Event('score-ready'));
  },
  async page(n) {
    if (this.pages[n]) return this.pages[n];
    const pg = await this.pdf.getPage(n), v1 = pg.getViewport({ scale: 1 }), vp = pg.getViewport({ scale: 1800 / v1.width });
    const c = document.createElement('canvas'); c.width = Math.round(vp.width); c.height = Math.round(vp.height);
    const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    await pg.render({ canvasContext: ctx, viewport: vp }).promise; this.pages[n] = c; return c;
  }
};
// Mostra a(s) linha(s) da partitura de um trecho, com um quadrado vermelho no compasso que está tocando.
// mode 'all' = todas as linhas do trecho; 'current' = só a linha do compasso atual.
function ScoreView(box, meas, mode) {
  const B = PACK.score.boxes, sysKey = m => { const b = B[m]; return b ? b.p + '|' + b.y0 : null; };
  const systems = []; const seen = {};
  meas.forEach(([m]) => { const k = sysKey(m); if (k && !seen[k]) { seen[k] = { key: k, ms: [] }; systems.push(seen[k]); } if (k && !seen[k].ms.includes(m)) seen[k].ms.push(m); });
  const el = {}; let shown = null, lastM = null;
  async function drawSystem(sy) {
    const bs = sy.ms.map(m => B[m]), p = bs[0].p, y0 = bs[0].y0, y1 = bs[0].y1;
    const x0 = Math.max(0, Math.min(...bs.map(b => b.x0)) - 0.015), x1 = Math.min(1, Math.max(...bs.map(b => b.x1)) + 0.01);
    const img = await Score.page(p), W = img.width, H = img.height;
    const wrap = document.createElement('div'); wrap.className = 'scorerow';
    const inner = document.createElement('div'); inner.className = 'scoreinner'; inner.style.width = (innerWidth < 700 ? Math.min(260, Math.max(100, Math.round(sy.ms.length * 48))) : 100) + '%'; wrap.appendChild(inner);
    const c = document.createElement('canvas'); const sw = (x1 - x0) * W, sh = (y1 - y0) * H;
    c.width = Math.round(sw); c.height = Math.round(sh); c.getContext('2d').drawImage(img, x0 * W, y0 * H, sw, sh, 0, 0, sw, sh);
    inner.appendChild(c);
    sy.ms.forEach(m => { const b = B[m], d = document.createElement('div'); d.className = 'mbox'; d.style.left = ((b.x0 - x0) / (x1 - x0) * 100) + '%'; d.style.width = ((b.x1 - b.x0) / (x1 - x0) * 100) + '%'; d.dataset.m = m; inner.appendChild(d); (el[m] = el[m] || []).push(d); });
    return wrap;
  }
  async function build() {
    box.innerHTML = '';
    if (!(await Score.load())) { box.appendChild(importer()); return; }
    const tip = document.createElement('p'); tip.className = 'lead'; tip.textContent = 'Leia só a linha de palavras embaixo das notas. O quadrado vermelho mostra onde a música está.'; box.appendChild(tip);
    if (mode === 'all') for (const sy of systems) box.appendChild(await drawSystem(sy));
    else { const holder = document.createElement('div'); holder.className = 'scorehold'; box.appendChild(holder); }
  }
  async function showSystem(sy) {
    if (shown === sy) return; shown = sy; const holder = box.querySelector('.scorehold'); if (!holder) return;
    Object.keys(el).forEach(k => delete el[k]); const w = await drawSystem(sy); holder.innerHTML = ''; holder.appendChild(w); lastM = null;
  }
  const ready = build();
  return {
    ready,
    highlight(beat) {
      const cur = meas.find(x => beat >= x[1] && beat < x[2]); const m = cur ? cur[0] : null;
      if (mode !== 'all' && m != null) { const k = sysKey(m), sy = systems.find(x => x.key === k); if (sy && sy !== shown) { showSystem(sy); } }
      if (m === lastM) return; lastM = m;
      box.querySelectorAll('.mbox.on').forEach(d => d.classList.remove('on'));
      (el[m] || []).forEach(d => { d.classList.add('on'); const w = d.parentElement.parentElement; if (w.scrollWidth > w.clientWidth + 4) w.scrollTo({ left: Math.max(0, d.offsetLeft - w.clientWidth * 0.25), behavior: reduce ? 'auto' : 'smooth' }); });
    },
    reset() { box.querySelectorAll('.mbox.on').forEach(d => d.classList.remove('on')); lastM = null; }
  };
}
// Confere se o PDF é da música: nº de páginas (obrigatório) + título no texto da 1ª página ou no nome do arquivo.
async function pdfIdentity(doc, x, fname) {
  const norm = t => (t || '').normalize('NFD').toLowerCase().replace(/[^a-z]/g, '');
  const pagesOk = !x.score || doc.numPages === x.score.pages;
  let txt = ''; try { const tc = await (await doc.getPage(1)).getTextContent(); txt = tc.items.map(i => i.str).join(''); } catch (e) {}
  const titleOk = norm(txt + ' ' + (fname || '')).includes(norm(x.title));
  return { pagesOk, titleOk };
}
// Mostra a 1ª página do PDF e pede confirmação. Resolve true/false.
function confirmPdf(doc, x, why) {
  return new Promise(async res => {
    const ov = document.createElement('div'); ov.className = 'pdfconf'; ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true');
    ov.innerHTML = '<div class="panel"><h2>Conferir partitura</h2><p class="msg"></p><div class="thumb"></div><div class="row"><button class="btn pri" data-a="1">Sim, é desta música</button><button class="btn" data-a="0">Cancelar</button></div></div>';
    ov.querySelector('.msg').textContent = why + ' Veja a primeira página: ela é da música “' + x.title + '”?';
    document.body.appendChild(ov);
    try { const pg = await doc.getPage(1), v1 = pg.getViewport({ scale: 1 }), vp = pg.getViewport({ scale: 520 / v1.width }); const c = document.createElement('canvas'); c.width = Math.round(vp.width); c.height = Math.round(vp.height); const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); await pg.render({ canvasContext: ctx, viewport: vp }).promise; ov.querySelector('.thumb').appendChild(c); } catch (e) { ov.querySelector('.thumb').textContent = '(não consegui mostrar a página)'; }
    ov.querySelectorAll('button').forEach(b => b.onclick = () => { ov.remove(); res(b.dataset.a === '1'); });
  });
}
const sameBuf = (a, b) => { if (!a || !b || a.byteLength !== b.byteLength) return false; const x = new Uint8Array(a), y = new Uint8Array(b); for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false; return true; };
// Grava o PDF de uma música depois de conferir. Devolve 'ok' | 'same' | 'cancel' | motivo de erro.
async function savePdfFor(x, buf, doc, fname) {
  const id = await pdfIdentity(doc, x, fname);
  if (!id.pagesOk) return 'Esse PDF tem ' + doc.numPages + ' página(s), mas a partitura de ' + x.title + ' tem ' + x.score.pages + '.';
  const old = await SongDB.getPdf(x.id).catch(() => null), oldBuf = old ? (old.buf || await old.blob.arrayBuffer()) : null;
  if (oldBuf && sameBuf(oldBuf, buf)) return 'same';
  if (!id.titleOk || oldBuf) {
    const why = !id.titleOk ? 'Não encontrei o nome “' + x.title + '” neste PDF.' : 'Esta música já tem uma partitura salva e ela será substituída.';
    if (!(await confirmPdf(doc, x, why))) return 'cancel';
  }
  await SongDB.putPdf({ id: x.id, buf: buf.slice(0) });
  return 'ok';
}
function importer() {
  const d = document.createElement('div'); d.className = 'panel alert';
  d.innerHTML = '<h2>Partitura de ' + '<span></span></h2><p class="msg">Importe o PDF da partitura que o professor mandou. Ele fica guardado só neste iPhone. Faça isso uma vez só.</p><div class="row"><label class="file btn pri"><input type="file" accept="application/pdf,.pdf">Importar partitura (PDF)</label><span class="save"></span></div>';
  d.querySelector('span').textContent = PACK.title;
  const inp = d.querySelector('input'), msg = d.querySelector('.save');
  inp.onchange = async ev => { const f = ev.target.files[0]; ev.target.value = ''; if (!f) return; msg.textContent = 'Abrindo…';
    try { await Score.importFile(f); msg.textContent = 'Partitura salva ✓'; }
    catch (e) { msg.textContent = e && e.message === 'cancelado' ? 'Partitura não alterada.' : e && e.message === 'paginas' ? 'Esse PDF não parece ser a partitura de ' + PACK.title + '. Confira o arquivo.' : 'Não consegui abrir esse PDF.'; } };
  return d;
}

if (Score.has()) Score.load().then(ok => { if (ok) setTimeout(loadScoreLyrics, 0); }).catch(() => {});
/* ================= AJUSTE DE SINCRONIA ================= */
Store.d.prefs = Object.assign({ tech: false, adv: false }, Store.d.prefs || {});
Store.d.prefs.off = Object.assign({ synth: 0, prof: {} }, Store.d.prefs.off || {});
const offS = () => Store.d.prefs.off.synth || 0;
const offP = () => (PACK && Store.d.prefs.off.prof[PACK.id]) || 0;
function syncCtl(box, kind) {
  const get = () => kind() === 'prof' ? offP() : offS();
  const set = v => { v = Math.round(Math.max(-1.5, Math.min(1.5, v)) * 10) / 10; if (kind() === 'prof') Store.d.prefs.off.prof[PACK.id] = v; else Store.d.prefs.off.synth = v; Store.save(); paint(); };
  box.className = 'row syncctl'; box.innerHTML = '<span>Letra fora do tempo?</span><button class="btn">◀ Está adiantada</button><button class="btn">Está atrasada ▶</button><span class="save"></span>';
  const [b1, b2] = box.querySelectorAll('button'), lab = box.querySelector('.save');
  const paint = () => { const v = get(); lab.textContent = v === 0 ? 'sem ajuste' : (v > 0 ? 'letra ' + v.toFixed(1).replace('.', ',') + ' s mais tarde' : 'letra ' + (-v).toFixed(1).replace('.', ',') + ' s mais cedo'); };
  b1.onclick = () => set(get() + 0.1); b2.onclick = () => set(get() - 0.1); setTimeout(paint); box.paint = paint; return box;
}

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
  if (!active) return; const s = active, beat = (A.main.currentTime - offS()) / (60 / bpm) - 4;
  s.card.querySelectorAll('.count i').forEach((d, i) => d.classList.toggle('hit', beat < 0 && i <= Math.floor(beat + 4)));
  const cur = karaoke(s.els, beat); if (s.score) s.score.highlight(beat);
  if (cur) { const ln = cur.parentElement; if (ln !== lastLine) { lastLine = ln; const r = ln.getBoundingClientRect(); if (r.top < 110 || r.bottom > innerHeight - 40) ln.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' }); } }
  raf = requestAnimationFrame(tickSec);
}
/* letra digitada pela pessoa (fica só no aparelho) */
const LYR_KEY = 'coral-lyr:' + (PACK ? PACK.id : '');
let LYR = {}; try { LYR = JSON.parse(localStorage.getItem(LYR_KEY) || '{}'); } catch (e) {}
SECS.forEach(s => { s.lines.flat().forEach(e => { if (e.s0 === undefined) e.s0 = e.s; }); });
function tokens(t) { return (t || '').replace(/[,.;:!?"“”]/g, ' ').split(/[\s\-‐–]+/).filter(Boolean); }
function applyLyrics(s) {
  const t = LYR[s.id], notes = s.lines.flat();
  if (!t) { notes.forEach(e => e.s = e.sp || e.s0); return; }
  const tk = tokens(t); let last = '';
  notes.forEach((e, i) => { let w = tk[i]; if (w === undefined) w = '•'; if (w === '_') w = '~'; e.s = w; last = w; });
}
function renderSecLines(s) {
  const box = s.card.querySelector('.lines'); box.innerHTML = ''; s.els = []; let prev = null;
  s.lines.forEach(line => {
    const r = drawLine(line, s.rg, { prev, onTap: () => mode === 'nota' }); prev = r.prev;
    r.ln.addEventListener('click', () => { if (mode === 'linha') startSec(s, line[0].b - 1); });
    box.appendChild(r.ln); s.els.push(...r.els);
  });
  fit(box);
}
SECS.forEach(s => {
  const rg = rangeOf(s.lines); s.rg = rg; applyLyrics(s);
  const el = document.createElement('section'); el.className = 'sec'; el.id = 'sec-' + s.id;
  el.innerHTML = '<div class="sh"><button class="play" aria-label="Tocar">' + PLAY + '</button><div><div class="n"></div><h3></h3></div><div class="count" aria-hidden="true"><i></i><i></i><i></i><i></i></div></div><p class="tip"></p>'
    + (Score.has() && s.meas ? '<div class="row"><button class="btn scb">📄 Ver partitura</button></div><div class="scorebox" hidden></div>' : '')
    + '<div class="lines"></div>'
    + '<div class="row"><button class="btn lyrb">✎ ' + (PACK && PACK.noLyrics ? 'Escrever a letra' : 'Editar a letra') + '</button><span class="save lyrn"></span></div>'
    + '<div class="lyred" hidden><textarea rows="4"></textarea><p class="lead lyrh"></p><div class="row"><button class="btn pri lyrs">Salvar letra</button><button class="btn lyrc">Cancelar</button><button class="btn lyrx">Apagar</button></div></div>';
  el.querySelector('.n').textContent = s.id === '0' ? 'Extra' : 'Trecho ' + s.id;
  el.querySelector('h3').textContent = s.t; el.querySelector('.tip').textContent = s.tip;
  s.card = el; $('secs').appendChild(el); renderSecLines(s);
  const n = s.lines.flat().length, ed = el.querySelector('.lyred'), ta = el.querySelector('textarea');
  const count = () => { const k = tokens(ta.value).length; el.querySelector('.lyrh').textContent = 'Escreva as sílabas na ordem, separadas por espaço ou hífen (ex.: can-ta-mos jun-tos). Use _ para continuar a mesma sílaba em outra nota. Este trecho tem ' + n + ' notas; você escreveu ' + k + (k === n ? ' ✓' : '') + '.'; };
  el.querySelector('.lyrb').onclick = () => { ed.hidden = !ed.hidden; if (!ed.hidden) { ta.value = LYR[s.id] || ''; count(); ta.focus(); } };
  ta.oninput = count;
  el.querySelector('.lyrc').onclick = () => { ed.hidden = true; };
  const save = v => { if (v) LYR[s.id] = v; else delete LYR[s.id]; try { localStorage.setItem(LYR_KEY, JSON.stringify(LYR)); } catch (e) {} applyLyrics(s); renderSecLines(s); ed.hidden = true; el.querySelector('.lyrn').textContent = v ? 'Letra salva ✓' : ''; };
  el.querySelector('.lyrs').onclick = () => save(ta.value.trim());
  el.querySelector('.lyrx').onclick = () => save('');
  el.querySelector('.play').onclick = () => { if (active === s) stopSec(); else startSec(s, null); };
  const scb = el.querySelector('.scb');
  if (scb) scb.onclick = () => { const bx = el.querySelector('.scorebox'); bx.hidden = !bx.hidden; scb.textContent = bx.hidden ? 'Ver partitura' : 'Esconder partitura'; if (!bx.hidden && !s.score) s.score = ScoreView(bx, s.meas, 'all'); };
});
document.addEventListener('score-ready', () => { SECS.forEach(s => { if (s.score) { const bx = s.card.querySelector('.scorebox'); s.score = ScoreView(bx, s.meas, 'all'); } }); if (fScore) fScore = ScoreView($('fScore'), FULL.meas, 'current'); });
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

if ($('tSync')) $('tSync').appendChild(syncCtl(document.createElement('div'), () => 'synth'));
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
  if (!micBusyElsewhere('rec')) Mic.stop();
  if (analyze) analyzePCM(chunks, sr); else $('cMsg').textContent = 'Gravação cancelada.';
}
stoppers.add(() => stopRec(false));
$('cStop').onclick = () => stopRec(true);
$('cRec').onclick = async () => {
  const s = secById($('cSec').value); stopAll(); $('cOut').hidden = true; $('cMsg').classList.remove('err');
  try { await Mic.start(); } catch (e) { $('cMsg').textContent = micError(e); $('cMsg').classList.add('err'); return; }
  if (view !== 'corrigir' || document.hidden) { if (!micBusyElsewhere('rec')) Mic.stop(); return; }
  recording = true; recSec = s; recHint = null; recLine = -1; $('cRec').disabled = true;
  $('cMsg').textContent = 'Espere os 4 cliques e cante junto.';
  $('cStage').hidden = false; $('cNow').innerHTML = ''; $('cNext').innerHTML = '';
  s._recScore = null; if (Score.has() && s.meas && Score.pdf) { $('cScore').hidden = false; s._recScore = ScoreView($('cScore'), s.meas, 'current'); } else $('cScore').hidden = true;
  Mic.rec = []; recStartT = performance.now();
  A.main.addEventListener('playing', () => { if (recording && recHint == null) recHint = (performance.now() - recStartT) / 1000; }, { once: true });
  playMain(s.a[bpm], 0, 'rec', () => setTimeout(() => stopRec(true), 700));
  const lines = s.lines;
  (function tick() {
    if (!recording) return; const beat = (A.main.currentTime - offS()) / (60 / bpm) - 4, last = lines[lines.length - 1], end = last[last.length - 1];
    $('cLbl').textContent = beat < 0 ? 'Gravando · contando ' + (Math.floor(beat + 4) + 1) : 'Gravando · cante junto';
    $('cProg').style.width = Math.max(0, Math.min(100, beat / (end.b + end.d) * 100)) + '%';
    let li = lines.findIndex(l => beat < l[l.length - 1].b + l[l.length - 1].d); if (li < 0) li = lines.length - 1;
    if (li !== recLine) {
      recLine = li; $('cNow').innerHTML = ''; $('cNext').innerHTML = '';
      const r = drawLine(lines[li], s.rg, { big: true, onTap: () => false }); $('cNow').appendChild(r.ln); s._recEls = r.els;
      if (lines[li + 1]) $('cNext').appendChild(drawLine(lines[li + 1], s.rg, { onTap: () => false }).ln);
      fit($('cStage'));
    }
    if (s._recEls) karaoke(s._recEls, beat); if (s._recScore) s._recScore.highlight(beat);
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
  if (simple() && gView === 'pitch') {
    // por frase: acha a mais difícil
    let k = 0, worst = null; const ls = s.lines.map((line, li) => { let bad = 0, low = 0, high = 0, ok = 0; line.forEach(() => { const p = g.per[k++]; if (p.status === 'high') { bad++; high++; } else if (p.status === 'low') { bad++; low++; } else if (p.status === 'ok') ok++; }); return { li, bad, low, high, ok, n: line.length }; });
    ls.forEach(x => { if (x.bad && (!worst || x.bad / x.n > worst.bad / worst.n)) worst = x; });
    const pct = g.heard ? Math.round(g.good / g.heard * 100) : 0;
    sum = (pct >= 80 ? 'Muito bem! ' : pct >= 50 ? 'Bom caminho! ' : 'Vamos com calma. ') + g.good + ' de ' + g.heard + ' notas saíram afinadas. ';
    if (g.oct > 0) sum += 'Você cantou mais agudo que o tenor (uma “oitava” acima): pergunte ao professor se está certo. ';
    if (worst) sum += 'A frase ' + (worst.li + 1) + ' foi a mais difícil: ficou ' + (worst.low >= worst.high ? 'um pouco grave (baixa). Pense em “subir” a voz.' : 'um pouco aguda (alta). Pense em “descer” a voz.');
    else sum += 'Nenhuma frase ficou muito fora. Ótimo!';
    $('cSum').textContent = sum;
    if (worst) { const b = document.createElement('button'); b.className = 'btn pri'; b.style.marginTop = '8px'; b.textContent = '🔁 Treinar a frase ' + (worst.li + 1) + ' no modo eco'; b.onclick = () => { ecoOpen(s.id, worst.li); }; $('cSum').appendChild(document.createElement('br')); $('cSum').appendChild(b); }
  } else $('cSum').textContent = sum;
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
let fScore = null;
if (FULL && FULL.lines && FULL.lines.length) $('fSync').appendChild(syncCtl(document.createElement('div'), () => fSrc));
if (Score.has() && FULL.meas) { setTimeout(() => { if ($('fScore').hidden) $('fScoreB').click(); }, 0); $('fScoreP').hidden = false; $('fScoreB').onclick = () => { const b = $('fScore'); b.hidden = !b.hidden; $('fScoreB').textContent = b.hidden ? 'Ver partitura' : 'Esconder partitura'; if (!b.hidden && !fScore) { fScore = ScoreView(b, FULL.meas, 'current'); fScore.ready.then(() => fScore.highlight(0)); } }; }
const FL = FULL.lines.map(l => ({ ...l, rg: rangeOf([l.ev]) }));
const fmt = s => { s = Math.max(0, Math.round(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
function stopFull() { if (!fOn) return; fOn = false; if (A.owner === 'full') stopMain(); fp.innerHTML = PLAY; cancelAnimationFrame(fRaf); $('fCount').querySelectorAll('i').forEach(d => d.classList.remove('hit')); }
stoppers.add(stopFull);
const PROF = PACK && PACK.prof && PACK.prof.map && PACK.prof.map.length ? PACK.prof : null;
let fSrc = PROF ? 'prof' : 'piano';
const PT_ = PROF ? PROF.map.map(x => x[0]) : [], PB_ = PROF ? PROF.map.map(x => x[1]) : [];
function interp(x, xs, ys) { if (!xs.length) return 0; if (x <= xs[0]) return ys[0] - (xs[0] - x) * 2; if (x >= xs[xs.length - 1]) return ys[ys.length - 1] + (x - xs[xs.length - 1]) * 2; let lo = 0, hi = xs.length - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (xs[m] <= x) lo = m; else hi = m; } const f = (x - xs[lo]) / ((xs[hi] - xs[lo]) || 1); return ys[lo] + f * (ys[hi] - ys[lo]); }
const profBeat = t => interp(t, PT_, PB_), profTime = b => Math.max(0, interp(b, PB_, PT_));
function fBeatNow() { return fSrc === 'prof' ? profBeat(A.main.currentTime - offP()) : (A.main.currentTime - offS()) / (60 / bpm) - 4; }
function startFull(beat) {
  stopAll(); fOn = true;
  if (fSrc === 'prof') playMain(PROF.a, beat == null ? 0 : Math.max(0, profTime(beat) - 1), 'full', () => { stopFull(); Day.mark('ensaio'); });
  else playMain(FULL.a[bpm], beat == null ? 0 : Math.max(0, (4 + beat) * 60 / bpm), 'full', () => { stopFull(); Day.mark('ensaio'); });
  fp.innerHTML = PAUSE; fLineIdx = -1; tickFull();
}
if (PROF) {
  $('fSrcRow').hidden = false; $('fSrcNote').hidden = false;
  const setSrc = v => { stopFull(); fSrc = v; const sc = $('fSync').firstChild; if (sc && sc.paint) setTimeout(sc.paint); $('fProf').setAttribute('aria-pressed', v === 'prof'); $('fPiano').setAttribute('aria-pressed', v === 'piano'); $('fSrcNote').hidden = v !== 'prof'; refreshMapTimes(); };
  $('fProf').onclick = () => setSrc('prof'); $('fPiano').onclick = () => setSrc('piano');
}
fp.onclick = () => fOn ? stopFull() : startFull(null);
FULL.blocks.forEach(b => {
  const li = document.createElement('li'); li.innerHTML = '<span class="k"></span><span><b></b><small></small></span><span class="tm"></span>';
  li.querySelector('.k').textContent = b.trecho === 'I' ? 'In' : b.trecho.replace('b', '');
  li.querySelector('b').textContent = b.label; li.querySelector('small').textContent = b.sub || '';
  li.onclick = () => startFull(b.start - 1); b.li = li; $('map').appendChild(li);
});
function refreshMapTimes() { FULL.blocks.forEach(b => b.li.querySelector('.tm').textContent = fmt(typeof fSrc !== 'undefined' && fSrc === 'prof' ? profTime(b.start) : (4 + b.start) * 60 / bpm)); }
refreshMapTimes();
function renderStage(i) {
  $('fNow').innerHTML = ''; $('fNext').innerHTML = ''; if (i < 0) return;
  const L = FL[i], r = drawLine(L.ev, L.rg, { big: true }); $('fNow').appendChild(r.ln); L.els = r.els;
  if (FL[i + 1]) $('fNext').appendChild(drawLine(FL[i + 1].ev, FL[i + 1].rg, {}).ln);
  fit($('fNow').parentElement);
}
function tickFull() {
  if (!fOn) return; const beat = fBeatNow();
  $('fCount').querySelectorAll('i').forEach((d, i) => d.classList.toggle('hit', beat < 0 && i <= Math.floor(beat + 4)));
  $('fProg').style.width = Math.min(100, Math.max(0, beat / FULL.len * 100)) + '%';
  let li = FL.findIndex(L => { const l = L.ev[L.ev.length - 1]; return beat < l.b + l.d; }); if (li < 0) li = FL.length - 1;
  if (li !== fLineIdx) { fLineIdx = li; renderStage(li); }
  if (FL[li].els) karaoke(FL[li].els, beat); if (fScore && !$('fScore').hidden) fScore.highlight(beat);
  let bi = FULL.blocks.findIndex(b => beat < b.end); if (bi < 0) bi = FULL.blocks.length - 1;
  FULL.blocks.forEach((b, i) => { b.li.classList.toggle('now', i === bi && beat >= -0.5); b.li.classList.toggle('past', i < bi); });
  $('fLbl').textContent = beat < 0 ? (fSrc === 'prof' ? 'Introdução do áudio… prepare-se' : 'Contando… 1, 2, 3, 4') : FULL.blocks[bi].label;
  fRaf = requestAnimationFrame(tickFull);
}

/* ================= AQUECER ================= */
let bT = null, aqSeq = false;
const aqMark = () => { try { localStorage.setItem('coral-aq', cycleKey()); } catch (e) {} };
function stopBreath() { if (!bT) return; clearInterval(bT); bT = null; $('bPlay').innerHTML = PLAY; $('orb').style.transform = 'scale(.7)'; $('orbT').textContent = 'Pronto?'; $('orbN').textContent = '4'; }
stoppers.add(stopBreath);
$('bPlay').innerHTML = PLAY;
function startBreath(keepSeq) {
  if (!keepSeq) aqSeq = false; stopAll(); aqMark(); const plan = []; for (let c = 1; c <= 4; c++) { plan.push(['Inspire', 4, c]); plan.push(['Segure', 4, c]); plan.push(['Solte em “sss”', 8, c]); }
  let pi = 0, left = plan[0][1]; $('bPlay').innerHTML = PAUSE;
  const paint = () => { const [t, n, c] = plan[pi]; $('orbT').textContent = t + ' · ciclo ' + c + ' de 4'; $('orbN').textContent = left; $('orb').style.transform = 'scale(' + (t === 'Inspire' ? 0.7 + 0.3 * (n - left + 1) / n : t === 'Segure' ? 1 : 1 - 0.3 * (n - left + 1) / n) + ')'; };
  paint(); bT = setInterval(() => { left--; if (left <= 0) { pi++; if (pi >= plan.length) { stopBreath(); $('orbT').textContent = 'Pronto! Siga para o próximo.'; Day.mark('resp'); if (aqSeq && WARM[0]) setTimeout(() => { if (aqSeq) { startWarm(WARM[0], true); WARM[0].card.scrollIntoView({ block: 'start', behavior: reduce ? 'auto' : 'smooth' }); } }, 1500); return; } left = plan[pi][1]; } paint(); }, 1000);
}
$('bPlay').onclick = () => { if (bT) { aqSeq = false; stopBreath(); } else startBreath(); };
let wActive = null, wRaf = 0;
function stopWarm() { if (!wActive) return; const w = wActive; if (A.owner === 'warm') stopMain(); w.btn.innerHTML = PLAY; cancelAnimationFrame(wRaf); w.stat.textContent = ''; w.stat.classList.remove('warn'); wActive = null; }
stoppers.add(stopWarm);
function startWarm(w, keepSeq) {
  if (!keepSeq) aqSeq = false; stopAll(); aqMark(); wActive = w;
  playMain(w.a, 0, 'warm', () => {
    stopWarm(); w.stat.textContent = 'Feito ✓'; Day.mark('w:' + w.id);
    if (!aqSeq) return; const k = WARM.indexOf(w);
    if (k < WARM.length - 1) setTimeout(() => { if (aqSeq) { startWarm(WARM[k + 1], true); WARM[k + 1].card.scrollIntoView({ block: 'start', behavior: reduce ? 'auto' : 'smooth' }); } }, 1500);
    else { aqSeq = false; $('aqDone').hidden = false; $('aqDone').scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' }); $('aqAll').textContent = '▶ Fazer o aquecimento completo'; }
  });
  w.btn.innerHTML = PAUSE; tickWarm();
}
WARM.forEach((w, i) => {
  const el = document.createElement('section'); el.className = 'sec'; el.id = 'warm-' + w.id;
  el.innerHTML = '<div class="sh"><button class="play" aria-label="Tocar exercício">' + PLAY + '</button><div><div class="n"></div><h3></h3></div></div><p class="tip"></p><div class="wstat"></div>';
  el.querySelector('.n').textContent = (i + 2) + ' · Aquecimento'; el.querySelector('h3').textContent = w.t; el.querySelector('.tip').textContent = w.how;
  w.btn = el.querySelector('.play'); w.stat = el.querySelector('.wstat'); w.card = el;
  w.btn.onclick = () => { if (wActive === w) { aqSeq = false; stopWarm(); } else startWarm(w); };
  $('warm').appendChild(el);
});
/* Achar a nota: o app toca uma nota, você segura "ô" e a tela mostra se está na nota, meio tom acima/abaixo ou numa oitava errada */
const AF = { on: false, i: 0, hold: 0, timer: 0, listen: false, t0: 0 };
const AF_NOTES = [50, 52, 48, 53, 55, 47];   // soando: Ré3 Mi3 Dó3 Fá3 Sol3 Si2 — região confortável do tenor
function afTarget() { return AF_NOTES[AF.i % AF_NOTES.length]; }
function afPaint(state, txt, d) {
  const box = $('afBox'); box.className = 'afbox ' + state; $('afBig').textContent = txt;
  const y = d == null || d !== d ? 50 : 50 - Math.max(-6, Math.min(6, d)) / 6 * 46;   // ponteiro: meio = na nota
  $('afPtr').style.top = y + '%'; $('afPtr').hidden = d == null || d !== d;
}
async function afListen() {
  AF.listen = false; if (Mic.on && !micBusyElsewhere('af')) Mic.stop();
  const tg = afTarget(); $('afNote').textContent = 'Nota ' + (AF.i + 1) + ' de ' + AF_NOTES.length + (simple() ? '' : ' · ' + nameOf(tg));
  afPaint('wait', 'Ouça a nota…'); noteNow(tg + 12);
  await new Promise(r => setTimeout(r, 1800)); if (!AF.on || afTarget() !== tg) return;
  try { await Mic.start(); } catch (e) { $('afMsg').textContent = micError(e); afStop(); return; }
  if (!AF.on) { if (!micBusyElsewhere('af')) Mic.stop(); return; }
  AF.hold = 0; AF.t0 = performance.now(); AF.listen = true; afPaint('wait', 'Agora segure “ô” nessa nota');
}
function afTick() {
  if (!AF.on || !AF.listen || !Mic.on) return;
  const m = Mic.pitch(), tg = afTarget();
  if (m !== m) { afPaint('wait', 'Cante “ô”…', null); AF.hold = Math.max(0, AF.hold - 1); return; }
  const d = m - tg; let st, txt;
  if (Math.abs(d - 12) < 1.2) { st = 'oct'; txt = 'UMA OITAVA ACIMA — desça bastante, voz mais grossa'; }
  else if (Math.abs(d + 12) < 1.2) { st = 'oct'; txt = 'UMA OITAVA ABAIXO — suba a voz'; }
  else if (Math.abs(d) <= 0.35) { st = 'ok'; txt = 'NA NOTA — segure!'; }
  else if (Math.abs(d) <= 0.7) { st = 'near'; txt = d > 0 ? 'Quase: um pouquinho alto' : 'Quase: um pouquinho baixo'; }
  else if (Math.abs(d) <= 1.5) { st = d > 0 ? 'high' : 'low'; txt = d > 0 ? 'MEIO TOM ACIMA (semitonando) — desça um pouco' : 'MEIO TOM ABAIXO (semitonando) — suba um pouco'; }
  else { st = d > 0 ? 'high' : 'low'; txt = d > 0 ? 'Alto demais — desça' : 'Baixo demais — suba'; }
  afPaint(st, txt, Math.abs(d) > 9 ? null : d);
  AF.hold = st === 'ok' ? AF.hold + 1 : Math.max(0, AF.hold - 1);
  $('afHold').style.width = Math.min(100, AF.hold / 18 * 100) + '%';
  if (AF.hold >= 18) {   // ~1,5 s na nota
    AF.listen = false; if (!micBusyElsewhere('af')) Mic.stop(); afPaint('ok', 'Acertou!'); AF.i++;
    if (AF.i >= AF_NOTES.length) { $('afMsg').textContent = 'Muito bem! Você achou as ' + AF_NOTES.length + ' notas.'; afStop(true); $('afNext').hidden = false; return; }
    setTimeout(() => { if (AF.on) afListen(); }, 1200);
  } else if (performance.now() - AF.t0 > 20000) { AF.listen = false; if (!micBusyElsewhere('af')) Mic.stop(); $('afMsg').textContent = 'Tudo bem. Ouça de novo com calma e tente deslizar a voz até a nota.'; setTimeout(() => { if (AF.on) afListen(); }, 1500); }
}
function afStop(done) { AF.on = false; AF.listen = false; clearInterval(AF.timer); AF.timer = 0; if (!micBusyElsewhere('af')) Mic.stop(); $('afGo').textContent = done ? '▶ Fazer de novo' : '▶ Começar'; if (!done) afPaint('wait', 'Toque em Começar', null); $('afHold').style.width = '0%'; }
stoppers.add(() => { if (AF.on) afStop(); });
$('afGo').onclick = () => { if (AF.on) { afStop(); return; } stopAll(); AF.on = true; AF.i = 0; $('afMsg').textContent = ''; $('afGo').textContent = '■ Parar'; clearInterval(AF.timer); AF.timer = setInterval(afTick, 80); afListen(); };
$('afAgain').onclick = () => { if (AF.on) afListen(); else noteNow(afTarget() + 12); };
function afDemo(a, b, txt) { if (AF.on) afStop(); stopAll(); $('afMsg').textContent = txt; noteNow(a + 12); seqT.push(setTimeout(() => noteNow(b + 12), 1300)); }
$('afExSemi').onclick = () => afDemo(50, 51, 'Meio tom: a 2ª nota é só um pouquinho mais aguda. Parece quase igual — é esse “quase” que o professor chama de semitonar.');
$('afExOct').onclick = () => afDemo(50, 62, 'Oitava: a 2ª nota é a MESMA nota, só que bem mais aguda (fina). A sua parte de tenor é a 1ª, a mais grave.');
$('afExSame').onclick = () => afDemo(50, 50, 'Mesma nota: os dois sons têm exatamente a mesma altura. Quando sua voz está assim junto com o app, os sons “se fundem”.');
/* Treinar o ouvido: o app toca 2 notas e você responde se a 2ª subiu, desceu ou ficou igual. Começa fácil e vai apertando. */
const EAR = { on: false, n: 0, ok: 0, a: 0, b: 0, ans: null, total: 10, pt: 0, nt: 0 };
function earStop() { EAR.on = false; clearTimeout(EAR.pt); clearTimeout(EAR.nt); }
function earRound() {
  const n = EAR.n, big = n < 4;   // 4 primeiras: diferenças grandes; depois: pequenas (1 ou 2 semitons)
  const a = 47 + Math.floor(Math.random() * 9), r = Math.random();
  const step = big ? 4 + Math.floor(Math.random() * 4) : 1 + Math.floor(Math.random() * 2);
  const b = r < 0.25 ? a : r < 0.62 ? a + step : a - step;
  EAR.a = a; EAR.b = b; EAR.ans = b > a ? 'up' : b < a ? 'down' : 'same';
  $('earQ').textContent = 'Pergunta ' + (n + 1) + ' de ' + EAR.total + (big ? '' : ' · agora mais difícil');
  $('earMsg').textContent = 'Ouça as duas notas…'; earPlay();
  document.querySelectorAll('#earAns button').forEach(x => x.disabled = false);
}
function earPlay() { clearTimeout(EAR.pt); stopAll(); noteNow(EAR.a + 12); EAR.pt = setTimeout(() => noteNow(EAR.b + 12), 1100); }
document.querySelectorAll('#earAns button').forEach(btn => btn.onclick = () => {
  if (!EAR.on) return; const g = btn.dataset.a, names = { up: 'SUBIU', down: 'DESCEU', same: 'FICOU IGUAL' };
  document.querySelectorAll('#earAns button').forEach(x => x.disabled = true);
  if (g === EAR.ans) { EAR.ok++; $('earMsg').textContent = 'Certo! A 2ª nota ' + names[EAR.ans].toLowerCase() + '.'; }
  else $('earMsg').textContent = 'Era: ' + names[EAR.ans] + '. Ouça de novo com calma…';
  if (g !== EAR.ans) EAR.pt = setTimeout(earPlay, 700);
  EAR.n++;
  clearTimeout(EAR.nt); EAR.nt = setTimeout(() => {
    if (!EAR.on) return;
    if (EAR.n >= EAR.total) { EAR.on = false; $('earGo').textContent = '▶ Começar de novo'; $('earQ').textContent = ''; $('earMsg').textContent = 'Você acertou ' + EAR.ok + ' de ' + EAR.total + '. ' + (EAR.ok >= 8 ? 'Muito bem! Seu ouvido está pegando a diferença.' : 'Faz parte do começo: repita amanhã, o ouvido melhora com a prática.'); $('earNext').hidden = false; return; }
    earRound();
  }, g === EAR.ans ? 1300 : 3200);
});
$('earGo').onclick = () => { earStop(); stopAll(); $('earNext').hidden = true; EAR.on = true; EAR.n = 0; EAR.ok = 0; $('earGo').textContent = 'Recomeçar'; earRound(); };
$('earAgain').onclick = () => { if (EAR.on) earPlay(); };
function aqPart(pt) {
  aqSeq = false; stopBreath(); stopWarm(); if (AF.on) afStop(); earStop(); stopAll();
  document.querySelectorAll('#v-aquecer [data-part]').forEach(el => el.hidden = el.dataset.part !== pt);
  $('aqParts').querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', b.dataset.p === pt));
  $('aqPartLead').textContent = { voz: 'Respiração e exercícios leves para acordar a voz. Uns 5 minutos.', ouvido: 'Perceber se a nota sobe, desce ou fica igual, antes de cantar.', afina: 'Cantar uma nota e ver se você está no tom.' }[pt];
  window.scrollTo(0, 0);
}
$('aqParts').querySelectorAll('button').forEach(b => b.onclick = () => aqPart(b.dataset.p));
$('aqGo').onclick = () => aqPart('ouvido');
$('earNext').onclick = () => aqPart('afina');
$('afNext').onclick = () => show('ouvir');
aqPart('voz');
$('aqAll').onclick = () => {
  if (aqSeq) { aqSeq = false; stopBreath(); stopWarm(); $('aqAll').textContent = '▶ Fazer o aquecimento completo'; return; }
  $('aqDone').hidden = true; aqSeq = true; $('aqAll').textContent = '■ Parar o aquecimento'; startBreath(true); $('breathCard').scrollIntoView({ block: 'start', behavior: reduce ? 'auto' : 'smooth' });
};
$('ajLetra').onclick = () => show('musicas');
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
  setTimeout(() => { try { drawEvo(); } catch (e) {} });
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
  const L = Store.d.log || [], tot = L.reduce((a, x) => a + (+x.min || 0), 0), days = new Set(L.map(x => cycleKey(x.date))).size;
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
// Backup completo (v2): músicas, partituras, letras (por trecho e coladas), preferências e progresso de todas as músicas.
const BK_APP = 'coral-tenor-backup', BK_V = 2;
$('bkOut').onclick = async () => {
  const msg = $('bkMsg'); msg.textContent = 'Preparando o backup…'; await yieldUI();
  try {
    Store.save();
    const songs = await SongDB.all(), pdfs = {};
    for (const r of await SongDB.allPdfs()) { const u = await pdfBytes(r); pdfs[r.id] = bufToB64(u.buffer); }
    const data = { app: BK_APP, v: BK_V, created: new Date().toISOString(), ls: LS.all(), songs, pdfs };
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
    const name = 'Coral_Tenor_backup_' + new Date().toLocaleDateString('pt-BR').replace(/\//g, '-') + '.json';
    msg.textContent = 'Backup com ' + songs.length + ' música(s) e ' + Object.keys(pdfs).length + ' partitura(s) · ' + mb(blob.size) + '.';
    try {
      const file = new File([blob], name, { type: 'application/json' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: 'Backup Coral Tenor' }); msg.textContent += ' Pronto ✓'; return; }
    } catch (e) { if (e && e.name === 'AbortError') { msg.textContent = 'Backup cancelado.'; return; } }
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove(); msg.textContent += ' Baixado ✓';
  } catch (e) { msg.textContent = 'Não consegui montar o backup: ' + ((e && e.message) || 'erro'); }
};
// Confere o backup inteiro antes de mexer em qualquer dado. Devolve { plan } ou lança erro com o motivo.
async function checkBackup(j, say) {
  if (j && j.app === 'coral-tenor' && j.data && typeof j.data === 'object') {   // backup antigo (v1): só o progresso de uma música
    const d = j.data; if ((d.status && typeof d.status !== 'object') || (d.log && !Array.isArray(d.log))) throw new Error('Backup antigo danificado.');
    return { legacy: true, data: d };
  }
  if (!j || j.app !== BK_APP || j.v !== BK_V || !Array.isArray(j.songs) || !j.ls || typeof j.ls !== 'object' || !j.pdfs || typeof j.pdfs !== 'object') throw new Error('Esse arquivo não é um backup do app.');
  const ids = new Set();
  for (const sg of j.songs) { const why = songProblem(sg); if (why) throw new Error('Música “' + ((sg && sg.title) || '?') + '” com problema: ' + why + '. Nada foi alterado.'); if (ids.has(sg.id)) throw new Error('Música repetida no backup.'); ids.add(sg.id); }
  const pdfs = [];
  for (const [id, b64] of Object.entries(j.pdfs)) {
    if (!ids.has(id)) throw new Error('O backup tem uma partitura sem música (' + id + '). Nada foi alterado.');
    say && say('Conferindo a partitura de ' + j.songs.find(x => x.id === id).title + '…'); await yieldUI();
    let buf; try { buf = b64ToBuf(b64); } catch (e) { throw new Error('Partitura danificada no backup. Nada foi alterado.'); }
    const why = await pdfProblem(buf, j.songs.find(x => x.id === id)); if (why) throw new Error('Partitura com problema (' + why + '). Nada foi alterado.');
    pdfs.push({ id, buf });
  }
  const ls = {};
  for (const [k, v] of Object.entries(j.ls)) {
    if (!k.startsWith('coral-') || typeof v !== 'string') throw new Error('Dados do backup em formato inesperado. Nada foi alterado.');
    const sid = LS.idOfKey(k);
    if (sid != null && !ids.has(sid)) continue;   // dado de música que não está no backup: não é restaurado (evita misturar músicas)
    if (k.startsWith('coral-tenor-v1') || k.startsWith('coral-lyr:')) { let o; try { o = JSON.parse(v); } catch (e) { throw new Error('Progresso danificado no backup. Nada foi alterado.'); } if (!o || typeof o !== 'object' || Array.isArray(o)) throw new Error('Progresso danificado no backup. Nada foi alterado.'); }
    if (k === 'coral-cur' && !ids.has(v)) continue;
    ls[k] = v;
  }
  return { songs: j.songs, pdfs, ls };
}
// Aplica o backup: tudo ou nada. Guarda o estado anterior e volta para ele se algo falhar.
async function applyBackup(plan) {
  const oldSongs = await SongDB.all(), oldPdfs = await SongDB.allPdfs(), oldLs = LS.all();
  Store.lock = true;   // nada da tela atual pode gravar por cima enquanto restaura
  try {
    await SongDB.write(plan.songs, plan.pdfs, true);
    try {
      Object.keys(oldLs).forEach(k => localStorage.removeItem(k));
      Object.entries(plan.ls).forEach(([k, v]) => localStorage.setItem(k, v));
    } catch (e) {
      try { Object.keys(LS.all()).forEach(k => localStorage.removeItem(k)); Object.entries(oldLs).forEach(([k, v]) => localStorage.setItem(k, v)); } catch (e2) {}
      await SongDB.write(oldSongs, oldPdfs, true);
      throw new Error('Não coube no aparelho; seus dados anteriores foram mantidos.');
    }
  } catch (e) { Store.lock = false; throw e; }
}
$('bkIn').onchange = async ev => {
  const f = ev.target.files[0]; ev.target.value = ''; if (!f) return; const msg = $('bkMsg'), say = t => { msg.textContent = t; };
  try {
    const j = await readJsonFile(f, say);
    say('Conferindo o backup…'); await yieldUI();
    const plan = await checkBackup(j, say);
    msg.innerHTML = ''; const info = document.createElement('p'); info.className = 'lead';
    const b = document.createElement('button'); b.className = 'btn pri';
    if (plan.legacy) {
      info.textContent = 'Backup antigo: tem só o progresso de uma música. Ele vai substituir o progresso de “' + (PACK ? PACK.title : 'música aberta') + '”. Músicas, partituras e letras não mudam.';
      b.textContent = 'Restaurar o progresso';
      b.onclick = () => { Store.d = Object.assign({ status: {}, log: [], results: [], alcance: null, days: {} }, plan.data); Store.save(); renderDiary(); drawRange(); renderDay(); msg.textContent = 'Progresso restaurado ✓'; };
    } else {
      const nProg = Object.keys(plan.ls).filter(k => k.startsWith('coral-tenor-v1')).length;
      info.textContent = 'Backup conferido: ' + plan.songs.length + ' música(s), ' + plan.pdfs.length + ' partitura(s), progresso de ' + nProg + ' música(s) e letras salvas. Restaurar substitui TUDO o que está neste aparelho.';
      b.textContent = 'Substituir meus dados por este backup';
      b.onclick = async () => { b.disabled = true; say('Restaurando…'); try { await applyBackup(plan); msg.textContent = 'Backup restaurado ✓ Abrindo…'; setTimeout(() => location.reload(), 700); } catch (e) { b.disabled = false; msg.textContent = (e && e.message) || 'Não consegui restaurar; seus dados anteriores foram mantidos.'; } };
    }
    msg.append(info, b);
  } catch (e) { msg.textContent = (e && e.message) || 'Esse arquivo não é um backup do app.'; }
};

/* ================= HOJE (treino guiado) ================= */
const ORDER = ['1', '2', '3', '4', '5', '0'];
const todayKey = () => cycleKey();
const Day = {
  get() { const k = todayKey(); Store.d.days = Store.d.days || {}; if (!Store.d.days[k]) { Store.d.days[k] = { done: [], listen: 0, start: null }; const ks = Object.keys(Store.d.days).sort(); while (ks.length > 60) delete Store.d.days[ks.shift()]; } return Store.d.days[k]; },
  begin() { const d = this.get(); if (!d.start) { d.start = Date.now(); Store.save(); } },
  mark(key) { const d = this.get(); if (!d.done.includes(key)) { d.done.push(key); Store.save(); if (view === 'hoje') renderDay(); } },
  unmark(key) { const d = this.get(); d.done = d.done.filter(k => k !== key); Store.save(); renderDay(); },
  listened(id) { const d = this.get(); if (id === dayTrecho()) { d.listen = (d.listen || 0) + 1; Store.save(); if (d.listen >= 2) this.mark('ouvir'); } }
};
function dayIndex() { return cycleIndex(); }
function dayTrecho() { const nf = ORDER.find(id => Store.d.status[id] !== 'firme'); return nf || ORDER[dayIndex() % ORDER.length]; }
function dayWarm() { const opts = ['brrr', 'mi', 'longa']; return WARM.find(w => w.id === opts[dayIndex() % 3]); }
function goTo(v, el) { show(v); const tgt = (typeof Sess !== 'undefined' && Sess.on) ? $('nowBox') : el; if (tgt) setTimeout(() => tgt.scrollIntoView({ block: 'start', behavior: reduce ? 'auto' : 'smooth' }), 60); }
let DAYSTEPS = [];
const SHORT_KEYS = ['w:hum', 'jogo', 'eco', 'registrar'];
function STEPS() { return (typeof Sess !== 'undefined' && Sess.short) ? DAYSTEPS.filter(x => SHORT_KEYS.includes(x.k)) : DAYSTEPS; }
function renderDay() {
  const d = Day.get(), tid = PACK ? dayTrecho() : null, s = tid ? secById(tid) : null, w2 = dayWarm(), hum = WARM.find(w => w.id === 'hum');
  const firm = SECS.filter(x => Store.d.status[x.id] === 'firme').length;
  const dt = cycleDate(); $('dayTitle').textContent = 'Treino de hoje · ' + dt.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' });
  const lesson = LESSONS[dayIndex() % LESSONS.length];
  const all = [
    { k: 'resp', t: 'Respirar · 1 min', p: 'O app conta com você: puxe o ar, segure e solte devagar fazendo “sss”.', go: 'Começar', fn: () => { goTo('aquecer', $('breathCard')); startBreath(); } },
    { k: 'w:hum', t: 'Aquecer a voz · 1 min', p: 'Boca fechada, faça “hum” seguindo o som, como uma sirene suave. Sem força.', go: 'Tocar', fn: () => { goTo('aquecer', hum.card); startWarm(hum); } },
    { k: 'jogo', t: 'Jogo: acerte ' + gameTotal() + ' notas', p: 'O app toca uma nota e você canta igual até a tela ficar verde.', go: 'Jogar', fn: () => { goTo('jogo'); gameStart(); } },
    { k: 'eco', t: 'Cantar frase por frase' + (s ? ' · ' + s.t : ''), p: 'O app canta uma frase curta; depois é a sua vez de repetir. Faça pelo menos 3 frases.', go: 'Abrir', fn: () => ecoOpen(tid, 0) },
    { k: 'ensaio', t: PROF ? 'Cantar junto com o professor' : 'Cantar a música inteira', p: PROF ? 'O áudio do professor toca e a letra vai acendendo. Cante junto, sem medo de errar.' : 'A música inteira, na ordem do coral.', go: 'Tocar', fn: () => { goTo('ensaio'); startFull(null); } },
    { k: 'corrigir', t: 'Gravar e ver como foi (opcional)', p: 'De fone. O app grava sua voz e diz, em uma frase, onde melhorar.', go: 'Abrir', fn: () => { $('cSec').value = tid; goTo('corrigir'); } },
    { k: 'aula', t: 'Mini-aula: ' + lesson.t, p: 'Um minuto para entender um conceito, com exemplo para ouvir.', go: 'Abrir', fn: () => { goTo('aulas', $('lesson-' + lesson.id)); Day.mark('aula'); } },
    { k: 'registrar', t: 'Registrar o treino', p: d.start ? 'Tempo de hoje: cerca de ' + Math.max(1, Math.round((Date.now() - d.start) / 60000)) + ' min.' : 'Salva o treino de hoje no Diário.', go: 'Registrar', fn: () => { const min = d.start ? Math.max(5, Math.round((Date.now() - d.start) / 60000)) : 15; addLog(min, 'Treino do dia' + (PACK ? ' · ' + PACK.title + (tid ? ' · ' + secName(tid) : '') : '')); Day.mark('registrar'); } }
  ];
  const steps = PACK ? all : all.filter(x => ['resp', 'w:hum', 'jogo', 'aula', 'registrar'].includes(x.k));
  DAYSTEPS = steps;
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
  $('dayLead').textContent = next ? 'Toque em “Começar o treino de hoje” e siga os passos. Use fone de ouvido.' : 'Treino de hoje completo. Até amanhã! (O treino novo começa às 4h da manhã.)';
  renderToday(); Sess.paint();
}

/* ================= MÚSICAS (arquivo importado) ================= */
function importSong(f, msgEl) { return importSongs([f], msgEl); }
// Remove a música e tudo o que é dela (partitura, letras, progresso e seleção), para nada reaparecer ao reimportar.
async function removeSong(id) {
  Store.lock = (PACK && PACK.id === id);
  await SongDB.delSong(id);
  try { LS.songKeys(id).forEach(k => localStorage.removeItem(k)); if (localStorage.getItem('coral-cur') === id) localStorage.removeItem('coral-cur'); } catch (e) {}
}
function renderSongs() {
  const ul = $('songList'); ul.innerHTML = '';
  if (!SONGS.length) ul.innerHTML = '<li class="lead">Nenhuma música importada ainda.</li>';
  SONGS.forEach(x => {
    const li = document.createElement('li'); li.className = 'st-row';
    const nm = document.createElement('div'); nm.className = 'nm'; nm.textContent = x.title + (PACK && x.id === PACK.id ? ' · aberta' : '');
    const row = document.createElement('div'); row.className = 'row';
    if (!PACK || x.id !== PACK.id) { const o = document.createElement('button'); o.className = 'btn'; o.textContent = 'Abrir'; o.onclick = () => { try { localStorage.setItem('coral-cur', x.id); } catch (e) {} location.reload(); }; row.appendChild(o); }
    if (PACK && x.id === PACK.id && Score.has()) { const pb = document.createElement('label'); pb.className = 'file btn'; pb.innerHTML = '<input type="file" accept="application/pdf,.pdf">📄 Partitura'; pb.querySelector('input').onchange = async ev => { const f = ev.target.files[0]; ev.target.value = ''; if (!f) return; try { await Score.importFile(f); nm.textContent = x.title + ' · aberta · partitura ✓'; } catch (e) { nm.textContent = x.title + (e && e.message === 'cancelado' ? ' · partitura não alterada' : ' · esse PDF não confere'); } }; row.appendChild(pb); SongDB.getPdf(x.id).then(r => { if (r) nm.textContent = x.title + ' · aberta · partitura ✓'; }).catch(() => {}); }
    const del = document.createElement('button'); del.className = 'btn'; del.textContent = 'Remover';
    del.onclick = () => { if (del.dataset.ok) { removeSong(x.id).then(() => location.reload()).catch(() => { del.textContent = 'Não consegui remover'; }); } else { del.dataset.ok = 1; del.textContent = 'Toque de novo: apaga a música, a partitura, a letra e o progresso dela'; } };
    row.appendChild(del); li.append(nm, row); ul.appendChild(li);
  });
}
async function importSongs(files, msgEl) {
  const say = t => { msgEl.textContent = t; };
  const ok = [], bad = [];
  for (const f of files) {
    try {
      const j = await readJsonFile(f, t => say((files.length > 1 ? f.name + ': ' : '') + t));
      say('Conferindo ' + (j && j.app === 'coral-bundle' ? 'o pacote' : 'a música') + '…'); await yieldUI();
      if (j && j.app === 'coral-bundle') {
        if (!Array.isArray(j.songs) || !j.songs.length) throw new Error('pacote vazio');
        const ids = new Set();
        for (const sg of j.songs) { const why = songProblem(sg); if (why) throw new Error('“' + ((sg && sg.title) || '?') + '”: ' + why); if (ids.has(sg.id)) throw new Error('música repetida no pacote'); ids.add(sg.id); }
        const pdfs = [];
        for (const [id, b64] of Object.entries(j.pdfs || {})) {
          if (!ids.has(id)) throw new Error('partitura sem música no pacote');
          const sg = j.songs.find(x => x.id === id); say('Conferindo a partitura de ' + sg.title + '…'); await yieldUI();
          let buf; try { buf = b64ToBuf(b64); } catch (e) { throw new Error('partitura danificada'); }
          const why = await pdfProblem(buf, sg); if (why) throw new Error('partitura de ' + sg.title + ': ' + why);
          pdfs.push({ id, buf });
        }
        say('Gravando ' + j.songs.length + ' músicas e ' + pdfs.length + ' partituras…'); await yieldUI();
        await SongDB.write(j.songs, pdfs, false);   // uma transação: entra tudo ou nada
        ok.push(...j.songs); continue;
      }
      const why = songProblem(j); if (why) throw new Error(why);
      await SongDB.write([j], [], false); ok.push(j);
    } catch (e) { bad.push(f.name + ' (' + ((e && e.message) || 'erro') + ')'); }
  }
  if (ok.length) { try { if (!PACK || !SONGS.some(x => x.id === localStorage.getItem('coral-cur'))) localStorage.setItem('coral-cur', ok[0].id); } catch (e) {} }
  say((ok.length ? ok.length + (ok.length > 1 ? ' músicas importadas ✓' : ' música importada ✓') : '') + (bad.length ? (ok.length ? ' · ' : '') + 'Não importei: ' + bad.join('; ') + '. Nada desse arquivo foi gravado.' : '') + (ok.length ? ' Abrindo…' : ''));
  if (ok.length) setTimeout(() => location.reload(), 900);
}
['songIn', 'songIn2'].forEach((id, i) => { const el = $(id); if (el) { el.multiple = true; el.onchange = ev => { const fs = [...ev.target.files]; ev.target.value = ''; if (fs.length) importSongs(fs, $(i ? 'songMsg2' : 'songMsg')); }; } });
$('songName').textContent = PACK ? PACK.title : 'sem música';
$('credit').textContent = PACK ? (PACK.credit || PACK.title) + '. ' + (PACK.guide ? PACK.guide + ' ' : '') + 'O áudio já está na oitava da sua voz.' : 'Nenhuma música importada. As músicas ficam só no seu aparelho.';
$('noSong').hidden = !!PACK;
if (!PACK) ['ensaio', 'eco', 'ouvir'].forEach(v => { const t = document.querySelector('.tabs button[data-v="' + v + '"]'); if (t) t.hidden = true; });
renderSongs();


/* ================= PREFERÊNCIAS / MODO SIMPLES ================= */
Store.d.prefs = Object.assign({ tech: false, adv: false }, Store.d.prefs || {});
function simple() { return !Store.d.prefs.tech; }
function applyPrefs() { document.body.classList.toggle('simple', simple()); document.body.classList.toggle('adv', !!Store.d.prefs.adv); $('prefTech').checked = !!Store.d.prefs.tech; $('prefAdv').checked = !!Store.d.prefs.adv; }
$('prefTech').onchange = e => { Store.d.prefs.tech = e.target.checked; Store.save(); applyPrefs(); };
$('prefAdv').onchange = e => { Store.d.prefs.adv = e.target.checked; Store.save(); applyPrefs(); };
$('moreTab').onclick = () => { const on = !document.body.classList.contains('adv'); document.body.classList.toggle('adv', on); $('moreTab').textContent = on ? '‹ Menos' : 'Mais ›'; $('moreTab').setAttribute('aria-expanded', on); };
applyPrefs();

/* ================= MÚSICA DO DIA ================= */
function todaySong() { if (!SONGS.length) return null; const l = [...SONGS].sort((a, b) => a.title.localeCompare(b.title)); return l[dayIndex() % l.length]; }
function openSong(id) { try { localStorage.setItem('coral-cur', id); } catch (e) {} location.hash = '#hoje'; location.reload(); }
function renderToday() {
  const t = todaySong(), box = $('todaySwitch'); box.innerHTML = '';
  if (!t) { $('todaySong').textContent = 'Importe uma música para começar. Enquanto isso, dá para respirar, aquecer e jogar.'; return; }
  $('todaySong').innerHTML = ''; const b = document.createElement('b'); b.textContent = t.title;
  $('todaySong').append('Música de hoje: ', b, PACK && PACK.id === t.id ? '' : ' (você está com ' + (PACK ? PACK.title : 'nenhuma') + ' aberta)');
  if (!PACK || PACK.id !== t.id) { const o = document.createElement('button'); o.className = 'btn pri'; o.textContent = 'Abrir ' + t.title; o.onclick = () => openSong(t.id); box.appendChild(o); }
  if (SONGS.length > 1) { const sel = document.createElement('select'); sel.setAttribute('aria-label', 'Trocar de música'); sel.innerHTML = '<option value="">Trocar de música…</option>'; SONGS.forEach(x => { const op = document.createElement('option'); op.value = x.id; op.textContent = x.title; sel.appendChild(op); }); sel.onchange = () => sel.value && openSong(sel.value); box.appendChild(sel); }
}

/* ================= TREINO GUIADO (barra de passos) ================= */
const HOW = {
  'resp': ['Toque no botão vermelho ▶ do quadro “Respiração”.', 'Siga o círculo: puxe o ar quando ele cresce, segure, e solte fazendo “sss” quando ele diminui.', 'Quando acabar, toque em Próximo ›.'],
  'w:hum': ['Toque no ▶ vermelho do “Hum deslizando”.', 'De boca fechada, faça “hum” junto com o som, subindo e descendo, sem força.', 'Quando acabar, toque em Próximo ›.'],
  'jogo': ['Toque em ▶ Começar.', 'Ouça a nota. Quando aparecer 🎤, cante “ô” na mesma altura.', 'Apareceu ▲? Suba a voz. Apareceu ▼? Desça. Segure até ficar verde.'],
  'eco': ['Toque em ▶ Ouvir a frase e escute.', 'Vem a contagem 3, 2, 1. Em “CANTE AGORA”, cante a mesma frase, seguindo as bolinhas.', 'Repita se quiser e toque em Próxima frase ›. Faça 3 frases.'],
  'ensaio': ['Toque no ▶ vermelho.', 'Siga o quadrado vermelho da partitura e cante junto, sem medo de errar.', 'Letra fora do tempo? Use os botões “adiantada / atrasada”.'],
  'corrigir': ['Ponha o fone de ouvido.', 'Toque em ● Cantar e corrigir e cante junto com o trecho.', 'Leia a frase do resultado; se quiser, treine a frase indicada.'],
  'aula': ['Leia a mini-aula que está no topo.', 'Toque nos botões 🔊 para ouvir os exemplos.'],
  'registrar': ['Toque em Registrar para guardar o treino de hoje.']
};
function paintNow() {
  const nb = $('nowBox'); if (!Sess.on) { nb.hidden = true; return; }
  const i = Sess.idx(); if (i < 0) { nb.hidden = true; return; }
  const st = STEPS()[i], how = HOW[st.k.startsWith('w:') && st.k !== 'w:hum' ? 'w:hum' : st.k] || [];
  nb.hidden = false; nb.innerHTML = '<div class="nowh">AGORA · Passo ' + (i + 1) + ' de ' + STEPS().length + '</div><b></b><ol></ol>';
  nb.querySelector('b').textContent = st.t; const ol = nb.querySelector('ol'); how.forEach(t => { const li = document.createElement('li'); li.textContent = t; ol.appendChild(li); });
}
const Sess = {
  on: false,
  idx() { const d = Day.get(); const i = STEPS().findIndex(x => !d.done.includes(x.k)); return i; },
  short: false,
  start(short) { this.short = !!short; this.on = true; Day.begin(); document.body.classList.add('insess'); renderDay(); const i = this.idx(); if (i >= 0) STEPS()[i].fn(); },
  end() { this.on = false; this.short = false; document.body.classList.remove('insess'); $('sessBar').hidden = true; renderDay(); },
  paint() {
    paintNow();
    if (!this.on) { $('sessBar').hidden = true; return; }
    const i = this.idx(); $('sessBar').hidden = false;
    if (i < 0) { $('sessStep').textContent = 'Treino de hoje completo! 🎉'; $('sessTip').textContent = 'Até amanhã. Se quiser, continue praticando à vontade.'; $('sessDo').hidden = true; $('sessNext').textContent = 'Fechar'; return; }
    const st = STEPS()[i]; $('sessDo').hidden = false; $('sessNext').textContent = 'Próximo ›';
    $('sessStep').textContent = 'Passo ' + (i + 1) + ' de ' + STEPS().length + ' · ' + st.t; $('sessTip').textContent = ''; $('sessDo').textContent = st.go;
  }
};
$('startDay').onclick = () => Sess.start(false);
$('startShort').onclick = () => Sess.start(true);
$('sessDo').onclick = () => { const i = Sess.idx(); if (i >= 0) STEPS()[i].fn(); };
$('sessNext').onclick = () => { const i = Sess.idx(); if (i < 0) { Sess.end(); show('hoje'); return; } Day.mark(STEPS()[i].k); renderDay(); const j = Sess.idx(); if (j >= 0) STEPS()[j].fn(); else show('hoje'); };
$('sessEnd').onclick = () => Sess.end();

/* ================= ECO: FRASE POR FRASE ================= */
const E = { sec: null, li: 0, speed: 'slow', reps: 2, run: 0, raf: 0, score: null, done: 0 };
function ecoRate() { return E.speed === 'slow' ? 0.8 : 1; }
function ecoBpm() { return E.speed === 'fast' ? 80 : 60; }
function micBusyElsewhere(me) { return (me !== 'af' && typeof AF !== 'undefined' && AF.on) || (me !== 'tuner' && typeof tTimer !== 'undefined' && !!tTimer) || (me !== 'range' && typeof rTimer !== 'undefined' && !!rTimer) || (me !== 'rec' && typeof recording !== 'undefined' && recording) || (me !== 'game' && typeof G !== 'undefined' && G.on); }
function ecoStop() { E.run++; cancelAnimationFrame(E.raf); if (A.owner === 'eco') stopMain(); try { A.main.playbackRate = 1; } catch (e) {} if (Mic.rec && !recording) Mic.rec = null; if (!micBusyElsewhere('eco')) Mic.stop(); $('eGo').disabled = false; $('eGo').textContent = '2 · Ouvir a frase'; $('eSay').classList.remove('you'); }
stoppers.add(ecoStop);
function ecoRender() {
  const s = E.sec; if (!s) return; const line = s.lines[E.li];
  $('eLine').innerHTML = ''; const r = drawLine(line, s.rg, { big: true }); $('eLine').appendChild(r.ln); E.els = r.els; fit($('eLine').parentElement);
  $('eNum').textContent = 'Frase ' + (E.li + 1) + ' de ' + s.lines.length; $('eLbl').textContent = s.t; $('eSay').innerHTML = '&nbsp;'; $('eRes').textContent = '';
  $('ePrev').disabled = E.li === 0; $('eNext').disabled = E.li >= s.lines.length - 1;
  if (Score.has() && s.meas) { E.score = ScoreView($('eScore'), s.meas, 'current'); E.score.ready.then(() => E.score.highlight(line[0].b + 0.01)); } else { $('eScore').innerHTML = ''; E.score = null; }
}
function firstSec() { const s = SECS.find(x => x.id !== '0') || SECS[0]; return s ? s.id : null; }
function ecoOpen(id, li) {
  if (!PACK) { show('hoje'); return; }
  E.sec = secById(id) || SECS[0]; E.li = Math.max(0, Math.min(li || 0, E.sec.lines.length - 1));
  $('eSecs').querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', b.dataset.id === E.sec.id));
  show('eco'); ecoRender();
}
SECS.forEach(s0 => { const b = document.createElement('button'); b.textContent = s0.id === '0' ? 'Introdução' : s0.t; b.dataset.id = s0.id; b.setAttribute('aria-pressed', 'false'); b.onclick = () => { ecoStop(); ecoOpen(s0.id, 0); }; $('eSecs').appendChild(b); });
[['eSlow', 'slow'], ['eMid', 'mid'], ['eFast', 'fast']].forEach(([id, v]) => $(id).onclick = () => { ecoStop(); E.speed = v; ['eSlow', 'eMid', 'eFast'].forEach(x => $(x).setAttribute('aria-pressed', x === id)); });
document.querySelectorAll('#v-eco [data-r]').forEach(b => b.onclick = () => { E.reps = +b.dataset.r; document.querySelectorAll('#v-eco [data-r]').forEach(x => x.setAttribute('aria-pressed', x === b)); });
$('ePrev').onclick = () => { ecoStop(); E.li = Math.max(0, E.li - 1); ecoRender(); };
$('eNext').onclick = () => { ecoStop(); E.li = Math.min(E.sec.lines.length - 1, E.li + 1); E.done++; if (E.done >= 3) Day.mark('eco'); ecoRender(); };
$('eMic').onchange = e => { $('eRes').textContent = e.target.checked ? 'O app vai ouvir você só na hora de cantar. Use fone se puder.' : ''; };
$('eGo').onclick = () => { if (!E.sec) return; if ($('eGo').textContent.startsWith('■')) { ecoStop(); return; } ecoCycle(); };
async function ecoCycle() {
  stopAll(); const my = ++E.run, s = E.sec, line = s.lines[E.li], bp = ecoBpm(), rate = ecoRate(), spb = 60 / bp / rate;
  const b0 = line[0].b - 0.5, last = line[line.length - 1], b1 = last.b + last.d + 0.25;
  $('eGo').textContent = '■ Parar'; $('eRes').textContent = ''; let results = [];
  for (let r = 0; r < E.reps; r++) {
    if (my !== E.run) return;
    // 1) ouvir
    $('eSay').textContent = 'Ouça…'; $('eSay').classList.remove('you');
    await new Promise(res => {
      playMain(s.a[bp], (4 + b0) * (60 / bp), 'eco', res);
      try { A.main.playbackRate = rate; A.main.preservesPitch = true; A.main.webkitPreservesPitch = true; } catch (e) {}
      const t = () => { if (my !== E.run) return res(); const beat = (A.main.currentTime - offS() * rate) / (60 / bp) - 4; karaoke(E.els, beat); if (E.score) E.score.highlight(beat); if (beat >= b1) { A.main.pause(); return res(); } E.raf = requestAnimationFrame(t); }; t();
    });
    if (my !== E.run) return;
    // 2) sua vez (mesmo tempo, em silêncio)
    E.els.forEach(({ el }) => el.classList.remove('cur', 'done'));
    let useMic = $('eMic').checked;
    if (useMic) { try { await Mic.start(); } catch (err) { if (my !== E.run) return; useMic = false; $('eMic').checked = false; $('eRes').textContent = micError(err); } }
    if (my !== E.run) { if (!micBusyElsewhere('eco')) Mic.stop(); return; }
    if (!useMic) beeps(60 / spb, 3);
    for (const c of ['3', '2', '1']) { if (my !== E.run) return; $('eSay').textContent = 'Prepare-se… ' + c; $('eSay').classList.remove('you'); await new Promise(r2 => setTimeout(r2, spb * 1000)); }
    $('eSay').textContent = '🎤 CANTE AGORA!'; $('eSay').classList.add('you');
    const t0 = performance.now();
    if (useMic) Mic.rec = [];
    await new Promise(res => {
      const t = () => { if (my !== E.run) return res(); const beat = b0 + (performance.now() - t0) / 1000 / spb; karaoke(E.els, beat); if (E.score) E.score.highlight(beat); if (beat >= b1 + 0.3) return res(); E.raf = requestAnimationFrame(t); }; t();
    });
    if (useMic && my === E.run) {
      const chunks = Mic.rec || []; Mic.rec = null; const srate = Mic.ctx ? Mic.ctx.sampleRate : 48000; if (!micBusyElsewhere('eco')) Mic.stop();
      try {
        const x = await AN.pcmToMono16k(chunks, srate), tr = await AN.track(x);
        const notes = line.map(e => ({ m: e.m - 12, b: e.b - b0, d: e.d }));
        const g = AN.grade(tr, notes, spb, -4 * spb); results.push(g);
        E.els.forEach((o, i) => { o.el.classList.remove('g-ok', 'g-near', 'g-high', 'g-low', 'g-none'); o.el.classList.add('g-' + g.per[i].status); });
        const low = g.per.filter(p => p.status === 'low').length, high = g.per.filter(p => p.status === 'high').length;
        $('eRes').textContent = g.heard < notes.length * 0.3 ? 'Não ouvi bem sua voz. Cante um pouco mais forte ou mais perto do microfone.' : 'Acertou ' + g.good + ' de ' + g.total + ' notas.' + (low > high && low ? ' Algumas ficaram graves: pense em “subir”.' : high > low && high ? ' Algumas ficaram agudas: pense em “descer”.' : g.good === g.total ? ' Perfeito! 👏' : '');
      } catch (e) { $('eRes').textContent = 'Não consegui analisar desta vez.'; }
      await new Promise(r2 => setTimeout(r2, 900));
    } else await new Promise(r2 => setTimeout(r2, 500));
    E.els.forEach(({ el }) => el.classList.remove('cur', 'done'));
  }
  if (my !== E.run) return;
  $('eSay').textContent = 'Muito bem! Repita ou vá para a próxima frase.'; $('eSay').classList.remove('you');
  $('eGo').textContent = '2 · Ouvir de novo'; try { A.main.playbackRate = 1; } catch (e) {}
}

/* ================= JOGO: ACERTE A NOTA ================= */
function gameTotal() { return (typeof Sess !== 'undefined' && Sess.on && Sess.short) ? 5 : 10; }
const G = { on: false, n: 0, ok: 0, target: null, prev: null, hold: 0, t0: 0, timer: 0, guard: 0 };
function gameStop() { G.on = false; G.listen = false; G.target = null; clearInterval(G.timer); G.timer = 0; if (!micBusyElsewhere('game')) Mic.stop(); $('gStart').textContent = '▶ Começar'; $('gStart').disabled = false; $('gAgain').disabled = true; $('gSkip').disabled = true; $('v-jogo').querySelector('.gamebox').classList.remove('hit'); }
// Faixa do jogo: respeita o alcance confortável medido. Sem medição, usa a região média do tenor (Dó3 a Lá3 soando).
// Faixa medida estreita não é trocada por outra: o jogo usa só as notas dela; com menos de 2 notas, explica e não começa.
function gRange() {
  const a = Store.d.alcance || {};
  if (a.lo == null || a.hi == null) return { lo: 47, hi: 57, measured: false };
  const lo = Math.max(40, Math.round(a.lo)), hi = Math.min(69, Math.round(a.hi) - 1);
  return { lo, hi, measured: true, narrow: hi - lo < 5, tooNarrow: hi - lo < 1 };
}
function gNext() {
  if (!G.on) return;
  if (G.n >= G.total) return gFinish();
  const { lo, hi } = gRange(); let t, tries = 0;
  do { t = lo + Math.floor(Math.random() * (hi - lo + 1)); tries++; } while (tries < 50 && G.prev != null && (t === G.prev || Math.abs(t - G.prev) > 5));
  G.target = t; G.prev = t; G.hold = 0; G.t0 = performance.now(); G.n++;
  $('gScore').textContent = 'Nota ' + G.n + ' de ' + G.total + ' · acertos: ' + G.ok;
  $('gBig').textContent = '🎵'; $('gSay').textContent = 'Ouça a nota…'; $('gHold').style.width = '0%'; $('v-jogo').querySelector('.gamebox').classList.remove('hit');
  gPlayThenListen();
}
async function gPlayThenListen() {
  G.listen = false; if (Mic.on) Mic.stop(); noteNow(G.target + 12); const my = G.target;
  await new Promise(r => setTimeout(r, 1800)); if (!G.on || G.target !== my) return;
  try { await Mic.start(); } catch (e) { if (G.on) $('gSay').textContent = micError(e); return; }
  if (!G.on || G.target !== my) { if (!micBusyElsewhere('game')) Mic.stop(); return; }
  G.t0 = performance.now(); G.guard = 0; G.listen = true;
}
function gTick() {
  if (!G.on || G.target == null || !G.listen || !Mic.on) return;
  const now = performance.now();
  if (now - G.t0 > 15000) { $('gSay').textContent = 'Tudo bem, vamos para a próxima.'; G.target = null; G.listen = false; Mic.stop(); setTimeout(gNext, 1200); return; }
  const m = Mic.pitch();
  if (m !== m) { $('gBig').textContent = '🎤'; $('gSay').textContent = 'Agora cante “ô”…'; G.hold = Math.max(0, G.hold - 1); }
  else {
    let d = m - G.target; const oct = Math.round(d / 12); d = d - 12 * oct;
    if (Math.abs(d) <= 0.45) { G.hold++; $('gBig').textContent = '✓'; $('gSay').textContent = 'Isso! Segure…' + (oct ? ' (você cantou uma oitava ' + (oct > 0 ? 'acima' : 'abaixo') + ', tudo bem)' : ''); }
    else { G.hold = Math.max(0, G.hold - 1); $('gBig').textContent = d > 0 ? '▼' : '▲'; $('gSay').textContent = d > 0 ? 'Mais grave (desça a voz)' : 'Mais agudo (suba a voz)'; }
  }
  $('gHold').style.width = Math.min(100, G.hold / 10 * 100) + '%';
  if (G.hold >= 10) { G.ok++; G.target = null; G.listen = false; Mic.stop(); $('v-jogo').querySelector('.gamebox').classList.add('hit'); $('gBig').textContent = '🎉'; $('gSay').textContent = 'Acertou!'; $('gScore').textContent = 'Nota ' + G.n + ' de ' + G.total + ' · acertos: ' + G.ok; setTimeout(gNext, 1300); }
}
async function gameStart() {
  stopAll();
  const R = gRange();
  if (R.tooNarrow) { $('gSay').textContent = 'O alcance salvo tem menos de 2 notas confortáveis, e o jogo precisa de pelo menos 2. Meça o alcance de novo em Mais › Alcance.'; $('gBig').textContent = '🎤'; return; }
  $('gRangeMsg').textContent = R.measured ? ('Notas do jogo: ' + nameOf(R.lo) + ' a ' + nameOf(R.hi) + ', dentro do seu alcance confortável' + (R.narrow ? ' (faixa curta: o jogo usa só essas notas).' : '.')) : 'Você ainda não mediu seu alcance: o jogo usa notas médias de tenor. Meça em Mais › Alcance.';
  try { await Mic.start(); if (!micBusyElsewhere('game')) Mic.stop(); } catch (e) { $('gSay').textContent = micError(e); return; }
  G.on = true; G.n = 0; G.ok = 0; G.prev = null; G.total = gameTotal(); $('gStart').textContent = 'Jogando…'; $('gStart').disabled = true; $('gAgain').disabled = false; $('gSkip').disabled = false;
  clearInterval(G.timer); G.timer = setInterval(gTick, 80); gNext();
}
function gFinish() {
  const ok = G.ok, tot = G.total || 10, f = ok / tot; gameStop();
  $('gBig').textContent = f >= 0.8 ? '🏆' : f >= 0.5 ? '👍' : '💪'; $('gSay').textContent = 'Você acertou ' + ok + ' de ' + tot + '. ' + (f >= 0.8 ? 'Excelente!' : f >= 0.5 ? 'Bom! Amanhã tem mais.' : 'Faz parte do começo. A prática melhora rápido.');
  Store.d.games = [{ date: new Date().toISOString(), ok, total: tot }, ...(Store.d.games || [])].slice(0, 200); Store.save(); Day.mark('jogo'); gHist();
}
function gHist() { const L = (Store.d.games || []).slice(0, 7); $('gHist').textContent = L.length ? 'Últimas partidas: ' + L.map(x => x.ok + '/' + (x.total || 10)).join(' · ') : ''; }
$('gStart').onclick = () => gameStart();
$('gAgain').onclick = () => { if (G.target != null) gPlayThenListen(); };
$('gSkip').onclick = () => { G.target = null; gNext(); };
gHist();

/* ================= EVOLUÇÃO E RESUMO ================= */
function allStores() {
  const out = [];
  try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith('coral-tenor-v1')) { try { const d = JSON.parse(localStorage.getItem(k)); const id = k.includes(':') ? k.split(':')[1] : 'maracangalha'; out.push({ id, d }); } catch (e) {} } } } catch (e) {}
  if (!out.length) out.push({ id: PACK ? PACK.id : '', d: Store.d });
  return out;
}
const titleOf = id => (SONGS.find(x => x.id === id) || {}).title || id;
const dkey = d => cycleKey(d);
function drawEvo() {
  const c = $('evo'); if (!c) return; const ctx = c.getContext('2d'), W = c.width, H = c.height, css = getComputedStyle(document.documentElement);
  const days = []; for (let i = 13; i >= 0; i--) { const d = cycleDate(); d.setDate(d.getDate() - i); d.setHours(12, 0, 0, 0); days.push(dkey(d)); }
  const S = allStores(), min = {}, game = {}, tune = {};
  S.forEach(({ d }) => { (d.log || []).forEach(x => { const k = dkey(x.date); min[k] = (min[k] || 0) + (+x.min || 0); }); (d.games || []).forEach(x => { const k = dkey(x.date), v = x.ok / (x.total || 10) * 100; game[k] = Math.max(game[k] || 0, v); }); (d.results || []).forEach(x => { const k = dkey(x.date); tune[k] = Math.max(tune[k] || 0, x.ok); }); });
  ctx.clearRect(0, 0, W, H); const L = 64, B = H - 50, T = 20, cw = (W - L - 20) / 14;
  ctx.font = '22px -apple-system, Arial'; ctx.strokeStyle = css.getPropertyValue('--line'); ctx.lineWidth = 2;
  [0, 50, 100].forEach(v => { const y = B - (B - T) * v / 100; ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(W - 10, y); ctx.stroke(); ctx.fillStyle = css.getPropertyValue('--muted'); ctx.fillText(v + '%', 4, y + 7); });
  const maxMin = Math.max(30, ...Object.values(min));
  days.forEach((k, i) => {
    const x = L + i * cw; if (min[k]) { ctx.fillStyle = css.getPropertyValue('--silver'); const h = (B - T) * min[k] / maxMin; ctx.fillRect(x + cw * 0.2, B - h, cw * 0.6, h); }
    if (i % 2 === 1) { ctx.fillStyle = css.getPropertyValue('--muted'); ctx.fillText(k.slice(8) + '/' + k.slice(5, 7), x - 8, H - 14); }
  });
  const line = (obj, col) => { ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 4; let pen = false; ctx.beginPath(); days.forEach((k, i) => { if (obj[k] == null) return; const x = L + i * cw + cw / 2, y = B - (B - T) * obj[k] / 100; pen ? ctx.lineTo(x, y) : ctx.moveTo(x, y); pen = true; }); ctx.stroke(); days.forEach((k, i) => { if (obj[k] == null) return; const x = L + i * cw + cw / 2, y = B - (B - T) * obj[k] / 100; ctx.beginPath(); ctx.arc(x, y, 7, 0, 7); ctx.fill(); }); };
  line(game, css.getPropertyValue('--ok')); line(tune, css.getPropertyValue('--red'));
  const nd = days.filter(k => min[k]).length, tm = days.reduce((a, k) => a + (min[k] || 0), 0);
  $('evoTxt').textContent = nd ? 'Últimos 14 dias: ' + nd + ' dia(s) de treino, ' + tm + ' minutos.' : 'Os treinos registrados aparecem aqui.';
}
function teacherSummary() {
  const S = allStores(), since = Date.now() - 7 * 864e5, days = new Set(); let mins = 0; const games = [];
  const lines = ['Resumo do meu treino de canto (tenor) — últimos 7 dias', ''];
  S.forEach(({ d }) => { (d.log || []).forEach(x => { if (Date.parse(x.date) >= since) { days.add(dkey(x.date)); mins += +x.min || 0; } }); (d.games || []).forEach(x => { if (Date.parse(x.date) >= since) games.push(x.ok / (x.total || 10) * 10); }); });
  lines.push('• Dias de treino: ' + days.size + ' · Tempo total: ' + mins + ' min');
  if (games.length) lines.push('• Jogo de afinação (acertar a nota): média ' + (games.reduce((a, b) => a + b, 0) / games.length).toFixed(1).replace('.', ',') + ' de 10, melhor ' + Math.max(...games).toFixed(0) + ' de 10');
  const Al = Store.d.alcance; if (Al && Al.lo != null && Al.hi != null) lines.push('• Alcance confortável medido: ' + nameOf(Al.lo) + ' a ' + nameOf(Al.hi));
  lines.push('');
  S.forEach(({ id, d }) => {
    const st = d.status || {}, res = (d.results || []).filter(x => Date.parse(x.date) >= since);
    const firm = Object.entries(st).filter(([, v]) => v === 'firme').map(([k]) => k), tr = Object.entries(st).filter(([, v]) => v === 'treino').map(([k]) => k);
    if (!firm.length && !tr.length && !res.length) return;
    lines.push(titleOf(id) + ':');
    if (firm.length) lines.push('  – Firmes: ' + firm.map(secName).join(', '));
    if (tr.length) lines.push('  – Ainda treinando: ' + tr.map(secName).join(', '));
    if (res.length) { const best = {}; res.forEach(r => { best[r.trecho] = Math.max(best[r.trecho] || 0, r.ok); }); const w = Object.entries(best).sort((a, b) => a[1] - b[1]); lines.push('  – Afinação nas gravações: ' + w.map(([k, v]) => secName(k) + ' ' + v + '%').join(', ')); if (w[0] && w[0][1] < 70) lines.push('  – Mais difícil para mim: ' + secName(w[0][0])); }
  });
  lines.push('', 'Dúvidas para a aula: ');
  return lines.join('\n');
}
$('sumBtn').onclick = () => { $('sumTxt').value = teacherSummary(); $('sumBox').hidden = false; };
$('sumCopy').onclick = async () => { try { await navigator.clipboard.writeText($('sumTxt').value); $('sumMsg').textContent = 'Copiado ✓'; } catch (e) { $('sumTxt').select(); $('sumMsg').textContent = 'Texto selecionado: copie pelo menu do iPhone.'; } };
$('sumShare').onclick = async () => { try { if (navigator.share) { await navigator.share({ text: $('sumTxt').value }); $('sumMsg').textContent = 'Pronto ✓'; } else $('sumCopy').click(); } catch (e) {} };

/* ================= LETRA LIDA DA PARTITURA (no aparelho, a partir do PDF da pessoa) ================= */
const LYR_SKIP = /^(p|pp|ppp|mp|mf|f|ff|fff|sfz|cresc\.?|crescendo|dim\.?|rubato|fine|fim|coda|total|vezes|vez|falado|última|repete|várias|x|\d+)$/i;
const HAS_LETTER = /[A-Za-zÀ-ÖØ-öø-ÿ]/;
async function readScoreLyrics() {
  if (!Score.pdf || !Score.has()) return null;
  return readLyricsFrom(Score.pdf, PACK.score.boxes);
}
async function readLyricsFrom(pdf, B) {
  const chars = {};
  for (let n = 1; n <= pdf.numPages; n++) {
    const pg = await pdf.getPage(n), vp = pg.getViewport({ scale: 1 }), tc = await pg.getTextContent(), W = vp.width, H = vp.height;
    const list = chars[n] = [];
    tc.items.forEach((it, ii) => {
      const str = it.str || ''; if (!str.trim() || (!HAS_LETTER.test(str) && !/^[\s\-–‐]+$/.test(str)) || /[œŒ˙≈∑‰]/.test(str)) return;
      const x0 = it.transform[4], y = it.transform[5], w = it.width || 0, fs = Math.abs(it.transform[3]) || 10, cw = str.length ? w / str.length : 0;
      for (let i = 0; i < str.length; i++) list.push({ c: str[i], x: (x0 + cw * (i + 0.5)) / W, y: (H - y) / H, cw: cw / W, fs: fs / H, it: n * 100000 + ii });
    });
  }
  const out = {};
  Object.entries(B).forEach(([m, b]) => {
    const h = (b.y1 - b.y0) / 3.05, bot = b.y1 - 1.15 * h;
    let cs = (chars[b.p] || []).filter(c => c.x >= b.x0 - 0.004 && c.x < b.x1 && c.y > bot + 0.55 * h && c.y < bot + 2.0 * h);
    if (!cs.length) { out[m] = []; return; }
    const rows = {}; cs.forEach(c => { const k = Math.round(c.y * 400); rows[k] = (rows[k] || 0) + 1; });
    const best = +Object.entries(rows).sort((a, b2) => b2[1] - a[1])[0][0]; cs = cs.filter(c => Math.abs(c.y * 400 - best) <= (/[\-–‐]/.test(c.c) ? 5 : 1.5)).sort((a, b2) => a.x - b2.x);
    const syl = []; let cur = [];
    const flush = () => { if (!cur.length) return; const t = cur.map(c => c.c).join('').replace(/^[,.;:!?"“”]+|[,.;:!?"“”]+$/g, ''); if (t && HAS_LETTER.test(t) && !LYR_SKIP.test(t)) syl.push({ x: (cur[0].x + cur[cur.length - 1].x) / 2, x0: cur[0].x, x1: cur[cur.length - 1].x, t }); cur = []; };
    cs.forEach(c => { if (/[\s\-–‐_‿]/.test(c.c)) { flush(); if (/[\-–‐]/.test(c.c) && syl.length) syl[syl.length - 1].hy = true; return; } if (cur.length && (c.it !== cur[cur.length - 1].it || c.x - cur[cur.length - 1].x > Math.max(c.cw, cur[cur.length - 1].cw) * 1.9)) flush(); cur.push(c); });
    flush(); out[m] = syl;
  });
  return out;
}
// separação silábica simples do português (para palavras que a partitura juntou)
function splitPT(w) {
  const V = 'aeiouáéíóúâêôãõàüAEIOUÁÉÍÓÚÂÊÔÃÕÀÜyY', isV = c => V.includes(c), low = w.toLowerCase();
  const KEEP = ['ch', 'lh', 'nh', 'qu', 'gu', 'bl', 'br', 'cl', 'cr', 'dr', 'fl', 'fr', 'gl', 'gr', 'pl', 'pr', 'tr', 'vr'];
  const cuts = []; let i = 0;
  while (i < w.length && !isV(w[i])) i++;
  while (i < w.length) {
    while (i < w.length && isV(w[i])) i++;           // núcleo vocálico (ditongos ficam juntos)
    let j = i; while (j < w.length && !isV(w[j])) j++;  // consoantes até a próxima vogal
    if (j >= w.length) break;
    const cons = low.slice(i, j); let cut;
    if (cons.length <= 1) cut = i; else if (KEEP.includes(cons.slice(-2))) cut = j - 2; else cut = j - 1;
    if (cut > 0) cuts.push(cut); i = j;
  }
  const out = []; let a = 0; cuts.forEach(c => { if (c > a) { out.push(w.slice(a, c)); a = c; } }); out.push(w.slice(a));
  return out.filter(Boolean);
}
// casa as sílabas de cada compasso com as notas, pela posição (programação dinâmica, em ordem)
function matchSyl(sy, nx) {
  sy = sy.slice();
  if (sy.length < nx.length) {
    const ex = []; sy.forEach(o => { const ps = o.t.includes(' ') ? [o.t] : splitPT(o.t); if (ps.length < 2) { ex.push(o); return; } const a = o.x0 != null ? o.x0 : o.x, b = o.x1 != null ? o.x1 : o.x; ps.forEach((t, k) => ex.push({ x: a + (b - a) * (k + 0.5) / ps.length, t, hy: k < ps.length - 1 ? true : !!o.hy })); });
    if (ex.length <= nx.length) sy = ex;
  }
  while (sy.length > nx.length && sy.length > 1) { let bi = 0, bd = 1e9; for (let i = 0; i < sy.length - 1; i++) { const d = sy[i + 1].x - sy[i].x; if (d < bd) { bd = d; bi = i; } } sy.splice(bi, 2, { x: (sy[bi].x + sy[bi + 1].x) / 2, t: sy[bi].t + (sy[bi].hy ? '' : ' ') + sy[bi + 1].t, hy: sy[bi + 1].hy }); }
  const S = sy.length, N = nx.length, D = [], P = [];
  for (let i = 0; i <= S; i++) { D.push(new Array(N + 1).fill(1e9)); P.push(new Array(N + 1).fill(0)); }
  for (let j = 0; j <= N; j++) D[0][j] = 0;
  for (let i = 1; i <= S; i++) for (let j = 1; j <= N; j++) { const a = D[i - 1][j - 1] + Math.abs(sy[i - 1].x - nx[j - 1]), b = D[i][j - 1]; if (a <= b) { D[i][j] = a; P[i][j] = 1; } else { D[i][j] = b; P[i][j] = 2; } }
  const res = new Array(N).fill(null); let i = S, j = N;
  while (i > 0 && j > 0) { if (P[i][j] === 1) { res[j - 1] = sy[i - 1]; i--; j--; } else j--; }
  return res;
}
function fillLyrics(lines, meas, map, B) {
    let n = 0;
    const notes = lines.flat(); let prevHad = false;
    meas.forEach(([m, b0, b1]) => {
      const ns = notes.filter(e => e.b >= b0 - 1e-6 && e.b < b1 - 1e-6), box = B[m]; if (!ns.length || !box) return;
      const w = box.x1 - box.x0, nx = ns.map(e => box.x0 + w * 0.07 + (e.b - b0) / (b1 - b0) * w * 0.88);
      const r = matchSyl(map[m] || [], nx);
      ns.forEach((e, k) => { if (r[k]) { e.sp = r[k].t; e.hy = !!r[k].hy; n++; prevHad = true; } else { e.sp = prevHad ? '~' : (e.sp || null); e.hy = false; } });
    });
    return n;
}
function applyScoreLyrics(map) {
  if (!map) return 0; const B = PACK.score.boxes; let n = 0;
  const fill = (lines, meas) => {
    const notes = lines.flat(); let prevHad = false;
    meas.forEach(([m, b0, b1]) => {
      const ns = notes.filter(e => e.b >= b0 - 1e-6 && e.b < b1 - 1e-6), box = B[m]; if (!ns.length || !box) return;
      const w = box.x1 - box.x0, nx = ns.map(e => box.x0 + w * 0.07 + (e.b - b0) / (b1 - b0) * w * 0.88);
      const r = matchSyl(map[m] || [], nx);
      ns.forEach((e, k) => { if (r[k]) { e.sp = r[k].t; e.hy = !!r[k].hy; n++; prevHad = true; } else e.sp = prevHad ? '~' : (e.sp || null); });
    });
  };
  SECS.forEach(s => { if (s.meas) fill(s.lines, s.meas); });
  if (FULL && FULL.meas) fill(FULL.lines.map(l => l.ev), FULL.meas);
  return n;
}
async function loadScoreLyrics() {
  if (!PACK || !PACK.noLyrics || !Score.has()) return;
  try {
    if (!(await Score.load())) return;
    const map = await readScoreLyrics(), n = applyScoreLyrics(map);
    if (!n) return;
    SECS.forEach(s => { applyLyrics(s); if (s.card) renderSecLines(s); });
    FULL.lines.forEach(l => l.ev.forEach(e => { if (e.sp && !e._typed) e.s = e.sp; }));
    if (typeof fLineIdx !== 'undefined') fLineIdx = -1;
    if (view === 'eco' && E.sec) ecoRender();
    document.querySelectorAll('.lyrn').forEach(x => { if (!x.textContent) x.textContent = 'Letra lida da sua partitura ✓'; });
  } catch (e) {}
}
document.addEventListener('score-ready', loadScoreLyrics);

/* ================= MÚSICAS (letra completa, lida do PDF da pessoa ou escrita por ela) ================= */
const Letras = (() => {
  const cache = {}; let sel = null, size = 17;
  try { size = +localStorage.getItem('coral-letra-size') || 17; } catch (e) {}
  const keyOf = id => 'coral-letra:' + id;
  const typed = id => { try { return localStorage.getItem(keyOf(id)) || ''; } catch (e) { return ''; } };
  // Monta as frases da música: cada linha vira uma frase com sílabas; cada sílaba guarda suas notas (altura, início, duração)
  // e a direção em relação à nota anterior (sobe/desce/igual). Partes (blocos) viram títulos.
  function buildLines(lines, blocks, withLyrics) {
    const out = []; let bi = -1, pm = null;
    const dir = m => { const d = pm == null ? 0 : m - pm; pm = m; return d; };
    lines.forEach((ln, li) => {
      if (!ln.length) return;
      const b0 = ln[0].b, lastE = ln[ln.length - 1]; let nb = bi; while (nb + 1 < blocks.length && blocks[nb + 1].start <= b0 + 1e-6) nb++;
      if (nb !== bi) { bi = nb; out.push({ h: blocks[bi].label + (blocks[bi].sub ? ' · ' + blocks[bi].sub : '') }); }
      const any = withLyrics && ln.some(e => e.sp && e.sp !== '~');
      let t = '', glue = false; const words = []; let cw = null, last = null;
      ln.forEach(e => {
        const d = e.m == null ? 0 : dir(e.m), note = { m: e.m, b: e.b, d: e.d };
        let sp = any ? e.sp : '♪';
        if ((sp === '~' || !sp) && last && any) { last.mv.push(d); last.ms.push(e.m); last.nb.push(note); return; }
        if (!sp || sp === '~') sp = '•';
        if (any) t += (t && !glue ? ' ' : '') + sp;
        if (!cw || !glue || !any) { cw = []; words.push(cw); }
        last = { t: sp, mv: [d], ms: [e.m], nb: [note] }; cw.push(last); glue = any && !!e.hy;
      });
      out.push({ t: any ? t : '♪ (só melodia, sem letra)', words, mel: !any, li, b0, b1: lastE.b + lastE.d });
    });
    return out;
  }
  async function fromPdf(x) {
    if (cache[x.id]) return cache[x.id];
    if (!x.score || !x.score.boxes || !x.full || !x.full.meas) return null;
    const rec = await SongDB.getPdf(x.id); if (!rec) return null;
    const lib = await Score.lib(), pdf = await lib.getDocument({ data: await pdfBytes(rec) }).promise;
    const map = await readLyricsFrom(pdf, x.score.boxes);
    const lines = JSON.parse(JSON.stringify(x.full.lines.map(l => l.ev)));
    lines.flat().forEach(e => { e.sp = null; });
    if (!fillLyrics(lines, x.full.meas, map, x.score.boxes)) return null;
    return (cache[x.id] = buildLines(lines, x.full.blocks || [], true));
  }
  // Usa a letra colada pela pessoa para arrumar espaços/grafia, mantendo as sílabas (e as notas/setas) da partitura.
  function alignTyped(r, txt) {
    const lettersOf = str => { const L = [], O = []; const n = str.normalize('NFC'); for (let i = 0; i < n.length; i++) { const b = n[i].normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase(); if (/[a-z]/.test(b)) { L.push(b); O.push(i); } } return { L, O, s: n }; };
    const U = lettersOf(txt), N = U.L.length, start = new Uint8Array(N);
    for (let k = 0; k < N; k++) start[k] = (k === 0 || U.O[k] !== U.O[k - 1] + 1) ? 1 : 0;
    let n = 0;
    const out = r.map(o => {
      if (!o.words || o.mel) return o;
      const syl = []; o.words.forEach(w => w.forEach(sy => syl.push(Object.assign({}, sy))));
      const P = [], own = []; syl.forEach((sy, si) => { const l = lettersOf(sy.t).L; l.forEach(c => { P.push(c); own.push(si); }); });
      const M = P.length; if (!M || !N) return o;
      // alinhamento semi-global: a linha inteira da partitura dentro de qualquer trecho do texto colado
      const W = N + 1, D = new Float32Array((M + 1) * W), T = new Uint8Array((M + 1) * W);
      for (let i = 1; i <= M; i++) { D[i * W] = i; T[i * W] = 2; }
      for (let i = 1; i <= M; i++) for (let j = 1; j <= N; j++) {
        const a = D[(i - 1) * W + j - 1] + (P[i - 1] === U.L[j - 1] ? 0 : 1), b = D[(i - 1) * W + j] + 1, c = D[i * W + j - 1] + 1;
        if (a <= b && a <= c) { D[i * W + j] = a; T[i * W + j] = 1; } else if (b <= c) { D[i * W + j] = b; T[i * W + j] = 2; } else { D[i * W + j] = c; T[i * W + j] = 3; }
      }
      let bj = 0, bv = 1e9; for (let j = 0; j <= N; j++) if (D[M * W + j] < bv) { bv = D[M * W + j]; bj = j; }
      if (bv > Math.max(2, M * 0.3)) return Object.assign({}, o, { chk: 'nf' });   // frase não encontrada no texto colado: fica como a partitura
      const map = new Int32Array(M).fill(-1); let i = M, j = bj;
      while (i > 0) { const t = T[i * W + j]; if (t === 1) { map[i - 1] = j - 1; i--; j--; } else if (t === 2) i--; else if (t === 3) j--; else break; }
      // novo texto de cada sílaba (grafia do texto colado) e onde começam as palavras
      const first = syl.map(() => -1), last = syl.map(() => -1);
      for (let k = 0; k < M; k++) if (map[k] >= 0) { const si = own[k]; if (first[si] < 0) first[si] = map[k]; last[si] = map[k]; }
      syl.forEach((sy, si) => { if (first[si] < 0) { sy.ws = true; return; } const a = U.O[first[si]], b = U.O[last[si]]; let tx = U.s.slice(a, b + 1).replace(/[\n\r]+/g, ' ').replace(/\s+/g, ' ').replace(/[-‐–]/g, ''); sy.t = tx.trim() || sy.t; sy.ws = !!start[first[si]]; });
      const words = []; let cw = null;
      syl.forEach((sy, si) => { if (!cw || sy.ws) { cw = []; words.push(cw); } cw.push(sy); });
      n++;
      return Object.assign({}, o, { t: syl.map(sy => (sy.ws ? ' ' : '') + sy.t).join('').trim(), words, chk: bv === 0 ? 'ok' : 'dif', orig: o.t });
    });
    return { r: out, n };
  }
  function chips() {
    const box = $('lsSongs'); box.innerHTML = '';
    [...SONGS].sort((a, b) => a.title.localeCompare(b.title)).forEach(x => {
      const b = document.createElement('button'); b.className = 'btn' + (sel === x.id ? ' pri' : ''); b.textContent = x.title;
      b.onclick = () => { sel = x.id; chips(); render(); }; box.appendChild(b);
    });
  }
  function importPdf(x) {
    const d = document.createElement('div'); d.className = 'row';
    d.innerHTML = '<label class="file btn pri"><input type="file" accept="application/pdf,.pdf">📄 Escolher o PDF da partitura</label><span class="save"></span>';
    const msg = d.querySelector('.save');
    d.querySelector('input').onchange = async ev => {
      const f = ev.target.files[0]; ev.target.value = ''; if (!f) return; msg.textContent = 'Lendo…';
      try {
        const lib = await Score.lib(), buf = await f.arrayBuffer(), doc = await lib.getDocument({ data: new Uint8Array(buf.slice(0)) }).promise;
        const r = await savePdfFor(x, buf, doc, f.name);
        if (r === 'cancel') { msg.textContent = 'Partitura não alterada.'; return; }
        if (r !== 'ok' && r !== 'same') { msg.textContent = r; return; }
        delete cache[x.id];
        if (PACK && x.id === PACK.id) { Score.pdf = doc; Score.pages = {}; document.dispatchEvent(new Event('score-ready')); }
        render();
      } catch (e) { msg.textContent = 'Não consegui abrir esse PDF.'; }
    };
    return d;
  }
  async function render() {
    const x = SONGS.find(s => s.id === sel), body = $('lsBody'), ed = $('lsEd');
    ed.hidden = true; $('lsTitle').textContent = x ? x.title : ''; body.style.fontSize = size + 'px';
    if (!x) { body.innerHTML = '<p class="lead">Importe as músicas no Diário para ver as letras aqui.</p>'; $('lsTools').hidden = true; return; }
    $('lsTools').hidden = false; body.innerHTML = '<p class="lead">Lendo a letra da sua partitura…</p>'; $('lsNote').textContent = '';
    const t = typed(x.id);
    const plain = () => { body.innerHTML = ''; t.split(/\n/).forEach(l => { const p = document.createElement(l.trim() ? 'p' : 'div'); p.className = l.trim() ? 'lsl' : 'lsgap'; p.textContent = l; body.appendChild(p); }); $('lsNote').textContent = 'Letra escrita por você ✓ (sem setas: o app não conseguiu ler a partitura).'; };
    let r = null, err = ''; try { r = await Promise.race([fromPdf(x), new Promise((_, no) => setTimeout(() => no(new Error('demorou demais para ler o PDF')), 30000))]); } catch (e) { err = (e && (e.name + ': ' + e.message)) || String(e); }
    if (sel !== x.id) return;
    let fixed = 0;
    if (t && r) { const a = alignTyped(r, t); r = a.r; fixed = a.n; }
    if (r) { const rr = []; r.forEach(o => { const l = rr[rr.length - 1]; if (o.mel && l && l.mel) return; rr.push(o); }); r = rr; }
    else if (t) { plain(); return; }
    body.innerHTML = '';
    if (!r) {
      const has = await SongDB.getPdf(x.id).catch(() => null);
      const p = document.createElement('p'); p.className = 'msg';
      p.textContent = has ? 'Não consegui ler a letra desse PDF. Toque em “✎ Escrever/colar a letra” para colocar a letra você mesmo.' : 'Para ver a letra, escolha o PDF da partitura que o professor mandou. Ele fica guardado só neste iPhone. Ou toque em “✎ Escrever/colar a letra”.';
      body.appendChild(p); if (!has) body.appendChild(importPdf(x));
      if (err) { const d = document.createElement('p'); d.className = 'lead'; d.textContent = 'Detalhe para o suporte: ' + err.slice(0, 160) + ' · ' + navigator.userAgent.replace(/^.*?OS ([\d_]+).*$/, 'iOS $1'); body.appendChild(d); }
      return;
    }
    const lg = document.createElement('div'); lg.className = 'lslegend';
    lg.innerHTML = '<span><b class="ar up">↑</b> sobe</span><span><b class="ar up2">⇈</b> sobe muito</span><span><b class="ar dn">↓</b> desce</span><span><b class="ar dn2">⇊</b> desce muito</span><span><b class="ar eq">=</b> mesmo tom</span>';
    body.appendChild(lg);
    const tip = document.createElement('p'); tip.className = 'lead'; tip.textContent = 'A seta em cima de cada sílaba compara com a nota anterior. Toque numa sílaba para ouvir a nota dela.'; body.appendChild(tip);
    const arrow = d => d >= 3 ? ['up2', '⇈'] : d > 0 ? ['up', '↑'] : d <= -3 ? ['dn2', '⇊'] : d < 0 ? ['dn', '↓'] : ['eq', '='];
    r.forEach(o => {
      if (o.h || !o.words || o.mel) { const p = document.createElement(o.h ? 'h3' : 'p'); p.className = o.h ? 'lsh' : 'lsl' + (o.mel ? ' lsm' : ''); p.textContent = o.h || o.t; body.appendChild(p); return; }
      const p = document.createElement('p'); p.className = 'lsl lsp' + (o.chk ? ' chk-' + o.chk : '');
      if (o.chk) { const k = document.createElement('span'); k.className = 'chk'; k.textContent = o.chk === 'ok' ? '✓' : o.chk === 'dif' ? '≠' : '?'; k.title = o.chk === 'ok' ? 'Igual ao texto colado' : o.chk === 'dif' ? 'Pequena diferença entre a partitura e o texto colado' : 'Frase não encontrada no texto colado'; p.appendChild(k); }
      o.words.forEach((w, wi) => {
        const ws = document.createElement('span'); ws.className = 'lw';
        w.forEach(sy => {
          const b = document.createElement('button'); b.className = 'lsy'; b.type = 'button';
          const ar = document.createElement('span'); ar.className = 'ars';
          sy.mv.forEach(d => { const [c, ch] = arrow(d); const i = document.createElement('b'); i.className = 'ar ' + c; i.textContent = ch; ar.appendChild(i); });
          const tx = document.createElement('span'); tx.className = 'tx'; tx.textContent = sy.t;
          b.append(ar, tx); b.onclick = () => { if (sy.ms.length > 1) playSeq(sy.ms, 450); else playNote(sy.ms[0]); b.classList.add('ping'); setTimeout(() => b.classList.remove('ping'), 600); };
          ws.appendChild(b);
        });
        p.appendChild(ws); if (wi < o.words.length - 1) p.appendChild(document.createTextNode(' '));
      });
      body.appendChild(p);
      if (o.chk === 'dif' && o.orig) { const d = document.createElement('p'); d.className = 'lsorig'; d.textContent = 'Na partitura: ' + o.orig; body.appendChild(d); }
    });
    if (t) {
      const c = { ok: 0, dif: 0, nf: 0 }; r.forEach(o => { if (o.chk) c[o.chk]++; });
      const sm = document.createElement('div'); sm.className = 'panel chksum';
      sm.innerHTML = '<b>Conferência com o texto colado</b><p class="lead"></p>';
      sm.querySelector('p').textContent = '✓ ' + c.ok + ' frase(s) iguais · ≠ ' + c.dif + ' com diferença (veja “Na partitura”) · ? ' + c.nf + ' não encontradas no texto colado (repetições, “lá lá”, vocalizes ou trechos que o site não tem).';
      body.insertBefore(sm, body.firstChild);
    }
    $('lsNote').textContent = t ? 'Letra corrigida com o texto que você colou ✓ (' + fixed + ' de ' + r.filter(o => o.words).length + ' linhas conferidas). As setas continuam seguindo as notas.' : 'Letra lida da sua partitura, na ordem em que você canta. Pode ter palavras grudadas ou partidas: toque em “✎ Escrever/colar a letra” e cole a letra certa — o app arruma as palavras e mantém as setas.';
  }
  const norm = t => (t || '').normalize('NFD').toLowerCase().replace(/[^a-z]/g, '');
  $('lsPdfs').onchange = async ev => {
    const fs = [...ev.target.files]; ev.target.value = ''; if (!fs.length) return; const msg = $('lsPdfMsg'); msg.textContent = 'Lendo ' + fs.length + ' PDF(s)…';
    const lib = await Score.lib(), done = [], miss = [], skip = [], used = new Set();
    for (const f of fs) {
      try {
        const buf = await f.arrayBuffer(), doc = await lib.getDocument({ data: new Uint8Array(buf.slice(0)) }).promise;
        const pg = await doc.getPage(1), tc = await pg.getTextContent(), txt = norm(tc.items.map(i => i.str).join('') + ' ' + f.name);
        let x = SONGS.find(sg => txt.includes(norm(sg.title)));
        if (x && used.has(x.id)) continue;   // mesmo PDF marcado duas vezes
        if (!x) { const c = SONGS.filter(sg => !used.has(sg.id) && sg.score && sg.score.pages === doc.numPages); if (c.length === 1) x = c[0]; }   // só pelo nº de páginas: savePdfFor pede confirmação
        if (!x || (x.score && x.score.pages !== doc.numPages)) { miss.push(f.name); continue; }
        used.add(x.id);
        const r = await savePdfFor(x, buf, doc, f.name);
        if (r === 'cancel') { skip.push(x.title); continue; }
        if (r !== 'ok' && r !== 'same') { miss.push(f.name); continue; }
        delete cache[x.id]; done.push(x.title);
        if (PACK && x.id === PACK.id) { Score.pdf = doc; Score.pages = {}; document.dispatchEvent(new Event('score-ready')); }
      } catch (e) { miss.push(f.name); }
    }
    msg.textContent = [done.length ? 'Partituras salvas: ' + done.join(', ') + ' ✓' : '', skip.length ? 'Não alteradas: ' + skip.join(', ') : '', miss.length ? 'Não reconheci: ' + miss.join(', ') : ''].filter(Boolean).join(' · ');
    render();
  };
  $('lsBig').onclick = () => { size = Math.min(34, size + 2); try { localStorage.setItem('coral-letra-size', size); } catch (e) {} $('lsBody').style.fontSize = size + 'px'; };
  $('lsSmall').onclick = () => { size = Math.max(14, size - 2); try { localStorage.setItem('coral-letra-size', size); } catch (e) {} $('lsBody').style.fontSize = size + 'px'; };
  $('lsEdit').onclick = async () => {
    const x = SONGS.find(s => s.id === sel); if (!x) return; const ed = $('lsEd');
    if (!ed.hidden) { ed.hidden = true; return; }
    $('lsTa').value = typed(x.id); ed.hidden = false; $('lsTa').focus();
  };
  $('lsFromPdf').onclick = async () => { const x = SONGS.find(s => s.id === sel); if (!x) return; try { const r = await fromPdf(x); if (r) $('lsTa').value = r.filter(o => o.words && !o.mel).map(o => o.t).join('\n'); } catch (e) {} };
  $('lsWeb').onclick = () => { const x = SONGS.find(s => s.id === sel); if (!x) return; const comp = (x.credit || '').split(/[·(]/)[0].trim(); const q = 'letra ' + x.title + (comp ? ' ' + comp : ''); window.open('https://www.google.com/search?q=' + encodeURIComponent(q), '_blank', 'noopener'); };
  $('lsSave').onclick = () => { const x = SONGS.find(s => s.id === sel); if (!x) return; const v = $('lsTa').value.trim(); try { if (v) localStorage.setItem(keyOf(x.id), v); else localStorage.removeItem(keyOf(x.id)); } catch (e) {} render(); };
  $('lsClear').onclick = () => { const x = SONGS.find(s => s.id === sel); if (!x) return; try { localStorage.removeItem(keyOf(x.id)); } catch (e) {} render(); };
  $('lsOpen').onclick = () => { const x = SONGS.find(s => s.id === sel); if (!x) return; if (PACK && x.id === PACK.id) { show('ouvir'); return; } try { localStorage.setItem('coral-cur', x.id); location.hash = 'ouvir'; } catch (e) {} location.reload(); };
  // frases da música para o Ouvir: letra da partitura (corrigida pelo texto colado, se houver); sem PDF, só as notas
  async function lines(x) {
    let r = null; try { r = await fromPdf(x); } catch (e) {}
    const t = typed(x.id); if (r && t) r = alignTyped(r, t).r;
    if (!r) { const ls = JSON.parse(JSON.stringify(x.full.lines.map(l => l.ev))); r = buildLines(ls, x.full.blocks || [], false); r.noLyrics = true; }
    return r;
  }
  return { lines, open() { if (!sel) sel = PACK ? PACK.id : (SONGS[0] && SONGS[0].id); chips(); render(); } };
})();

// grava a sua voz (pedaços do microfone) num arquivo WAV para ouvir de novo
function toWav(chunks, sr, startSec) {
  let n = 0; chunks.forEach(c => n += c.length); const all = new Float32Array(n); let o = 0; chunks.forEach(c => { all.set(c, o); o += c.length; });
  const x = all.subarray(Math.min(all.length, Math.floor(startSec * sr))); let pk = 0; for (let k = 0; k < x.length; k++) pk = Math.max(pk, Math.abs(x[k]));
  const g = pk > 0.01 ? Math.min(8, 0.9 / pk) : 1, buf = new ArrayBuffer(44 + x.length * 2), v = new DataView(buf);
  const w = (p0, str) => { for (let k = 0; k < str.length; k++) v.setUint8(p0 + k, str.charCodeAt(k)); };
  w(0, 'RIFF'); v.setUint32(4, 36 + x.length * 2, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, x.length * 2, true);
  for (let k = 0; k < x.length; k++) v.setInt16(44 + k * 2, Math.max(-1, Math.min(1, x[k] * g)) * 32767, true);
  return new Blob([buf], { type: 'audio/wav' });
}
/* ================= OUVIR: frase por frase, com setas (altura) e barras (tempo) ================= */
const Ouvir = (() => {
  let L = [], i = 0, run = 0, raf = 0, cells = [], loaded = false, noLyr = false, spd = 'treino', take = null;
  const mine = new Audio(); mine.preload = 'auto';
  // andamento real da música, tirado do áudio do professor (batidas por minuto)
  const REAL = (() => { try { const mp = PACK && PACK.prof && PACK.prof.map; if (!mp || mp.length < 3) return null; const sl = [];
    for (let k = 1; k < mp.length; k++) { const dt = mp[k][0] - mp[k - 1][0], db = mp[k][1] - mp[k - 1][1]; if (dt > 0.05 && db > 0) sl.push(db / dt * 60); }
    sl.sort((a, b) => a - b); const v = sl[sl.length >> 1]; return v > 40 && v < 260 ? Math.round(v) : null; } catch (e) { return null; } })();
  const tgt = () => spd === 'devagar' ? 48 : spd === 'treino' || !REAL ? 60 : Math.round(REAL * { p70: 0.7, p85: 0.85, p100: 1 }[spd]);
  // progresso: frases que você já cantou certinho (notas e entrada)
  const keyP = () => 'coral-prog:' + (PACK ? PACK.id : '');
  const prog = () => { try { return new Set(JSON.parse(localStorage.getItem(keyP()) || '[]')); } catch (e) { return new Set(); } };
  const saveProg = st => { try { localStorage.setItem(keyP(), JSON.stringify([...st])); } catch (e) {} };
  function paintProg() {
    const st = prog(), n = L.filter(o => st.has(o.li)).length, o = L[i];
    $('oProg').textContent = 'Dominadas: ' + n + ' de ' + L.length + ' frases' + (o && st.has(o.li) ? ' · esta frase você já domina ✓' : '');
    $('oProgBar').style.width = (L.length ? n / L.length * 100 : 0) + '%';
    $('oTodo').hidden = n === L.length || !L.length;
  }
  const keyI = () => 'coral-ouvir:' + (PACK ? PACK.id : '');
  const arrow = d => d >= 3 ? ['up2', '⇈'] : d > 0 ? ['up', '↑'] : d <= -3 ? ['dn2', '⇊'] : d < 0 ? ['dn', '↓'] : ['eq', '='];
  async function load() {
    if (!PACK) { $('oBox').innerHTML = '<p class="msg">Importe as músicas primeiro (Mais › Diário).</p>'; return; }
    $('oSay').textContent = 'Preparando as frases…';
    const r = await Letras.lines(PACK); noLyr = !!r.noLyrics; L = []; let part = '';
    r.forEach(o => { if (o.h) { part = o.h; return; } L.push(Object.assign({ part }, o)); });
    try { i = Math.min(L.length - 1, Math.max(0, +localStorage.getItem(keyI()) || 0)); } catch (e) { i = 0; }
    loaded = true; $('oNoLyr').hidden = !noLyr; render();
  }
  function render() {
    stop(); const o = L[i]; if (!o) return; $('oBox').scrollLeft = 0; $('oRes').textContent = '';
    try { localStorage.setItem(keyI(), i); } catch (e) {}
    $('oPart').textContent = o.part || ''; $('oNum').textContent = 'Frase ' + (i + 1) + ' de ' + L.length; paintProg(); take = null; $('oMine').hidden = true;
    $('oPrev').disabled = i === 0; $('oNext').disabled = i >= L.length - 1;
    const box = $('oBox'); box.innerHTML = ''; cells = [];
    const syl = []; o.words.forEach((w, wi) => w.forEach((sy, k) => syl.push({ sy, hy: k < w.length - 1 })));
    const total = Math.max(1, o.b1 - o.b0), avail = Math.max(240, (box.clientWidth || 340) - 12);
    const unit = Math.max(46, Math.min(80, avail / total));   // pixels por tempo (frase longa: a linha rola para o lado)
    const row = document.createElement('div'); row.className = 'orow'; let prevEnd = o.b0;
    // escadinha: quanto mais aguda a nota, mais alto a sílaba aparece (igual a uma escada que sobe e desce)
    const ms = syl.flatMap(x => x.sy.ms), hi = Math.max(...ms), lo = Math.min(...ms), span = Math.max(hi - lo, 4), H = 64;
    syl.forEach(({ sy, hy }) => {
      sy.nb.forEach((n, j) => {
        const b = n.b, end = n.b + n.d, last = j === sy.nb.length - 1;
        if (b - prevEnd > 0.05) { const g = document.createElement('div'); g.className = 'orest'; g.style.width = Math.round((b - prevEnd) * unit) + 'px'; g.innerHTML = '<span>pausa</span>'; row.appendChild(g); }
        prevEnd = end;
        const c = document.createElement('button'); c.type = 'button'; c.className = 'ocell' + (j ? ' oext' : '') + (!last ? ' ocont' : ''); c.style.minWidth = Math.round(n.d * unit) + 'px';
        c.style.paddingTop = Math.round((hi - n.m) / span * H) + 'px';
        const tx = document.createElement('span'); tx.className = 'otx';
        tx.textContent = j === 0 ? sy.t + (hy && last ? '-' : '') : vowelOf(sy.t) + (hy && last ? '-' : '');
        const bar = document.createElement('span'); bar.className = 'obar'; bar.style.width = Math.max(8, Math.round(n.d * unit) - 4) + 'px';
        const seg = document.createElement('i'); seg.style.flex = '1 1 0'; bar.appendChild(seg);
        const fill = document.createElement('em'); bar.appendChild(fill);
        c.append(tx, bar);
        c.onclick = () => playNote(n.m);
        row.appendChild(c); cells.push({ el: c, fill, b, end });
      });
    });
    box.appendChild(row);
    const first = syl[0] && syl[0].sy.nb[0].b, lead = first - o.b0;
    $('oSay').textContent = 'Comece pelo 1. Toque numa sílaba para ouvir a nota dela.';
  }
  function paint(beat) {
    cells.forEach(c => { const on = beat >= c.b && beat < c.end; if (on && !c.el.classList.contains('on')) { const bx = $('oBox'); if (c.el.offsetLeft + c.el.offsetWidth > bx.scrollLeft + bx.clientWidth - 20 || c.el.offsetLeft < bx.scrollLeft) bx.scrollTo({ left: Math.max(0, c.el.offsetLeft - 30), behavior: reduce ? 'auto' : 'smooth' }); } c.el.classList.toggle('on', on); c.el.classList.toggle('done', beat >= c.end); c.fill.style.width = (beat <= c.b ? 0 : Math.min(100, (beat - c.b) / (c.end - c.b) * 100)) + '%'; });
  }
  function stop() { run++; cancelAnimationFrame(raf); try { mine.pause(); } catch (e) {} if (A.owner === 'ouvir') stopMain(); if (Mic.rec && !micBusyElsewhere('ouvir')) { Mic.rec = null; } if (Mic.on && !micBusyElsewhere('ouvir')) Mic.stop(); try { A.main.playbackRate = 1; } catch (e) {} cells.forEach(c => { c.el.classList.remove('on', 'done'); c.fill.style.width = '0%'; }); $('oGo').textContent = '2 · Ouvir a frase'; $('oYou').textContent = '3 · Agora eu canto'; $('oStep').textContent = '1 · Notas uma a uma'; stopNotes(); $('oSay').classList.remove('you'); }
  function listen() {
    const o = L[i]; if (!o) return; stopAll(); const T = tgt(), bp = T > 70 && FULL.a[80] ? 80 : 60, my = ++run, rate = T / bp, b0 = o.b0 - 0.5, b1 = o.b1 + 0.2;
    $('oGo').textContent = '■ Parar'; $('oSay').textContent = 'Ouça… (' + T + ' batidas por minuto)';
    playMain(FULL.a[bp], Math.max(0, (4 + b0) * (60 / bp) + offS()), 'ouvir', null);
    try { A.main.playbackRate = rate; A.main.preservesPitch = true; A.main.webkitPreservesPitch = true; } catch (e) {}
    const t = () => { if (my !== run) return; const beat = (A.main.currentTime - offS()) / (60 / bp) - 4; paint(beat); if (beat >= b1) { A.main.pause(); $('oGo').textContent = '2 · Ouvir de novo'; $('oSay').textContent = 'Agora é a sua vez: toque em 3.'; return; } raf = requestAnimationFrame(t); }; t();
  }
  function clearGrade() { cells.forEach(c => { c.el.classList.remove('g-ok', 'g-near', 'g-high', 'g-low', 'g-none', 'g-oct'); const lb = c.el.querySelector('.olab'); if (lb) lb.remove(); }); $('oRes').textContent = ''; }
  async function you() {
    const o = L[i]; if (!o) return; stopAll(); clearGrade(); take = null; $('oMine').hidden = true; const my = ++run, spb = 60 / tgt();
    $('oYou').textContent = '■ Parar';
    playNote(o.words[0][0].ms[0], true);   // nota de entrada (antes de ligar o microfone, para sair no alto-falante)
    $('oSay').textContent = 'Nota de entrada…'; await new Promise(r => setTimeout(r, 1300)); if (my !== run) return;
    let useMic = $('oMic').checked;
    if (useMic) { try { await Mic.start(); } catch (err) { if (my !== run) return; useMic = false; $('oRes').textContent = micError(err); } }
    if (my !== run) { if (!micBusyElsewhere('ouvir')) Mic.stop(); return; }
    // contagem de 4 no tempo da música: a 1ª sílaba entra logo depois do "4"
    // 4 bips de contagem + 1 bip agudo exatamente na entrada: "cante junto com o bip agudo"
    beeps(60 / spb, 5); cells[0] && cells[0].el.classList.add('go');
    for (const c of ['1', '2', '3', '4']) { if (my !== run) return; if (c === '3' && useMic) Mic.rec = []; $('oSay').textContent = c + (c === '4' ? ' … no próximo bip agudo: cante!' : ''); await new Promise(r => setTimeout(r, spb * 1000)); }
    if (my !== run) return; cells[0] && cells[0].el.classList.remove('go');
    $('oSay').textContent = 'AGORA — cante e siga a barra'; $('oSay').classList.add('you');
    const t0 = performance.now(), b0 = o.b0, b1 = o.b1 + (useMic ? 0.6 : 0.3), PRE = 2;
    await new Promise(res => { const t = () => { if (my !== run) return res(); const beat = b0 + (performance.now() - t0) / 1000 / spb; paint(beat); if (beat >= b1) return res(); raf = requestAnimationFrame(t); }; t(); });
    if (my !== run) return;
    $('oSay').classList.remove('you'); cells.forEach(c => { c.el.classList.remove('on', 'done'); c.fill.style.width = '0%'; });
    if (useMic) {
      const chunks = Mic.rec || []; Mic.rec = null; const sr = Mic.ctx ? Mic.ctx.sampleRate : 48000; if (!micBusyElsewhere('ouvir')) Mic.stop();
      $('oSay').textContent = 'Conferindo…';
      try { take = URL.createObjectURL(toWav(chunks, sr, Math.max(0, (PRE - 0.4) * spb))); $('oMine').hidden = false; } catch (e) { take = null; }
      try {
        const syl = []; o.words.forEach(w => w.forEach(sy => syl.push(sy)));
        const notes = [], own = []; syl.forEach((sy, k) => sy.nb.forEach(n => { notes.push({ m: n.m - 12, b: n.b - b0, d: n.d }); own.push(k); }));
        const x = await AN.pcmToMono16k(chunks, sr), tr = await AN.track(x);
        // entrada: quando a voz começou (independe de a nota estar certa); a gravação começou PRE tempos antes da 1ª nota
        const exp = PRE * spb, on = AN.onset(tr, exp - 1.2 * spb, exp + 1.5 * spb);
        const hint = (on != null ? on : exp) - 4 * spb;
        const g = AN.grade(tr, notes, spb, hint, on != null ? 0.15 : 0.6); if (my !== run) return;
        // cor de cada casinha = resultado daquela nota
        const st = g.per.map(pp => pp.status);
        // Tenor cantando uma oitava acima (ou abaixo) da parte: é erro, mesmo que a "nota" pareça a mesma
        const octOff = g.heard >= notes.length * 0.3 ? g.oct : 0;
        const LAB = { ok: 'certo', near: 'quase', high: 'alto', low: 'baixo', none: 'não ouvi', oct: 'oitava' };
        cells.forEach((c, k) => { const s2 = octOff && (st[k] === 'ok' || st[k] === 'near') ? 'oct' : (g.per[k] && g.per[k].octJump ? 'oct' : st[k]); c.el.classList.add('g-' + s2); let lb = c.el.querySelector('.olab'); if (!lb) { lb = document.createElement('span'); lb.className = 'olab'; c.el.appendChild(lb); } lb.textContent = LAB[s2] || ''; });
        const lateMs = on != null ? Math.round((on - exp) * 1000) : 0, low = g.per.filter(pp => pp.status === 'low').length, high = g.per.filter(pp => pp.status === 'high').length;
        let msg;
        if (g.heard < notes.length * 0.3) msg = 'Não ouvi bem sua voz. Cante um pouco mais forte ou mais perto do iPhone.';
        else {
          msg = 'Acertou ' + g.good + ' de ' + g.total + ' notas.';
          msg += on == null ? ' Não consegui medir a entrada.' : lateMs > 180 ? ' Você entrou atrasado: comece junto com o bip agudo.' : lateMs < -180 ? ' Você entrou cedo: espere o bip agudo.' : ' Entrada na hora certa.';
          if (low > high && low) msg += ' Notas em azul ficaram baixas: pense em “subir”.';
          else if (high > low && high) msg += ' Notas em vermelho ficaram altas: pense em “descer”.';
          if (g.per.some(pp => pp.octJump)) msg += ' Alguma nota saiu numa altura bem diferente (uma oitava): ouça de novo “Uma nota por vez”.';
          if (g.good === g.total && Math.abs(lateMs) <= 180 && !octOff) { msg = 'Perfeito! Notas e entrada certas. Frase marcada como dominada. Pode ir para a próxima.'; const stp = prog(); stp.add(o.li); saveProg(stp); paintProg(); }
          if (octOff > 0) msg = 'Você cantou uma OITAVA ACIMA da sua parte (roxo). A melodia está certa, mas a voz foi para cima demais. O tenor canta mais grave: desça a voz até ela ficar parecida com o som do app, mais “grossa”, sem esforço. Treine em Aquecer › Achar a nota.';
          else if (octOff < 0) msg = 'Você cantou uma OITAVA ABAIXO da sua parte (roxo). Suba a voz até ela ficar igual ao som do app.';
        }
        $('oRes').textContent = msg + ' (O app mede só a altura e a entrada; técnica e respiração, confira com o professor.)'; $('oSay').textContent = 'Embaixo de cada nota está escrito como ficou.';
      } catch (e) { $('oRes').textContent = 'Não consegui conferir desta vez.'; $('oSay').textContent = ''; }
    } else { $('oSay').textContent = 'Muito bem! Repita ou vá para a próxima frase.'; }
    $('oYou').textContent = '3 · Cantar de novo';
  }
  // uma nota por vez, devagar, dizendo se sobe, desce ou fica: para ouvir e entender a altura de cada sílaba
  async function steps() {
    const o = L[i]; if (!o) return; stopAll(); const my = ++run, gap = tgt() <= 50 ? 1400 : 1000;
    $('oStep').textContent = '■ Parar';
    const syl = []; o.words.forEach(w => w.forEach(sy => syl.push(sy)));
    let ci = 0;
    for (let k = 0; k < syl.length; k++) {
      const sy = syl[k];
      for (let j = 0; j < sy.ms.length; j++, ci++) {
        if (my !== run) return;
        const d = sy.mv[j], c = cells[ci]; cells.forEach(x => x.el.classList.remove('on')); c && c.el.classList.add('on');
        const word = j === 0 ? sy.t : vowelOf(sy.t) + ' (continua “' + sy.t + '”)';
        $('oSay').textContent = '“' + word + '” · ' + (k === 0 && j === 0 ? 'primeira nota' : d >= 3 ? 'sobe bastante' : d > 0 ? 'sobe' : d <= -3 ? 'desce bastante' : d < 0 ? 'desce' : 'mesma nota');
        noteNow(sy.ms[j]); await new Promise(r => setTimeout(r, gap));
        c && c.el.classList.add('done');
      }
    }
    if (my !== run) return; cells.forEach(x => x.el.classList.remove('on', 'done'));
    $('oStep').textContent = '1 · Notas uma a uma'; $('oSay').textContent = 'Agora ouça a frase inteira, no ritmo.';
  }
  stoppers.add(stop);
  $('oStep').onclick = () => { if ($('oStep').textContent.startsWith('■')) { stop(); return; } steps(); };
  $('oGo').onclick = () => { if ($('oGo').textContent.startsWith('■')) { stop(); return; } listen(); };
  $('oYou').onclick = () => { if ($('oYou').textContent.startsWith('■')) { stop(); return; } you(); };
  $('oPrev').onclick = () => { if (i > 0) { i--; render(); } };
  $('oNext').onclick = () => { if (i < L.length - 1) { i++; render(); } };
  // velocidades: Bem devagar · Treino (60) · 70% · 85% · 100% do andamento real
  if (!REAL) $('oSpd').querySelectorAll('[data-s^="p"]').forEach(b => b.hidden = true);
  const capSpd = () => { $('oSpdCap').textContent = REAL ? 'Andamento real desta música: ' + REAL + ' batidas por minuto. Agora: ' + tgt() + '.' : 'Agora: ' + tgt() + ' batidas por minuto.'; };
  $('oSpd').querySelectorAll('button').forEach(b => b.onclick = () => { stop(); spd = b.dataset.s; $('oSpd').querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', x === b)); capSpd(); });
  capSpd();
  $('oMine').onclick = () => {
    if (!take) return; stop(); const my = ++run;
    $('oSay').textContent = 'Você cantou assim…'; mine.src = take; mine.currentTime = 0; const pp = mine.play(); pp && pp.catch(() => {});
    mine.onended = () => { if (my !== run) return; $('oSay').textContent = 'Agora o som certo…'; setTimeout(() => { if (my === run) listen(); }, 500); };
  };
  $('oTodo').onclick = () => { const st = prog(); let k = L.findIndex((o, j) => j > i && !st.has(o.li)); if (k < 0) k = L.findIndex(o => !st.has(o.li)); if (k >= 0) { i = k; render(); } };
  $('oProgReset').onclick = () => { if ($('oProgReset').dataset.ok) { saveProg(new Set()); paintProg(); $('oProgReset').textContent = 'Zerar progresso'; delete $('oProgReset').dataset.ok; } else { $('oProgReset').dataset.ok = 1; $('oProgReset').textContent = 'Toque de novo para zerar'; } };
  $('oMic').onchange = e => { try { localStorage.setItem('coral-omic', e.target.checked ? '1' : '0'); } catch (x) {} };
  try { $('oMic').checked = localStorage.getItem('coral-omic') !== '0'; } catch (x) {}
  $('oLetra').onclick = () => show('musicas');
  if ($('oSong')) {
    const sel = $('oSong'); sel.innerHTML = ''; [...SONGS].sort((a, b) => a.title.localeCompare(b.title)).forEach(x => { const op = document.createElement('option'); op.value = x.id; op.textContent = x.title; op.selected = PACK && x.id === PACK.id; sel.appendChild(op); });
    sel.onchange = () => { try { localStorage.setItem('coral-cur', sel.value); } catch (e) {} location.hash = '#ouvir'; location.reload(); };
  }
  return { open() { if (!loaded) load(); else render(); }, stop };
})();

/* ================= MINI-AULAS ================= */
const det = new Audio(); det.preload = 'auto'; try { det.preservesPitch = false; det.webkitPreservesPitch = false; det.mozPreservesPitch = false; } catch (e) {}
function playDetuned(m, rate) { stopAll(); const path = NOTES[m].a; load(path).then(u => { det.src = u; det.playbackRate = rate; det.currentTime = 0; const p = det.play(); p && p.catch(() => {}); }); }
let beepCtx = null;
function beeps(bpmx, n) { try { beepCtx = beepCtx || new (window.AudioContext || window.webkitAudioContext)(); const t0 = beepCtx.currentTime + 0.1; for (let i = 0; i < n; i++) { const o = beepCtx.createOscillator(), g = beepCtx.createGain(); o.frequency.value = i % 4 === 0 ? 1500 : 1000; g.gain.setValueAtTime(0.3, t0 + i * 60 / bpmx); g.gain.exponentialRampToValueAtTime(0.001, t0 + i * 60 / bpmx + 0.06); o.connect(g); g.connect(beepCtx.destination); o.start(t0 + i * 60 / bpmx); o.stop(t0 + i * 60 / bpmx + 0.07); } } catch (e) {} }
const LESSONS = [
  { id: 'grave', t: 'Grave e agudo', p: ['Som grave é o som “grosso”, de baixo. Som agudo é o som “fino”, de cima.', 'Na música, “subir” é ir para o agudo e “descer” é ir para o grave. Quando o app diz “mais agudo”, suba a voz.'], ex: [['Ouvir um som grave', () => playNote(57)], ['Ouvir um som agudo', () => playNote(69)], ['Grave → agudo', () => playSeq([57, 62, 66, 69], 600)]] },
  { id: 'afinar', t: 'O que é afinar', p: ['Afinar é cantar exatamente a mesma altura do som de referência.', '“Semitonar” é ficar um pouquinho abaixo ou acima. Ouça a diferença: primeiro certo, depois um pouco baixo.'], ex: [['Nota certa', () => playNote(62)], ['A mesma nota, um pouco baixa', () => playDetuned(62, 0.971)], ['Um pouco alta', () => playDetuned(62, 1.03)]] },
  { id: 'oitava', t: 'Oitava', p: ['A mesma nota pode ser cantada mais grave ou mais aguda: isso é uma “oitava”.', 'Homens costumam cantar uma oitava abaixo das mulheres. Por isso o app às vezes diz “você cantou uma oitava acima”.'], ex: [['Lá grave', () => playNote(57)], ['O mesmo Lá, uma oitava acima', () => playNote(69)]] },
  { id: 'tempo', t: 'Tempo e contagem', p: ['A música tem uma “batida” constante, como um relógio. A contagem 1, 2, 3, 4 serve para todos entrarem juntos.', 'Antes de cantar, o app faz 4 cliques: na hora do próximo “1”, você começa.'], ex: [['Contagem devagar', () => beeps(60, 8)], ['Contagem mais rápida', () => beeps(96, 8)]] },
  { id: 'respirar', t: 'Respirar para cantar', p: ['Inspire sem levantar os ombros, deixando as costelas de baixo se abrirem. Não force.', 'Solte o ar devagar enquanto canta. Os lugares de respirar na música quem indica é o professor.'], ex: [['Fazer a respiração guiada', () => { goTo('aquecer', $('breathCard')); startBreath(); }]] },
  { id: 'fone', t: 'Fone e microfone', p: ['Use fone de ouvido quando o app for te ouvir (jogo, eco com microfone e gravação). Sem fone, o som do app entra no microfone e confunde a análise.', 'Cante perto do celular, num lugar sem barulho.'], ex: [] },
  { id: 'partitura', t: 'Como seguir a partitura no app', p: ['Você não precisa ler as notas. Olhe só a linha de palavras embaixo da pauta.', 'O quadrado vermelho mostra onde a música está. Siga o quadrado e cante as palavras que estão embaixo dele.'], ex: [] }
];
LESSONS.forEach(L => {
  const c = document.createElement('section'); c.className = 'panel lesson'; c.id = 'lesson-' + L.id;
  const h = document.createElement('h3'); h.textContent = L.t; c.appendChild(h);
  L.p.forEach(t => { const p = document.createElement('p'); p.textContent = t; c.appendChild(p); });
  if (L.ex.length) { const row = document.createElement('div'); row.className = 'row'; L.ex.forEach(([t, fn]) => { const b = document.createElement('button'); b.className = 'btn'; b.textContent = '🔊 ' + t; b.onclick = () => { fn(); Day.mark('aula'); }; row.appendChild(b); }); c.appendChild(row); }
  $('lessons').appendChild(c);
});

/* ================= início ================= */
const standalone = navigator.standalone || matchMedia('(display-mode: standalone)').matches;
$('install').hidden = standalone;
rSet(); drawRange(); renderDiary();
{ const h = (location.hash || '').slice(1); let aq = ''; try { aq = localStorage.getItem('coral-aq'); } catch (e) {}
  show(h && (PACK || !['ensaio', 'eco', 'ouvir'].includes(h)) ? h : !PACK ? 'diario' : aq === cycleKey() ? 'ouvir' : 'aquecer'); }
addEventListener('resize', () => fit());
// segundo plano / tela bloqueada / troca de app: para som, gravação e microfone
function stopEverything() { stopAll(); try { if (AF.on) afStop(); } catch (e) {} try { gameStop(); } catch (e) {} try { tunerOff(); } catch (e) {} try { rMicOff(); } catch (e) {} Mic.stop(); }
document.addEventListener('visibilitychange', () => { if (document.hidden) stopEverything(); });
window.addEventListener('pagehide', stopEverything);
// acesso só para os testes automáticos (abrir o app com ?teste)
if (/[?&]teste\b/.test(location.search)) window.__coral = { G, E, Mic, Store, gRange, A, Ouvir, get view() { return view; } };
})();
