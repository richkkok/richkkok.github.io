import { emptyState } from "../data/defaults.js";
import { validateState } from "./models.js";
export class Repository {
  constructor(name = "richkkok-v1", factory = globalThis.indexedDB) {
    this.name = name;
    this.factory = factory;
    this.db = null;
  }
  async open() {
    if (this.db) return this.db;
    this.db = await new Promise((resolve, reject) => {
      const r = this.factory.open(this.name, 1);
      r.onupgradeneeded = () => r.result.createObjectStore("household");
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
      r.onblocked = () =>
        reject(Error("다른 창의 리치콕을 닫고 다시 시도해 주세요."));
    });
    this.db.onversionchange = () => {
      this.db.close();
      this.db = null;
    };
    return this.db;
  }
  async readKey(key, fallback = null) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const r = db
        .transaction("household")
        .objectStore("household")
        .get(key);
      r.onsuccess = () => resolve(r.result ?? fallback);
      r.onerror = () => reject(r.error);
    });
  }
  async writeKey(key, value) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("household", "readwrite");
      tx.objectStore("household").put(value, key);
      tx.oncomplete = () => resolve(structuredClone(value));
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || Error("저장하지 못했어요."));
    });
  }
  async deleteKey(key) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("household", "readwrite");
      tx.objectStore("household").delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || Error("삭제하지 못했어요."));
    });
  }
  async read() {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const r = db
        .transaction("household")
        .objectStore("household")
        .get("state");
      r.onsuccess = () => resolve(r.result || emptyState());
      r.onerror = () => reject(r.error);
    });
  }
  async mutate(change) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("household", "readwrite"),
        store = tx.objectStore("household");
      let next, ownError;
      const r = store.get("state");
      r.onsuccess = () => {
        try {
          const current = r.result || emptyState();
          next = change(current) || current;
          if (next instanceof Promise)
            throw Error("Storage changes must be synchronous");
          next.revision = (current.revision || 0) + 1;
          store.put(next, "state");
        } catch (e) {
          ownError = e;
          tx.abort();
        }
      };
      tx.oncomplete = () => resolve(structuredClone(next));
      tx.onerror = () => reject(ownError || tx.error);
      tx.onabort = () =>
        reject(ownError || tx.error || Error("저장하지 못했어요."));
    });
  }
  async replace(state) {
    const checked = validateState(state);
    return this.mutate(() => checked);
  }
  async clear() {
    return this.mutate(() => emptyState());
  }
  close() {
    this.db?.close();
    this.db = null;
  }
}
