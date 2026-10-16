/* Headless test koşucusu: chrome --headless --allow-file-access-from-files --dump-dom test.html?iters=100000 */
(async function () {
  const out = [];
  const el = document.getElementById('out');
  const log = (...a) => { out.push(a.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(' ')); el.textContent = out.join('\n'); };
  const q = new URLSearchParams(location.search);
  const ITERS = Number(q.get('iters') || 60000);
  const ONLY = q.get('only') || '';
  const SEED = Number(q.get('seed') || 12345);
  let fails = 0;
  const check = (cond, msg) => { if (!cond) { fails++; log('FAIL:', msg); } else log('ok:', msg); };

  async function fetchBuf(rel) {
    const r = await fetch(encodeURI(rel));
    if (!r.ok) throw new Error('fetch failed ' + rel + ' ' + r.status);
    return new Uint8Array(await r.arrayBuffer());
  }

  try {
    // ---------------------------------------------------------------- parser
    const buf = await fetchBuf('../../İMALAT LİSTESİ.xls');
    const parsed = PanjurParse.parseBuffer(buf, 'İMALAT LİSTESİ.xls');
    log('order', parsed.orderNo, 'sheet', parsed.sheetName, 'sections', parsed.sections);
    check(parsed.orderNo === '19757', 'sipariş no 19757');
    const byType = Object.fromEntries(parsed.materials.map(m => [m.type, m]));
    check(byType.lamel && byType.lamel.items.length === 122, 'lamel 122 poz');
    check(byType.altparca && byType.altparca.items.length === 122, 'alt parça 122 poz');
    check(byType.dikme && byType.dikme.items.length === 122, 'dikme 122 poz');
    check(byType.tambur && byType.tambur.items.length === 122, 'tambur 122 poz');
    check(byType.lamel.color === 'ANT.GRİ' && byType.lamel.desc === 'AS 55 EKO ALÜMINYUM LAMEL', 'lamel renk/açıklama: ' + byType.lamel.color + ' / ' + byType.lamel.desc);
    const d53 = byType.dikme.items.find(i => i.poz === 53), d11 = byType.dikme.items.find(i => i.poz === 11);
    check(d53 && d53.len === 1005, 'dikme poz 53 → 1005 (tarih düzeltme)');
    check(d11 && d11.len === 1010, 'dikme poz 11 → 1010 (tarih düzeltme)');
    check(parsed.warnings.length === 12, 'uyarı sayısı 12 (6 dikme + 6 fitil, aynı bozuk ölçüler): ' + parsed.warnings.length);
    check(parsed.warnings.filter(w => /DİKMELİ/.test(w.message)).length === 6, 'dikme uyarısı 6');
    const l26 = byType.lamel.items.find(i => i.poz === 26);
    check(l26 && l26.count === 22 && l26.len === 929, 'lamel poz 26: 22×929');
    const lamelLenSum = byType.lamel.items.reduce((s, i) => s + i.len, 0);
    check(lamelLenSum === 178468, 'lamel Σölçü 178468 (ERP başlığı) → ' + lamelLenSum);
    check(PanjurParse.typeOf('TAPA SL-56').type === 'diger' && PanjurParse.typeOf('AS 55 EKO ALÜMINYUM LAMEL').type === 'lamel', 'TAPA lamel sayılmadı');
    check(byType.fitil && byType.fitil.defaultOn === false, 'fitil tanındı ve varsayılan kapalı');
    // decodeLen ek testleri
    check(PanjurParse.decodeLen(46143).len === 1005 && PanjurParse.decodeLen(46296).len === 1010, 'decodeLen seri');
    check(PanjurParse.decodeLen('1.005').len === 1005 && PanjurParse.decodeLen(1.012).len === 1012, 'decodeLen string/float');

    // ---------------------------------------------------------------- ERP ham CSV (yeni biçim)
    const csvBuf = await fetchBuf('../../000000000021542_İmalat.csv');
    const csv = PanjurParse.parseBuffer(csvBuf, '000000000021542_İmalat.csv');
    log('CSV:', { order: csv.orderNo, layout: csv.layout, rows: csv.rowCount, mats: csv.materials.map(m => `${m.typeLabel}/${m.desc.slice(0, 18)}/${m.color}: ${m.items.length} poz ${m.pieces} parça`), skipped: csv.skipped });
    check(csv.orderNo === '21542', 'CSV sipariş no 21542 → ' + csv.orderNo);
    check(csv.layout === 'ERP ham', 'CSV düzeni ERP ham → ' + csv.layout);
    check(csv.rowCount === 1875, 'CSV 1875 satır → ' + csv.rowCount);
    const cT = Object.fromEntries(csv.materials.map(m => [m.type, m]));
    check(cT.lamel && cT.lamel.items.length === 156, 'CSV lamel 156 poz');
    check(cT.altparca && cT.altparca.items.length === 156, 'CSV alt parça 156 poz');
    check(cT.dikme && cT.dikme.items.length === 156, 'CSV dikme 156 poz');
    check(cT.tambur && cT.tambur.items.length === 156, 'CSV tambur 156 poz');
    check(cT.lamel.color === 'BEJ GRİ' && cT.lamel.desc === 'AS 55 EKO ALÜMINYUM LAMEL', 'CSV renk/açıklama: ' + cT.lamel.color + ' / ' + cT.lamel.desc);
    check(cT.lamel.stokCodes.join() === 'TAP.P.SD.B06.55E', 'CSV lamel stok kodu: ' + cT.lamel.stokCodes.join());
    const c74 = cT.lamel.items.find(i => i.poz === 74), c73 = cT.lamel.items.find(i => i.poz === 73);
    check(c74 && c74.count === 39 && c74.len === 674, 'CSV poz 74: 39×674');
    check(c73 && c73.len === 1274, 'CSV poz 73: "1.274" → 1274 (binlik ayırıcı) → ' + (c73 && c73.len));
    check(cT.dikme.items.every(i => i.count === 2), 'CSV dikme hepsi 2 adet');
    check(cT.dikme.items.find(i => i.poz === 48).len === 1950 && cT.dikme.items.find(i => i.poz === 74).len === 2135, 'CSV dikme poz 48 → 1950, poz 74 → 2135');
    check(typeof cT.lamel.items[0].poz === 'number', 'CSV poz sayı tipinde');
    check(csv.warnings.length === 0, 'CSV uyarı yok → ' + csv.warnings.map(w => w.message).join(' | '));
    const skipMotor = csv.skipped.find(s => /MOTOR/i.test(s.desc));
    check(skipMotor && skipMotor.count === 156, 'CSV motor satırları atlandı (ölçüsüz)');
    check(cT.lamel.pieces === csv.materials.find(m => m.type === 'lamel').items.reduce((a, b) => a + b.count, 0), 'CSV parça sayısı tutarlı');
    // parseTrNumber birim testleri
    const tn = PanjurParse.parseTrNumber;
    check(tn('1.274') === 1274 && tn('674') === 674 && tn('3,68004') === 3.68004 && tn('1.274,5') === 1274.5 && tn('') === null, 'parseTrNumber');
    // aynı verinin xlsx ikizi aynı sonucu vermeli
    const xBuf = await fetchBuf('../../000000000021542_İmalat.xlsx');
    const xls = PanjurParse.parseBuffer(xBuf, '000000000021542_İmalat.xlsx');
    const sig = p => p.materials.map(m => `${m.key}:${m.items.length}:${m.pieces}:${m.totalMm}`).join('|');
    check(sig(csv) === sig(xls), 'CSV ile xlsx ikizi aynı: ' + (sig(csv) === sig(xls) ? 'evet' : sig(csv) + ' ≠ ' + sig(xls)));
    check(xls.orderNo === '21542', 'xlsx ikizi sipariş no 21542 → ' + xls.orderNo);

    // ---------------------------------------------------------------- insan çözümü (3 sipariş)
    const hbuf = await fetchBuf('../../YUNUS PEN OPTİMİZASYON HALİ.xlsx');
    const hwb = XLSX.read(hbuf, { type: 'array', cellDates: false });
    function readCols(ws, cols) {
      const range = XLSX.utils.decode_range(ws['!ref']);
      const items = []; const groups = []; let cur = []; let kalan = false;
      for (let r = range.s.r; r <= range.e.r; r++) {
        const cell = ci => ws[XLSX.utils.encode_cell({ r, c: ci })];
        const val = ci => { const x = cell(ci); return x ? x.v : null; };
        const [a, b, c, d, e] = cols.map(val);
        const ecell = cell(cols[4]);
        if (ecell && ecell.f && /SUM/i.test(ecell.f)) { groups.push(cur); cur = []; continue; }
        if (b === 'KALANLAR') { kalan = true; continue; }
        if (typeof a === 'number' && typeof e === 'number' && typeof c === 'number') {
          const it = { order: String(a), customer: String(b).trim(), poz: c, count: d, len: e };
          items.push(it); if (!kalan) cur.push(it);
        }
      }
      return { items, groups };
    }
    const hl = readCols(hwb.Sheets['Sayfa1'], [0, 1, 2, 3, 4]);
    const hd1 = readCols(hwb.Sheets['Sayfa2'], [0, 1, 2, 3, 4]);
    const hd2 = readCols(hwb.Sheets['Sayfa2'], [6, 7, 8, 9, 10]);
    const hd3 = readCols(hwb.Sheets['Sayfa2'], [15, 16, 17, 18, 19]);
    const lamelItems = hl.items, dikmeItems = hd1.items.concat(hd2.items, hd3.items);
    check(lamelItems.length === 158, 'insan dosyası lamel 158 poz → ' + lamelItems.length);
    check(dikmeItems.length === 144, 'insan dosyası dikme 144 poz → ' + dikmeItems.length);

    const P = Object.assign({}, PanjurOpt.DEFAULTS, { seed: SEED });
    for (const k of ['T0', 'T1', 'wKalan', 'wCut', 'wBar', 'pLNS', 'wFill', 'pElim', 'debug', 'allowSplit', 'mergeSameLength', 'multiStep']) if (q.get(k) != null) P[k] = Number(q.get(k));

    // ---------------------------------------------------------------- compileGroup birim testi
    const mk = (poz, count, len) => ({ order: '19757', customer: 'T', poz, count, len });
    const g1 = PanjurOpt.makeParts([mk(114, 34, 1844), mk(115, 33, 1844), mk(41, 18, 1394), mk(74, 18, 1384)]);
    const c1 = PanjurOpt.compileGroup(g1, P, null);
    log('compile g1', { n: c1.n, bars: c1.bars, strokes: c1.strokes, changes: c1.changes, perBar: c1.perBar, steps: c1.steps.map(s => [s.len, s.n, s.alloc.map(a => a.part.item.poz + ':' + a.count).join('+')]), remnants: c1.remnants });
    check(c1.feasible && c1.bars === 34 && c1.strokes === 4 && c1.changes === 2 && c1.perBar === 6482, 'g1 = insan grubu (34 boy, 4 kesim, 2 bozma)');
    const g2 = PanjurOpt.makeParts([mk(114, 34, 1844), mk(41, 18, 1394), mk(74, 18, 1384)]);
    const c2 = PanjurOpt.compileGroup(g2, P, null);
    log('compile g2', { n: c2.n, bars: c2.bars, strokes: c2.strokes, changes: c2.changes, steps: c2.steps.map(s => [s.len, s.n]) });
    check(c2.feasible && c2.bars === 18 && c2.strokes === 4, 'g2: 34→17+17 ile 18 boy 4 kesim');
    const g3 = PanjurOpt.makeParts([mk(68, 19, 1349), mk(94, 19, 1349), mk(58, 19, 1344), mk(63, 19, 1344), mk(13, 19, 1084)]);
    const c3 = PanjurOpt.compileGroup(g3, P, null);
    log('compile g3', { n: c3.n, bars: c3.bars, strokes: c3.strokes, changes: c3.changes, steps: c3.steps.map(s => [s.len, s.n, s.alloc.map(a => a.part.item.poz + ':' + a.count).join('+')]) });
    const c3b = PanjurOpt.compileGroup(g3, Object.assign({}, P, { mergeSameLength: false }), null);
    check(c3b.strokes === 5 && c3b.bars === 19, 'g3 birleştirme kapalı: 5 kesim 19 boy');
    const cInf = PanjurOpt.compileGroup(PanjurOpt.makeParts([mk(1, 10, 3300), mk(2, 10, 3200)]), P, null);
    check(!cInf.feasible, 'sığmayan grup → infeasible');

    // ------------------------------------------------- gerileme testleri (düzeltilen hatalar)
    // 1) Boydan uzun poz: eskiden sonsuz döngüye girip sekmeyi kilitliyordu
    let tooLongErr = null;
    try { await PanjurOpt.optimize([mk(1, 5, 7000), mk(2, 20, 1200)], P, { iters: 200, yield: false }); }
    catch (e) { tooLongErr = e; }
    check(tooLongErr && tooLongErr.code === 'TOO_LONG' && /poz 1/.test(tooLongErr.message),
      'boydan uzun poz → anlaşılır hata (donma değil): ' + (tooLongErr ? tooLongErr.message.slice(0, 60) : 'hata yok!'));
    // tam sınır: 6500 - 5 emniyet - 4 testere = 6491 sığar
    const edgeOk = await PanjurOpt.optimize([mk(1, 2, 6491), mk(2, 5, 1200)], P, { iters: 200, yield: false });
    check(edgeOk.validation.ok, '6491 mm (tam sınır) kesilebiliyor');

    // 2) Adet/ölçü geçersiz satırlar: eskiden TypeError ile çöküyordu
    const junk = await PanjurOpt.optimize([mk(1, 0, 1200), mk(2, -5, 1300), mk(3, 10, 0), mk(4, 10, 1400)], P, { iters: 200, yield: false });
    check(junk.validation.ok && junk.skipped.length === 3, 'adet/ölçü geçersiz 3 satır atlandı, çökme yok: ' + junk.skipped.length);

    // 3) LNS hamlesi tam 2 dolu grupla: eskiden sonsuz döngü (küme 3 elemana ulaşamıyordu)
    const twoGroup = await PanjurOpt.optimize(
      [mk(1, 40, 3000), mk(2, 40, 3000), mk(3, 40, 2900), mk(4, 40, 2900)],
      Object.assign({}, P, { pLNS: 1, pElim: 0 }), { iters: 3000, yield: false });
    check(twoGroup.validation.ok, 'yalnız LNS hamlesiyle 2 gruplu durum donmadan tamamlandı');

    // 4) Demet düşürülünce zorunlu bölme (adet tek demete sığmıyor)
    const small = await PanjurOpt.optimize([mk(1, 40, 1994), mk(2, 20, 1200)],
      Object.assign({}, P, { maxBundle: 10 }), { iters: 500, yield: false });
    check(small.validation.ok, 'demet 10 ile optimize edilebiliyor (eskiden çöküyordu)');
    check(small.forcedSplits.length >= 1, 'tek demete sığmayan poz zorunlu bölündü ve bildirildi: ' + small.forcedSplits.length);
    check(PanjurOpt.maxCountPerPart(1994, Object.assign({}, P, { maxBundle: 10 })) === 30,
      'maxCountPerPart(1994, demet 10) = 3 adım × 10 = 30');

    // 5) Bozuk parametreler güvenli aralığa çekilir
    const zeroB = await PanjurOpt.optimize([mk(1, 10, 1200), mk(2, 10, 1300)],
      Object.assign({}, P, { maxBundle: 0 }), { iters: 200, yield: false });
    check(zeroB.validation.ok && zeroB.P.maxBundle === 1, 'demet 0 → 1 olarak düzeltildi');

    // 6) Türkçe İ: ERP sayfa adı '..._İmalat' regex'le bulunamıyordu
    check(PanjurParse.norm('000000000021542_İmalat').indexOf('imalat') >= 0,
      "Türkçe 'İ' normalleştirmesi: _İmalat → imalat");

    // insan çözümünün maliyeti (gruplar aynen, KALANLAR)
    function humanStats(hgroups, items, Pm) {
      let bars = 0, strokes = 0, changes = 0; const pool = []; const inGroups = new Set();
      hgroups.forEach((g, gi) => {
        const parts = PanjurOpt.makeParts(g);
        const c = PanjurOpt.compileGroup(parts, Object.assign({}, Pm, { mergeSameLength: false, safety: 0 }), null);
        if (!c.feasible) { log('insan grubu sığmadı', gi, g.map(x => x.len + 'x' + x.count)); return; }
        bars += c.bars; strokes += c.strokes; changes += c.changes;
        for (const r of c.remnants) pool.push({ count: r.count, len: r.len, group: gi, step: r.afterStep });
        for (const it of g) inGroups.add(it);
      });
      const kal = PanjurOpt.makeParts(items.filter(it => !inGroups.has(it)));
      const kp = PanjurOpt.planKalan(kal, pool, Pm);
      return { bars, strokes, changes, kalan: kal.length, kalanStrokes: kp.strokes, kalanChanges: kp.changes, deficit: kp.deficit.reduce((s, d) => s + d.count, 0), fbBars: kp.fallback ? kp.fallback.bars : 0, totalStrokes: strokes + kp.strokes + (kp.fallback ? kp.fallback.strokes : 0), totalBars: bars + (kp.fallback ? kp.fallback.bars : 0) };
    }
    const hs = humanStats(hl.groups, lamelItems, P);
    log('İNSAN lamel:', hs);
    const hsd = humanStats(hd1.groups.concat(hd2.groups), dikmeItems, Object.assign({}, P, { maxBundle: 2 }));
    log('İNSAN dikme:', hsd);

    // ---------------------------------------------------------------- optimize lamel
    if (!ONLY || ONLY === 'lamel') {
      const t0 = performance.now();
      let lastProg = null;
      const res = await PanjurOpt.optimize(lamelItems, P, { iters: ITERS, yield: false, onProgress: p => { lastProg = p; } });
      if (lastProg) log('  kabul oranı', (lastProg.accepted / lastProg.iter).toFixed(3));
      const t1 = performance.now();
      const st = res.stats;
      log('OPT lamel:', { iters: res.iterations, ms: Math.round(t1 - t0), init: Math.round(res.initialCost), cost: Math.round(st.cost), bars: st.bars, strokes: st.strokes, changes: st.changes, groupBars: st.groupBars, groupStrokes: st.groupStrokes, kalan: st.kalanCount, kalanStrokes: st.kalanStrokes, fallbackBars: st.fallbackBars, wastePct: +(st.wastePct * 100).toFixed(2), lb: st.lowerBoundBars, groups: st.groupCount, remnantMm: st.remnantMm, remnantUsed: st.remnantUsedMm });
      check(res.validation.ok, 'lamel doğrulama: ' + (res.validation.errors.slice(0, 5).join(' | ') || 'temiz'));
      const cp = st.costParts;
      const sum = cp.cut + cp.bar + cp.change + cp.kalan + cp.waste + cp.other;
      check(Math.abs(sum - st.cost) < 1e-6, 'maliyet dökümü toplamı maliyete eşit: ' + sum.toFixed(3) + ' vs ' + st.cost.toFixed(3));
      check(Math.abs(cp.cut - P.wCut * st.strokes) < 1e-9 && Math.abs(cp.bar - P.wBar * st.bars) < 1e-9, 'döküm kalemleri doğru');
      log('  maliyet dökümü', { cut: Math.round(cp.cut), bar: Math.round(cp.bar), change: Math.round(cp.change), kalan: Math.round(cp.kalan), waste: Math.round(cp.waste), other: Math.round(cp.other) });
      log('  parça sayısı', res.parts.length, '(poz', lamelItems.length + ')');
      for (const g of (q.get('full') ? res.groups : res.groups.slice(0, 6))) log('  G' + g.no, 'boy', g.bars, 'kesim', g.strokes, 'Σ', g.sumLen, 'kalan', g.leftover, 'artık', g.remnants.filter(r => !r.final).map(r => r.count + '×' + r.len).join(','), g.steps.map(s => s.len + '×' + s.n + '[' + s.alloc.map(a => a.item.poz + ':' + a.count).join('+') + ']').join(' | '));
      log('  KALANLAR', res.kalan.parts.map(k => k.item.poz + ':' + k.count + 'x' + k.item.len).join(', '));
      log('  artık planı', (q.get('full') ? res.kalan.plan : res.kalan.plan.slice(0, 5)).map(e => `G${e.groupNo}/${e.step} ${e.count}×${e.len}: ` + e.steps.map(s => s.len + '×' + s.n + '→' + s.item.poz).join(', ')));
      window.__lamel = res;
      window.__lamelMeta = { desc: 'AS 55 EKO ALÜMINYUM LAMEL', color: 'ANT.GRİ', sheetName: 'LAMEL' };
    }
    // ---------------------------------------------------------------- optimize dikme
    if (!ONLY || ONLY === 'dikme') {
      const Pd = Object.assign({}, P, { maxBundle: 2 });
      const t0 = performance.now();
      const res = await PanjurOpt.optimize(dikmeItems, Pd, { iters: Number(q.get('diters') || Math.min(ITERS, 40000)), yield: false });
      const st = res.stats;
      log('OPT dikme:', { iters: res.iterations, ms: Math.round(performance.now() - t0), cost: Math.round(st.cost), bars: st.bars, strokes: st.strokes, changes: st.changes, kalan: st.kalanCount, wastePct: +(st.wastePct * 100).toFixed(2), lb: st.lowerBoundBars, groups: st.groupCount });
      check(res.validation.ok, 'dikme doğrulama: ' + (res.validation.errors.slice(0, 5).join(' | ') || 'temiz'));
      window.__dikme = res;
      for (const g of res.groups.slice(0, 4)) log('  G' + g.no, 'boy', g.bars, 'Σ', g.sumLen, g.steps.map(s => s.len + '×' + s.n + '[' + s.alloc.map(a => a.item.poz + ':' + a.count).join('+') + ']').join(' | '));
      log('  dikme kalanlar:', res.groups.map(g => g.leftover).sort((a, b) => b - a).join(' '));
    }
    // ---------------------------------------------------------------- alt parça / tambur (tek sipariş, demet 1)
    if (ONLY === 'alt' || ONLY === 'tambur') {
      const src = ONLY === 'alt' ? byType.altparca : byType.tambur;
      const items = src.items.map(i => ({ order: '19757', customer: 'YUNUS PEN', poz: i.poz, len: i.len, count: i.count }));
      const Pa = Object.assign({}, P, { maxBundle: Number(q.get('bundle') || 1) });
      const t0 = performance.now();
      const res = await PanjurOpt.optimize(items, Pa, { iters: ITERS, yield: false });
      const st = res.stats;
      log('OPT ' + ONLY + ':', { iters: res.iterations, cost: Math.round(st.cost), bars: st.bars, strokes: st.strokes, changes: st.changes, kalan: st.kalanCount, wastePct: +(st.wastePct * 100).toFixed(2), lb: st.lowerBoundBars, groups: st.groupCount, pieces: st.pieces, mm: st.pieceMm });
      check(res.validation.ok, ONLY + ' doğrulama: ' + (res.validation.errors.slice(0, 5).join(' | ') || 'temiz'));
      log('  kalanlar:', res.groups.map(g => g.leftover).sort((a, b) => b - a).join(' '));
    }
    if (ONLY === 'csv') {
      const m = cT[q.get('mat') || 'lamel'];
      const items = m.items.map(i => ({ order: csv.orderNo, customer: 'CSV', poz: i.poz, len: i.len, count: i.count }));
      const Pc = Object.assign({}, P, { maxBundle: Number(q.get('bundle') || m.defaultBundle) });
      const t0 = performance.now();
      const res = await PanjurOpt.optimize(items, Pc, { iters: ITERS, yield: false });
      const st = res.stats;
      log('OPT csv/' + m.type + ':', { ms: Math.round(performance.now() - t0), iters: res.iterations, cost: Math.round(st.cost), bars: st.bars, lb: st.lowerBoundBars, strokes: st.strokes, changes: st.changes, kalan: st.kalanCount, wastePct: +(st.wastePct * 100).toFixed(2), groups: st.groupCount, pieces: st.pieces });
      check(res.validation.ok, 'csv/' + m.type + ' doğrulama: ' + (res.validation.errors.slice(0, 5).join(' | ') || 'temiz'));
      for (const g of res.groups.slice(0, 4)) log('  G' + g.no, 'boy', g.bars, 'Σ', g.sumLen, g.steps.map(s => s.len + '×' + s.n + '[' + s.alloc.map(a => a.item.poz + ':' + a.count).join('+') + ']').join(' | '));
    }
    // Gerçek ERP projesinden (CSV) örnek Excel: run.sh "csvxlsx=1&iters=300000"
    if (q.get('csvxlsx')) {
      const orders = [{ orderNo: Number(csv.orderNo), customer: q.get('cust') || 'ÖZ SEDEF', date: new Date(Date.UTC(2026, 9, 20)), pozCount: cT.lamel.items.length, note: '' }];
      const results = [];
      for (const type of ['lamel', 'dikme', 'altparca', 'tambur']) {
        const m = cT[type];
        if (!m) continue;
        const items = m.items.map(i => ({ order: Number(csv.orderNo), customer: orders[0].customer, poz: i.poz, len: i.len, count: i.count }));
        const Pm = Object.assign({}, P, { maxBundle: m.defaultBundle });
        const res = await PanjurOpt.optimize(items, Pm, { iters: ITERS, yield: false });
        check(res.validation.ok, type + ' doğrulama: ' + (res.validation.errors.slice(0, 3).join(' | ') || 'temiz'));
        log('  ' + m.typeLabel + ':', { bars: res.stats.bars, lb: res.stats.lowerBoundBars, strokes: res.stats.strokes, changes: res.stats.changes, kalan: res.stats.kalanCount, fire: +(res.stats.wastePct * 100).toFixed(2) });
        results.push({ result: res, meta: { desc: m.desc, color: m.color, sheetName: m.typeLabel, orders }, opts: { twoColumn: m.defaultBundle <= 2, showRemnants: false } });
      }
      const buf = await PanjurExcel.buildWorkbook(results, { orders });
      const bytes = new Uint8Array(buf); let bin = '';
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
      document.getElementById('xlsx').textContent = btoa(bin);
      log('csv xlsx bytes', bytes.length);
    }
    if (q.get('xlsx')) {
      const orders = [{ orderNo: 19757, customer: 'YUNUS PEN', date: new Date(Date.UTC(2026, 8, 24)), pozCount: 122, note: 'DETAY' }, { orderNo: 20139, customer: 'CANVER', date: new Date(Date.UTC(2026, 8, 24)), pozCount: 14, note: 'DETAY' }, { orderNo: 20256, customer: 'DETAY', date: new Date(Date.UTC(2026, 8, 30)), pozCount: 22, note: 'MNB' }];
      const results = [];
      if (window.__lamel) results.push({ result: window.__lamel, meta: Object.assign({ orders }, window.__lamelMeta), opts: { twoColumn: false, showRemnants: true } });
      if (window.__dikme) results.push({ result: window.__dikme, meta: { desc: 'DİKMELİ U 62 LIK', color: 'ANT.GRİ', sheetName: 'DİKME', orders }, opts: { twoColumn: true } });
      // CSV projesinden bir malzeme: aynı sayfa adı ('LAMEL') → çakışma giderme testi
      const csvItems = cT.lamel.items.slice(0, 40).map(i => ({ order: csv.orderNo, customer: 'ÖZ SEDEF', poz: i.poz, len: i.len, count: i.count }));
      const csvRes = await PanjurOpt.optimize(csvItems, Object.assign({}, P, { maxBundle: 50 }), { iters: 20000, yield: false });
      check(csvRes.validation.ok, 'CSV malzemesi doğrulama: ' + (csvRes.validation.errors.slice(0, 3).join(' | ') || 'temiz'));
      results.push({ result: csvRes, meta: { desc: cT.lamel.desc, color: cT.lamel.color, sheetName: 'LAMEL', orders: [{ orderNo: 21542, customer: 'ÖZ SEDEF', date: new Date(Date.UTC(2026, 9, 20)), pozCount: 156, note: '' }] }, opts: { twoColumn: false } });
      const buf = await PanjurExcel.buildWorkbook(results, { orders });
      const bytes = new Uint8Array(buf); let bin = '';
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
      document.getElementById('xlsx').textContent = btoa(bin);
      log('xlsx bytes', bytes.length);
    }
    log(fails ? `SONUÇ: ${fails} HATA` : 'SONUÇ: TÜM TESTLER GEÇTİ');
  } catch (e) {
    log('EXCEPTION', String(e), e && e.stack);
  }
  document.body.setAttribute('data-done', '1');
})();
