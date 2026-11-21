// ============================================================
// ⚡ BayanIDB v2 - Indexed IndexedDB Storage Layer for BAYAN_POS_MOBILE
// ============================================================
// تخزين مفهرس حقيقي لكل سجل (keyPath: 'id') مع هجرة آمنة تلقائية من v1 ('data' blob)
// دون فقدان أي بيانات، ودعم idbBulkPut و idbGetAll و idbGetByIndex بالدفعات.
(function (global) {
    'use strict';

    const DB_NAME = 'BayanMobileDB';
    const DB_VERSION = 2;
    const RECORD_STORES = ['products', 'invoices', 'customers'];
    const KV_STORES = ['treasury', 'settings'];
    const ALL_STORES = [...RECORD_STORES, ...KV_STORES];

    let _dbPromise = null;

    function normalizeRecord(storeName, item, fallbackIdx = 0) {
        if (!item || typeof item !== 'object') return null;
        const copy = Object.assign({}, item);

        if (storeName === 'products') {
            const rawId = copy.id !== undefined && copy.id !== null && String(copy.id).trim() !== ''
                ? String(copy.id).trim()
                : String(copy.barcode || copy.code || ('prod_' + Date.now() + '_' + fallbackIdx));
            copy.id = rawId;
            copy.barcode = String(copy.barcode || copy.code || '').trim();
            copy.code = String(copy.code || copy.barcode || '').trim();
            copy.name = String(copy.name || '').trim();
            copy.category = String(copy.category || 'عام').trim();
            return copy;
        }

        if (storeName === 'invoices') {
            const rawId = copy.id !== undefined && copy.id !== null && String(copy.id).trim() !== ''
                ? String(copy.id).trim()
                : String(copy.invoiceId || ('inv_' + Date.now() + '_' + fallbackIdx));
            copy.id = rawId;
            const dateVal = String(copy.dateISO || copy.date || '').trim();
            copy.dateISO = dateVal;
            copy.date = dateVal;
            copy.customer_name = String(copy.customer_name || copy.partner || 'عميل نقدي').trim();
            if (!copy.partner) copy.partner = copy.customer_name;
            copy.invoiceId = String(copy.invoiceId || rawId).trim();
            return copy;
        }

        if (storeName === 'customers') {
            const rawId = copy.id !== undefined && copy.id !== null && String(copy.id).trim() !== ''
                ? String(copy.id).trim()
                : String(copy.code || copy.name || ('cust_' + Date.now() + '_' + fallbackIdx));
            copy.id = rawId;
            copy.name = String(copy.name || '').trim();
            copy.code = String(copy.code || '').trim();
            copy.mobile = String(copy.mobile || copy.phone || '').trim();
            return copy;
        }

        return copy;
    }

    function createIndexedStore(db, storeName) {
        const store = db.createObjectStore(storeName, { keyPath: 'id' });
        if (storeName === 'products') {
            store.createIndex('barcode', 'barcode', { unique: false });
            store.createIndex('code', 'code', { unique: false });
            store.createIndex('name', 'name', { unique: false });
            store.createIndex('category', 'category', { unique: false });
        } else if (storeName === 'invoices') {
            store.createIndex('date', 'date', { unique: false });
            store.createIndex('dateISO', 'dateISO', { unique: false });
            store.createIndex('customer_name', 'customer_name', { unique: false });
            store.createIndex('invoiceId', 'invoiceId', { unique: false });
        } else if (storeName === 'customers') {
            store.createIndex('name', 'name', { unique: false });
            store.createIndex('code', 'code', { unique: false });
            store.createIndex('mobile', 'mobile', { unique: false });
        }
        return store;
    }

    function ensureIndexesOnExistingStore(store, storeName) {
        const ensure = (idxName, keyPath) => {
            if (!store.indexNames.contains(idxName)) {
                store.createIndex(idxName, keyPath, { unique: false });
            }
        };
        if (storeName === 'products') {
            ensure('barcode', 'barcode');
            ensure('code', 'code');
            ensure('name', 'name');
            ensure('category', 'category');
        } else if (storeName === 'invoices') {
            ensure('date', 'date');
            ensure('dateISO', 'dateISO');
            ensure('customer_name', 'customer_name');
            ensure('invoiceId', 'invoiceId');
        } else if (storeName === 'customers') {
            ensure('name', 'name');
            ensure('code', 'code');
            ensure('mobile', 'mobile');
        }
    }

    function openDB() {
        if (_dbPromise) return _dbPromise;
        _dbPromise = new Promise((resolve, reject) => {
            if (!global.indexedDB) return reject(new Error('IndexedDB not supported'));
            const req = global.indexedDB.open(DB_NAME, DB_VERSION);
            req.onupgradeneeded = (e) => {
                const db = e.target.result;
                const tx = e.target.transaction;

                // 1. تأمين مخازن المفتاح-القيمة (treasury, settings)
                KV_STORES.forEach((name) => {
                    if (!db.objectStoreNames.contains(name)) {
                        db.createObjectStore(name);
                    }
                });

                // 2. إنشاء أو ترقية مخازن السجلات المفهرسة (products, invoices, customers) مع هجرة آمنة لبيانات v1
                RECORD_STORES.forEach((name) => {
                    if (!db.objectStoreNames.contains(name)) {
                        createIndexedStore(db, name);
                        return;
                    }

                    const existingStore = tx.objectStore(name);
                    if (existingStore.keyPath === 'id') {
                        ensureIndexesOnExistingStore(existingStore, name);
                        return;
                    }

                    // 🚚 هجرة آمنة من v1 (مصفوفة مخزنة تحت مفتاح 'data' أو 'accounts') إلى v2 (سجل لكل صف بـ keyPath:'id')
                    const legacyReq = existingStore.get('data');
                    legacyReq.onsuccess = () => {
                        const legacyData = legacyReq.result;
                        const finishUpgrade = (extraAccounts) => {
                            let mergedList = Array.isArray(legacyData) ? legacyData.slice() : [];
                            if (Array.isArray(extraAccounts) && extraAccounts.length > 0 && mergedList.length === 0) {
                                mergedList = extraAccounts.slice();
                            }
                            try {
                                db.deleteObjectStore(name);
                            } catch (_) { }
                            const newStore = createIndexedStore(db, name);
                            for (let i = 0; i < mergedList.length; i++) {
                                const rec = normalizeRecord(name, mergedList[i], i);
                                if (rec) {
                                    try { newStore.put(rec); } catch (_) { }
                                }
                            }
                        };

                        if (name === 'customers') {
                            try {
                                const accReq = existingStore.get('accounts');
                                accReq.onsuccess = () => finishUpgrade(accReq.result);
                                accReq.onerror = () => finishUpgrade(null);
                            } catch (_) {
                                finishUpgrade(null);
                            }
                        } else {
                            finishUpgrade(null);
                        }
                    };
                    legacyReq.onerror = () => {
                        try { db.deleteObjectStore(name); } catch (_) { }
                        createIndexedStore(db, name);
                    };
                });
            };
            req.onsuccess = (e) => resolve(e.target.result);
            req.onerror = (e) => {
                _dbPromise = null;
                reject(e.target.error || new Error('IDB open error'));
            };
        });
        return _dbPromise;
    }

    async function idbBulkPut(storeName, items, options = {}) {
        try {
            if (!Array.isArray(items)) return false;
            const db = await openDB();
            const clearFirst = Boolean(options && options.clearFirst);
            return await new Promise((resolve) => {
                const tx = db.transaction(storeName, 'readwrite');
                const store = tx.objectStore(storeName);
                if (clearFirst) {
                    try { store.clear(); } catch (_) { }
                }
                if (RECORD_STORES.includes(storeName)) {
                    for (let i = 0; i < items.length; i++) {
                        const rec = normalizeRecord(storeName, items[i], i);
                        if (rec) store.put(rec);
                    }
                } else {
                    store.put(items, options.key || 'data');
                }
                tx.oncomplete = () => resolve(true);
                tx.onerror = () => resolve(false);
                tx.onabort = () => resolve(false);
            });
        } catch (_) {
            return false;
        }
    }

    async function idbGetAll(storeName) {
        try {
            const db = await openDB();
            return await new Promise((resolve) => {
                const tx = db.transaction(storeName, 'readonly');
                const store = tx.objectStore(storeName);
                if (typeof store.getAll === 'function') {
                    const req = store.getAll();
                    req.onsuccess = () => resolve(Array.isArray(req.result) ? req.result : []);
                    req.onerror = () => resolve([]);
                } else {
                    const results = [];
                    const cursorReq = store.openCursor();
                    cursorReq.onsuccess = (ev) => {
                        const cursor = ev.target.result;
                        if (cursor) {
                            results.push(cursor.value);
                            cursor.continue();
                        } else {
                            resolve(results);
                        }
                    };
                    cursorReq.onerror = () => resolve([]);
                }
            });
        } catch (_) {
            return [];
        }
    }

    async function idbGetByIndex(storeName, indexName, value) {
        try {
            const db = await openDB();
            return await new Promise((resolve) => {
                const tx = db.transaction(storeName, 'readonly');
                const store = tx.objectStore(storeName);
                if (!store.indexNames.contains(indexName)) return resolve([]);
                const idx = store.index(indexName);
                if (typeof idx.getAll === 'function') {
                    const req = idx.getAll(value);
                    req.onsuccess = () => resolve(Array.isArray(req.result) ? req.result : []);
                    req.onerror = () => resolve([]);
                } else {
                    const results = [];
                    const cReq = idx.openCursor(value);
                    cReq.onsuccess = (ev) => {
                        const cursor = ev.target.result;
                        if (cursor) {
                            results.push(cursor.value);
                            cursor.continue();
                        } else {
                            resolve(results);
                        }
                    };
                    cReq.onerror = () => resolve([]);
                }
            });
        } catch (_) {
            return [];
        }
    }

    async function idbCount(storeName) {
        try {
            const db = await openDB();
            return await new Promise((resolve) => {
                const tx = db.transaction(storeName, 'readonly');
                const req = tx.objectStore(storeName).count();
                req.onsuccess = () => resolve(typeof req.result === 'number' ? req.result : 0);
                req.onerror = () => resolve(0);
            });
        } catch (_) {
            return 0;
        }
    }

    async function idbGet(storeName, key = 'data') {
        try {
            if (RECORD_STORES.includes(storeName)) {
                if (key === 'data' || key === 'accounts' || key === undefined || key === null) {
                    const all = await idbGetAll(storeName);
                    return all.length > 0 ? all : null;
                }
                const db = await openDB();
                return await new Promise((resolve) => {
                    const tx = db.transaction(storeName, 'readonly');
                    const req = tx.objectStore(storeName).get(String(key));
                    req.onsuccess = () => resolve(req.result !== undefined ? req.result : null);
                    req.onerror = () => resolve(null);
                });
            }
            const db = await openDB();
            return await new Promise((resolve) => {
                const tx = db.transaction(storeName, 'readonly');
                const req = tx.objectStore(storeName).get(key);
                req.onsuccess = () => resolve(req.result !== undefined ? req.result : null);
                req.onerror = () => resolve(null);
            });
        } catch (_) {
            return null;
        }
    }

    async function idbSet(storeName, value, key = 'data') {
        try {
            if (RECORD_STORES.includes(storeName)) {
                if (Array.isArray(value)) {
                    return await idbBulkPut(storeName, value, { clearFirst: true });
                }
                if (value && typeof value === 'object') {
                    return await idbBulkPut(storeName, [value], { clearFirst: false });
                }
                return false;
            }
            const db = await openDB();
            return await new Promise((resolve) => {
                const tx = db.transaction(storeName, 'readwrite');
                const req = tx.objectStore(storeName).put(value, key);
                req.onsuccess = () => resolve(true);
                req.onerror = () => resolve(false);
            });
        } catch (_) {
            return false;
        }
    }

    async function idbClearAll() {
        try {
            const db = await openDB();
            await Promise.all(
                ALL_STORES.map((s) => new Promise((resolve) => {
                    const tx = db.transaction(s, 'readwrite');
                    const req = tx.objectStore(s).clear();
                    req.onsuccess = () => resolve(true);
                    req.onerror = () => resolve(false);
                }))
            );
            return true;
        } catch (_) {
            return false;
        }
    }

    async function migrateFromLocalStorage() {
        try {
            const prefix = 'bayan_mob_';
            const map = [
                { lsKey: prefix + 'products', store: 'products' },
                { lsKey: prefix + 'transactions', store: 'invoices' },
                { lsKey: prefix + 'customers', store: 'customers' },
                { lsKey: prefix + 'accounts', store: 'customers' },
                { lsKey: prefix + 'shop_logo', store: 'settings', key: 'shopLogo' }
            ];
            for (const m of map) {
                const raw = localStorage.getItem(m.lsKey);
                if (raw && raw.length > 0) {
                    let parsed = raw;
                    try { parsed = JSON.parse(raw); } catch (_) { }
                    if (RECORD_STORES.includes(m.store) && Array.isArray(parsed)) {
                        await idbBulkPut(m.store, parsed, { clearFirst: false });
                    } else {
                        await idbSet(m.store, parsed, m.key || 'data');
                    }
                    localStorage.removeItem(m.lsKey);
                }
            }
        } catch (_) { }
    }

    global.BayanIDB = {
        DB_NAME,
        DB_VERSION,
        RECORD_STORES,
        openDB,
        idbGet,
        idbSet,
        idbBulkPut,
        idbGetAll,
        idbGetByIndex,
        idbCount,
        idbClearAll,
        migrateFromLocalStorage
    };
})(window);
