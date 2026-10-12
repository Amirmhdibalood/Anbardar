import { CapacitorSQLite, SQLiteConnection, type SQLiteDBConnection } from '@capacitor-community/sqlite'
import { BaseDatabase } from '../baseDatabase'
import type { RunResult, SqlRow, SqlValue } from '../types'

/**
 * درایور اندروید بر پایه @capacitor-community/sqlite (نسخه ۸، سازگار با Capacitor 8).
 *
 * نکته‌های طراحی:
 * - تراکنش‌ها را خودمان با beginTransaction/commitTransaction مدیریت می‌کنیم و همه دستورها
 *   با `transaction=false` اجرا می‌شوند تا تراکنش تودرتو ساخته نشود.
 * - هر دستور DDL جداگانه با run() اجرا می‌شود (نه execute چندتایی) تا Triggerهایی که
 *   داخلشان `;` دارد توسط افزونه اشتباه تکه‌تکه نشوند.
 * - در Schema عمداً از ON DELETE / ON UPDATE استفاده نشده؛ افزونه دستورهای DELETE را بر اساس
 *   این عبارت‌ها بازنویسی می‌کند و ما فقط به رفتار پیش‌فرض (NO ACTION = جلوگیری) نیاز داریم.
 */
export class CapacitorDatabase extends BaseDatabase {
  readonly kind = 'native' as const

  private constructor(
    private readonly sqlite: SQLiteConnection,
    private readonly conn: SQLiteDBConnection,
    private readonly dbName: string,
  ) {
    super()
  }

  static async open(dbName = 'anbardar'): Promise<CapacitorDatabase> {
    const sqlite = new SQLiteConnection(CapacitorSQLite)
    const consistency = await sqlite.checkConnectionsConsistency()
    const exists = (await sqlite.isConnection(dbName, false)).result
    const conn =
      consistency.result && exists
        ? await sqlite.retrieveConnection(dbName, false)
        : await sqlite.createConnection(dbName, false, 'no-encryption', 1, false)
    await conn.open()
    const instance = new CapacitorDatabase(sqlite, conn, dbName)
    await instance.rawSetForeignKeys(true)
    return instance
  }

  protected async rawRun(sql: string, params: readonly SqlValue[]): Promise<RunResult> {
    const result = await this.conn.run(sql, [...params], false, 'no')
    return { changes: result.changes?.changes ?? 0 }
  }

  protected async rawAll(sql: string, params: readonly SqlValue[]): Promise<SqlRow[]> {
    const result = await this.conn.query(sql, [...params])
    const rows = (result.values ?? []) as SqlRow[]
    // iOS ردیف اول را برای نام ستون‌ها رزرو می‌کند؛ اندروید نه
    return rows.length > 0 && rows[0] && 'ios_columns' in rows[0] ? rows.slice(1) : rows
  }

  protected async rawBegin(): Promise<void> {
    await this.conn.beginTransaction()
  }
  protected async rawCommit(): Promise<void> {
    await this.conn.commitTransaction()
  }
  protected async rawRollback(): Promise<void> {
    if ((await this.conn.isTransactionActive()).result) await this.conn.rollbackTransaction()
  }
  protected async rawSetForeignKeys(enabled: boolean): Promise<void> {
    await this.conn.execute(`PRAGMA foreign_keys = ${enabled ? 'ON' : 'OFF'};`, false)
  }

  async close(): Promise<void> {
    await this.sqlite.closeConnection(this.dbName, false)
  }
}
