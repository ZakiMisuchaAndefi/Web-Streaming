/* ==========================================================================
   db.js — pembungkus IndexedDB
   ========================================================================== */

(function (AM) {
  "use strict";

  const DB_NAME = "musik-local-library";
  const DB_VERSION = 2;

  const Store = {
    name: DB_NAME,
    version: DB_VERSION,
    db: null,
    available: false,
    error: null,

    open() {
      return new Promise((resolve, reject) => {
        if (!("indexedDB" in window) || !window.indexedDB) {
          reject(new Error("IndexedDB tidak tersedia di browser ini."));
          return;
        }

        let request;
        try {
          request = window.indexedDB.open(DB_NAME, DB_VERSION);
        } catch (error) {
          reject(error);
          return;
        }

        request.onupgradeneeded = (event) => {
          const db = event.target.result;

          if (!db.objectStoreNames.contains("tracks")) {
            const tracks = db.createObjectStore("tracks", { keyPath: "id" });
            tracks.createIndex("addedAt", "addedAt");
            tracks.createIndex("albumKey", "albumKey");
            tracks.createIndex("artistKey", "artistKey");
          }

          if (!db.objectStoreNames.contains("files")) {
            db.createObjectStore("files", { keyPath: "id" });
          }

          if (!db.objectStoreNames.contains("covers")) {
            db.createObjectStore("covers", { keyPath: "id" });
          }

          if (!db.objectStoreNames.contains("playlists")) {
            db.createObjectStore("playlists", { keyPath: "id" });
          }

          if (!db.objectStoreNames.contains("settings")) {
            db.createObjectStore("settings", { keyPath: "key" });
          }

          if (!db.objectStoreNames.contains("history")) {
            const history = db.createObjectStore("history", { keyPath: "id" });
            history.createIndex("playedAt", "playedAt");
          }
        };

        request.onsuccess = () => {
          const db = request.result;
          db.onversionchange = () => {
            db.close();
            Store.db = null;
            Store.available = false;
          };
          Store.db = db;
          Store.available = true;
          Store.error = null;
          resolve(db);
        };

        request.onerror = () => {
          Store.available = false;
          Store.error = request.error;
          reject(request.error || new Error("Gagal membuka basis data."));
        };

        request.onblocked = () => {
          Store.error = new Error("Basis data sedang dipakai oleh tab lain.");
        };
      });
    },

    transaction(storeNames, mode) {
      if (!this.db) throw new Error("Basis data belum siap.");
      return this.db.transaction(storeNames, mode || "readonly");
    },

    requestResult(request) {
      return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error("Permintaan basis data gagal."));
      });
    },

    getAll(storeName) {
      const tx = this.transaction(storeName, "readonly");
      return this.requestResult(tx.objectStore(storeName).getAll());
    },

    get(storeName, key) {
      const tx = this.transaction(storeName, "readonly");
      return this.requestResult(tx.objectStore(storeName).get(key));
    },

    put(storeName, value) {
      const tx = this.transaction(storeName, "readwrite");
      const store = tx.objectStore(storeName);
      return new Promise((resolve, reject) => {
        store.put(value);
        tx.oncomplete = () => resolve(value);
        tx.onerror = () => reject(tx.error || new Error("Gagal menyimpan data."));
        tx.onabort = () => reject(tx.error || new Error("Penyimpanan dibatalkan."));
      });
    },

    putAll(storeName, values) {
      if (!values || !values.length) return Promise.resolve();
      const tx = this.transaction(storeName, "readwrite");
      const store = tx.objectStore(storeName);
      values.forEach((value) => store.put(value));
      return new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error || new Error("Gagal menyimpan data."));
        tx.onabort = () => reject(tx.error || new Error("Penyimpanan dibatalkan."));
      });
    },

    putMany(storeName, values, extra) {
      const entries = Object.entries(extra || {});
      const names = [storeName].concat(entries.map((entry) => entry[0]));
      if (!values || !values.length) return this.putAllMany(entries);
      const tx = this.transaction(names, "readwrite");
      values.forEach((value) => tx.objectStore(storeName).put(value));
      entries.forEach((entry) => {
        const [name, list] = entry;
        (list || []).forEach((value) => tx.objectStore(name).put(value));
      });
      return new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error || new Error("Gagal menyimpan data."));
        tx.onabort = () => reject(tx.error || new Error("Penyimpanan dibatalkan."));
      });
    },

    putAllMany(entries) {
      if (!entries.length) return Promise.resolve();
      const names = entries.map((entry) => entry[0]);
      const tx = this.transaction(names, "readwrite");
      entries.forEach((entry) => {
        const [name, list] = entry;
        (list || []).forEach((value) => tx.objectStore(name).put(value));
      });
      return new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error || new Error("Gagal menyimpan data."));
        tx.onabort = () => reject(tx.error || new Error("Penyimpanan dibatalkan."));
      });
    },

    remove(storeName, key) {
      const tx = this.transaction(storeName, "readwrite");
      return new Promise((resolve, reject) => {
        tx.objectStore(storeName).delete(key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error || new Error("Gagal menghapus data."));
      });
    },

    removeMany(entries) {
      if (!entries.length) return Promise.resolve();
      const tx = this.transaction(entries.map((entry) => entry[0]), "readwrite");
      entries.forEach((entry) => {
        const [name, keys] = entry;
        (keys || []).forEach((key) => tx.objectStore(name).delete(key));
      });
      return new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error || new Error("Gagal menghapus data."));
      });
    },

    clearAll() {
      const names = ["tracks", "files", "covers", "playlists", "settings", "history"];
      const tx = this.transaction(names, "readwrite");
      names.forEach((name) => tx.objectStore(name).clear());
      return new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error || new Error("Gagal membersihkan data."));
        tx.onabort = () => reject(tx.error || new Error("Pembersihan dibatalkan."));
      });
    }
  };

  AM.DB = Store;
})(window.AM = window.AM || {});
