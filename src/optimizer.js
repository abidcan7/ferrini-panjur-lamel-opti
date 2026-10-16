/*
 * Panjur kesim optimizasyonu — çekirdek motor
 * -------------------------------------------
 * Model:
 *   - Bir "grup" bir demetle yapılan sıralı kesimlerdir. Demet, gruptaki en büyük
 *     adımın adediyle başlar (≤ maxBundle) ve her adımda yalnızca küçülür; böylece
 *     her adımda aktif çubukların kalan boyu aynıdır. Küçülürken kenara ayrılan
 *     çubuklar aynı boyda "artık demetleri" oluşturur.
 *   - Adım = (ölçü, adet, hangi pozlara kaç parça). Aynı ölçüdeki pozlar tek adımda
 *     kesilebilir (mergeSameLength); aynı poz aynı grupta birden çok adımda
 *     kesilebilir (multiStep).
 *   - Bir çubuğa sığma şartı: Σ(ölçü + testere payı) ≤ boy − emniyet.
 *   - KALANLAR: gruba girmeyen pozlar; grupların artık demetlerinden kesilir.
 *     Artık yetmezse eksik yeni çubukla (fallback grupları) karşılanır.
 * Amaç: wCut·kesim + wBar·çubuk + wChange·demet bozma (+ küçük fire cezası).
 *
 * Node ve tarayıcıda çalışır (UMD).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PanjurOpt = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const DEFAULTS = Object.freeze({
    L: 6500,          // çubuk boyu (mm)
    kerf: 4,          // testere payı (mm / kesim)
    safety: 5,        // emniyet payı (mm / çubuk)
    maxBundle: 50,    // tek seferde kesilebilecek en fazla parça
    wCut: 10,         // kesim ağırlığı
    wBar: 4,          // çubuk ağırlığı
    wChange: 1,       // demet bozma (çubuk kenara ayırma) ağırlığı
    wWaste: 0.0005,   // fire (mm) eşitlik bozucu
    wKalan: 3,        // KALANLAR'a düşen her poz için artık yönetimi cezası
    wFill: 3,         // kullanılmayan son kalanları az sayıda çubukta toplamaya yönlendirir (bin-packing sinyali)
    mergeSameLength: true, // aynı ölçüdeki pozları tek kesimde birleştir
    multiStep: true,       // aynı poz aynı grupta birden çok adımda kesilebilir
    allowSplit: false,     // bir pozun adedi farklı gruplara bölünebilir (deneysel)
    minSplit: 5,           // bölme açıksa bir parçanın en küçük adedi
    seed: 12345,
    T0: 5, T1: 0.3,        // tavlama sıcaklıkları
    pLNS: 0.004,           // yık-ve-yeniden-kur hamlesi olasılığı
    pElim: 0.02,           // yeniden paketleme (grup boşaltma) hamlesi olasılığı
  });

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const INFEASIBLE = Object.freeze({ feasible: false, cost: Infinity, steps: [], bars: 0, strokes: 0, changes: 0, remnants: [], perBar: Infinity, cands: [] });
  const EMPTY = Object.freeze({ feasible: true, cost: 0, steps: [], bars: 0, strokes: 0, changes: 0, remnants: [], perBar: 0, leftover: 0, n: 0, cands: [] });
  // evaluate() sığmayan bir durumda da bu şekli döndürür; böylece buildResult hiçbir alanı eksik bulmaz
  const NO_KALAN = Object.freeze({ plan: [], strokes: 0, changes: 0, deficit: [], usedMm: 0, fallback: null, cost: 0 });
  const INFEASIBLE_EVAL = Object.freeze({ cost: Infinity, bars: 0, strokes: 0, changes: 0, kp: NO_KALAN, groupBars: 0, groupStrokes: 0, groupChanges: 0, infeasible: true });

  // ---------------------------------------------------------------- grup derleyici

  function buildKeys(parts, P) {
    if (P.mergeSameLength) {
      const map = new Map();
      for (const p of parts) {
        let k = map.get(p.item.len);
        if (!k) { k = { len: p.item.len, pieces: 0, parts: [] }; map.set(p.item.len, k); }
        k.pieces += p.count; k.parts.push(p);
      }
      return [...map.values()];
    }
    return parts.map(p => ({ len: p.item.len, pieces: p.count, parts: [p] }));
  }

  function candidateBundles(keys, P) {
    const s = new Set([P.maxBundle]);
    for (const k of keys) {
      s.add(Math.min(k.pieces, P.maxBundle));
      for (let m = 2; m <= 6; m++) s.add(Math.ceil(k.pieces / m));
      for (const p of k.parts) s.add(Math.min(p.count, P.maxBundle));
    }
    return [...s].filter(n => n >= 1 && n <= P.maxBundle).sort((a, b) => b - a);
  }

  // Bir ölçü anahtarını demet boyu n için adımlara böler. Dönüş: alloc listesi
  // (her alloc = [{part, count}]) ya da null (bu n ile mümkün değil).
  function splitKey(k, n, P) {
    const m = Math.ceil(k.pieces / n);
    if (m === 1) return [k.parts.map(p => ({ part: p, count: p.count }))];
    const sorted = k.parts.slice().sort((a, b) => b.count - a.count || a.id - b.id);
    // 1) poz hizalı: hiçbir poz bölünmeden (FFD)
    const bins = [], sums = [];
    let ok = true;
    for (const p of sorted) {
      if (p.count > n) { ok = false; break; }
      let placed = false;
      for (let b = 0; b < bins.length; b++) {
        if (sums[b] + p.count <= n) { bins[b].push({ part: p, count: p.count }); sums[b] += p.count; placed = true; break; }
      }
      if (!placed) { bins.push([{ part: p, count: p.count }]); sums.push(p.count); }
    }
    if (ok && bins.length === m) return bins;
    if (!P.multiStep) return ok ? bins : null;
    // 2) dengeli bölme (pozlar gerekirse adımlar arasında bölünür)
    const base = Math.floor(k.pieces / m), extra = k.pieces % m;
    const allocs = [];
    let ii = 0, remC = sorted[0].count;
    for (let i = 0; i < m; i++) {
      let need = base + (i < extra ? 1 : 0);
      const alloc = [];
      while (need > 0) {
        const take = Math.min(need, remC);
        alloc.push({ part: sorted[ii], count: take });
        need -= take; remC -= take;
        if (remC === 0) { ii++; remC = ii < sorted.length ? sorted[ii].count : 0; }
      }
      allocs.push(alloc);
    }
    return allocs;
  }

  function compileWithN(keys, n, P, cap) {
    const steps = [];
    let perBar = 0;
    for (const k of keys) {
      const allocs = splitKey(k, n, P);
      if (!allocs) return null;
      perBar += allocs.length * (k.len + P.kerf);
      if (perBar > cap) return null;
      for (const alloc of allocs) {
        let c = 0;
        for (const a of alloc) c += a.count;
        steps.push({ len: k.len, n: c, alloc });
      }
    }
    if (!steps.length) return null;          // adedi 0 olan anahtar: adım üretilemez
    steps.sort((a, b) => b.n - a.n || b.len - a.len);
    const bars = steps[0].n;
    let changes = 0, used = 0;
    const remnants = [];
    for (let i = 0; i < steps.length; i++) {
      if (i > 0 && steps[i].n < steps[i - 1].n) {
        changes++;
        remnants.push({ count: steps[i - 1].n - steps[i].n, len: P.L - used, afterStep: i });
      }
      used += steps[i].len + P.kerf;
    }
    const leftover = P.L - used;
    remnants.push({ count: steps[steps.length - 1].n, len: leftover, afterStep: steps.length, final: true });
    const cost = P.wCut * steps.length + P.wBar * bars + P.wChange * changes;
    return { feasible: true, n, steps, bars, strokes: steps.length, changes, remnants, perBar, leftover, cost };
  }

  /** Poz kümesi için en iyi kesim planı. nPref verilirse yalnızca o demet boyu denenir. */
  function compileGroup(parts, P, nPref) {
    if (!parts.length) return EMPTY;
    const cap = P.L - P.safety;
    const keys = buildKeys(parts, P);
    let minPerBar = 0;
    for (const k of keys) minPerBar += k.len + P.kerf;
    if (minPerBar > cap) return INFEASIBLE;
    const cands = candidateBundles(keys, P);
    if (nPref) {
      const r = compileWithN(keys, nPref, P, cap);
      if (r) { r.cands = cands; return r; }
    }
    let best = null;
    for (const n of cands) {
      const r = compileWithN(keys, n, P, cap);
      if (r && (!best || r.cost < best.cost)) best = r;
    }
    if (!best) return INFEASIBLE;
    best.cands = cands;
    return best;
  }

  // ---------------------------------------------------------------- KALANLAR (artık) planlayıcı

  function insertSorted(queue, from, b) {
    let i = queue.length;
    while (i > from && bundleBefore(b, queue[i - 1])) i--;
    queue.splice(i, 0, b);
  }
  function bundleBefore(a, b) {
    return a.count > b.count || (a.count === b.count && a.len > b.len);
  }

  /**
   * KALANLAR parçalarını artık demetlerinden keser (deterministik, açgözlü).
   * pool: [{count, len, group, step}] — len fiziksel kalan boy.
   */
  function planKalan(parts, pool, P) {
    const res = { plan: [], strokes: 0, changes: 0, deficit: [], usedMm: 0, fallback: null, cost: 0 };
    if (!parts.length) return res;
    const dem = parts.map(p => ({ part: p, rem: p.count }))
      .sort((a, b) => b.part.item.len - a.part.item.len || a.part.id - b.part.id);
    let minLen = Infinity, totalRem = 0;
    for (const d of dem) { if (d.part.item.len < minLen) minLen = d.part.item.len; totalRem += d.rem; }
    const queue = [];
    for (const b of pool) {
      if (b.count > 0 && b.len - P.safety >= minLen + P.kerf) queue.push({ count: b.count, len: b.len, group: b.group, step: b.step });
    }
    queue.sort((a, b) => b.count - a.count || b.len - a.len || a.group - b.group || a.step - b.step);
    let qi = 0;
    while (qi < queue.length && totalRem > 0) {
      const b = queue[qi++];
      let n = b.count, cap = b.len - P.safety, used = 0;
      const bsteps = [];
      for (;;) {
        let best = null, bestFull = false;
        for (const d of dem) {
          if (d.rem <= 0) continue;
          if (d.part.item.len + P.kerf > cap) continue;
          const full = d.rem >= n;
          if (!best || (full && !bestFull)) { best = d; bestFull = full; if (full) break; }
        }
        if (!best) break;
        const take = Math.min(n, best.rem);
        if (take < n) {
          res.changes++;
          insertSorted(queue, qi, { count: n - take, len: b.len - used, group: b.group, step: b.step, derived: true });
        }
        bsteps.push({ len: best.part.item.len, n: take, part: best.part });
        res.strokes++;
        best.rem -= take; totalRem -= take; n = take;
        used += best.part.item.len + P.kerf; cap -= best.part.item.len + P.kerf;
        res.usedMm += take * best.part.item.len;
      }
      if (bsteps.length) res.plan.push({ bundle: b, steps: bsteps, leftoverCount: n, leftoverLen: b.len - used });
    }
    for (const d of dem) if (d.rem > 0) res.deficit.push({ id: d.part.id, item: d.part.item, count: d.rem, origin: d.part });
    res.cost = P.wCut * res.strokes + P.wChange * res.changes + (P.wKalan || 0) * parts.length;
    if (res.deficit.length) {
      res.fallback = fallbackGroups(res.deficit, P);
      res.cost += res.fallback.cost;
    }
    return res;
  }

  /** Artık yetmeyen parçalar için yeni çubuklarla açgözlü gruplama (FFD). */
  function fallbackGroups(parts, P) {
    const sorted = parts.slice().sort((a, b) => b.item.len - a.item.len || b.count - a.count);
    const groups = [];
    for (const p of sorted) {
      let best = null, bestDelta = Infinity;
      for (const g of groups) {
        const c = compileGroup(g.parts.concat(p), P, null);
        if (!c.feasible) continue;
        const delta = c.cost - g.comp.cost;
        if (delta < bestDelta) { bestDelta = delta; best = { g, c }; }
      }
      const alone = compileGroup([p], P, null);
      if (best && bestDelta <= alone.cost) { best.g.parts.push(p); best.g.comp = best.c; }
      else groups.push({ parts: [p], comp: alone, nPref: null });
    }
    let bars = 0, strokes = 0, changes = 0, cost = 0;
    for (const g of groups) { bars += g.comp.bars; strokes += g.comp.strokes; changes += g.comp.changes; cost += g.comp.cost; }
    return { groups, bars, strokes, changes, cost };
  }

  // ---------------------------------------------------------------- durum ve değerlendirme

  const KALAN = -1;

  class State {
    constructor(parts, P, rng) {
      this.P = P; this.rng = rng;
      this.parts = parts;                 // tüm parçalar (poz parçaları)
      this.groups = [];                   // {parts: [], nPref, comp}
      this.loc = new Map();               // part.id → grup indeksi | KALAN
      this.totalPieceMm = 0; this.minLen = Infinity;
      for (const p of parts) { this.totalPieceMm += p.count * p.item.len; if (p.item.len < this.minLen) this.minLen = p.item.len; }
      this.cost = Infinity; this.eval = null;
    }
    newGroupIndex() {
      for (let i = 0; i < this.groups.length; i++) if (this.groups[i].parts.length === 0) return i;
      this.groups.push({ parts: [], nPref: null, comp: EMPTY });
      return this.groups.length - 1;
    }
    kalanParts() {
      const out = [];
      for (const p of this.parts) if (this.loc.get(p.id) === KALAN) out.push(p);
      return out;
    }
    recompile(gi) {
      const g = this.groups[gi];
      if (g.parts.length === 0) { g.comp = EMPTY; g.nPref = null; return; }
      g.comp = compileGroup(g.parts, this.P, g.nPref);
      if (!g.comp.feasible && g.nPref) { g.nPref = null; g.comp = compileGroup(g.parts, this.P, null); }
    }
    evaluate() {
      const P = this.P;
      let cost = 0, bars = 0, strokes = 0, changes = 0;
      const pool = [];
      for (let gi = 0; gi < this.groups.length; gi++) {
        const g = this.groups[gi];
        if (g.parts.length === 0) continue;
        const c = g.comp;
        if (!c.feasible) return INFEASIBLE_EVAL;
        cost += c.cost; bars += c.bars; strokes += c.strokes; changes += c.changes;
        for (const r of c.remnants) if (r.count > 0 && r.len > 0) pool.push({ count: r.count, len: r.len, group: gi, step: r.afterStep });
      }
      const kp = planKalan(this.kalanParts(), pool, P);
      cost += kp.cost;
      if (P.wFill) {
        // KALANLAR'da kullanılmayan son kalanlar için doluluk ödülü (yalnızca gerçek hurda)
        const usedFinal = new Set();
        for (const e of kp.plan) usedFinal.add(e.bundle.group + ':' + e.bundle.step);
        for (let gi = 0; gi < this.groups.length; gi++) {
          const g = this.groups[gi];
          if (!g.parts.length) continue;
          const c = g.comp;
          if (usedFinal.has(gi + ':' + c.steps.length)) continue;
          const f = c.leftover / P.L;
          cost -= P.wFill * c.remnants[c.remnants.length - 1].count * f * f;
        }
      }
      const fbBars = kp.fallback ? kp.fallback.bars : 0;
      const fbStrokes = kp.fallback ? kp.fallback.strokes : 0;
      const fbChanges = kp.fallback ? kp.fallback.changes : 0;
      const material = (bars + fbBars) * P.L;
      cost += P.wWaste * (material - this.totalPieceMm);
      return { cost, bars: bars + fbBars, strokes: strokes + kp.strokes + fbStrokes, changes: changes + kp.changes + fbChanges, kp, groupBars: bars, groupStrokes: strokes, groupChanges: changes };
    }
    snapshot() {
      const s = { loc: new Map(this.loc), nPref: this.groups.map(g => g.nPref), cost: this.cost };
      if (this.P.allowSplit) s.parts = this.parts.map(p => ({ id: p.id, item: p.item, count: p.count }));
      return s;
    }
    checkConsistency(tag) {
      const seen = new Map();
      for (let gi = 0; gi < this.groups.length; gi++) {
        const g = this.groups[gi];
        for (const p of g.parts) {
          if (seen.has(p.id)) throw new Error(`${tag}: parça ${p.id} iki yerde (${seen.get(p.id)} ve ${gi})`);
          seen.set(p.id, gi);
          if (this.loc.get(p.id) !== gi) throw new Error(`${tag}: parça ${p.id} loc=${this.loc.get(p.id)} ama grupta ${gi}`);
        }
        if (g.parts.length && !g.comp.feasible) throw new Error(`${tag}: grup ${gi} dolu ama comp infeasible`);
        if (g.parts.length && g.comp.steps.length === 0) throw new Error(`${tag}: grup ${gi} dolu ama adım yok`);
        if (!g.parts.length && g.comp.steps.length) throw new Error(`${tag}: grup ${gi} boş ama adım var`);
      }
      for (const p of this.parts) {
        const l = this.loc.get(p.id);
        if (l === KALAN) { if (seen.has(p.id)) throw new Error(`${tag}: parça ${p.id} KALAN ama grupta`); }
        else if (!seen.has(p.id)) throw new Error(`${tag}: parça ${p.id} loc=${l} ama hiçbir grupta değil`);
      }
    }
    restore(s) {
      if (s.parts) this.parts = s.parts.map(p => ({ id: p.id, item: p.item, count: p.count }));
      for (const g of this.groups) { g.parts = []; }
      this.loc = new Map();
      for (const p of this.parts) {
        const gi = s.loc.get(p.id);
        this.loc.set(p.id, gi);
        if (gi !== KALAN) {
          while (this.groups.length <= gi) this.groups.push({ parts: [], nPref: null, comp: EMPTY });
          this.groups[gi].parts.push(p);
        }
      }
      for (let i = 0; i < this.groups.length; i++) { this.groups[i].nPref = s.nPref[i] || null; this.recompile(i); }
      this.eval = this.evaluate(); this.cost = this.eval.cost;
    }
  }

  // ---------------------------------------------------------------- kurucu sezgisel

  function constructInitial(state) {
    const P = state.P;
    const sorted = state.parts.slice().sort((a, b) => b.item.len - a.item.len || b.count - a.count || a.id - b.id);
    for (const p of sorted) {
      let best = null, bestDelta = Infinity;
      for (let gi = 0; gi < state.groups.length; gi++) {
        const g = state.groups[gi];
        if (g.parts.length === 0) continue;
        const c = compileGroup(g.parts.concat(p), P, null);
        if (!c.feasible) continue;
        const delta = c.cost - g.comp.cost;
        if (delta < bestDelta) { bestDelta = delta; best = { gi, c }; }
      }
      const alone = compileGroup([p], P, null);
      if (best && bestDelta <= alone.cost) {
        state.groups[best.gi].parts.push(p); state.groups[best.gi].comp = best.c; state.loc.set(p.id, best.gi);
      } else {
        const gi = state.newGroupIndex();
        state.groups[gi].parts.push(p); state.groups[gi].comp = alone; state.loc.set(p.id, gi);
      }
    }
    state.eval = state.evaluate(); state.cost = state.eval.cost;
  }

  // ---------------------------------------------------------------- tavlama benzetimi

  function removePart(state, p) {
    const gi = state.loc.get(p.id);
    if (gi === KALAN) return KALAN;
    const g = state.groups[gi];
    const ix = g.parts.indexOf(p);
    g.parts.splice(ix, 1);
    return gi;
  }
  function placePart(state, p, gi) {
    state.loc.set(p.id, gi);
    if (gi !== KALAN) state.groups[gi].parts.push(p);
  }

  // Bir parçanın bir gruba "sığma ihtimali" (hızlı ön eleme): ya boy kapasitesi var
  // ya da aynı ölçü zaten grupta (birleştirme adım eklemeyebilir).
  function plausible(state, g, p) {
    const P = state.P;
    if (g.parts.length === 0) return true;
    const c = g.comp;
    if (c.perBar + p.item.len + P.kerf <= P.L - P.safety) return true;
    if (P.mergeSameLength) for (const q of g.parts) if (q.item.len === p.item.len) return true;
    return false;
  }

  function pickTarget(state, p, from) {
    const rng = state.rng;
    const t = rng();
    if (t < 0.1) return KALAN;
    if (t < 0.17) return state.newGroupIndex();
    // sığabilecek gruplar arasından seç
    const cands = [];
    for (let i = 0; i < state.groups.length; i++) {
      if (i === from) continue;
      const g = state.groups[i];
      if (g.parts.length && plausible(state, g, p)) cands.push(i);
    }
    if (!cands.length) return KALAN;
    return cands[(rng() * cands.length) | 0];
  }

  // Yık-ve-yeniden-kur (LNS): birkaç grubu dağıt, parçaları açgözlü yeniden yerleştir.
  function greedyInsert(state, p) {
    const P = state.P;
    let best = -1, bestDelta = Infinity, bestComp = null;
    for (let gi = 0; gi < state.groups.length; gi++) {
      const g = state.groups[gi];
      if (!g.parts.length || !plausible(state, g, p)) continue;
      const c = compileGroup(g.parts.concat(p), P, null);
      if (!c.feasible) continue;
      const delta = c.cost - g.comp.cost;
      if (delta < bestDelta) { bestDelta = delta; best = gi; bestComp = c; }
    }
    const alone = compileGroup([p], P, null);
    if (best >= 0 && bestDelta <= alone.cost) {
      state.groups[best].parts.push(p); state.groups[best].comp = bestComp; state.groups[best].nPref = null; state.loc.set(p.id, best);
    } else {
      const gi = state.newGroupIndex();
      state.groups[gi].parts.push(p); state.groups[gi].comp = alone; state.groups[gi].nPref = null; state.loc.set(p.id, gi);
    }
  }

  function lnsIteration(state, T) {
    const rng = state.rng;
    const nonEmpty = [];
    for (let i = 0; i < state.groups.length; i++) if (state.groups[i].parts.length) nonEmpty.push(i);
    if (nonEmpty.length < 2) return false;
    const snap = state.snapshot();
    snap.comps = state.groups.map(g => g.comp);
    const k = 2 + ((rng() * 2) | 0);
    const chosen = new Set();
    if (rng() < 0.5) {
      // en pahalı (parça başına) grup
      let worst = -1, worstV = -1;
      for (const gi of nonEmpty) {
        const g = state.groups[gi];
        let pieces = 0; for (const p of g.parts) pieces += p.count;
        const v = g.comp.cost / pieces;
        if (v > worstV) { worstV = v; worst = gi; }
      }
      chosen.add(worst);
    }
    // küme en çok nonEmpty.length ayrı değer tutabilir; kıskaç olmazsa sonsuz döngü
    const kk = Math.min(k, nonEmpty.length);
    while (chosen.size < kk) chosen.add(nonEmpty[(rng() * nonEmpty.length) | 0]);
    const released = [];
    for (const gi of chosen) {
      const g = state.groups[gi];
      for (const p of g.parts) released.push(p);
      g.parts = []; g.comp = EMPTY; g.nPref = null;
    }
    if (rng() < 0.5) for (const p of state.kalanParts()) if (rng() < 0.5) released.push(p);
    if (rng() < 0.5) released.sort((a, b) => b.item.len - a.item.len || b.count - a.count);
    else for (let i = released.length - 1; i > 0; i--) { const j = (rng() * (i + 1)) | 0; const t = released[i]; released[i] = released[j]; released[j] = t; }
    for (const p of released) greedyInsert(state, p);
    const ev = state.evaluate();
    const delta = ev.cost - state.cost;
    if (delta <= 0 || rng() < Math.exp(-delta / T)) { state.cost = ev.cost; state.eval = ev; return true; }
    // geri al
    for (const g of state.groups) g.parts = [];
    for (const p of state.parts) {
      const gi = snap.loc.get(p.id); state.loc.set(p.id, gi);
      if (gi !== KALAN) state.groups[gi].parts.push(p);
    }
    for (let i = 0; i < state.groups.length; i++) { state.groups[i].nPref = snap.nPref[i] || null; state.groups[i].comp = i < snap.comps.length ? snap.comps[i] : EMPTY; }
    return false;
  }

  // Yeniden paketleme hamlesi: en çok boşluk bırakan k gruptan (biri en boşu) parçaları toplar,
  // rastgeleleştirilmiş FFD ile k−1 (olmazsa k) gruba yeniden yerleştirmeyi dener.
  function repackAttempt(state, pieces, limit, jitter) {
    const P = state.P, rng = state.rng;
    const order = pieces.slice().sort((a, b) => (b.item.len + rng() * jitter) - (a.item.len + rng() * jitter) || b.count - a.count);
    const bins = []; // {parts, comp}
    for (const p of order) {
      let best = -1, bestKey = Infinity, bestComp = null;
      for (let i = 0; i < bins.length; i++) {
        const b = bins[i];
        if (!plausible(state, { parts: b.parts, comp: b.comp }, p)) continue;
        const c = compileGroup(b.parts.concat(p), P, null);
        if (!c.feasible) continue;
        const key = (c.cost - b.comp.cost) * 1000 + c.leftover; // önce maliyet artışı, sonra kalan boy
        if (key < bestKey) { bestKey = key; best = i; bestComp = c; }
      }
      if (best >= 0) { bins[best].parts.push(p); bins[best].comp = bestComp; }
      else {
        if (bins.length >= limit) return null;
        bins.push({ parts: [p], comp: compileGroup([p], P, null) });
      }
    }
    return bins;
  }

  function repackIteration(state, T) {
    const rng = state.rng;
    const nonEmpty = [];
    for (let i = 0; i < state.groups.length; i++) if (state.groups[i].parts.length) nonEmpty.push(i);
    if (nonEmpty.length < 3) return false;
    // boşluk (son çubuklardaki kalan × adet + kenara ayrılan artıklar) / çubuk
    const slack = gi => { const c = state.groups[gi].comp; let s = 0; for (const r of c.remnants) s += r.count * r.len; return s / c.bars; };
    nonEmpty.sort((a, b) => slack(b) - slack(a));
    const k = 3 + ((rng() * 3) | 0);
    const top = nonEmpty.slice(0, Math.min(nonEmpty.length, 8));
    const chosen = new Set([top[0]]);
    while (chosen.size < Math.min(k, top.length)) chosen.add(top[(rng() * top.length) | 0]);
    const gis = [...chosen];
    const pieces = [];
    for (const gi of gis) for (const p of state.groups[gi].parts) pieces.push(p);
    let curCost = 0; for (const gi of gis) curCost += state.groups[gi].comp.cost;
    let best = null, bestCost = Infinity;
    const tries = 6;
    for (let t = 0; t < tries; t++) {
      const limit = t < tries - 1 ? gis.length - 1 : gis.length;
      const bins = repackAttempt(state, pieces, limit, t === 0 ? 0 : 400);
      if (!bins) continue;
      let c = 0; for (const b of bins) c += b.comp.cost;
      if (c < bestCost) { bestCost = c; best = bins; }
      if (bins.length < gis.length) break;
    }
    if (!best || bestCost > curCost + 1e-9) return false;
    // uygula
    const snap = state.snapshot();
    snap.comps = state.groups.map(x => x.comp);
    for (const gi of gis) { const g = state.groups[gi]; g.parts = []; g.comp = EMPTY; g.nPref = null; }
    best.forEach((b, i) => {
      const gi = i < gis.length ? gis[i] : state.newGroupIndex();
      const g = state.groups[gi];
      g.parts = b.parts; g.comp = b.comp; g.nPref = null;
      for (const p of b.parts) state.loc.set(p.id, gi);
    });
    const ev = state.evaluate();
    const delta = ev.cost - state.cost;
    if (delta <= 0 || rng() < Math.exp(-delta / T)) { state.cost = ev.cost; state.eval = ev; return true; }
    for (const x of state.groups) x.parts = [];
    for (const p of state.parts) {
      const li = snap.loc.get(p.id); state.loc.set(p.id, li);
      if (li !== KALAN) state.groups[li].parts.push(p);
    }
    for (let i = 0; i < state.groups.length; i++) { state.groups[i].nPref = snap.nPref[i] || null; state.groups[i].comp = i < snap.comps.length ? snap.comps[i] : EMPTY; }
    return false;
  }

  function saIteration(state, T) {
    const rng = state.rng, P = state.P;
    const r = rng();
    const parts = state.parts;
    if (parts.length < 2) return false;
    const touched = [];
    const saved = [];
    const remember = gi => { if (gi !== KALAN && !touched.includes(gi)) { touched.push(gi); saved.push({ gi, comp: state.groups[gi].comp, nPref: state.groups[gi].nPref }); } };
    let undo;
    const pSwap = P.allowSplit ? 0.35 : 0.38, pMove = 0.5;
    if (r < pMove) {
      // taşı
      const p = parts[(rng() * parts.length) | 0];
      const from = state.loc.get(p.id);
      const to = pickTarget(state, p, from);
      if (to === from) return false;
      remember(from); remember(to);
      removePart(state, p); placePart(state, p, to);
      undo = () => { removePart(state, p); placePart(state, p, from); };
    } else if (r < pMove + pSwap) {
      // değiştir: p ile, başka gruptaki q (boy farkı küçük olanlar tercih)
      const p = parts[(rng() * parts.length) | 0];
      const a = state.loc.get(p.id);
      let q = null;
      if (rng() < 0.7) {
        // benzer ölçülü aday
        const tol = 50 + ((rng() * 400) | 0);
        const cands = [];
        for (const x of parts) if (x !== p && state.loc.get(x.id) !== a && Math.abs(x.item.len - p.item.len) <= tol) cands.push(x);
        if (cands.length) q = cands[(rng() * cands.length) | 0];
      }
      if (!q) q = parts[(rng() * parts.length) | 0];
      if (p === q) return false;
      const b = state.loc.get(q.id);
      if (a === b) return false;
      remember(a); remember(b);
      removePart(state, p); removePart(state, q);
      placePart(state, p, b); placePart(state, q, a);
      undo = () => { removePart(state, p); removePart(state, q); placePart(state, p, a); placePart(state, q, b); };
    } else if (r < pMove + pSwap + 0.08 || !P.allowSplit) {
      // demet boyu tercihi
      const nonEmpty = [];
      for (let i = 0; i < state.groups.length; i++) if (state.groups[i].parts.length) nonEmpty.push(i);
      if (!nonEmpty.length) return false;
      const gi = nonEmpty[(rng() * nonEmpty.length) | 0];
      const g = state.groups[gi];
      const cands = g.comp.cands || [];
      const pick = rng() < 0.3 || !cands.length ? null : cands[(rng() * cands.length) | 0];
      if (pick === g.nPref) return false;
      remember(gi);
      g.nPref = pick;
      undo = () => {};
    } else {
      // böl / birleştir (deneysel)
      if (rng() < 0.5) {
        const p = parts[(rng() * parts.length) | 0];
        if (p.count < 2 * P.minSplit) return false;
        const c1 = P.minSplit + ((rng() * (p.count - 2 * P.minSplit + 1)) | 0);
        const from = state.loc.get(p.id);
        const q = { id: state.nextPartId++, item: p.item, count: p.count - c1 };
        const to = pickTarget(state, q, from);
        if (to === from) { state.nextPartId--; return false; }
        remember(from); remember(to);
        p.count = c1; parts.push(q); placePart(state, q, to);
        undo = () => { removePart(state, q); parts.pop(); state.loc.delete(q.id); p.count += q.count; };
      } else {
        // aynı pozun iki parçasını birleştir
        const p = parts[(rng() * parts.length) | 0];
        const sib = parts.filter(x => x !== p && x.item === p.item);
        if (!sib.length) return false;
        const q = sib[(rng() * sib.length) | 0];
        // birleşince tek grupta kesilemeyecek kadar büyürse birleştirme
        if (p.count + q.count > maxCountPerPart(p.item.len, P)) return false;
        const from = state.loc.get(q.id);
        const to = state.loc.get(p.id);
        remember(from); remember(to);
        removePart(state, q); const qi = parts.indexOf(q); parts.splice(qi, 1); const qc = q.count; p.count += qc;
        undo = () => { p.count -= qc; parts.splice(qi, 0, q); placePart(state, q, from); };
      }
    }
    for (const gi of touched) state.recompile(gi);
    const ev = state.evaluate();
    const delta = ev.cost - state.cost;
    if (delta <= 0 || rng() < Math.exp(-delta / T)) {
      state.cost = ev.cost; state.eval = ev;
      return true;
    }
    undo();
    for (const s of saved) { state.groups[s.gi].comp = s.comp; state.groups[s.gi].nPref = s.nPref; }
    return false;
  }

  // ---------------------------------------------------------------- sonuç üretimi

  function buildResult(state, material) {
    const P = state.P;
    const ev = state.evaluate();
    const groups = [];
    const order = [];
    for (let gi = 0; gi < state.groups.length; gi++) if (state.groups[gi].parts.length) order.push(gi);
    // sıralama: demet büyükten küçüğe, sonra ilk adım ölçüsü uzundan kısaya
    const firstLen = c => (c.steps.length ? c.steps[0].len : 0);   // sığmayan grupta adım yoktur
    order.sort((a, b) => {
      const ca = state.groups[a].comp, cb = state.groups[b].comp;
      return cb.bars - ca.bars || firstLen(cb) - firstLen(ca) || a - b;
    });
    const gIndexOf = new Map();
    order.forEach((gi, i) => gIndexOf.set(gi, i + 1));
    for (const gi of order) {
      const g = state.groups[gi];
      const c = g.comp;
      let sumLen = 0;
      const steps = c.steps.map((s, i) => {
        sumLen += s.len;
        const prevN = i === 0 ? null : c.steps[i - 1].n;
        return {
          len: s.len, n: s.n,
          alloc: s.alloc.map(a => ({ part: a.part, item: a.part.item, count: a.count })),
          setAside: prevN !== null && s.n < prevN ? prevN - s.n : 0,
        };
      });
      groups.push({
        no: gIndexOf.get(gi), stateIndex: gi, bars: c.bars, strokes: c.strokes, changes: c.changes,
        perBar: c.perBar, sumLen, leftover: c.leftover, steps,
        remnants: c.remnants.filter(r => r.count > 0 && r.len > 0),
      });
    }
    const kp = ev.kp;
    const kalanParts = state.kalanParts().sort((a, b) => b.item.len - a.item.len || b.count - a.count);
    const kalan = {
      parts: kalanParts.map(p => ({ part: p, item: p.item, count: p.count })),
      plan: kp.plan.map(e => ({
        groupNo: gIndexOf.get(e.bundle.group), step: e.bundle.step, count: e.bundle.count, len: e.bundle.len, derived: !!e.bundle.derived,
        steps: e.steps.map(s => ({ len: s.len, n: s.n, item: s.part.item, part: s.part })),
        leftoverCount: e.leftoverCount, leftoverLen: e.leftoverLen,
      })),
      strokes: kp.strokes, changes: kp.changes, usedMm: kp.usedMm,
      deficit: kp.deficit.map(d => ({ item: d.item, count: d.count })),
      fallbackGroups: kp.fallback ? kp.fallback.groups.map((g, i) => ({
        no: groups.length + i + 1, bars: g.comp.bars, strokes: g.comp.strokes, changes: g.comp.changes, perBar: g.comp.perBar,
        sumLen: g.comp.steps.reduce((s, x) => s + x.len, 0), leftover: g.comp.leftover, fallback: true,
        steps: g.comp.steps.map((s, i2) => ({ len: s.len, n: s.n, alloc: s.alloc.map(a => ({ part: a.part, item: a.part.item, count: a.count })), setAside: i2 > 0 && s.n < g.comp.steps[i2 - 1].n ? g.comp.steps[i2 - 1].n - s.n : 0 })),
        remnants: [],
      })) : [],
    };
    let pieces = 0;
    for (const p of state.parts) pieces += p.count;
    let remnantMm = 0;
    for (const g of groups) for (const r of g.remnants) remnantMm += r.count * r.len;
    const materialMm = ev.bars * P.L;
    const cutPart = P.wCut * ev.strokes, barPart = P.wBar * ev.bars, chgPart = P.wChange * ev.changes;
    const kalanPart = (P.wKalan || 0) * kalanParts.length;
    const wastePart = (P.wWaste || 0) * (materialMm - state.totalPieceMm);
    const stats = {
      cost: ev.cost, bars: ev.bars, strokes: ev.strokes, changes: ev.changes,
      costParts: { cut: cutPart, bar: barPart, change: chgPart, kalan: kalanPart, waste: wastePart, other: ev.cost - (cutPart + barPart + chgPart + kalanPart + wastePart) },
      groupBars: ev.groupBars, groupStrokes: ev.groupStrokes, groupChanges: ev.groupChanges,
      kalanStrokes: kp.strokes, kalanChanges: kp.changes, kalanCount: kalanParts.length,
      fallbackBars: kp.fallback ? kp.fallback.bars : 0,
      pieces, pieceMm: state.totalPieceMm, materialMm,
      wasteMm: materialMm - state.totalPieceMm,
      wastePct: materialMm ? (materialMm - state.totalPieceMm) / materialMm : 0,
      remnantMm, remnantUsedMm: kp.usedMm,
      lowerBoundBars: Math.ceil(state.totalPieceMm / P.L),
      groupCount: groups.length,
    };
    return { material, P, stats, groups, kalan };
  }

  // ---------------------------------------------------------------- doğrulayıcı

  function validate(result) {
    const P = result.P, errors = [];
    const produced = new Map(); // part.id → adet
    const add = (part, c) => produced.set(part.id, (produced.get(part.id) || 0) + c);
    const allGroups = result.groups.concat(result.kalan.fallbackGroups || []);
    const pool = new Map(); // "gNo:step" → {count,len}
    for (const g of allGroups) {
      if (g.bars > P.maxBundle) errors.push(`Grup ${g.no}: demet ${g.bars} > ${P.maxBundle}`);
      let active = g.steps.length ? g.steps[0].n : 0, used = 0;
      g.steps.forEach((s, i) => {
        if (s.n > active) errors.push(`Grup ${g.no} adım ${i + 1}: demet büyüyor (${active}→${s.n})`);
        if (s.n < active) {
          const key = `${g.no}:${i}`;
          pool.set(key, { count: active - s.n, len: P.L - used });
        }
        active = s.n;
        used += s.len + P.kerf;
        if (used > P.L - P.safety) errors.push(`Grup ${g.no} adım ${i + 1}: çubuk boyu aşıldı (${used} > ${P.L - P.safety})`);
        let c = 0;
        for (const a of s.alloc) { add(a.part, a.count); c += a.count; }
        if (c !== s.n) errors.push(`Grup ${g.no} adım ${i + 1}: dağıtım ${c} ≠ adet ${s.n}`);
      });
      if (!g.fallback) pool.set(`${g.no}:${g.steps.length}`, { count: active, len: P.L - used });
    }
    for (const e of result.kalan.plan) {
      const key = `${e.groupNo}:${e.step}`;
      const b = pool.get(key);
      if (!b) { errors.push(`Artık planı: kaynak bulunamadı (Grup ${e.groupNo} adım ${e.step})`); continue; }
      if (e.derived) {
        // türetilmiş demet: kaynağın toplam adedinden düşülür (aşağıda)
      }
      let active = e.count, used = 0;
      for (const s of e.steps) {
        if (s.n > active) errors.push(`Artık planı Grup ${e.groupNo}: demet büyüyor`);
        active = s.n; used += s.len + P.kerf;
        if (used > e.len - P.safety) errors.push(`Artık planı Grup ${e.groupNo} adım ${e.step}: artık boyu aşıldı (${used} > ${e.len - P.safety})`);
        add(s.part, s.n);
      }
    }
    // artık adet kontrolü: aynı kaynaktan kesilen toplam ilk-adım adedi (türetilmemiş) ≤ kaynak adedi
    const useByKey = new Map();
    for (const e of result.kalan.plan) {
      if (e.derived) continue; // türetilmiş demetler zaten ana demetten ayrılmış çubuklardır
      const key = `${e.groupNo}:${e.step}`;
      useByKey.set(key, (useByKey.get(key) || 0) + e.count);
    }
    for (const [key, used] of useByKey) {
      const b = pool.get(key);
      if (b && used > b.count) errors.push(`Artık planı ${key}: ${used} çubuk kullanılmış, kaynakta ${b.count} var`);
    }
    for (const p of result.parts || []) {
      const got = produced.get(p.id) || 0;
      if (got !== p.count) errors.push(`Poz ${p.item.poz} (${p.item.order}): ${p.count} gerekli, ${got} kesildi`);
    }
    return { ok: errors.length === 0, errors };
  }

  // ---------------------------------------------------------------- sürücü

  // Olay döngüsüne kısa bir süre bırakır (worker'da mesaj işlenebilsin diye)
  function yieldNow() {
    if (typeof MessageChannel !== 'undefined') {
      return new Promise(r => { const ch = new MessageChannel(); ch.port1.onmessage = () => { ch.port1.close(); r(); }; ch.port2.postMessage(null); });
    }
    return new Promise(r => setTimeout(r, 0));
  }

  function makeParts(items) {
    return items.map((it, i) => ({ id: i + 1, item: it, count: it.count }));
  }

  /**
   * Bir pozun tek bir grupta kesilebilecek en büyük adedi.
   * Grup = tek demet: bütün adımlar aynı çubuklardan kesilir, yani
   * adım sayısı × (ölçü + testere payı) çubuğa sığmak zorundadır.
   * 0 dönerse parça çubuğa hiç sığmıyordur.
   */
  function maxCountPerPart(len, P) {
    const cap = P.L - P.safety;
    if (!(len > 0) || len + P.kerf > cap) return 0;
    const maxSteps = Math.floor(cap / (len + P.kerf));          // ≥ 1
    return P.multiStep ? maxSteps * P.maxBundle : P.maxBundle;
  }

  /**
   * items → parça listesi.
   *  - ölçüsü/adedi geçersiz satırlar ayıklanır (skipped)
   *  - çubuktan uzun pozlar ayrı bildirilir (tooLong) — çağıran hata vermelidir
   *  - tek grupta kesilemeyecek kadar büyük pozlar zorunlu olarak bölünür (forced):
   *    bunlar fiziksel olarak zaten ayrı demetlerdir, birleşik tutmanın karşılığı yoktur
   */
  function prepareParts(items, P) {
    const parts = [], skipped = [], tooLong = [], forced = [];
    let id = 1;
    for (const it of items) {
      const len = Math.round(Number(it.len));
      const count = Math.round(Number(it.count));
      if (!isFinite(len) || len <= 0 || !isFinite(count) || count <= 0) { skipped.push(it); continue; }
      const maxCount = maxCountPerPart(len, P);
      if (!maxCount) { tooLong.push(it); continue; }
      if (count > maxCount) forced.push({ item: it, count, chunk: maxCount, pieces: Math.ceil(count / maxCount) });
      for (let left = count; left > 0;) {
        const take = Math.min(left, maxCount);
        parts.push({ id: id++, item: it, count: take });
        left -= take;
      }
    }
    return { parts, skipped, tooLong, forced };
  }

  /**
   * items: [{order, customer, poz, len, count, ...}]
   * opts: { iters, timeMs, onProgress(info), chunk }
   */
  async function optimize(items, params, opts) {
    const P = Object.assign({}, DEFAULTS, params || {});
    opts = opts || {};
    // parametreleri güvenli aralığa çek — bozuk değer sessiz donma/çökme üretmesin
    P.L = Math.max(1, Math.round(Number(P.L) || DEFAULTS.L));
    P.kerf = Math.max(0, Number(P.kerf) || 0);
    P.safety = Math.max(0, Number(P.safety) || 0);
    P.maxBundle = Math.max(1, Math.round(Number(P.maxBundle) || 1));
    if (P.safety >= P.L) {
      const e = new Error(`Emniyet payı (${P.safety} mm) çubuk boyundan (${P.L} mm) küçük olmalı.`);
      e.code = 'BAD_PARAMS'; throw e;
    }
    const rng = mulberry32(P.seed >>> 0);
    const prep = prepareParts(items, P);
    if (prep.tooLong.length) {
      const usable = P.L - P.safety - P.kerf;
      const list = prep.tooLong.slice(0, 5).map(it => `poz ${it.poz} (${it.len} mm)`).join(', ');
      const e = new Error(`${prep.tooLong.length} poz çubuğa sığmıyor: ${list}${prep.tooLong.length > 5 ? ' …' : ''}. `
        + `${P.L} mm çubuktan testere (${P.kerf} mm) ve emniyet payı (${P.safety} mm) düşünce en fazla ${usable} mm kesilebilir.`);
      e.code = 'TOO_LONG'; e.items = prep.tooLong;
      throw e;
    }
    const parts = prep.parts;
    const state = new State(parts, P, rng);
    state.nextPartId = parts.length + 1;
    constructInitial(state);
    const init = state.snapshot();
    let best = state.snapshot();
    const T0 = P.T0 || 5, T1 = P.T1 || 0.3;
    const iters = opts.iters || 0, timeMs = opts.timeMs || 0;
    const chunk = opts.chunk || 2000;
    const start = Date.now();
    let it = 0, accepted = 0;
    if (parts.length >= 2 && (iters > 0 || timeMs > 0)) {
      for (;;) {
        const fracI = iters ? it / iters : 0;
        const fracT = timeMs ? (Date.now() - start) / timeMs : 0;
        const frac = Math.max(fracI, fracT);
        if (frac >= 1) break;
        const T = T0 * Math.pow(T1 / T0, frac);
        for (let k = 0; k < chunk; k++) {
          const mv = rng();
          const kind = mv < (P.pElim || 0) ? 'elim' : mv < (P.pElim || 0) + (P.pLNS || 0) ? 'lns' : 'sa';
          const acc = kind === 'elim' ? repackIteration(state, T) : kind === 'lns' ? lnsIteration(state, T) : saIteration(state, T);
          if (acc) accepted++;
          if (P.debug) state.checkConsistency(kind + (acc ? '+' : '-') + ' it' + it);
          it++;
          if (state.cost < best.cost - 1e-9) best = state.snapshot();
        }
        if (opts.onProgress) opts.onProgress({ iter: it, frac, T, cost: state.cost, best: best.cost, accepted, eval: state.eval });
        if (opts.abort && opts.abort()) break;
        if (opts.yield !== false) await yieldNow();
        if (opts.abort && opts.abort()) break;
      }
    }
    state.restore(best);
    const result = buildResult(state, opts.material || null);
    result.parts = state.parts;
    result.items = items;
    result.initialCost = init.cost;
    result.iterations = it;
    result.skipped = prep.skipped;          // ölçüsü/adedi geçersiz satırlar
    result.forcedSplits = prep.forced;      // demete sığmadığı için bölünmek zorunda kalan pozlar
    result.validation = validate(result);
    return result;
  }

  return { DEFAULTS, compileGroup, planKalan, optimize, validate, makeParts, prepareParts, maxCountPerPart, mulberry32, State, constructInitial, buildResult, KALAN };
});
