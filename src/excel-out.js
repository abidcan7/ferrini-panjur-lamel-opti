/*
 * Sonuç Excel'i (ExcelJS gerektirir). Düzen, elle yapılan örnek dosyayla aynı:
 *   A: sipariş no, B: müşteri, C: POZ, D: ADET, E: ÖLÇÜ, F: not; sağ üstte sipariş bloğu.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('exceljs'));
  else root.PanjurExcel = factory(root.ExcelJS);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (ExcelJS) {
  'use strict';

  const THIN = { style: 'thin', color: { argb: 'FF000000' } };
  const BORDER = { top: THIN, left: THIN, bottom: THIN, right: THIN };
  const FONT = 'Calibri';
  const GRAY = { name: FONT, size: 9, color: { argb: 'FF666666' } };

  function joinUnique(arr) {
    const seen = [];
    for (const x of arr) if (!seen.includes(x)) seen.push(x);
    return seen.join(' + ');
  }

  function safeSheetName(s) {
    return s.replace(/[\[\]:*?/\\]/g, ' ').trim().slice(0, 31) || 'Sayfa';
  }

  // Bir adımı satır verisine çevirir
  function stepRow(step) {
    const orders = step.alloc.map(a => a.item.order || '');
    const customers = step.alloc.map(a => a.item.customer || '');
    const pozs = step.alloc.map(a => String(a.item.poz));
    const counts = step.alloc.map(a => a.count);
    const single = step.alloc.length === 1;
    const uo = joinUnique(orders), uc = joinUnique(customers);
    const numOrNull = v => v === '' ? null : (isFinite(Number(v)) ? Number(v) : v);
    return {
      order: uo.includes(' + ') ? uo : numOrNull(uo),
      customer: uc,
      poz: single ? (isFinite(Number(pozs[0])) ? Number(pozs[0]) : pozs[0]) : pozs.join(' + '),
      count: single ? counts[0] : counts.join(' + '),
      len: step.len,
    };
  }

  // Grup bloğunu satır listesi olarak üretir: [{cells: {A..F}, kind}]
  function groupBlock(g, opts) {
    const rows = [];
    const title = g.fallback ? `GRUP ${g.no} (artık yetmedi – yeni çubuk)` : `GRUP ${g.no}`;
    rows.push({ kind: 'header', A: title });
    g.steps.forEach((s, i) => {
      const r = stepRow(s);
      let note = '';
      if (i === 0) note = `${g.bars} çubuk`;
      else if (s.setAside > 0) note = `${s.setAside} çubuk kenara → ${s.n}`;
      rows.push({ kind: 'step', A: r.order, B: r.customer, C: r.poz, D: r.count, E: r.len, F: note });
    });
    const remnantNote = (g.remnants || []).filter(r => !r.final && r.count > 0).map(r => `${r.count}×${r.len}`).join(', ');
    rows.push({ kind: 'sum', steps: g.steps.length, value: g.sumLen, F: `${g.strokes} kesim` + (remnantNote && opts.showRemnants ? ` · artık ${remnantNote}` : '') });
    rows.push({ kind: 'blank' });
    return rows;
  }

  function kalanBlock(kalan) {
    const rows = [];
    if (!kalan.parts.length) return rows;
    rows.push({ kind: 'kalanTitle' });
    rows.push({ kind: 'header', A: '' });
    // kaynak notu: hangi gruptan kaç parça
    const src = new Map();
    for (const e of kalan.plan) for (const s of e.steps) {
      const key = s.part.id;
      const m = src.get(key) || new Map();
      m.set(e.groupNo, (m.get(e.groupNo) || 0) + s.n);
      src.set(key, m);
    }
    for (const k of kalan.parts) {
      const m = src.get(k.part.id);
      const note = m ? 'artık: ' + [...m.entries()].map(([g, n]) => `G${g} (${n})`).join(' + ') : '';
      const it = k.item;
      rows.push({ kind: 'step', A: isFinite(Number(it.order)) ? Number(it.order) : it.order, B: it.customer, C: isFinite(Number(it.poz)) ? Number(it.poz) : it.poz, D: k.count, E: it.len, F: note });
    }
    return rows;
  }

  function writeRows(ws, rows, colOffset, startRow, styleOpts) {
    // colOffset: 0 → A..F, 6 → G..L
    const col = i => colOffset + i; // 1-based
    let r = startRow;
    let blockStart = null;
    for (const row of rows) {
      if (row.kind === 'header') {
        blockStart = r + 1;
        if (row.A) { const c = ws.getCell(r, col(1)); c.value = row.A; c.font = { name: FONT, size: 10, bold: true }; }
        for (const [i, t] of [[3, 'POZ'], [4, 'ADET'], [5, 'ÖLÇÜ']]) {
          const c = ws.getCell(r, col(i)); c.value = t; c.font = { name: FONT, size: 11, bold: true }; c.alignment = { horizontal: 'right' };
        }
      } else if (row.kind === 'step') {
        const vals = [row.A, row.B, row.C, row.D, row.E];
        vals.forEach((v, i) => {
          const c = ws.getCell(r, col(i + 1));
          c.value = v == null ? null : v;
          c.border = BORDER;
          c.font = i === 4 ? { name: FONT, size: 14, bold: true } : { name: FONT, size: 11 };
          if (i === 4) c.numFmt = '#,##0';
          if (i >= 2) c.alignment = { horizontal: 'right' };
        });
        if (row.F) { const c = ws.getCell(r, col(6)); c.value = row.F; c.font = GRAY; }
      } else if (row.kind === 'sum') {
        const c = ws.getCell(r, col(5));
        const colLetter = ws.getColumn(col(5)).letter;
        c.value = { formula: `SUM(${colLetter}${blockStart}:${colLetter}${r - 1})`, result: row.value };
        c.numFmt = '#,##0'; c.border = BORDER; c.font = { name: FONT, size: 11, bold: true };
        if (row.F) { const f = ws.getCell(r, col(6)); f.value = row.F; f.font = GRAY; }
      } else if (row.kind === 'kalanTitle') {
        const c = ws.getCell(r, col(2)); c.value = 'KALANLAR'; c.font = { name: FONT, size: 12, bold: true };
      }
      r++;
    }
    return r;
  }

  function setWidths(ws, twoCol) {
    const w = { 1: 7, 2: 12, 3: 7.5, 4: 7, 5: 8, 6: twoCol ? 12 : 22 };
    for (const [k, v] of Object.entries(w)) ws.getColumn(Number(k)).width = v;
    if (twoCol) for (const [k, v] of Object.entries(w)) ws.getColumn(Number(k) + 6).width = v;
    else { ws.getColumn(7).width = 7; ws.getColumn(8).width = 12; ws.getColumn(9).width = 8; ws.getColumn(10).width = 5; ws.getColumn(11).width = 8; }
  }

  function materialSheet(wb, res, meta, opts) {
    const name = safeSheetName(meta.sheetName);
    const ws = wb.addWorksheet(name, { pageSetup: { orientation: 'portrait', fitToWidth: 1, fitToHeight: 0, paperSize: 9, margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 } } });
    const twoCol = !!opts.twoColumn;
    setWidths(ws, twoCol);
    ws.getCell('A1').value = meta.desc; ws.getCell('A1').font = { name: FONT, size: 16, bold: true };
    ws.getRow(1).height = 21;
    const headCol = 7; // sipariş bloğu G2'den başlar (iki sütunlu düzende sağ sütunun üstünde)
    ws.getCell(1, headCol).value = meta.color || ''; ws.getCell(1, headCol).font = { name: FONT, size: 12, bold: true };
    let hr = 2;
    for (const o of meta.orders) {
      ws.getCell(hr, headCol).value = isFinite(Number(o.orderNo)) ? Number(o.orderNo) : o.orderNo;
      ws.getCell(hr, headCol + 1).value = o.customer || '';
      if (o.date) { ws.getCell(hr, headCol + 2).value = o.date; ws.getCell(hr, headCol + 2).numFmt = 'd-mmm'; }
      ws.getCell(hr, headCol + 3).value = o.pozCount;
      ws.getCell(hr, headCol + 4).value = o.note || '';
      hr++;
    }
    const blocks = [];
    for (const g of res.groups) blocks.push(groupBlock(g, opts));
    for (const g of res.kalan.fallbackGroups || []) blocks.push(groupBlock(g, opts));
    const kb = kalanBlock(res.kalan);
    const startRow = 3;
    if (!twoCol) {
      let r = Math.max(startRow, hr + 1);
      for (const b of blocks) r = writeRows(ws, b, 0, r, opts);
      if (kb.length) r = writeRows(ws, kb, 0, r, opts);
      ws.pageSetup.printTitlesRow = '1:1';
      ws.pageSetup.printArea = `A1:K${Math.max(r, hr)}`;
    } else {
      const total = blocks.reduce((s, b) => s + b.length, 0) + kb.length;
      let r1 = startRow, r2 = Math.max(startRow, hr + 1), i = 0, acc = 0;
      for (; i < blocks.length && acc + blocks[i].length <= total / 2 + 3; i++) { r1 = writeRows(ws, blocks[i], 0, r1, opts); acc += blocks[i].length; }
      for (; i < blocks.length; i++) r2 = writeRows(ws, blocks[i], 6, r2, opts);
      if (kb.length) { if (r1 <= r2) r1 = writeRows(ws, kb, 0, r1, opts); else r2 = writeRows(ws, kb, 6, r2, opts); }
      ws.pageSetup.printTitlesRow = '1:1';
      ws.pageSetup.printArea = `A1:L${Math.max(r1, r2)}`;
    }
    return ws;
  }

  function summarySheet(wb, results, meta) {
    const ws = wb.addWorksheet('ÖZET');
    ws.getColumn(1).width = 26; ws.getColumn(2).width = 12;
    for (let c = 3; c <= 14; c++) ws.getColumn(c).width = 12;
    ws.getCell('A1').value = 'KESİM OPTİMİZASYONU – ÖZET'; ws.getCell('A1').font = { name: FONT, size: 14, bold: true };
    ws.getCell('A2').value = 'Oluşturma: ' + new Date().toLocaleString('tr-TR');
    let r = 4;
    const hdr = ['Parça', 'Renk', 'Çubuk boyu', 'Demet', 'Poz', 'Parça adedi', 'Toplam (m)', 'Çubuk', 'Alt sınır', 'Fire %', 'Kesim', 'Demet bozma', 'Grup', 'KALANLAR poz', 'Artık kesim', 'Maliyet'];
    hdr.forEach((h, i) => { const c = ws.getCell(r, i + 1); c.value = h; c.font = { name: FONT, bold: true }; c.border = BORDER; c.alignment = { wrapText: true, vertical: 'middle' }; });
    r++;
    for (const x of results) {
      const st = x.result.stats;
      const vals = [x.meta.desc, x.meta.color, x.result.P.L, x.result.P.maxBundle, x.result.items.length, st.pieces, +(st.pieceMm / 1000).toFixed(1), st.bars, st.lowerBoundBars, +(st.wastePct * 100).toFixed(2), st.strokes, st.changes, st.groupCount, st.kalanCount, st.kalanStrokes, Math.round(st.cost)];
      vals.forEach((v, i) => { const c = ws.getCell(r, i + 1); c.value = v; c.border = BORDER; });
      r++;
    }
    r += 2;
    ws.getCell(r, 1).value = 'Parametreler'; ws.getCell(r, 1).font = { name: FONT, bold: true }; r++;
    const P = results.length ? results[0].result.P : {};
    const plist = [['Testere payı (mm)', P.kerf], ['Emniyet payı (mm)', P.safety], ['Kesim ağırlığı', P.wCut], ['Çubuk ağırlığı', P.wBar], ['Demet bozma ağırlığı', P.wChange], ['KALANLAR poz cezası', P.wKalan], ['Aynı ölçü birleştirme', P.mergeSameLength ? 'açık' : 'kapalı'], ['Poz bölme (gruplar arası)', P.allowSplit ? 'açık' : 'kapalı']];
    for (const [k, v] of plist) { ws.getCell(r, 1).value = k; ws.getCell(r, 2).value = v; r++; }
    r += 1;
    ws.getCell(r, 1).value = 'Siparişler'; ws.getCell(r, 1).font = { name: FONT, bold: true }; r++;
    for (const o of meta.orders) { ws.getCell(r, 1).value = o.orderNo; ws.getCell(r, 2).value = o.customer; if (o.date) { ws.getCell(r, 3).value = o.date; ws.getCell(r, 3).numFmt = 'dd.mm.yyyy'; } ws.getCell(r, 4).value = o.note || ''; r++; }
    return ws;
  }

  function pozListSheet(wb, results) {
    const ws = wb.addWorksheet('POZ LİSTESİ');
    const hdr = ['Sipariş', 'Müşteri', 'Poz', 'Parça', 'Adet', 'Ölçü', 'Grup'];
    const widths = [9, 14, 7, 26, 7, 8, 30];
    hdr.forEach((h, i) => { const c = ws.getCell(1, i + 1); c.value = h; c.font = { name: FONT, bold: true }; c.border = BORDER; ws.getColumn(i + 1).width = widths[i]; });
    const rows = [];
    for (const x of results) {
      const res = x.result;
      const where = new Map(); // item → [{label, count}]
      const push = (item, label, count) => { const a = where.get(item) || []; a.push({ label, count }); where.set(item, a); };
      for (const g of res.groups.concat(res.kalan.fallbackGroups || [])) for (const s of g.steps) for (const a of s.alloc) push(a.item, `G${g.no}`, a.count);
      for (const e of res.kalan.plan) for (const s of e.steps) push(s.item, `KALANLAR (artık G${e.groupNo})`, s.n);
      for (const d of res.kalan.deficit || []) push(d.item, 'EKSİK', d.count);
      for (const it of res.items) {
        const w = where.get(it) || [];
        // aynı etiketleri birleştir
        const agg = new Map();
        for (const e of w) agg.set(e.label, (agg.get(e.label) || 0) + e.count);
        const label = [...agg.entries()].map(([l, c]) => agg.size > 1 || c !== it.count ? `${l} (${c})` : l).join(' + ');
        rows.push([it.order, it.customer, it.poz, x.meta.desc + (x.meta.color ? ' ' + x.meta.color : ''), it.count, it.len, label]);
      }
    }
    rows.sort((a, b) => String(a[3]).localeCompare(String(b[3]), 'tr') || String(a[0]).localeCompare(String(b[0]), 'tr') || (Number(a[2]) - Number(b[2])) || String(a[2]).localeCompare(String(b[2]), 'tr'));
    rows.forEach((row, i) => row.forEach((v, j) => {
      const c = ws.getCell(i + 2, j + 1);
      c.value = (j === 0 || j === 2) && isFinite(Number(v)) ? Number(v) : v; c.border = BORDER;
      if (j === 5) c.numFmt = '#,##0';
    }));
    ws.views = [{ state: 'frozen', ySplit: 1 }];
    ws.autoFilter = { from: 'A1', to: 'G1' };
    return ws;
  }

  function remnantSheet(wb, results) {
    const ws = wb.addWorksheet('ARTIK PLANI');
    const hdr = ['Parça', 'Kaynak grup', 'Adımdan sonra', 'Artık adet', 'Artık boy', 'Kesim ölçü', 'Adet', 'Poz', 'Sipariş', 'Müşteri'];
    const widths = [26, 11, 12, 10, 10, 10, 7, 7, 9, 14];
    hdr.forEach((h, i) => { const c = ws.getCell(1, i + 1); c.value = h; c.font = { name: FONT, bold: true }; c.border = BORDER; ws.getColumn(i + 1).width = widths[i]; });
    let r = 2;
    for (const x of results) {
      for (const e of x.result.kalan.plan) {
        for (const s of e.steps) {
          const vals = [x.meta.desc + (x.meta.color ? ' ' + x.meta.color : ''), `G${e.groupNo}`, e.step, e.count, e.len, s.len, s.n, s.item.poz, s.item.order, s.item.customer];
          vals.forEach((v, i) => { const c = ws.getCell(r, i + 1); c.value = (i === 7 || i === 8) && isFinite(Number(v)) ? Number(v) : v; c.border = BORDER; });
          r++;
        }
      }
      for (const d of x.result.kalan.deficit || []) {
        const vals = [x.meta.desc, 'EKSİK', '', '', '', d.item.len, d.count, d.item.poz, d.item.order, d.item.customer];
        vals.forEach((v, i) => { const c = ws.getCell(r, i + 1); c.value = v; c.border = BORDER; c.font = { name: FONT, color: { argb: 'FFC00000' } }; });
        r++;
      }
    }
    if (r === 2) ws.getCell(2, 1).value = 'Artıktan kesim yok.';
    ws.views = [{ state: 'frozen', ySplit: 1 }];
    return ws;
  }

  /**
   * results: [{ result, meta: { desc, color, sheetName, orders: [{orderNo, customer, date, pozCount, note}] }, opts: { twoColumn, showRemnants } }]
   * meta: { orders }
   */
  async function buildWorkbook(results, meta) {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Panjur Kesim Optimizasyonu';
    wb.created = new Date();
    const used = new Set(['ÖZET', 'POZ LİSTESİ', 'ARTIK PLANI']);
    for (const x of results) {
      let name = safeSheetName(x.meta.sheetName || x.meta.desc);
      if (used.has(name)) { let i = 2; while (used.has(`${name} ${i}`.slice(0, 31))) i++; name = `${name} ${i}`.slice(0, 31); }
      used.add(name);
      x.meta = Object.assign({}, x.meta, { sheetName: name });
      materialSheet(wb, x.result, x.meta, x.opts || {});
    }
    summarySheet(wb, results, meta);
    pozListSheet(wb, results);
    remnantSheet(wb, results);
    return wb.xlsx.writeBuffer();
  }

  return { buildWorkbook, groupBlock, kalanBlock, stepRow };
});
