'use strict';

/* ============================================================
   Fluxo — comprovantes
   Guarda fotos e PDFs no próprio aparelho (IndexedDB).
   Os arquivos NÃO entram no backup .json: o backup leva só os
   lançamentos. Assim o app não fica pesado e o backup continua
   pequeno o bastante para enviar por WhatsApp.
   ============================================================ */

window.FluxoReceipts = (function(){

  const DB_NAME = 'fluxo';
  const DB_VERSION = 1;
  const STORE_FILES = 'receiptFiles';
  const STORE_META = 'receiptMeta';

  const MAX_SIDE = 1600;        /* maior lado da foto, em pixels */
  const JPEG_QUALITY = 0.72;    /* compressão da foto */
  const MAX_PDF = 8 * 1024 * 1024;

  let dbp = null;
  let index = [];
  let byTx = {};
  let ready = false;

  function supported(){
    try { return !!window.indexedDB; } catch (e) { return false; }
  }

  function newId(){
    return 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function openDB(){
    if (dbp) return dbp;
    dbp = new Promise(function(resolve, reject){
      if (!supported()) {
        reject(new Error('Este aparelho não permitiu guardar arquivos.'));
        return;
      }
      const req = window.indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = function(){
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_FILES)) {
          const files = db.createObjectStore(STORE_FILES, { keyPath: 'id' });
          files.createIndex('txId', 'txId', { unique: false });
        }
        if (!db.objectStoreNames.contains(STORE_META)) {
          const meta = db.createObjectStore(STORE_META, { keyPath: 'id' });
          meta.createIndex('txId', 'txId', { unique: false });
        }
      };
      req.onsuccess = function(){ resolve(req.result); };
      req.onerror = function(){ reject(req.error || new Error('Falha ao abrir o armazenamento.')); };
    });
    return dbp;
  }

  function done(req){
    return new Promise(function(resolve, reject){
      req.onsuccess = function(){ resolve(req.result); };
      req.onerror = function(){ reject(req.error || new Error('Falha no armazenamento.')); };
    });
  }

  function rebuild(){
    byTx = {};
    index.slice().sort(function(a, b){ return (a.createdAt || 0) - (b.createdAt || 0); })
      .forEach(function(m){
        if (!byTx[m.txId]) byTx[m.txId] = [];
        byTx[m.txId].push(m);
      });
  }

  async function load(){
    if (ready) return index;
    ready = true;
    try {
      const db = await openDB();
      const tx = db.transaction(STORE_META, 'readonly');
      index = await done(tx.objectStore(STORE_META).getAll());
      rebuild();
    } catch (e) {
      index = [];
      byTx = {};
    }
    return index;
  }

  function list(txId){
    return (byTx[txId] || []).slice();
  }

  function count(txId){
    return (byTx[txId] || []).length;
  }

  function meta(id){
    return index.find(function(m){ return m.id === id; }) || null;
  }

  function totalBytes(){
    return index.reduce(function(sum, m){ return sum + (m.size || 0); }, 0);
  }

  /* ---------- preparar arquivo ---------- */

  function loadImage(file){
    return new Promise(function(resolve, reject){
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = function(){ URL.revokeObjectURL(url); resolve(img); };
      img.onerror = function(){ URL.revokeObjectURL(url); reject(new Error('Imagem inválida.')); };
      img.src = url;
    });
  }

  function loadBitmap(file){
    if (window.createImageBitmap) {
      return window.createImageBitmap(file).catch(function(){ return loadImage(file); });
    }
    return loadImage(file);
  }

  function shrink(file){
    return loadBitmap(file).then(function(source){
      const w0 = source.width || source.naturalWidth || 0;
      const h0 = source.height || source.naturalHeight || 0;
      if (!w0 || !h0) return file;

      const scale = Math.min(1, MAX_SIDE / Math.max(w0, h0));
      const w = Math.max(1, Math.round(w0 * scale));
      const h = Math.max(1, Math.round(h0 * scale));

      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) return file;

      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(source, 0, 0, w, h);
      if (source.close) { try { source.close(); } catch (e) {} }

      return new Promise(function(resolve){
        canvas.toBlob(function(blob){ resolve(blob || file); }, 'image/jpeg', JPEG_QUALITY);
      });
    });
  }

  function prepare(file){
    const name = file.name || 'comprovante';
    const mime = file.type || '';

    if (mime.indexOf('image/') === 0) {
      return shrink(file).then(function(blob){
        return {
          blob: blob,
          name: name.replace(/\.[^.]+$/, '') + '.jpg',
          mime: 'image/jpeg',
          kind: 'image'
        };
      });
    }

    if (mime === 'application/pdf' || /\.pdf$/i.test(name)) {
      if (file.size > MAX_PDF) throw new Error('PDF muito grande (máximo 8 MB).');
      return Promise.resolve({ blob: file, name: name, mime: 'application/pdf', kind: 'pdf' });
    }

    throw new Error('Formato não suportado. Use uma foto ou um PDF.');
  }

  /* ---------- gravar / apagar ---------- */

  async function add(txId, file){
    await load();
    const prepared = await prepare(file);
    const item = {
      id: newId(),
      txId: String(txId),
      name: prepared.name,
      mime: prepared.mime,
      kind: prepared.kind,
      size: prepared.blob.size || 0,
      createdAt: Date.now()
    };

    const db = await openDB();
    await new Promise(function(resolve, reject){
      const tx = db.transaction([STORE_FILES, STORE_META], 'readwrite');
      tx.objectStore(STORE_FILES).put({ id: item.id, txId: item.txId, blob: prepared.blob });
      tx.objectStore(STORE_META).put(item);
      tx.oncomplete = function(){ resolve(); };
      tx.onerror = function(){ reject(tx.error || new Error('Falha ao guardar o comprovante.')); };
      tx.onabort = function(){ reject(tx.error || new Error('Falha ao guardar o comprovante.')); };
    });

    index.push(item);
    rebuild();
    return item;
  }

  async function get(id){
    const db = await openDB();
    const tx = db.transaction(STORE_FILES, 'readonly');
    return (await done(tx.objectStore(STORE_FILES).get(id))) || null;
  }

  async function remove(id){
    await load();
    const db = await openDB();
    await new Promise(function(resolve, reject){
      const tx = db.transaction([STORE_FILES, STORE_META], 'readwrite');
      tx.objectStore(STORE_FILES).delete(id);
      tx.objectStore(STORE_META).delete(id);
      tx.oncomplete = function(){ resolve(); };
      tx.onerror = function(){ reject(tx.error || new Error('Falha ao apagar o comprovante.')); };
    });
    index = index.filter(function(m){ return m.id !== id; });
    rebuild();
  }

  async function removeByTx(txId){
    await load();
    const ids = (byTx[txId] || []).map(function(m){ return m.id; });
    for (let i = 0; i < ids.length; i++) {
      try { await remove(ids[i]); } catch (e) { /* segue removendo os demais */ }
    }
    return ids.length;
  }

  async function clear(){
    try {
      await load();
      const db = await openDB();
      await new Promise(function(resolve, reject){
        const tx = db.transaction([STORE_FILES, STORE_META], 'readwrite');
        tx.objectStore(STORE_FILES).clear();
        tx.objectStore(STORE_META).clear();
        tx.oncomplete = function(){ resolve(); };
        tx.onerror = function(){ reject(tx.error || new Error('Falha ao apagar os comprovantes.')); };
      });
    } catch (e) { /* sem banco: nada a apagar */ }
    index = [];
    rebuild();
  }

  return {
    supported: supported,
    load: load,
    list: list,
    count: count,
    meta: meta,
    totalBytes: totalBytes,
    add: add,
    get: get,
    remove: remove,
    removeByTx: removeByTx,
    clear: clear
  };

})();
