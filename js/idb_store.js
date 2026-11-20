// ============================================================
// ⚡ BayanIDB - IndexedDB Storage Layer for BAYAN_POS_MOBILE
// ============================================================
(function (global) {
    const DB_NAME = 'BayanMobileDB';
    const DB_VERSION = 1;
    const STORES = ['products', 'invoices', 'customers', 'treasury', 'settings'];

    let _dbPromise = null;

    function openDB() {
        if (_dbPromise) return _dbPromise;
        _dbPromise = new Promise((resolve, reject) => {
            if (!global.indexedDB) return reject(new Error('IndexedDB not supported'));
            const req = global.indexedDB.open(DB_NAME, DB_VERSION);
            req.onupgradeneeded = (e) => {
                const db = e.target.result;
                STORES.forEach((name) => {
                    if (!db.objectStoreNames.contains(name)) {
                        db.createObjectStore(name);
                    }
                });
            };
            req.onsuccess = (e) => resolve(e.target.result);
            req.onerror = (e) => reject(e.target.error || new Error('IDB open error'));
        });
        return _dbPromise;
    }

    async function idbGet(storeName, key = 'data') {
        try {
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
                STORES.map((s) => new Promise((resolve) => {
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
                { lsKey: prefix + 'accounts', store: 'customers', key: 'accounts' },
                { lsKey: prefix + 'shop_logo', store: 'settings', key: 'shopLogo' }
            ];
            for (const m of map) {
                const raw = localStorage.getItem(m.lsKey);
                if (raw && raw.length > 0) {
                    let parsed = raw;
                    try { parsed = JSON.parse(raw); } catch (_) {}
                    await idbSet(m.store, parsed, m.key || 'data');
                    localStorage.removeItem(m.lsKey);
                }
            }
        } catch (_) {}
    }

    global.BayanIDB = { openDB, idbGet, idbSet, idbClearAll, migrateFromLocalStorage };
})(window);
