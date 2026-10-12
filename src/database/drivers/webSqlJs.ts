import initSqlJs, { type SqlJsStatic } from 'sql.js'
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url'

let cached: Promise<SqlJsStatic> | null = null

/** بارگذاری WebAssembly مربوط به sql.js (فایل wasm داخل خود برنامه بسته‌بندی می‌شود، نه از اینترنت) */
export function loadSqlJs(): Promise<SqlJsStatic> {
  cached ??= initSqlJs({ locateFile: () => wasmUrl })
  return cached
}
