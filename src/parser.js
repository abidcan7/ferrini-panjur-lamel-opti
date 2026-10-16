/*
 * İmalat listesi ayrıştırıcı — SheetJS (XLSX) gerektirir.
 *
 * Desteklenen üç girdi biçimi:
 *   A) ERP ham çıktısı — CSV (.csv, noktalı virgül, Windows-1254) ya da aynı yapıdaki .xlsx:
 *      başlıksız 7 sütun → Poz; Stok kodu; Açıklama; Renk; Adet; Ölçü; Ağırlık
 *      Örn: 74;TAP.P.SD.B06.55E;AS 55 EKO ALÜMINYUM LAMEL;BEJ GRİ;39;1.274;6,59932
 *      (ölçüde "." binlik ayırıcıdır: 1.274 → 1274 mm)
 *   B) Düzenlenmiş İMALAT LİSTESİ (.xls/.xlsx): başlık satırı (Poz no / Adet / Ölçü) ve
 *      bölüm başlıkları (Lamel, Alt parça, Yan dikme, Tambur borusu, …)
 *   C) Başlıklı ama bölümsüz tablo — B ile aynı yoldan okunur.
 *
 * Parça türü, bölüm adından değil **açıklamadan** belirlenir; böylece stok kodu
 * projeden projeye değişse de (renk kodu stok kodunun içinde) doğru eşleşir.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('xlsx'));
  else root.PanjurParse = factory(root.XLSX);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (XLSX) {
  'use strict';

  // Tanınan parça türleri. bundle: varsayılan demet (tek seferde kesilen adet),
  // on: varsayılan olarak optimize edilsin mi.
  const TYPES = [
    { type: 'lamel', label: 'LAMEL', bundle: 50, on: true, match: s => /lamel/.test(s) && !/kapa|tapa/.test(s) },
    { type: 'altparca', label: 'ALT PARÇA', bundle: 1, on: true, match: s => /alt\s*par/.test(s) },
    { type: 'dikme', label: 'DİKME', bundle: 2, on: true, match: s => /dikme/.test(s) },
    { type: 'tambur', label: 'TAMBUR', bundle: 1, on: true, match: s => /tambur|m\.?\s*borusu/.test(s) },
    { type: 'fitil', label: 'FİTİL', bundle: 1, on: false, match: s => /fitil/.test(s) },
  ];
  const OTHER = { type: 'diger', label: 'DİĞER', bundle: 1, on: false };

  function norm(s) {
    return String(s == null ? '' : s).trim().toLocaleLowerCase('tr')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\u0131/g, 'i');
  }

  /** "74" → 74, "A-3" → "A-3" (sayısal pozlar sayı olarak tutulur) */
  function normPoz(v) {
    if (typeof v === 'number') return v;
    const t = String(v == null ? '' : v).trim();
    return /^\d+$/.test(t) ? Number(t) : t;
  }

  function typeOf(desc) {
    const s = norm(desc);
    return TYPES.find(t => t.match(s)) || OTHER;
  }

  /** Türkçe biçimli sayı: "1.274" → 1274, "3,68" → 3.68, "1.274,5" → 1274.5 */
  function parseTrNumber(t) {
    const s = String(t).trim().replace(/\s/g, '');
    if (!s || !/[\d]/.test(s)) return null;
    if (!/^[-+]?[\d.,]+$/.test(s)) return null;
    const dot = s.lastIndexOf('.'), com = s.lastIndexOf(',');
    let v;
    if (dot >= 0 && com >= 0) {
      v = com > dot ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
    } else if (com >= 0) {
      v = s.replace(/,/g, '.');
    } else if (dot >= 0) {
      // yalnız nokta: "1.274" binlik, "0.6" ondalık
      v = /^[-+]?\d{1,3}(\.\d{3})+$/.test(s) ? s.replace(/\./g, '') : s;
    } else v = s;
    const n = Number(v);
    return isFinite(n) ? n : null;
  }

  /** Hücre/metinden ölçü (mm). Bozulmuş Excel tarihlerini düzeltir. */
  function decodeLen(v) {
    if (v == null || v === '') return null;
    if (v instanceof Date) {
      return { len: v.getDate() * 1000 + (v.getMonth() + 1), fixed: true, raw: v.toISOString().slice(0, 10) };
    }
    if (typeof v === 'string') {
      const t = v.trim();
      if (!t) return null;
      const m = /^(\d{1,2})[./](\d{1,2})[./](\d{2,4})$/.exec(t);
      if (m) return { len: Number(m[1]) * 1000 + Number(m[2]), fixed: true, raw: t };
      const n = parseTrNumber(t);
      return n == null ? null : { len: Math.round(n) };
    }
    if (typeof v === 'number') {
      if (!isFinite(v)) return null;
      if (Number.isInteger(v) && v >= 36526 && v <= 73050) {
        // Excel tarih seri numarası: "1.005" → 1 Mayıs → 1005
        const date = new Date(Math.round((v - 25569) * 86400000));
        return { len: date.getUTCDate() * 1000 + (date.getUTCMonth() + 1), fixed: true, raw: v };
      }
      if (v > 0 && v < 100 && !Number.isInteger(v)) return { len: Math.round(v * 1000), fixed: true, raw: v };
      return { len: Math.round(v) };
    }
    return null;
  }

  // ---------------------------------------------------------------- metin / CSV

  function decodeText(buf) {
    const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    if (bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) return new TextDecoder('utf-8').decode(bytes.subarray(3));
    try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
    catch (e) { return new TextDecoder('windows-1254').decode(bytes); }
  }

  function sniffDelimiter(text) {
    const line = text.split(/\r?\n/).find(l => l.trim()) || '';
    const counts = [[';', 0], ['\t', 0], [',', 0], ['|', 0]].map(([d]) => [d, line.split(d).length - 1]);
    counts.sort((a, b) => b[1] - a[1]);
    return counts[0][1] > 0 ? counts[0][0] : ';';
  }

  function parseCsv(text, delim) {
    const rows = [];
    let row = [], field = '', i = 0, quoted = false;
    const push = () => { row.push(field); field = ''; };
    const eol = () => { push(); if (row.length > 1 || row[0] !== '') rows.push(row); row = []; };
    while (i < text.length) {
      const c = text[i];
      if (quoted) {
        if (c === '"') { if (text[i + 1] === '"') { field += '"'; i += 2; continue; } quoted = false; i++; continue; }
        field += c; i++; continue;
      }
      if (c === '"' && field === '') { quoted = true; i++; continue; }
      if (c === delim) { push(); i++; continue; }
      if (c === '\r') { i++; continue; }
      if (c === '\n') { eol(); i++; continue; }
      field += c; i++;
    }
    if (field !== '' || row.length) eol();
    return rows;
  }

  // ---------------------------------------------------------------- ortak çözümleme

  const HEADER_ALIASES = {
    poz: ['poz no', 'poz', 'pozno', 'poz numarasi'],
    stok: ['stok kodu', 'stok', 'stokkodu', 'malzeme kodu'],
    acik: ['aciklama', 'malzeme', 'malzeme adi', 'tanim'],
    renk: ['renk'],
    adet: ['adet', 'miktar'],
    olcu: ['olcu', 'olcu (mm)', 'boy', 'uzunluk'],
  };

  function findHeader(rows) {
    for (let r = 0; r < Math.min(rows.length, 30); r++) {
      const cells = (rows[r] || []).map(norm);
      const col = {};
      for (const [key, names] of Object.entries(HEADER_ALIASES)) {
        col[key] = cells.findIndex(c => names.includes(c));
      }
      if (col.poz >= 0 && col.adet >= 0 && col.olcu >= 0) return { row: r, col };
    }
    return null;
  }

  /** Başlıksız ERP düzeni mi? (poz; stok; açıklama; renk; adet; ölçü; ağırlık) */
  function looksRaw(rows) {
    let ok = 0, seen = 0;
    for (const row of rows.slice(0, 40)) {
      if (!row || row.length < 5) continue;
      seen++;
      const poz = parseTrNumber(row[0]), adet = parseTrNumber(row[4]);
      const desc = String(row[2] == null ? '' : row[2]).trim();
      if (poz != null && adet != null && desc) ok++;
    }
    return seen >= 3 && ok / seen >= 0.8;
  }

  function orderNoFrom(sheetName, fileName) {
    for (const s of [fileName || '', sheetName || '']) {
      const m = /(\d{3,})/.exec(String(s));
      if (m) return String(Number(m[1]));          // baştaki sıfırlar atılır
    }
    const m2 = /(\d+)/.exec(String(sheetName || ''));
    return m2 ? String(Number(m2[1])) : '';
  }

  /**
   * records: [{poz, stok, desc, color, count, lenCell, section}]
   * Türlere ve renge göre malzemeleri toplar.
   */
  function buildMaterials(records, ctx) {
    const materials = new Map();
    const warnings = [];
    const skipped = new Map();   // açıklama → ölçüsüz satır sayısı
    for (const rec of records) {
      const desc = String(rec.desc == null ? '' : rec.desc).trim();
      const d = decodeLen(rec.lenCell);
      const count = typeof rec.count === 'number' ? rec.count : parseTrNumber(rec.count);
      if (!d || !d.len || d.len <= 0 || count == null || count <= 0) {
        const k = desc || '(adsız)';
        skipped.set(k, (skipped.get(k) || 0) + 1);
        continue;
      }
      const where = rec.section ? ` (${rec.section})` : '';
      if (d.fixed) warnings.push({ poz: normPoz(rec.poz), raw: d.raw, fixed: d.len, message: `Poz ${rec.poz}${where} ${desc}: ölçü "${d.raw}" tarih/biçim bozulması → ${d.len} mm olarak düzeltildi` });
      if (d.len < 50 || d.len > 20000) warnings.push({ poz: normPoz(rec.poz), raw: rec.lenCell, fixed: d.len, message: `Poz ${rec.poz}${where} ${desc}: şüpheli ölçü ${d.len} mm` });
      const t = typeOf(desc);
      const color = String(rec.color == null ? '' : rec.color).trim();
      const stok = String(rec.stok == null ? '' : rec.stok).trim();
      // Anahtar: profil adı + renk. Stok kodu projeden projeye değişebildiği için
      // (renk kodu içinde) anahtara girmez; görüntülemek için saklanır.
      const key = `${t.type}|${norm(desc)}|${norm(color)}`;
      let mat = materials.get(key);
      if (!mat) {
        mat = { key, type: t.type, typeLabel: t.label, defaultBundle: t.bundle, defaultOn: t.on, known: t !== OTHER, desc: desc || t.label, color, stokCodes: [], items: [], section: rec.section || '' };
        materials.set(key, mat);
      }
      if (stok && !mat.stokCodes.includes(stok)) mat.stokCodes.push(stok);
      mat.items.push({ poz: normPoz(rec.poz), count: Math.round(count), len: d.len, stok, color, desc, section: rec.section || '' });
    }
    const list = [...materials.values()];
    for (const m of list) {
      m.pieces = m.items.reduce((s, i) => s + i.count, 0);
      m.totalMm = m.items.reduce((s, i) => s + i.count * i.len, 0);
    }
    list.sort((a, b) => {
      const ia = TYPES.findIndex(t => t.type === a.type), ib = TYPES.findIndex(t => t.type === b.type);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.desc.localeCompare(b.desc, 'tr') || a.color.localeCompare(b.color, 'tr');
    });
    return {
      orderNo: ctx.orderNo, sheetName: ctx.sheetName, fileName: ctx.fileName, layout: ctx.layout,
      materials: list, warnings, sections: ctx.sections || [],
      skipped: [...skipped.entries()].map(([desc, count]) => ({ desc, count })),
      rowCount: records.length,
    };
  }

  /** Başlıklı tablo (bölümlü olabilir) → kayıtlar */
  function recordsFromHeader(rows, hdr) {
    const col = hdr.col, out = [], sections = [];
    let section = null;
    for (let r = hdr.row + 1; r < rows.length; r++) {
      const row = rows[r] || [];
      const poz = row[col.poz];
      const stok = col.stok >= 0 ? row[col.stok] : null;
      const acik = col.acik >= 0 ? row[col.acik] : null;
      const isSection = (poz == null || poz === '') && (stok == null || stok === '') && acik != null && String(acik).trim() !== '';
      if (isSection) {
        const name = String(acik).trim();
        if (/^toplam/.test(norm(name))) break;
        section = name;
        sections.push({ name, count: 0 });
        continue;
      }
      if (poz == null || poz === '') continue;
      if (sections.length) sections[sections.length - 1].count++;
      out.push({
        poz: typeof poz === 'number' ? poz : String(poz).trim(),
        stok, desc: acik, color: col.renk >= 0 ? row[col.renk] : '',
        count: row[col.adet], lenCell: row[col.olcu], section,
      });
    }
    return { records: out, sections };
  }

  /** Başlıksız ERP düzeni → kayıtlar */
  function recordsFromRaw(rows) {
    const out = [];
    for (const row of rows) {
      if (!row || row.length < 5) continue;
      const poz = row[0];
      if (poz == null || String(poz).trim() === '') continue;
      if (parseTrNumber(poz) == null) continue;        // başlık/ara satır
      out.push({
        poz: typeof poz === 'number' ? poz : String(poz).trim(),
        stok: row[1], desc: row[2], color: row[3],
        count: row[4], lenCell: row[5], section: null,
      });
    }
    return { records: out, sections: [] };
  }

  function fromRows(rows, ctx) {
    const hdr = findHeader(rows);
    let parsed, layout;
    if (hdr) { parsed = recordsFromHeader(rows, hdr); layout = 'başlıklı'; }
    else if (looksRaw(rows)) { parsed = recordsFromRaw(rows); layout = 'ERP ham'; }
    else throw new Error('Tanınmayan dosya düzeni: başlık satırı (Poz no / Adet / Ölçü) ya da ERP ham düzeni (poz; stok; açıklama; renk; adet; ölçü) bekleniyordu.');
    if (!parsed.records.length) throw new Error('Dosyada satır bulunamadı.');
    return buildMaterials(parsed.records, Object.assign({ layout, sections: parsed.sections }, ctx));
  }

  function parseWorkbook(wb, fileName) {
    // Türkçe 'İ' JS'de /i/i ile eşleşmez (İ.toUpperCase() !== I), bu yüzden norm() ile bakılır:
    // '000000000021542_İmalat' sayfası düz regex'le bulunamıyordu.
    const sheetName = wb.SheetNames.find(n => /maliyet|imalat/.test(norm(n))) || wb.SheetNames[0];
    const ws = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });
    return fromRows(rows, { sheetName, fileName: fileName || '', orderNo: orderNoFrom(sheetName, fileName) });
  }

  function parseCsvText(text, fileName) {
    const rows = parseCsv(text, sniffDelimiter(text));
    return fromRows(rows, { sheetName: '', fileName: fileName || '', orderNo: orderNoFrom('', fileName) });
  }

  function isZipOrOle(bytes) {
    return (bytes[0] === 0x50 && bytes[1] === 0x4B) || (bytes[0] === 0xD0 && bytes[1] === 0xCF && bytes[2] === 0x11 && bytes[3] === 0xE0);
  }

  /** Dosya içeriğinden (ArrayBuffer/Uint8Array) ayrıştırır; .csv ve .xls/.xlsx. */
  function parseBuffer(buf, fileName) {
    const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    const isText = /\.(csv|txt)$/i.test(fileName || '') || !isZipOrOle(bytes);
    if (isText) return parseCsvText(decodeText(bytes), fileName);
    const wb = XLSX.read(bytes, { type: 'array', cellDates: false });
    return parseWorkbook(wb, fileName);
  }

  return { parseBuffer, parseWorkbook, parseCsvText, parseCsv, decodeText, decodeLen, parseTrNumber, normPoz, typeOf, norm, TYPES, OTHER };
});
