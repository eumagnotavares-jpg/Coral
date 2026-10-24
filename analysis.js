// ===== Análise de voz: YIN, alinhamento automático, afinação e ritmo =====
const AN = (() => {
  const SR = 16000, WIN = 1024, HOP = 320, MINF = 65, MAXF = 700;
  const fps = SR / HOP;

  // YIN em um quadro qualquer (para o afinador ao vivo). Devolve {m: midi float | NaN, c: confiança 0..1}
  function yinFrame(x, sr, start, len) {
    const tauMin = Math.floor(sr / MAXF), tauMax = Math.min(Math.ceil(sr / MINF), Math.floor(len / 2));
    const W = len - tauMax; if (W < 64) return { m: NaN, c: 0 };
    let e = 0; for (let j = 0; j < len; j++) e += x[start + j] * x[start + j];
    if (e / len < 1.5e-5) return { m: NaN, c: 0 };
    const d = new Float32Array(tauMax + 2);
    for (let tau = 1; tau <= tauMax + 1; tau++) { let s = 0; for (let j = 0; j < W; j++) { const v = x[start + j] - x[start + j + tau]; s += v * v; } d[tau] = s; }
    let run = 0; d[0] = 1;
    for (let t = 1; t <= tauMax + 1; t++) { run += d[t]; d[t] = d[t] * t / (run || 1); }
    let tau = -1;
    for (let t = tauMin; t < tauMax; t++) { if (d[t] < 0.15) { while (t + 1 < tauMax && d[t + 1] < d[t]) t++; tau = t; break; } }
    if (tau < 1) return { m: NaN, c: 0 };
    const a = d[tau - 1], b = d[tau], c = d[tau + 1], den = a - 2 * b + c;
    const tt = den ? tau + 0.5 * (a - c) / den : tau;
    return { m: 69 + 12 * Math.log2(sr / tt / 440), c: 1 - b };
  }

  // Limiares calibrados com testes sintéticos (silêncio, voz baixa, ruído, vazamento do fone) — ver testes/analysis.test.js
  const MIN_CONF = 0.86;     // confiança mínima do YIN por quadro (0,9 descartava voz real com ruído de ~11 dB SNR)
  const REL_ENERGY = 0.08;   // quadro com energia < 8% (≈ -22 dB) da voz mais forte da gravação é descartado (vazamento/ruído de fundo)
  async function track(x, onProgress, opt) {
    const minConf = opt && opt.minConf != null ? opt.minConf : MIN_CONF, rel = opt && opt.relEnergy != null ? opt.relEnergy : REL_ENERGY;
    const n = Math.max(0, Math.floor((x.length - WIN) / HOP)), out = new Float32Array(n), conf = new Float32Array(n), en = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const r = yinFrame(x, SR, i * HOP, WIN); out[i] = r.m; conf[i] = r.c;
      let e = 0; for (let j = 0; j < WIN; j += 2) e += x[i * HOP + j] * x[i * HOP + j]; en[i] = e / (WIN / 2);
      if (onProgress && i % 300 === 0) { onProgress(i / n); await new Promise(r => setTimeout(r)); }
    }
    // energia de referência: percentil 95 dos quadros com altura detectada
    const ve = []; for (let i = 0; i < n; i++) if (out[i] === out[i]) ve.push(en[i]);
    ve.sort((p, q) => p - q); const ref = ve.length ? ve[Math.floor(ve.length * 0.95)] : 0;
    let dropped = 0;
    for (let i = 0; i < n; i++) if (out[i] === out[i] && (conf[i] < minConf || en[i] < ref * rel)) { out[i] = NaN; dropped++; }
    out.conf = conf; out.dropped = dropped;
    return out;
  }
  function pcDist(a, b) { let d = ((a - b) % 12 + 12) % 12; return d > 6 ? 12 - d : d; }
  function median(a) { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }

  // notes: [{m: midi soando, b: início (tempos), d: duração (tempos)}]; spb = segundos por tempo; a música começa após 4 tempos de contagem
  function align(tr, notes, spb, hint, win) {
    const lead = 4 * spb, last = notes[notes.length - 1], songEnd = lead + (last.b + last.d) * spb, recLen = tr.length / fps;
    let lo = -lead, hi = Math.max(lo, recLen - songEnd * 0.6);
    if (hint != null) { const w = win != null ? win : 0.6; lo = hint - w; hi = hint + w; }
    let best = { score: -1, off: 0 };
    for (let off = lo; off <= hi + 1e-9; off += 0.02) {
      let sc = 0, cnt = 0;
      for (const nt of notes) {
        const a = off + lead + nt.b * spb, dur = nt.d * spb, f0 = Math.floor((a + dur * 0.2) * fps), f1 = Math.floor((a + dur * 0.8) * fps);
        for (let f = Math.max(0, f0); f <= Math.min(tr.length - 1, f1); f += 2) { cnt++; const v = tr[f]; if (v === v && pcDist(v, nt.m) < 0.75) sc++; }
      }
      const s = cnt ? sc / Math.sqrt(cnt) : 0;
      if (s > best.score) best = { score: s, off };
    }
    return best.off;
  }

  function grade(tr, notes, spb, hint, win) {
    const off = align(tr, notes, spb, hint, win), lead = 4 * spb;
    const per = notes.map(nt => {
      const a = off + lead + nt.b * spb, dur = nt.d * spb, f0 = Math.floor((a + dur * 0.25) * fps), f1 = Math.max(f0, Math.floor((a + dur * 0.8) * fps));
      const v = []; let tot = 0;
      for (let f = Math.max(0, f0); f <= Math.min(tr.length - 1, f1); f++) { tot++; if (tr[f] === tr[f]) v.push(tr[f]); }
      if (!tot || v.length < Math.max(2, tot * 0.35)) return { ok: false };
      return { ok: true, diff: median(v) - nt.m };
    });
    const oct = Math.round(median(per.filter(p => p.ok).map(p => p.diff / 12)) || 0);
    let n = 0, good = 0, near = 0, sum = 0;
    per.forEach(p => {
      if (!p.ok) { p.status = 'none'; return; }
      let c = (p.diff - 12 * oct) * 100;
      // Deslocamento de oitava da gravação INTEIRA é tolerado (oct acima). Uma nota isolada numa oitava diferente
      // das vizinhas NÃO conta como afinada: vira "alta"/"baixa" e fica marcada como salto de oitava (p.octJump).
      p.octJump = Math.abs(c) > 600;
      const cIn = p.octJump ? ((c % 1200) + 1800) % 1200 - 600 : c;   // desvio dentro da oitava (só informativo)
      p.cents = Math.round(cIn); n++; sum += cIn;
      const ac = Math.abs(cIn);
      p.status = p.octJump ? (c > 0 ? 'high' : 'low') : ac <= 35 ? 'ok' : ac <= 80 ? 'near' : (c > 0 ? 'high' : 'low');
      if (p.status === 'ok') good++; else if (p.status === 'near') near++;
    });
    // ---- ritmo: só nas notas que mudam de altura ou vêm depois de pausa (onde dá para ouvir a entrada)
    const tol = Math.max(0.09, Math.min(0.14, spb * 0.14));
    let rn = 0, rok = 0, rsum = 0;
    notes.forEach((nt, i) => {
      const p = per[i], prev = notes[i - 1];
      const measurable = !prev || Math.abs(prev.m - nt.m) >= 1 || prev.b + prev.d < nt.b - 0.01;
      p.rStatus = 'none'; if (!measurable) { p.rStatus = 'skip'; return; }
      const target = nt.m + 12 * oct, a = off + lead + nt.b * spb;
      const f0 = Math.max(1, Math.floor((a - 0.32) * fps)), f1 = Math.min(tr.length - 3, Math.floor((a + Math.min(0.45, nt.d * spb * 0.9)) * fps));
      const hit = f => { const v = tr[f]; return v === v && pcDist(v, target) < 0.8; };
      for (let f = f0; f <= f1; f++) {
        if (hit(f) && hit(f + 1) && hit(f + 2) && !hit(f - 1)) {
          const dt = f / fps - a; p.dt = Math.round(dt * 1000); rn++; rsum += dt;
          p.rStatus = Math.abs(dt) <= tol ? 'ok' : (dt < 0 ? 'early' : 'late'); if (p.rStatus === 'ok') rok++;
          break;
        }
      }
    });
    return { off, oct, per, heard: n, total: notes.length, good, near, mean: n ? Math.round(sum / n) : 0,
      rhythm: { measured: rn, ok: rok, meanMs: rn ? Math.round(rsum / rn * 1000) : 0, tolMs: Math.round(tol * 1000) } };
  }

  // Momento em que a voz começa (segundos): primeiro trecho de ~100 ms com altura estável (±1 semitom), entre from e to.
  // Não depende de a nota estar certa, então serve para medir a ENTRADA mesmo quando a afinação erra.
  function onset(tr, from, to) {
    const f0 = Math.max(0, Math.floor(from * fps)), f1 = Math.min(tr.length - 5, Math.floor(to * fps));
    for (let f = f0; f <= f1; f++) {
      let ok = true; for (let k = 0; k < 5; k++) { const v = tr[f + k]; if (v !== v || Math.abs(v - tr[f]) > 1) { ok = false; break; } }
      if (ok) return f / fps;
    }
    return null;
  }
  // reamostra qualquer AudioBuffer (ou Float32 + taxa) para mono 16 kHz
  async function toMono16k(buf) {
    const len = Math.ceil(buf.duration * SR), off = new OfflineAudioContext(1, Math.max(1, len), SR);
    const src = off.createBufferSource(); src.buffer = buf; src.connect(off.destination); src.start();
    const r = await off.startRendering(); return r.getChannelData(0);
  }
  async function decodeToMono16k(arrayBuf) {
    const AC = window.AudioContext || window.webkitAudioContext; const ac = new AC();
    const buf = await new Promise((res, rej) => { const p = ac.decodeAudioData(arrayBuf, res, rej); if (p && p.catch) p.catch(rej); });
    try { ac.close(); } catch (e) {}
    return toMono16k(buf);
  }
  async function pcmToMono16k(chunks, sr) {
    let n = 0; chunks.forEach(c => n += c.length);
    const all = new Float32Array(n); let o = 0; chunks.forEach(c => { all.set(c, o); o += c.length; });
    const buf = new AudioBuffer({ length: Math.max(1, n), numberOfChannels: 1, sampleRate: sr });
    buf.copyToChannel(all, 0);
    return toMono16k(buf);
  }
  return { track, grade, onset, yinFrame, decodeToMono16k, pcmToMono16k, SR };
})();
if (typeof module !== 'undefined') module.exports = AN;
