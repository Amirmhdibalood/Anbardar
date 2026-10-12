import type { PersistAdapter } from './sqlJsDatabase'
import type { SnapshotStore } from '../snapshot'

const DB_NAME = 'anbardar-web'
const STORE = 'files'

function openIdb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => request.result.createObjectStore(STORE)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function idbGet<T>(key: string): Promise<T | null> {
  const db = await openIdb()
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE).objectStore(STORE).get(key)
    req.onsuccess = () => resolve((req.result as T | undefined) ?? null)
    req.onerror = () => reject(req.error)
  })
}

async function idbPut(key: string, value: unknown): Promise<void> {
  const db = await openIdb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put(value, key)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

async function idbKeys(): Promise<string[]> {
  const db = await openIdb()
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE).objectStore(STORE).getAllKeys()
    req.onsuccess = () => resolve(req.result as string[])
    req.onerror = () => reject(req.error)
  })
}

async function idbDelete(key: string): Promise<void> {
  const db = await openIdb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).delete(key)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

/** ذخیره فایل دیتابیس sql.js در IndexedDB مرورگر */
export const indexedDbPersist: PersistAdapter = {
  load: () => idbGet<Uint8Array>('anbardar.sqlite'),
  save: (bytes) => idbPut('anbardar.sqlite', bytes),
}

/** نگهداری Snapshotهای قبل از Migration در IndexedDB مرورگر */
export const indexedDbSnapshotStore: SnapshotStore = {
  save: (name, content) => idbPut(`snapshot/${name}`, content),
  async list() {
    return (await idbKeys()).filter((k) => k.startsWith('snapshot/')).map((k) => k.slice('snapshot/'.length)).sort()
  },
  remove: (name) => idbDelete(`snapshot/${name}`),
  read: async (name) => idbGet<string>(`snapshot/${name}`),
}
