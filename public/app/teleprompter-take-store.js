/* Durable local take queue. Uploading must never own the camera.
 * A completed recording is saved in IndexedDB before upload begins, so an
 * interrupted upload can resume from the saved video when this page reopens.
 * An unfinished recording is NOT saved here; iOS can still kill that take.
 */
(function (root) {
  "use strict";
  var NAME = "fundhub-teleprompter-takes";
  var STORE = "takes";
  var dbPromise = null;

  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve, reject) {
      if (!root.indexedDB) { reject(new Error("no_device_storage")); return; }
      var req;
      try { req = root.indexedDB.open(NAME, 1); }
      catch (e) { reject(e); return; }
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "id" });
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error || new Error("device_storage_unavailable")); };
      req.onblocked = function () { reject(new Error("device_storage_blocked")); };
    }).catch(function (error) { dbPromise = null; throw error; });
    return dbPromise;
  }

  function action(mode, operation) {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx, request, value;
        try {
          tx = db.transaction(STORE, mode);
          request = operation(tx.objectStore(STORE));
        } catch (e) { reject(e); return; }
        request.onsuccess = function () { value = request.result; };
        tx.oncomplete = function () { resolve(value); };
        tx.onerror = function () { reject(tx.error || new Error("device_storage_failed")); };
        tx.onabort = function () { reject(tx.error || new Error("device_storage_aborted")); };
      });
    });
  }
  function id() {
    try { if (root.crypto && root.crypto.randomUUID) return root.crypto.randomUUID(); } catch (e) {}
    return "take-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2);
  }
  function put(entry) {
    return action("readwrite", function (store) { return store.put(entry); }).then(function () { return entry; });
  }
  function all() {
    return action("readonly", function (store) { return store.getAll(); })
      .then(function (records) {
        return (records || []).filter(function (entry) { return entry && entry.id && entry.file; })
          .sort(function (a, b) { return (a.createdAt || 0) - (b.createdAt || 0); });
      });
  }
  function remove(id) {
    return action("readwrite", function (store) { return store.delete(id); });
  }
  root.FundhubTakeStore = { id: id, put: put, all: all, remove: remove };
})(typeof window !== "undefined" ? window : globalThis);
