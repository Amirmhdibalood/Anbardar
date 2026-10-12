import type { Database as SqlJsDb, SqlJsStatic, SqlValue as SqlJsValue } from 'sql.js'
import { BaseDatabase } from '../baseDatabase'
import type { RunResult, SqlRow, SqlValue } from '../types'

/** محل ذخیره‌سازی دائمی فایل دیتابیس (در وب: IndexedDB). در تست‌ها لازم نیست. */
export interface PersistAdapter {
  load(): Promise<Uint8Array | null>
  save(bytes: Uint8Array): Promise<void>
}

/**
 * درایور SQLite مبتنی بر sql.js (WebAssembly).
 * کاربرد: اجرای مرورگر/توسعه، تست‌های خودکار در Node، و نسخه Web آینده.
 * همان SQL و همان Migrationها که روی اندروید اجرا می‌شوند، اینجا هم اجرا می‌شوند.
 */
export class SqlJsDatabase extends BaseDatabase {
  readonly kind = 'sqljs' as const
  private saveTimer: ReturnType<typeof setTimeout> | null = null

  private constructor(
    private readonly db: SqlJsDb,
    private readonly persist: PersistAdapter | null,
  ) {
    super()
  }

  static async open(SQL: SqlJsStatic, persist: PersistAdapter | null = null, initial?: Uint8Array): Promise<SqlJsDatabase> {
    const bytes = initial ?? (persist ? await persist.load() : null)
    const raw = bytes ? new SQL.Database(bytes) : new SQL.Database()
    const instance = new SqlJsDatabase(raw, persist)
    await instance.rawSetForeignKeys(true)
    return instance
  }

  protected async rawRun(sql: string, params: readonly SqlValue[]): Promise<RunResult> {
    this.db.run(sql, params as SqlJsValue[])
    return { changes: this.db.getRowsModified() }
  }

  protected async rawAll(sql: string, params: readonly SqlValue[]): Promise<SqlRow[]> {
    const stmt = this.db.prepare(sql)
    try {
      stmt.bind(params as SqlJsValue[])
      const rows: SqlRow[] = []
      while (stmt.step()) rows.push(stmt.getAsObject() as SqlRow)
      return rows
    } finally {
      stmt.free()
    }
  }

  protected async rawBegin(): Promise<void> {
    this.db.run('BEGIN')
  }
  protected async rawCommit(): Promise<void> {
    this.db.run('COMMIT')
  }
  protected async rawRollback(): Promise<void> {
    this.db.run('ROLLBACK')
  }
  protected async rawSetForeignKeys(enabled: boolean): Promise<void> {
    this.db.run(`PRAGMA foreign_keys = ${enabled ? 'ON' : 'OFF'}`)
  }

  protected override afterCommit(): void {
    if (!this.persist) return
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => void this.flush(), 200)
  }

  /** ذخیره فوری روی دیسک/IndexedDB */
  async flush(): Promise<void> {
    const persist = this.persist
    if (!persist) return
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = null
    // داخل صف اجرا می‌شود تا هیچ‌وقت وسط یک تراکنش باز، export انجام نشود
    await this.exclusive(async () => {
      const bytes = this.db.export()
      this.db.run('PRAGMA foreign_keys = ON') // export() کلیدهای خارجی را خاموش می‌کند
      await persist.save(bytes)
    })
  }

  /** نسخه باینری کامل دیتابیس (برای Backup وب در فازهای بعد) */
  exportBytes(): Promise<Uint8Array> {
    return this.exclusive(async () => {
      const bytes = this.db.export()
      this.db.run('PRAGMA foreign_keys = ON')
      return bytes
    })
  }

  async close(): Promise<void> {
    await this.flush()
    this.db.close()
  }
}
