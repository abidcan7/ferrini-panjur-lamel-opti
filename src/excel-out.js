/*
 * Sonuç Excel'i (ExcelJS gerektirir).
 *
 * Düzen kesim ustası içindir, ofis için değil:
 *   - Usta biten kesimin KOMPLE SATIRINI kalın uçlu marker ile boyar. Bu yüzden
 *     satırlar marker darbesi yüksekliğinde (~27 pt ≈ 9,5 mm), aralarında kalın
 *     çizgi var (darbe komşu satıra taşmasın) ve veri satırlarında hiç zemin
 *     dolgusu / gri yazı yok — boyandıktan sonra da okunabilsin diye yazı koyu.
 *   - ÖLÇÜ testereye kurulan sayıdır: en büyük punto, kalın.
 *   - Grup başlığındaki BOY adedi demet kurulum talimatıdır: iri ve ayrı hücre.
 *   - A4 dikey, yan yana iki grup sütunu; bir grup kutusu sayfa ortasından bölünmez.
 *   - Tek proje varsa sipariş/müşteri sayfa başlığına taşınır, satırlardan kalkar;
 *     birden fazla proje varsa satırda yalnız sipariş no durur, müşteri karşılığı
 *     sayfa başlığında listelenir.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('exceljs'));
  else root.PanjurExcel = factory(root.ExcelJS);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (ExcelJS) {
  'use strict';

  const FONT = 'Calibri';
  const THIN = { style: 'thin', color: { argb: 'FF000000' } };
  const MED = { style: 'medium', color: { argb: 'FF000000' } };
  const BORDER = { top: THIN, left: THIN, bottom: THIN, right: THIN };
  const GRAY = { name: FONT, size: 9, color: { argb: 'FF666666' } };
  const HEAD_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDDDDDD' } };
  const KALAN_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFBFBFBF' } };

  // --- kesim listesi ölçüleri (punto) ---
  const H_TITLE = 26;   // grup başlığı
  const H_HEAD = 15;    // sütun başlığı
  const H_STEP = 27;    // kesim satırı — marker darbesi bu yüksekliğe sığar
  const H_SUM = 17;     // grup toplamı
  const H_GAP = 10;     // gruplar arası boşluk
  // A4 dikey yazdırılabilir yükseklik (11,69" − 2×0,3" kenar) punto cinsinden,
  // sayfa başlığı bandı ve %8 emniyet payı düşülmüş hâli
  const PAGE_H = (11.69 - 0.7) * 72 - 59 - 20;   // A4 dikey − kenar − başlık bandı − emniyet

  function joinUnique(arr) {
    const seen = [];
    for (const x of arr) if (!seen.includes(x)) seen.push(x);
    return seen.join(' + ');
  }

  function safeSheetName(s) {
    return s.replace(/[\[\]:*?/\\]/g, ' ').trim().slice(0, 31) || 'Sayfa';
  }

  function numOrText(v) {
    if (v === '' || v == null) return null;
    return isFinite(Number(v)) ? Number(v) : v;
  }

  // Bir adımı satır verisine çevirir (arayüz de bunu kullanır)
  function stepRow(step) {
    const orders = step.alloc.map(a => a.item.order || '');
    const customers = step.alloc.map(a => a.item.customer || '');
    const pozs = step.alloc.map(a => String(a.item.poz));
    const counts = step.alloc.map(a => a.count);
    const single = step.alloc.length === 1;
    const uo = joinUnique(orders), uc = joinUnique(customers);
    return {
      order: uo.includes(' + ') ? uo : numOrText(uo),
      customer: uc,
      poz: single ? (isFinite(Number(pozs[0])) ? Number(pozs[0]) : pozs[0]) : pozs.join(' + '),
      count: single ? counts[0] : counts.join(' + '),
      len: step.len,
    };
  }

  // ---------------------------------------------------------------- blok üretimi

  /** Bir grubu satır listesine çevirir. */
  function groupBlock(g, opts) {
    const rows = [];
    rows.push({
      kind: 'gtitle',
      title: g.fallback ? `GRUP ${g.no}  (artık yetmedi)` : `GRUP ${g.no}`,
      bars: g.bars,
      sub: `${g.strokes} kesim` + (g.changes ? ` · ${g.changes} demet bozma` : ''),
    });
    rows.push({ kind: 'ghead' });
    g.steps.forEach((s, i) => {
      const r = stepRow(s);
      rows.push({
        kind: 'step', sira: i + 1, len: r.len, count: r.count, poz: r.poz, order: r.order,
        note: s.setAside > 0 ? `${s.setAside} boy kenara → ${s.n}` : '',
        setAside: s.setAside > 0,
      });
    });
    const rem = (g.remnants || []).filter(r => !r.final && r.count > 0).map(r => `${r.count}×${r.len}`).join(', ');
    rows.push({
      kind: 'gsum', steps: g.steps.length, value: g.sumLen,
      note: `kalan ${g.leftover} mm` + (rem && opts.showRemnants ? ` · artık ${rem}` : ''),
    });
    rows.push({ kind: 'gap' });
    return rows;
  }

  /** KALANLAR: artık demetlerinden kesilecek pozlar. */
  function kalanBlock(kalan) {
    const rows = [];
    if (!kalan.parts.length) return rows;
    const src = new Map();
    for (const e of kalan.plan) for (const s of e.steps) {
      const m = src.get(s.part.id) || new Map();
      m.set(e.groupNo, (m.get(e.groupNo) || 0) + s.n);
      src.set(s.part.id, m);
    }
    rows.push({ kind: 'ktitle', count: kalan.parts.length });
    rows.push({ kind: 'ghead' });
    kalan.parts.forEach((k, i) => {
      const m = src.get(k.part.id);
      const it = k.item;
      rows.push({
        kind: 'step', sira: i + 1, len: it.len, count: k.count,
        poz: numOrText(it.poz), order: numOrText(it.order),
        note: m ? 'artık: ' + [...m.keys()].slice(0, 3).map(g => `G${g}`).join('+') + (m.size > 3 ? ' …' : '') : '',
      });
    });
    rows.push({ kind: 'gap' });
    return rows;
  }

  function blockHeight(rows) {
    let h = 0;
    for (const r of rows) {
      if (r.kind === 'gtitle' && r.sub) h += H_HEAD;     // başlık altı özet satırı
      h += r.kind === 'gtitle' || r.kind === 'ktitle' ? H_TITLE
        : r.kind === 'ghead' ? H_HEAD
        : r.kind === 'step' ? H_STEP
        : r.kind === 'gsum' ? H_SUM : H_GAP;
    }
    return h;
  }

  // ---------------------------------------------------------------- yazım

  /**
   * Sütun düzeni. multi=true ise satırda sipariş no sütunu da var.
   * [anahtar, genişlik] — blok içi sıra.
   */
  function columns(multi) {
    // genişlikler punto büyüklüğüne göre: ÖLÇÜ 18 pt, ADET 14 pt, POZ 12 pt
    return multi
      ? [['sira', 4], ['len', 10], ['poz', 11], ['count', 11], ['order', 7], ['note', 11]]
      : [['sira', 4], ['len', 10], ['poz', 12], ['count', 11], ['note', 13]];
  }

  function setWidths(ws, cols) {
    const n = cols.length;
    for (let blk = 0; blk < 2; blk++) {
      for (let i = 0; i < n; i++) ws.getColumn(blk * (n + 1) + i + 1).width = cols[i][1];
    }
    ws.getColumn(n + 1).width = 2;                 // bloklar arası boşluk sütunu
  }

  function rowHeight(ws, r, h) {
    const row = ws.getRow(r);
    if (!row.height || row.height < h) row.height = h;   // iki sütun aynı satırı paylaşır
  }

  const LABEL = { sira: '#', len: 'ÖLÇÜ', count: 'ADET', poz: 'POZ', order: 'SİPARİŞ', note: 'AÇIKLAMA' };

  /** Bir bloğu (satır listesi) verilen sütun kaymasında ve satırdan başlayarak yazar. */
  function writeBlock(ws, rows, cols, colOffset, startRow) {
    const n = cols.length;
    const col = i => colOffset + i + 1;               // 1 tabanlı
    let r = startRow, blockStart = null;
    for (const row of rows) {
      if (row.kind === 'gtitle' || row.kind === 'ktitle') {
        rowHeight(ws, r, H_TITLE);
        const isK = row.kind === 'ktitle';
        if (isK) {
          // KALANLAR: demet hücresi yok, başlık tüm genişliğe yayılır
          ws.mergeCells(r, col(0), r, col(n - 1));
          const t = ws.getCell(r, col(0));
          t.value = `KALANLAR — ${row.count} poz, artıklardan kesilecek`;
          t.font = { name: FONT, size: 13, bold: true };
          t.alignment = { vertical: 'middle' };
          t.fill = KALAN_FILL;
        } else {
          // başlık: ilk sütunlar birleşik, en sağda demet (boy) adedi
          ws.mergeCells(r, col(0), r, col(n - 3));
          const t = ws.getCell(r, col(0));
          t.value = row.title;
          t.font = { name: FONT, size: 13, bold: true };
          t.alignment = { vertical: 'middle' };
          t.fill = HEAD_FILL;
          ws.mergeCells(r, col(n - 2), r, col(n - 1));
          const b = ws.getCell(r, col(n - 2));
          b.value = `${row.bars} BOY`;
          b.font = { name: FONT, size: 15, bold: true };
          b.alignment = { horizontal: 'right', vertical: 'middle' };
          b.fill = HEAD_FILL;
        }
        for (let i = 0; i < n; i++) {
          const c = ws.getCell(r, col(i));
          c.border = { top: MED, bottom: THIN, left: i === 0 ? MED : undefined, right: i === n - 1 ? MED : undefined };
        }
        r++;
        // alt satır: kesim/bozma özeti
        if (!isK && row.sub) {
          rowHeight(ws, r, H_HEAD);
          ws.mergeCells(r, col(0), r, col(n - 1));
          const s = ws.getCell(r, col(0));
          s.value = row.sub; s.font = GRAY;
          s.border = { left: MED, right: MED };
          r++;
        }
      } else if (row.kind === 'ghead') {
        rowHeight(ws, r, H_HEAD);
        blockStart = r + 1;
        cols.forEach(([k], i) => {
          const c = ws.getCell(r, col(i));
          c.value = LABEL[k];
          c.font = { name: FONT, size: 9, bold: true, color: { argb: 'FF444444' } };
          c.alignment = { horizontal: k === 'note' ? 'left' : 'center' };
          c.border = { bottom: MED, left: i === 0 ? MED : undefined, right: i === n - 1 ? MED : undefined };
        });
        r++;
      } else if (row.kind === 'step') {
        rowHeight(ws, r, H_STEP);
        cols.forEach(([k], i) => {
          const c = ws.getCell(r, col(i));
          c.value = row[k] == null || row[k] === '' ? null : row[k];
          // Satır marker ile boyanacak: yazı koyu ve kalın kalmalı, zemin dolgusu olmamalı
          c.font = k === 'len' ? { name: FONT, size: 18, bold: true }
            : k === 'count' ? { name: FONT, size: 14, bold: true }
            : k === 'note' ? { name: FONT, size: 9, bold: !!row.setAside }
            : k === 'sira' ? { name: FONT, size: 10, color: { argb: 'FF777777' } }
            : { name: FONT, size: 12 };
          if (k === 'len') c.numFmt = '0';
          c.alignment = {
            vertical: 'middle',
            horizontal: k === 'note' ? 'left' : k === 'poz' ? 'center' : k === 'sira' ? 'center' : 'right',
            wrapText: k === 'note',
            indent: k === 'count' || k === 'len' ? 1 : 0,   // sayı komşu sütuna değmesin
          };
          // kalın yatay çizgiler: marker darbesi kendi şeridinde kalsın
          c.border = {
            top: MED, bottom: MED,
            left: i === 0 ? MED : THIN,
            right: i === n - 1 ? MED : THIN,
          };
        });
        r++;
      } else if (row.kind === 'gsum') {
        rowHeight(ws, r, H_SUM);
        const li = cols.findIndex(([k]) => k === 'len');
        const letter = ws.getColumn(col(li)).letter;
        const c = ws.getCell(r, col(li));
        c.value = { formula: `SUM(${letter}${blockStart}:${letter}${r - 1})`, result: row.value };
        c.numFmt = '0';
        c.font = { name: FONT, size: 11, bold: true };
        c.alignment = { horizontal: 'right' };
        const ni = cols.findIndex(([k]) => k === 'note');
        ws.mergeCells(r, col(ni), r, col(n - 1));
        const nc = ws.getCell(r, col(ni));
        nc.value = row.note; nc.font = GRAY; nc.alignment = { horizontal: 'left' };
        for (let i = 0; i < n; i++) {
          const b = ws.getCell(r, col(i));
          b.border = { bottom: MED, left: i === 0 ? MED : undefined, right: i === n - 1 ? MED : undefined };
        }
        r++;
      } else {                                   // gap
        rowHeight(ws, r, H_GAP);
        r++;
      }
    }
    return r;
  }

  // ---------------------------------------------------------------- sayfa başlığı

  function sheetHeader(ws, res, meta, cols, multi) {
    const n = cols.length;
    const lastCol = 2 * n + 1;
    ws.mergeCells(1, 1, 1, lastCol);
    const t = ws.getCell(1, 1);
    t.value = meta.desc + (meta.color ? '  ·  ' + meta.color : '');
    t.font = { name: FONT, size: 16, bold: true };
    ws.getRow(1).height = 22;

    // tek proje: sipariş + müşteri başlıkta; çok proje: sipariş→müşteri karşılıkları
    const o = meta.orders || [];
    const fmtDate = d => {
      if (!d) return '';
      const dt = d instanceof Date ? d : new Date(d);
      return isNaN(dt) ? '' : `${String(dt.getUTCDate()).padStart(2, '0')}.${String(dt.getUTCMonth() + 1).padStart(2, '0')}.${dt.getUTCFullYear()}`;
    };
    const projeText = o.length === 1
      ? [o[0].orderNo, o[0].customer, fmtDate(o[0].date), o[0].note].filter(Boolean).join('  ·  ')
      : o.map(x => [x.orderNo, x.customer].filter(Boolean).join(' ') + (x.note ? ' (' + x.note + ')' : '')).join('   |   ');
    ws.mergeCells(2, 1, 2, lastCol);
    const p = ws.getCell(2, 1);
    p.value = (multi ? 'PROJELER:  ' : 'PROJE:  ') + projeText;
    p.font = { name: FONT, size: 12, bold: true };
    ws.getRow(2).height = 17;

    const st = res.stats;
    ws.mergeCells(3, 1, 3, lastCol);
    const s = ws.getCell(3, 1);
    s.value = `${st.bars} boy × ${res.P.L} mm  ·  ${st.strokes} kesim  ·  ${st.groupCount} grup  ·  demet ${res.P.maxBundle}  ·  testere ${res.P.kerf} mm  ·  fire %${(st.wastePct * 100).toFixed(1).replace('.', ',')}`;
    s.font = GRAY;
    ws.getRow(3).height = 14;
    ws.getRow(4).height = 6;
    return 5;                                     // bloklar bu satırdan başlar
  }

  // ---------------------------------------------------------------- malzeme sayfası

  function materialSheet(wb, res, meta, opts) {
    const ws = wb.addWorksheet(safeSheetName(meta.sheetName), {
      pageSetup: {
        orientation: 'portrait', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0,
        horizontalCentered: true,
        margins: { left: 0.3, right: 0.3, top: 0.35, bottom: 0.35, header: 0.15, footer: 0.15 },
      },
      views: [{ state: 'frozen', ySplit: 4 }],
    });
    const multi = (meta.orders || []).length > 1;
    const cols = columns(multi);
    setWidths(ws, cols);
    const startRow = sheetHeader(ws, res, meta, cols, multi);

    const blocks = [];
    for (const g of res.groups) blocks.push(groupBlock(g, opts));
    for (const g of res.kalan.fallbackGroups || []) blocks.push(groupBlock(g, opts));
    const kb = kalanBlock(res.kalan);
    if (kb.length) blocks.push(kb);

    // A4 dikey, yan yana iki sütun; bir grup kutusu sayfa ortasından bölünmez
    const blockCols = cols.length + 1;
    let rL = startRow, rR = startRow, hL = 0, hR = 0, side = 0, lastRow = startRow;
    for (const b of blocks) {
      const bh = blockHeight(b);
      if (side === 0 && hL > 0 && hL + bh > PAGE_H) { side = 1; }
      if (side === 1 && hR > 0 && hR + bh > PAGE_H) {
        const next = Math.max(rL, rR);
        ws.getRow(next - 1).addPageBreak();        // önceki sayfanın sonu
        rL = rR = next; hL = hR = 0; side = 0;
      }
      if (side === 0) { rL = writeBlock(ws, b, cols, 0, rL); hL += bh; }
      else { rR = writeBlock(ws, b, cols, blockCols, rR); hR += bh; }
      lastRow = Math.max(lastRow, rL, rR);
    }
    ws.pageSetup.printTitlesRow = '1:4';           // başlık bandı her sayfada
    ws.pageSetup.printArea = `A1:${ws.getColumn(2 * cols.length + 1).letter}${Math.max(lastRow, 5)}`;
    return ws;
  }

  // ---------------------------------------------------------------- ofis sayfaları

  /** Ofis sayfaları: yatay A4, sütunlar genişliğe sığdırılır, başlık her sayfada. */
  function officePageSetup(ws, lastCol) {
    ws.pageSetup = {
      orientation: 'landscape', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0,
      margins: { left: 0.3, right: 0.3, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 },
    };
    ws.pageSetup.printTitlesRow = '1:1';
    if (lastCol) ws.pageSetup.printArea = undefined;
  }

  function summarySheet(wb, results, meta) {
    const ws = wb.addWorksheet('ÖZET');
    ws.getColumn(1).width = 26; ws.getColumn(2).width = 12;
    for (let c = 3; c <= 16; c++) ws.getColumn(c).width = 12;
    ws.getCell('A1').value = 'KESİM OPTİMİZASYONU – ÖZET'; ws.getCell('A1').font = { name: FONT, size: 14, bold: true };
    ws.getCell('A2').value = 'Oluşturma: ' + new Date().toLocaleString('tr-TR');
    let r = 4;
    const hdr = ['Parça', 'Renk', 'Boy uzunluğu', 'Demet', 'Poz', 'Parça adedi', 'Toplam (m)', 'Boy', 'Alt sınır', 'Fire %', 'Kesim', 'Demet bozma', 'Grup', 'KALANLAR poz', 'Artık kesim', 'Maliyet'];
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
    const plist = [['Testere payı (mm)', P.kerf], ['Emniyet payı (mm)', P.safety], ['Kesim ağırlığı', P.wCut], ['Boy ağırlığı', P.wBar], ['Demet bozma ağırlığı', P.wChange], ['KALANLAR poz cezası', P.wKalan], ['Aynı ölçü birleştirme', P.mergeSameLength ? 'açık' : 'kapalı'], ['Poz bölme (gruplar arası)', P.allowSplit ? 'açık' : 'kapalı']];
    for (const [k, v] of plist) { ws.getCell(r, 1).value = k; ws.getCell(r, 2).value = v; r++; }
    r += 1;
    ws.getCell(r, 1).value = 'Siparişler'; ws.getCell(r, 1).font = { name: FONT, bold: true }; r++;
    for (const o of meta.orders) { ws.getCell(r, 1).value = o.orderNo; ws.getCell(r, 2).value = o.customer; if (o.date) { ws.getCell(r, 3).value = o.date; ws.getCell(r, 3).numFmt = 'dd.mm.yyyy'; } ws.getCell(r, 4).value = o.note || ''; r++; }
    officePageSetup(ws);
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
      const where = new Map();
      const push = (item, label, count) => { const a = where.get(item) || []; a.push({ label, count }); where.set(item, a); };
      for (const g of res.groups.concat(res.kalan.fallbackGroups || [])) for (const s of g.steps) for (const a of s.alloc) push(a.item, `G${g.no}`, a.count);
      for (const e of res.kalan.plan) for (const s of e.steps) push(s.item, `KALANLAR (artık G${e.groupNo})`, s.n);
      for (const d of res.kalan.deficit || []) push(d.item, 'EKSİK', d.count);
      for (const it of res.items) {
        const w = where.get(it) || [];
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
    officePageSetup(ws);
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
    officePageSetup(ws);
    return ws;
  }

  /**
   * results: [{ result, meta: { desc, color, sheetName, orders: [...] }, opts: { showRemnants } }]
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
