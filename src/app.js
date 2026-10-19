/* Panjur Kesim Optimizasyonu — arayüz */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const TYPE_LABEL = { lamel: 'LAMEL', dikme: 'DİKME', altparca: 'ALT PARÇA', tambur: 'TAMBUR', fitil: 'FİTİL', diger: 'DİĞER' };
  const TYPE_ORDER = ['lamel', 'dikme', 'altparca', 'tambur', 'fitil', 'diger'];
  const app = { files: [], mats: [], results: [], running: false, abort: false, workerSrc: null };

  // ---------------------------------------------------------------- yardımcılar
  function toast(msg, ms) {
    const t = $('toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove('show'), ms || 2500);
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function fmt(n) { return Number(n).toLocaleString('tr-TR'); }
  function lsGet(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* yok say */ } }
  // Tuş başına localStorage yazmamak için geciktirici
  function debounce(fn, ms) { let t; return function () { const a = arguments, self = this; clearTimeout(t); t = setTimeout(() => fn.apply(self, a), ms); }; }
  // Worker'lar saniyede onlarca ilerleme mesajı gönderir; DOM'a kare başına bir kez yazılır
  function rafThrottle(fn) {
    let pending = null, scheduled = false;
    const raf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : (cb => setTimeout(cb, 16));
    return function () {
      pending = arguments;
      if (scheduled) return;
      scheduled = true;
      raf(() => { scheduled = false; const a = pending; pending = null; if (a) fn.apply(null, a); });
    };
  }
  // Kalıcı uyarı paneli: geçici bildirimin aksine kullanıcı okuyup işlem yapabilir
  function clearNotes() { $('runNotes').innerHTML = ''; }
  function addNote(kind, title, bodyHtml) {
    const d = document.createElement('div');
    d.className = 'note-box' + (kind ? ' ' + kind : '');
    d.innerHTML = '<b>' + esc(title) + '</b>' + (bodyHtml || '');
    $('runNotes').appendChild(d);
  }

  // ---------------------------------------------------------------- parametreler
  const PARAM_IDS = ['pL', 'pKerf', 'pSafety', 'wCut', 'wBar', 'wChange', 'wKalan', 'pTime'];
  const CHECK_IDS = ['oMerge', 'oMulti', 'oSplit'];
  function loadParams() {
    const saved = lsGet('panjur.params', null);
    if (!saved) return;
    for (const id of PARAM_IDS) if (saved[id] != null && $(id)) $(id).value = saved[id];
    for (const id of CHECK_IDS) if (saved[id] != null && $(id)) $(id).checked = !!saved[id];
  }
  function saveParams() {
    const o = {};
    for (const id of PARAM_IDS) o[id] = $(id).value;
    for (const id of CHECK_IDS) o[id] = $(id).checked;
    lsSet('panjur.params', o);
  }
  function readParams() {
    const num = id => Number($(id).value);
    return {
      L: num('pL'), kerf: num('pKerf'), safety: num('pSafety'),
      wCut: num('wCut'), wBar: num('wBar'), wChange: num('wChange'), wKalan: num('wKalan'),
      mergeSameLength: $('oMerge').checked, multiStep: $('oMulti').checked, allowSplit: $('oSplit').checked,
      timeMs: Math.max(1, num('pTime')) * 1000,
    };
  }

  // ---------------------------------------------------------------- ağırlıklar
  const PRESETS = [
    { id: 'denge', name: 'Dengeli', w: { wCut: 10, wBar: 4, wChange: 1, wKalan: 3 }, desc: 'varsayılan' },
    { id: 'iscilik', name: 'İşçilik öncelikli', w: { wCut: 30, wBar: 2, wChange: 1, wKalan: 3 }, desc: 'en az kesim' },
    { id: 'malzeme', name: 'Malzeme öncelikli', w: { wCut: 4, wBar: 12, wChange: 1, wKalan: 3 }, desc: 'en az fire' },
    { id: 'kalansiz', name: 'KALANLAR olmasın', w: { wCut: 10, wBar: 4, wChange: 1, wKalan: 15 }, desc: 'her poz bir grupta' },
  ];
  function currentWeights() { return { wCut: Number($('wCut').value), wBar: Number($('wBar').value), wChange: Number($('wChange').value), wKalan: Number($('wKalan').value) }; }
  function sameWeights(a, b) { return ['wCut', 'wBar', 'wChange', 'wKalan'].every(k => Number(a[k]) === Number(b[k])); }
  function applyPreset(p) {
    for (const [k, v] of Object.entries(p.w)) $(k).value = v;
    saveParams(); renderWeights();
  }
  function renderWeights() {
    const w = currentWeights();
    const box = $('presets');
    if (!box.dataset.ready) {
      box.innerHTML = PRESETS.map((p, i) => `<button data-p="${i}" title="${esc(p.desc)}">${esc(p.name)} <span class="hint">${p.w.wCut}/${p.w.wBar}/${p.w.wChange}/${p.w.wKalan}</span></button>`).join('');
      box.querySelectorAll('button').forEach(b => b.addEventListener('click', () => applyPreset(PRESETS[Number(b.dataset.p)])));
      box.dataset.ready = '1';
    }
    box.querySelectorAll('button').forEach((b, i) => b.classList.toggle('on', sameWeights(PRESETS[i].w, w)));
    const num = n => Number(n).toLocaleString('tr-TR', { maximumFractionDigits: 1 });
    const li = [];
    if (w.wBar > 0 && w.wCut > 0) {
      li.push(w.wCut >= w.wBar
        ? `1 kesimden kaçınmak için en fazla <b>${num(w.wCut / w.wBar)} boy</b> fazladan harcanır.`
        : `1 boy kazanmak için en fazla <b>${num(w.wBar / w.wCut)} kesim</b> fazladan yapılır.`);
    }
    if (w.wChange > 0 && w.wBar > 0) li.push(`1 boy kazanmak için <b>${num(w.wBar / w.wChange)} kez demet bozma</b> göze alınır.`);
    if (w.wCut > 0) li.push(`Bir pozu KALANLAR'a atmanın bedeli ≈ <b>${num(w.wKalan / w.wCut)} kesim</b> (üstüne artıktan kesim maliyeti de eklenir).`);
    const L = Number($('pL').value) || 6500;
    if (w.wBar > 0) li.push(`Tam bir boy (<b>${fmt(L)} mm</b>) ${num(w.wBar)} puan; eşit maliyetli çözümlerde fire az olan seçilir.`);
    const flag = w.wBar > w.wCut ? '<div class="warn2">⚠ Bu ayarda malzeme işçilikten önemli sayılıyor: fire düşer, kesim sayısı artar.</div>'
      : w.wCut >= 8 * w.wBar ? '<div class="warn2">⚠ Kesim çok baskın: araç fireyi önemsemez, boy sayısı artabilir.</div>' : '';
    $('balance').innerHTML = `<b>Şu anki denge</b><ul>${li.map(x => '<li>' + x + '</li>').join('')}</ul>${flag}`;
  }

  // ---------------------------------------------------------------- dosyalar
  function orderMemory() { return lsGet('panjur.orders', {}); }
  const ORDER_MEMORY_MAX = 300;
  function rememberOrder(f) {
    if (!f.orderNo) return;                       // boş anahtar altında biriktirme
    const m = orderMemory();
    m[f.orderNo] = { customer: f.customer, date: f.date, note: f.note, at: Date.now() };
    const keys = Object.keys(m);
    if (keys.length > ORDER_MEMORY_MAX) {         // en eskileri at, bellek sınırsız büyümesin
      keys.sort((a, b) => (m[a].at || 0) - (m[b].at || 0));
      for (const k of keys.slice(0, keys.length - ORDER_MEMORY_MAX)) delete m[k];
    }
    lsSet('panjur.orders', m);
  }
  const rememberOrderSoon = debounce(rememberOrder, 500);

  async function addFiles(fileList) {
    for (const file of fileList) {
      try {
        const buf = new Uint8Array(await file.arrayBuffer());
        const parsed = PanjurParse.parseBuffer(buf, file.name);
        const dup = app.files.find(x => x.parsed.orderNo && x.parsed.orderNo === parsed.orderNo && x.parsed.rowCount === parsed.rowCount);
        if (dup) { toast(`${file.name} atlandı: ${parsed.orderNo} nolu proje zaten yüklü (${dup.name})`, 5000); continue; }
        const mem = orderMemory()[parsed.orderNo] || {};
        app.files.push({ name: file.name, orderNo: parsed.orderNo || '', customer: mem.customer || '', date: mem.date || '', note: mem.note || '', parsed });
        toast(`${file.name} yüklendi (sipariş ${parsed.orderNo || '?'})`);
      } catch (e) {
        console.error(e);
        toast(`${file.name} okunamadı: ${e.message}`, 5000);
      }
    }
    renderFiles();
    // Havuzu şimdi sına: hem "paralel arama" yazısı doğru olur, hem ilk koşu
    // worker kurulumunu beklemez. CSP'li sandbox'ta burada "tek çekirdek"e düşer.
    if (app.files.length) ensurePool().then(updateParHint, updateParHint);
  }

  function renderFiles() {
    const box = $('files');
    box.innerHTML = '';
    app.files.forEach((f, i) => {
      const mats = f.parsed.materials.map(m => `${esc(m.typeLabel)} ${m.items.length} poz${m.color ? ' <span class="badge">' + esc(m.color) + '</span>' : ''}`).join(' · ');
      const skip = f.parsed.skipped && f.parsed.skipped.length
        ? `<div class="secs"><span class="hint">Ölçüsüz (optimize edilmeyen): ${f.parsed.skipped.map(x => esc(x.desc) + ' ×' + x.count).join(' · ')}</span></div>` : '';
      const warn = f.parsed.warnings.length ? `<div class="warn">⚠ ${f.parsed.warnings.length} uyarı — <a href="#" data-toggle="w${i}">göster</a><ul id="w${i}" hidden>${f.parsed.warnings.map(w => '<li>' + esc(w.message) + '</li>').join('')}</ul></div>` : '';
      const div = document.createElement('div');
      div.className = 'file';
      div.innerHTML = `
        <div class="title">${esc(f.name)} <span class="badge">${esc(f.parsed.layout)}</span>${f.parsed.sheetName ? ' <span class="badge">' + esc(f.parsed.sheetName) + '</span>' : ''}</div>
        <div><button class="small ghost" data-rm="${i}">Kaldır</button></div>
        <div class="meta">
          <label>Sipariş no <input type="text" data-k="orderNo" data-i="${i}" value="${esc(f.orderNo)}" style="width:90px"></label>
          <label>Müşteri <input type="text" data-k="customer" data-i="${i}" value="${esc(f.customer)}" placeholder="örn. YUNUS PEN" style="width:160px"></label>
          <label>Tarih <input type="date" data-k="date" data-i="${i}" value="${esc(f.date)}"></label>
          <label>Not <input type="text" data-k="note" data-i="${i}" value="${esc(f.note)}" placeholder="örn. DETAY / MNB" style="width:120px"></label>
        </div>
        <div class="secs">${mats || '<span class="err">Ölçülü parça bulunamadı</span>'}</div>
        ${skip}
        ${warn}`;
      box.appendChild(div);
    });
    box.querySelectorAll('input[data-k]').forEach(inp => inp.addEventListener('input', e => {
      const f = app.files[Number(e.target.dataset.i)];
      f[e.target.dataset.k] = e.target.value.trim();
      rememberOrderSoon(f);
    }));
    box.querySelectorAll('button[data-rm]').forEach(b => b.addEventListener('click', e => { app.files.splice(Number(e.target.dataset.rm), 1); renderFiles(); }));
    box.querySelectorAll('a[data-toggle]').forEach(a => a.addEventListener('click', e => { e.preventDefault(); const ul = $(e.target.dataset.toggle); ul.hidden = !ul.hidden; }));
    renderMaterials();
  }

  // ---------------------------------------------------------------- malzeme ayarları
  function matCfgAll() { return lsGet('panjur.mats', {}); }
  function matCfgSave(key, cfg) { const all = matCfgAll(); all[key] = cfg; lsSet('panjur.mats', all); }
  function defaultCfg(m, defL) { return { on: !!m.defaultOn, L: defL, bundle: m.defaultBundle || 1 }; }

  function renderMaterials() {
    const box = $('matList');
    app.mats = collectMaterials();
    if (!app.mats.length) {
      box.innerHTML = app.files.length
        ? '<span class="err">Bu dosyalarda ölçülü parça bulunamadı.</span>'
        : '<span class="hint">Dosya yükleyince bulunan parçalar burada listelenir.</span>';
    } else {
      const rows = app.mats.map((m, i) => `<tr class="${m.cfg.on ? '' : 'off'}">
        <td><input type="checkbox" data-mi="${i}" data-mk="on"${m.cfg.on ? ' checked' : ''}></td>
        <td class="name"><b>${esc(m.desc)}</b>${m.known ? '' : ' <span class="badge">tanınmadı</span>'}<br><span class="code">${esc(m.stokCodes.join(', '))}</span></td>
        <td>${m.color ? '<span class="badge">' + esc(m.color) + '</span>' : ''}</td>
        <td>${m.items.length}</td>
        <td>${fmt(m.pieces)}</td>
        <td>${(m.totalMm / 1000).toFixed(1)} m</td>
        <td><input type="number" step="10" min="100" data-mi="${i}" data-mk="L" value="${m.cfg.L}"></td>
        <td><input type="number" step="1" min="1" data-mi="${i}" data-mk="bundle" value="${m.cfg.bundle}"></td>
      </tr>`).join('');
      const unknown = app.mats.filter(m => !m.known).length;
      box.innerHTML = `<div class="matwrap"><table class="mats">
        <thead><tr><th></th><th>Parça</th><th>Renk</th><th>Poz</th><th>Parça</th><th>Toplam</th><th>Boy (mm)</th><th>Demet</th></tr></thead>
        <tbody>${rows}</tbody></table></div>
        <div class="matfoot">İşaretli parçalar optimize edilir; demet = tek seferde kesilen en fazla adet.${unknown ? ' ' + unknown + ' parça tanınmadı — kesilecekse işaretleyip boy uzunluğunu girin.' : ''}</div>`;
      box.querySelectorAll('input[data-mi]').forEach(inp => inp.addEventListener('change', e => {
        const m = app.mats[Number(e.target.dataset.mi)], k = e.target.dataset.mk;
        m.cfg[k] = k === 'on' ? e.target.checked : Math.max(k === 'L' ? 100 : 1, Math.round(Number(e.target.value) || 0));
        if (k !== 'on') e.target.value = m.cfg[k];
        matCfgSave(m.key, m.cfg);
        if (k === 'on') e.target.closest('tr').classList.toggle('off', !m.cfg.on);
        updateRunHint();
      }));
    }
    updateRunHint();
  }

  // Müşteri / tarih / not alanları dosya yüklendikten SONRA doldurulur, oysa poz
  // listesi yükleme anında kopyalanır. Kullanılmadan önce kaynak dosyadan tazelenir;
  // yoksa kesim listesindeki "Müşteri" sütunu boş çıkar.
  function refreshItemMeta() {
    for (const m of app.mats) {
      for (const it of m.items) {
        const f = app.files[it.fi];
        if (f) { it.order = f.orderNo; it.customer = f.customer; }
      }
      for (const o of m.orders) {
        const f = app.files[o.fi];
        if (f) { o.orderNo = f.orderNo; o.customer = f.customer; o.date = f.date; o.note = f.note; }
      }
    }
  }

  // Paralel arama gerçekten kurulabiliyor mu? (CSP'li sandbox'ta worker kapalı olabilir)
  function updateParHint() {
    const el = $('parHint');
    if (!el) return;
    el.textContent = pool.blocked ? 'tek çekirdek — bu ortamda paralel arama kapalı'
      : pool.ready ? `${pool.workers.length} paralel arama`
      : `${workerCount()} paralel arama`;
  }

  function updateRunHint() {
    const on = app.mats.filter(m => m.cfg.on);
    const has = app.files.length > 0 && on.length > 0;
    $('runBtn').disabled = !has || app.running;
    $('runHint').textContent = !app.files.length ? 'Önce dosya yükleyin.'
      : !on.length ? 'En az bir parça seçin.'
      : `${app.files.length} dosya · ${on.length} parça · ${fmt(on.reduce((a, m) => a + m.pieces, 0))} kesilecek parça`;
  }

  // Tüm dosyalardan malzeme (tür + profil + renk) bazında poz listesi.
  // Stok kodu projeden projeye değişebildiği için anahtar profil adı + renktir.
  function collectMaterials() {
    const defL = Number($('pL').value) || 6500;
    const saved = matCfgAll();
    const map = new Map();
    for (let fi = 0; fi < app.files.length; fi++) {
      const f = app.files[fi];
      for (const m of f.parsed.materials) {
        let e = map.get(m.key);
        if (!e) {
          e = { key: m.key, type: m.type, typeLabel: m.typeLabel, desc: m.desc, color: m.color, known: m.known,
                defaultBundle: m.defaultBundle, defaultOn: m.defaultOn, stokCodes: [], items: [], orders: [], pieces: 0, totalMm: 0 };
          map.set(m.key, e);
        }
        for (const c of m.stokCodes) if (!e.stokCodes.includes(c)) e.stokCodes.push(c);
        for (const it of m.items) {
          e.items.push({ fi, order: f.orderNo, customer: f.customer, poz: it.poz, len: it.len, count: it.count, stok: it.stok, color: it.color });
          e.pieces += it.count; e.totalMm += it.count * it.len;
        }
        e.orders.push({ fi, orderNo: f.orderNo, customer: f.customer, date: f.date, note: f.note, pozCount: m.items.length });
      }
    }
    const arr = [...map.values()];
    arr.sort((a, b) => TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type) || a.desc.localeCompare(b.desc, 'tr') || a.color.localeCompare(b.color, 'tr'));
    for (const m of arr) {
      const def = defaultCfg(m, defL);
      const sv = saved[m.key];
      m.cfg = sv ? { on: !!sv.on, L: Number(sv.L) || def.L, bundle: Number(sv.bundle) || def.bundle } : def;
    }
    // sayfa adı: tür etiketi; çakışırsa renk ya da profil adı eklenir
    const used = new Set();
    for (const m of arr) {
      const base = TYPE_LABEL[m.type] || m.desc.split(/\s+/).slice(0, 2).join(' ').toLocaleUpperCase('tr');
      let name = base;
      if (used.has(name)) {
        name = (base + ' ' + (m.color || m.desc.split(/\s+/)[0])).trim();
        let i = 2;
        while (used.has(name)) name = base + ' ' + (i++);
      }
      used.add(name);
      m.sheetName = name.slice(0, 31);
    }
    return arr;
  }

  // ---------------------------------------------------------------- worker altyapısı
  async function getWorkerSource() {
    if (app.workerSrc) return app.workerSrc;
    const el = $('optimizer-src');
    let src = el && el.textContent && el.textContent.trim().length > 100 ? el.textContent : null;
    if (!src && el && el.src) {
      try { const r = await fetch(el.src); if (r.ok) src = await r.text(); } catch (e) { /* file:// altında olabilir */ }
    }
    if (!src) return null;
    app.workerSrc = src + '\n;let __abort = false; self.onmessage = async function (e) { const d = e.data; if (d && d.type === "ping") { self.postMessage({ type: "hello" }); return; } if (d && d.type === "abort") { __abort = true; return; } try { const res = await PanjurOpt.optimize(d.items, d.params, { timeMs: d.timeMs, yield: true, chunk: 2000, abort: () => __abort, onProgress: p => self.postMessage({ type: "progress", frac: p.frac, best: p.best, iter: p.iter }) }); self.postMessage({ type: "done", result: res }); } catch (err) { self.postMessage({ type: "error", message: String(err && err.message || err), code: String(err && err.code || ""), stack: String(err && err.stack || "") }); } };';
    return app.workerSrc;
  }

  function workerCount() {
    const hc = navigator.hardwareConcurrency || 2;
    return Math.max(1, Math.min(hc - 1, 8));
  }

  // Worker havuzu. Önceden her malzeme için worker'lar yeniden doğuruluyordu;
  // her doğum optimizer kaynağını baştan ayrıştırmak demek (4 malzeme × 8 worker = 32 kez).
  // Havuz bir kez kurulur, malzemeler arasında yeniden kullanılır.
  const pool = { url: null, workers: [], ready: false, blocked: false };
  function destroyPool() {
    for (const w of pool.workers) { try { w.onmessage = null; w.onerror = null; w.terminate(); } catch (e) { /* yok say */ } }
    pool.workers = [];
    pool.ready = false;
    if (pool.url) { URL.revokeObjectURL(pool.url); pool.url = null; }
  }
  /**
   * Worker havuzunu kurar; kuramazsa null döner (çağıran ana iş parçacığına düşer).
   *
   * Önemli: CSP ile korunan bir sandbox'ta (Atlas, Poz Çizer düzeni) `new Worker(blob:…)`
   * HATA FIRLATMAZ — nesneyi döndürür, reddi `onerror` ile ASENKRON bildirir. Kurulan
   * worker'ı sınamadan kullanırsak optimizasyon hiç yanıt gelmeyen bir sözde takılır.
   * Bu yüzden kullanmadan önce el sıkışılır; cevap vermeyen havuz çöpe atılır.
   */
  async function ensurePool() {
    if (pool.blocked) return null;
    const want = workerCount();
    if (pool.ready && pool.workers.length === want) return pool;
    const src = await getWorkerSource();
    if (!src) { pool.blocked = true; return null; }
    destroyPool();
    try { pool.url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' })); }
    catch (e) { pool.blocked = true; return null; }
    const made = [];
    for (let i = 0; i < want; i++) {
      try { made.push(new Worker(pool.url)); }
      catch (e) { console.error('worker oluşturulamadı', e); break; }
    }
    const alive = await Promise.all(made.map(w => new Promise(res => {
      const t = setTimeout(() => res(false), 4000);
      w.onmessage = e => { if (e.data && e.data.type === 'hello') { clearTimeout(t); res(true); } };
      w.onerror = () => { clearTimeout(t); res(false); };
      try { w.postMessage({ type: 'ping' }); } catch (e) { clearTimeout(t); res(false); }
    })));
    made.forEach((w, i) => { w.onmessage = null; w.onerror = null; if (!alive[i]) { try { w.terminate(); } catch (e) { /* yok say */ } } });
    pool.workers = made.filter((w, i) => alive[i]);
    if (!pool.workers.length) { destroyPool(); pool.blocked = true; return null; }
    pool.ready = true;
    return pool;
  }

  // Bir malzemeyi paralel koşularla optimize eder; en iyi sonucu döndürür
  async function optimizeMaterial(mat, P, timeMs, onProgress) {
    const seed0 = 1000 + mat.items.length;
    const p = await ensurePool();
    if (!p) {
      // ana iş parçacığı (yedek yol): worker yoksa ya da ortam engelliyorsa
      updateParHint();
      return PanjurOpt.optimize(mat.items, Object.assign({}, P, { seed: seed0 }),
        { timeMs, chunk: 1000, onProgress: x => onProgress(x.frac, x.best, 0), abort: () => app.abort, material: mat.key });
    }
    const workers = p.workers.slice();
    const n = workers.length;
    return new Promise((resolve, reject) => {
      const results = [];
      const fracs = new Array(n).fill(0), bests = new Array(n).fill(Infinity);
      let done = 0, finished = false, broken = false, firstErr = null;
      let chk = 0, abortSent = false;
      const settle = i => { fracs[i] = 1; if (++done === n) finish(); };
      const finish = () => {
        if (finished) return;
        finished = true;
        clearInterval(chk);
        for (const w of workers) { w.onmessage = null; w.onerror = null; }
        if (broken) destroyPool();            // hata almış worker'ı havuzda tutma
        if (!results.length) { reject(firstErr || new Error('Arama başarısız (worker)')); return; }
        results.sort((a, b) => a.stats.cost - b.stats.cost);
        resolve(results[0]);
      };
      chk = setInterval(() => {
        if (app.abort && !abortSent) { abortSent = true; for (const w of workers) { try { w.postMessage({ type: 'abort' }); } catch (e) { /* yok say */ } } }
      }, 200);
      workers.forEach((w, i) => {
        w.onmessage = e => {
          const m = e.data;
          if (m.type === 'progress') { fracs[i] = m.frac; bests[i] = m.best; onProgress(Math.min.apply(null, fracs), Math.min.apply(null, bests), n); }
          else if (m.type === 'done') { results.push(m.result); settle(i); }
          else if (m.type === 'error') {
            broken = true;
            if (!firstErr) { firstErr = new Error(m.message || 'worker hatası'); firstErr.code = m.code || ''; }
            console.error('worker', m.message, m.stack || '');
            settle(i);                        // ilerleme çubuğu bu worker'ı beklemesin
          }
        };
        w.onerror = err => {
          broken = true;
          if (!firstErr) firstErr = new Error((err && err.message) || 'worker hatası');
          console.error('worker hata', err && err.message);
          settle(i);
        };
        try { w.postMessage({ items: mat.items, params: Object.assign({}, P, { seed: seed0 + i * 7919 }), timeMs }); }
        catch (e) { broken = true; if (!firstErr) firstErr = e; settle(i); }
      });
    });
  }

  // ---------------------------------------------------------------- çalıştırma
  async function run() {
    if (app.running) return;
    saveParams();
    const params = readParams();
    const mats = app.mats.filter(m => m.cfg.on);
    if (!mats.length) { toast('Optimize edilecek parça seçilmedi.'); return; }
    refreshItemMeta();
    app.running = true; app.abort = false; app.results = [];
    $('runBtn').disabled = true; $('stopBtn').hidden = false;
    $('sec-results').hidden = true;
    clearNotes();
    const prog = $('progress'); prog.innerHTML = '';
    const lines = mats.map(m => {
      const div = document.createElement('div'); div.className = 'pline';
      div.innerHTML = `<div>${esc(m.sheetName)} <span class="hint">${m.items.length} poz · demet ${m.cfg.bundle}</span></div><div class="pbar"><div></div></div><div>bekliyor</div>`;
      prog.appendChild(div); return div;
    });
    const t0 = performance.now();
    const failed = [];
    // Bir malzemedeki hata diğerlerini iptal etmesin: her malzeme kendi try'ında
    for (let i = 0; i < mats.length; i++) {
      if (app.abort) { lines[i].children[2].textContent = 'durduruldu'; continue; }
      const m = mats[i];
      const P = { L: m.cfg.L, kerf: params.kerf, safety: params.safety, maxBundle: m.cfg.bundle || 1, wCut: params.wCut, wBar: params.wBar, wChange: params.wChange, wKalan: params.wKalan, mergeSameLength: params.mergeSameLength, multiStep: params.multiStep, allowSplit: params.allowSplit };
      const bar = lines[i].querySelector('.pbar > div'), txt = lines[i].children[2];
      const paint = rafThrottle((frac, best, n) => {
        bar.style.width = (frac * 100).toFixed(0) + '%';
        txt.textContent = `${(frac * 100).toFixed(0)}% · en iyi maliyet ${isFinite(best) ? Math.round(best) : '–'} · ${n ? n + ' paralel' : 'tek çekirdek'}`;
      });
      try {
        const res = await optimizeMaterial(m, P, params.timeMs, paint);
        bar.style.width = '100%';
        txt.textContent = `tamam · ${fmt(res.stats.bars)} boy · ${fmt(res.stats.strokes)} kesim · fire %${(res.stats.wastePct * 100).toFixed(1)}`;
        app.results.push({ mat: m, result: res });
        reportMaterialNotes(m, res);
      } catch (e) {
        console.error(e);
        bar.style.width = '0%';
        txt.textContent = 'yapılamadı';
        failed.push({ mat: m, err: e });
        const isFit = e && e.code === 'TOO_LONG';
        addNote('bad', `${m.sheetName}: optimize edilemedi`,
          `<div>${esc(e && e.message || String(e))}</div>`
          + (isFit ? '<div class="hint" style="margin-top:6px">Çözüm: bu parçanın boy uzunluğunu yükseltin ya da bu pozları listeden çıkarın.</div>' : ''));
      }
    }
    app.running = false; $('runBtn').disabled = false; $('stopBtn').hidden = true;
    updateRunHint();
    if (app.results.length) {
      $('resHint').textContent = `${((performance.now() - t0) / 1000).toFixed(0)} sn`;
      renderResults();
      $('sec-results').hidden = false;
      if (!failed.length) $('sec-results').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else if (failed.length) {
      toast(`${failed.length} parça optimize edilemedi — ayrıntı için uyarılara bakın.`, 6000);
    }
  }

  /** Optimizasyondan sonra kullanıcıyı ilgilendiren durumlar (zorunlu bölme, atlanan satır) */
  function reportMaterialNotes(m, res) {
    const fs = res.forcedSplits || [];
    if (fs.length) {
      const list = fs.slice(0, 6).map(f => `poz ${esc(f.item.poz)}: ${f.count} adet → ${f.pieces} demet (en çok ${f.chunk})`);
      addNote('warn', `${m.sheetName}: ${fs.length} poz zorunlu olarak bölündü`,
        `<div class="hint">Bu pozların adedi tek demette kesilemeyecek kadar büyük (adım sayısı × ölçü, boy uzunluğunu aşıyor), bu yüzden ayrı demetlere dağıtıldı.</div>`
        + `<ul>${list.map(x => '<li>' + x + '</li>').join('')}</ul>`
        + (fs.length > 6 ? `<div class="hint">… ve ${fs.length - 6} poz daha</div>` : ''));
    }
    const sk = res.skipped || [];
    if (sk.length) {
      addNote('warn', `${m.sheetName}: ${sk.length} satır ölçüsüz/adetsiz olduğu için atlandı`,
        `<div class="hint">${esc(sk.slice(0, 8).map(it => 'poz ' + it.poz).join(', '))}${sk.length > 8 ? ' …' : ''}</div>`);
    }
  }

  // ---------------------------------------------------------------- ağırlık karşılaştırma
  async function compareWeights() {
    if (app.running) return;
    const mats = app.mats.filter(m => m.cfg.on);
    if (!mats.length) { toast('Önce dosya yükleyip parça seçin.'); return; }
    refreshItemMeta();
    const mat = mats.slice().sort((a, b) => b.pieces - a.pieces)[0];
    const params = readParams();
    const cur = currentWeights();
    const runs = PRESETS.map(p => ({ name: p.name, w: p.w, preset: p }));
    if (!PRESETS.some(p => sameWeights(p.w, cur))) runs.unshift({ name: 'Şu anki ayar', w: cur, preset: null });
    const per = Math.max(2500, Math.round(params.timeMs / 2));
    app.running = true; app.abort = false;
    $('runBtn').disabled = true; $('stopBtn').hidden = false;
    const btn = $('cmpBtn'); btn.disabled = true;
    const out = $('cmpOut');
    out.innerHTML = `<div class="hint">${esc(mat.sheetName)} (${mat.items.length} poz) üzerinde ${runs.length} ayar × ${(per / 1000).toFixed(0)} sn deneniyor…</div>`;
    const rows = [];
    try {
      for (let i = 0; i < runs.length; i++) {
        if (app.abort) break;
        const r = runs[i];
        btn.textContent = `Karşılaştırılıyor… ${i + 1}/${runs.length}`;
        const P = Object.assign({ L: mat.cfg.L, kerf: params.kerf, safety: params.safety, maxBundle: mat.cfg.bundle || 1,
          mergeSameLength: params.mergeSameLength, multiStep: params.multiStep, allowSplit: params.allowSplit }, r.w);
        const res = await optimizeMaterial(mat, P, per, () => {});
        rows.push({ name: r.name, w: r.w, preset: r.preset, st: res.stats });
        out.innerHTML = renderCompare(mat, rows, cur, per);
      }
    } catch (e) { console.error(e); toast('Karşılaştırma hatası: ' + e.message, 5000); }
    btn.disabled = false; btn.textContent = 'Ağırlıkları karşılaştır';
    app.running = false; $('stopBtn').hidden = true; updateRunHint();
    if (rows.length) {
      out.innerHTML = renderCompare(mat, rows, cur, per);
      out.querySelectorAll('button[data-use]').forEach(b => b.addEventListener('click', () => {
        const w = rows[Number(b.dataset.use)].w;
        for (const [k, v] of Object.entries(w)) $(k).value = v;
        saveParams(); renderWeights(); toast('Ayar uygulandı: ' + rows[Number(b.dataset.use)].name);
      }));
    }
  }

  function renderCompare(mat, rows, cur, per) {
    const best = {
      bars: Math.min(...rows.map(r => r.st.bars)),
      strokes: Math.min(...rows.map(r => r.st.strokes)),
      waste: Math.min(...rows.map(r => r.st.wastePct)),
    };
    const body = rows.map((r, i) => {
      const st = r.st, isCur = sameWeights(r.w, cur);
      return `<tr class="${isCur ? 'cur' : ''}">
        <td>${esc(r.name)} <span class="hint">${r.w.wCut}/${r.w.wBar}/${r.w.wChange}/${r.w.wKalan}</span></td>
        <td class="${st.bars === best.bars ? 'best' : ''}">${fmt(st.bars)}</td>
        <td class="${st.strokes === best.strokes ? 'best' : ''}">${st.strokes}</td>
        <td>${st.changes}</td>
        <td class="${st.wastePct === best.waste ? 'best' : ''}">${(st.wastePct * 100).toFixed(1)}%</td>
        <td>${((st.materialMm - st.pieceMm) / 1000).toFixed(0)} m</td>
        <td>${st.kalanCount}</td>
        <td>${isCur ? '<span class="hint">kullanımda</span>' : `<button class="small ghost" data-use="${i}">kullan</button>`}</td>
      </tr>`;
    }).join('');
    const spanBars = Math.max(...rows.map(r => r.st.bars)) - best.bars;
    const spanCuts = Math.max(...rows.map(r => r.st.strokes)) - best.strokes;
    return `<table class="cmp2">
      <thead><tr><th>Ayar (kesim/boy/bozma/kalan)</th><th>Boy</th><th>Kesim</th><th>Demet bozma</th><th>Fire</th><th>Fire (m)</th><th>KALANLAR</th><th></th></tr></thead>
      <tbody>${body}</tbody></table>
      <div class="hint" style="margin-top:6px">${esc(mat.sheetName)} · ${mat.items.length} poz · ayar başına ${(per / 1000).toFixed(0)} sn arama (tam koşuda sonuçlar biraz daha iyi olur).
      Uçlar arası fark: <b>${spanCuts} kesim</b> ↔ <b>${spanBars} boy</b> (${((spanBars * mat.cfg.L) / 1000).toFixed(0)} m malzeme).</div>`;
  }

  // ---------------------------------------------------------------- sonuç görünümü
  function stepCells(step) {
    const r = PanjurExcel.stepRow(step);
    return r;
  }
  function renderGroup(g, kalan) {
    const rows = g.steps.map((s, i) => {
      const r = stepCells(s);
      let note = i === 0 ? `${g.bars} boy` : (s.setAside > 0 ? `${s.setAside} boy kenara → ${s.n}` : '');
      return `<tr><td>${esc(r.order)}</td><td>${esc(r.customer)}</td><td>${esc(r.poz)}</td><td>${esc(r.count)}</td><td class="len">${fmt(r.len)}</td><td class="note">${esc(note)}</td></tr>`;
    }).join('');
    const rem = (g.remnants || []).filter(r => !r.final && r.count > 0).map(r => `${r.count}×${fmt(r.len)}`).join(', ');
    const title = g.fallback ? `GRUP ${g.no} <span class="m">artık yetmedi – yeni boy</span>` : `GRUP ${g.no}`;
    return `<div class="gbox"><table class="g"><caption>${title}<span class="m">${g.bars} boy · ${g.strokes} kesim${g.changes ? ' · ' + g.changes + ' demet bozma' : ''}</span></caption>
      <thead><tr><th>Sipariş</th><th>Müşteri</th><th>POZ</th><th>ADET</th><th>ÖLÇÜ</th><th style="text-align:left">Not</th></tr></thead>
      <tbody>${rows}<tr class="sum"><td colspan="4" style="text-align:left;font-weight:400" class="note">kalan ${fmt(g.leftover)} mm${rem ? ' · artık ' + rem : ''}</td><td class="len">${fmt(g.sumLen)}</td><td></td></tr></tbody></table></div>`;
  }
  function renderKalan(res) {
    const k = res.kalan;
    if (!k.parts.length) return '';
    const src = new Map();
    for (const e of k.plan) for (const s of e.steps) { const m = src.get(s.part.id) || new Map(); m.set(e.groupNo, (m.get(e.groupNo) || 0) + s.n); src.set(s.part.id, m); }
    const rows = k.parts.map(p => {
      const m = src.get(p.part.id);
      const note = m ? 'artık: ' + [...m.entries()].map(([g, n]) => `G${g} (${n})`).join(' + ') : '';
      return `<tr class="kalan"><td>${esc(p.item.order)}</td><td>${esc(p.item.customer)}</td><td>${esc(p.item.poz)}</td><td>${p.count}</td><td class="len">${fmt(p.item.len)}</td><td class="note">${esc(note)}</td></tr>`;
    }).join('');
    const def = (k.deficit || []).map(d => `<tr><td colspan="6" class="err">Eksik: poz ${esc(d.item.poz)} × ${d.count} (${fmt(d.item.len)} mm) artıktan çıkmadı → yeni boy grubu</td></tr>`).join('');
    return `<div class="gbox kalan"><table class="g"><caption>KALANLAR <span class="m">${k.parts.length} poz · artıklardan ${k.strokes} kesim</span></caption>
      <thead><tr><th>Sipariş</th><th>Müşteri</th><th>POZ</th><th>ADET</th><th>ÖLÇÜ</th><th style="text-align:left">Kaynak</th></tr></thead><tbody>${rows}${def}</tbody></table></div>`;
  }
  function renderPlan(res) {
    if (!res.kalan.plan.length) return '';
    const rows = res.kalan.plan.map(e => `<tr><td>G${e.groupNo} / adım ${e.step}${e.derived ? ' (bölünmüş)' : ''}</td><td>${e.count} × ${fmt(e.len)}</td><td style="text-align:left">${e.steps.map(s => `${fmt(s.len)} × ${s.n} → poz ${esc(s.item.poz)}`).join('<br>')}</td><td>${e.leftoverCount} × ${fmt(e.leftoverLen)}</td></tr>`).join('');
    return `<details><summary>Artık planı (KALANLAR hangi artıktan kesilir)</summary><table class="g" style="margin-top:8px"><thead><tr><th style="text-align:left">Kaynak</th><th>Artık</th><th style="text-align:left">Kesimler</th><th>Kalan</th></tr></thead><tbody>${rows}</tbody></table></details>`;
  }
  function renderResults() {
    app.showAllGroups = false; app.shownTab = -1;
    const tabs = $('tabs'); tabs.innerHTML = '';
    app.results.forEach((x, i) => {
      const b = document.createElement('button'); b.textContent = `${x.mat.sheetName}${x.mat.color && !x.mat.sheetName.includes(x.mat.color) ? ' · ' + x.mat.color : ''}`;
      b.addEventListener('click', () => showResult(i)); tabs.appendChild(b);
    });
    showResult(0);
  }
  const GROUP_PAGE = 60;          // tek seferde çizilen en fazla grup
  function showResult(i) {
    if (app.shownTab !== i) { app.showAllGroups = false; app.shownTab = i; }
    $('tabs').querySelectorAll('button').forEach((b, j) => b.classList.toggle('active', j === i));
    const x = app.results[i], res = x.result, st = res.stats;
    const v = res.validation;
    const stats = [
      ['Boy', st.bars, `alt sınır ${st.lowerBoundBars} · ${(st.bars * res.P.L / 1000).toFixed(0)} m`],
      ['Kesim', st.strokes, `grup ${st.groupStrokes}${st.kalanStrokes ? ' + artık ' + st.kalanStrokes : ''}`],
      ['Fire', (st.wastePct * 100).toFixed(1) + ' %', `${(st.wasteMm / 1000).toFixed(1)} m`],
      ['Demet bozma', st.changes, ''],
      ['Grup', st.groupCount, `${res.items.length} poz · ${fmt(st.pieces)} parça`],
      ['KALANLAR', st.kalanCount, st.fallbackBars ? `+${st.fallbackBars} yeni boy` : 'artıktan'],
    ].map(([k, val, s]) => `<div class="stat"><div class="k">${k}</div><div class="v">${val}</div><div class="s">${s}</div></div>`).join('');
    // Durum rengi tek başına anlam taşımaz: ikon + yazı birlikte verilir
    const valid = `<div class="valid ${v.ok ? 'ok' : 'bad'}"><span class="ico">${v.ok ? '✔' : '✖'}</span><span>${v.ok
      ? 'Doğrulama tamam — her pozun adedi eksiksiz, hiçbir boy uzunluğu aşılmadı, demet sınırı korundu.'
      : 'Doğrulama hataları: ' + esc(v.errors.slice(0, 5).join(' | '))}</span></div>`;
    const all = res.groups.concat(res.kalan.fallbackGroups || []);
    // Binlerce satırı tek seferde DOM'a basmak sayfayı kilitler; önce ilk GROUP_PAGE grup
    const shown = app.showAllGroups ? all.length : Math.min(all.length, GROUP_PAGE);
    const groups = all.slice(0, shown).map(g => renderGroup(g)).join('') + renderKalan(res);
    const more = shown < all.length
      ? `<div class="moregroups"><button class="ghost" id="moreBtn" type="button">Kalan ${fmt(all.length - shown)} grubu da göster</button></div>` : '';
    $('resBody').innerHTML = `<div class="stats">${stats}</div>
      ${valid}
      <div class="cmp">Maliyet ${fmt(Math.round(st.cost))} (başlangıç ${fmt(Math.round(res.initialCost))}) · ${fmt(res.iterations)} iterasyon · ${esc(x.mat.desc)} ${esc(x.mat.color)}</div>
      <div class="breakdown">${costBreakdown(res)}</div>
      <div class="groups" style="margin-top:10px">${groups}</div>${more}${renderPlan(res)}`;
    const mb = $('moreBtn');
    if (mb) mb.addEventListener('click', () => { app.showAllGroups = true; showResult(i); });
  }

  function costBreakdown(res) {
    const c = res.stats.costParts;
    if (!c) return '';
    const total = res.stats.cost || 1;
    const parts = [
      ['kesim', c.cut], ['boy', c.bar], ['demet bozma', c.change], ['KALANLAR', c.kalan], ['fire', c.waste],
    ].filter(([, v]) => Math.abs(v) >= 0.5);
    return 'Maliyet puanının dağılımı: ' + parts.map(([k, v]) => `${k} ${Math.round(v)} <span class="hint">(%${Math.round(100 * v / total)})</span>`).join(' + ')
      + (Math.abs(c.other) >= 0.5 ? ` − doluluk ödülü ${Math.abs(Math.round(c.other))}` : '')
      + ' <span class="hint">— kararları yönlendiren şey ağırlıkların oranıdır; bu satır yalnızca toplamın nereden geldiğini gösterir.</span>';
  }

  // ---------------------------------------------------------------- Excel
  async function downloadExcel() {
    if (!app.results.length) return;
    refreshItemMeta();
    const showRemnants = $('oRemnantNote').checked;
    const results = app.results.map(x => ({
      result: x.result,
      meta: { desc: x.mat.desc, color: x.mat.color, sheetName: x.mat.sheetName, orders: dedupeOrders(x.mat.orders) },
      opts: { showRemnants },
    }));
    const allOrders = dedupeOrders(app.files.map(f => ({ orderNo: f.orderNo, customer: f.customer, date: f.date, note: f.note })));
    try {
      const buf = await PanjurExcel.buildWorkbook(results, { orders: allOrders });
      const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const a = document.createElement('a');
      const names = allOrders.map(o => o.customer || o.orderNo).filter(Boolean).slice(0, 3).join('-') || 'kesim';
      a.href = URL.createObjectURL(blob); a.download = `${names} KESİM PLANI.xlsx`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    } catch (e) { console.error(e); toast('Excel oluşturulamadı: ' + e.message, 6000); }
  }
  function dedupeOrders(list) {
    const m = new Map();
    for (const o of list) {
      const k = o.orderNo || o.customer;
      if (!m.has(k)) m.set(k, { orderNo: o.orderNo, customer: o.customer, date: o.date ? new Date(o.date + 'T00:00:00Z') : null, note: o.note, pozCount: 0 });
      m.get(k).pozCount += o.pozCount || 0;
    }
    return [...m.values()];
  }

  // ---------------------------------------------------------------- olaylar
  // Tema: sistem → açık → koyu sırayla döner, seçim hatırlanır
  function initTheme() {
    const btn = $('themeBtn');
    if (!btn) return;
    const FACE = { auto: ['◐', 'Tema: sistem (tıkla: açık)'], light: ['☀', 'Tema: açık (tıkla: koyu)'], dark: ['☾', 'Tema: koyu (tıkla: sistem)'] };
    let cur = lsGet('panjur.theme', 'auto');
    if (!FACE[cur]) cur = 'auto';
    const apply = () => {
      if (cur === 'auto') document.documentElement.removeAttribute('data-theme');
      else document.documentElement.setAttribute('data-theme', cur);
      btn.textContent = FACE[cur][0];
      btn.title = FACE[cur][1]; btn.setAttribute('aria-label', FACE[cur][1]);
    };
    apply();
    btn.addEventListener('click', () => {
      cur = cur === 'auto' ? 'light' : cur === 'light' ? 'dark' : 'auto';
      lsSet('panjur.theme', cur); apply();
    });
  }

  function init() {
    initTheme();
    loadParams();
    const drop = $('drop'), inp = $('fileInput');
    drop.addEventListener('click', () => inp.click());
    drop.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); inp.click(); } });
    inp.addEventListener('change', () => { addFiles([...inp.files]); inp.value = ''; });
    ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
    ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
    drop.addEventListener('drop', e => addFiles([...e.dataTransfer.files].filter(f => /\.(csv|txt|xlsx?)$/i.test(f.name))));
    $('runBtn').addEventListener('click', run);
    $('stopBtn').addEventListener('click', () => { app.abort = true; toast('Durduruluyor… mevcut en iyi sonuç alınacak'); });
    $('dlBtn').addEventListener('click', downloadExcel);
    $('cmpBtn').addEventListener('click', compareWeights);
    for (const id of ['wCut', 'wBar', 'wChange', 'wKalan']) $(id).addEventListener('input', renderWeights);
    for (const id of PARAM_IDS.concat(CHECK_IDS)) $(id).addEventListener('change', () => { saveParams(); if (id === 'pL') { renderMaterials(); renderWeights(); } else updateRunHint(); });
    updateParHint();
    renderWeights();
    if (new URLSearchParams(location.search).get('debug')) window.__panjur = app;   // tanılama
    // demo: ?demo=1 ile örnek dosyaları (http üzerinden) yükle
    const q = new URLSearchParams(location.search);
    if (q.get('demo')) {
      (async () => {
        for (const name of q.get('demo').split('|')) {
          try { const r = await fetch(encodeURI(name)); const b = await r.blob(); await addFiles([new File([b], name.split('/').pop())]); } catch (e) { console.error(e); }
        }
      })();
    }
    // kendi kendine test: ?selftest=1 → worker yoluyla küçük bir örnek çözer, sonucu <pre id="selftest"> içine yazar
    if (q.get('selftest')) {
      (async () => {
        const pre = document.createElement('pre'); pre.id = 'selftest'; document.body.appendChild(pre);
        try {
          const items = [];
          for (let i = 1; i <= 24; i++) items.push({ order: '1', customer: 'T', poz: i, len: 1200 + (i % 7) * 97, count: 18 + (i % 3) });
          const mat = { key: 'lamel|x|y', type: 'lamel', desc: 'TEST', color: '', sheetName: 'LAMEL', items, orders: [], cfg: { on: true, L: 6500, bundle: 50 } };
          const P = Object.assign({}, PanjurOpt.DEFAULTS, { maxBundle: 50 });
          const res = await optimizeMaterial(mat, P, 1500, () => {});
          pre.textContent = JSON.stringify({ ok: res.validation.ok, bars: res.stats.bars, strokes: res.stats.strokes, iters: res.iterations, workers: workerCount(), src: !!app.workerSrc });
        } catch (e) { pre.textContent = 'HATA ' + (e && e.message); }
      })();
    }
    renderFiles();
  }
  document.addEventListener('DOMContentLoaded', init);
})();
