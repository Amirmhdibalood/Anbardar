import { AppError } from '../utils/errors'
import { logger } from '../utils/logger'
import { mapDbError } from './errorMapper'
import type { Database, RunResult, SqlExecutor, SqlRow, SqlValue } from './types'

/**
 * هسته مشترک همه درایورها: صف‌بندی عملیات (یک اتصال، یک عملیات در هر لحظه)،
 * تراکنش با Rollback خودکار، SAVEPOINT برای تراکنش تودرتو و تبدیل خطاها به AppError.
 *
 * قانون مهم: داخل callback یک تراکنش فقط از `tx` استفاده شود، نه از `db`
 * (استفاده از db داخل تراکنش منتظر پایان همان تراکنش می‌ماند و قفل می‌شود).
 */
export abstract class BaseDatabase implements Database {
  abstract readonly kind: Database['kind']

  protected abstract rawRun(sql: string, params: readonly SqlValue[]): Promise<RunResult>
  protected abstract rawAll(sql: string, params: readonly SqlValue[]): Promise<SqlRow[]>
  protected abstract rawBegin(): Promise<void>
  protected abstract rawCommit(): Promise<void>
  protected abstract rawRollback(): Promise<void>
  protected abstract rawSetForeignKeys(enabled: boolean): Promise<void>
  abstract close(): Promise<void>

  /** بعد از هر نوشتن موفق بیرون از تراکنش یا Commit تراکنش اصلی (برای ذخیره‌سازی در وب) */
  protected afterCommit(): void {}

  private queue: Promise<unknown> = Promise.resolve()

  protected exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.queue.then(fn, fn)
    this.queue = result.catch(() => undefined)
    return result
  }

  private async guarded<T>(fn: () => Promise<T>, sql?: string): Promise<T> {
    try {
      return await fn()
    } catch (error) {
      const mapped = mapDbError(error, sql)
      if (mapped.cause) logger.warn('خطای دیتابیس', mapped.cause)
      throw mapped
    }
  }

  // ---- اجرای مستقیم روی دیتابیس (صف‌بندی‌شده)
  run(sql: string, params: readonly SqlValue[] = []): Promise<RunResult> {
    return this.exclusive(async () => {
      const result = await this.guarded(() => this.rawRun(sql, params), sql)
      if (result.changes > 0) this.afterCommit()
      return result
    })
  }

  all<T extends SqlRow = SqlRow>(sql: string, params: readonly SqlValue[] = []): Promise<T[]> {
    return this.exclusive(() => this.guarded(() => this.rawAll(sql, params) as Promise<T[]>, sql))
  }

  async get<T extends SqlRow = SqlRow>(sql: string, params: readonly SqlValue[] = []): Promise<T | undefined> {
    return (await this.all<T>(sql, params))[0]
  }

  transaction<T>(fn: (tx: SqlExecutor) => Promise<T>): Promise<T> {
    return this.exclusive(async () => {
      await this.guarded(() => this.rawBegin())
      const tx = new TransactionContext(this, (f, sql) => this.guarded(f, sql))
      try {
        const result = await fn(tx)
        await this.guarded(() => this.rawCommit())
        this.afterCommit()
        return result
      } catch (error) {
        tx.finish()
        try {
          await this.rawRollback()
        } catch (rollbackError) {
          logger.error('Rollback ناموفق بود', rollbackError)
        }
        if (!(error instanceof AppError)) logger.error('خطای پیش‌بینی‌نشده داخل تراکنش', error)
        throw mapDbError(error)
      }
    })
  }

  async setForeignKeys(enabled: boolean): Promise<void> {
    await this.exclusive(() => this.guarded(() => this.rawSetForeignKeys(enabled)))
  }

  async isForeignKeysEnabled(): Promise<boolean> {
    const row = await this.get<{ foreign_keys: number }>('PRAGMA foreign_keys')
    return row?.foreign_keys === 1
  }

  /** فقط برای TransactionContext */
  runRaw(sql: string, params: readonly SqlValue[]): Promise<RunResult> {
    return this.rawRun(sql, params)
  }
  allRaw(sql: string, params: readonly SqlValue[]): Promise<SqlRow[]> {
    return this.rawAll(sql, params)
  }
}

let savepointCounter = 0

/** «تراکنش جاری»؛ بدون صف‌بندی چون صف را تراکنش اصلی نگه داشته است */
class TransactionContext implements SqlExecutor {
  private done = false

  constructor(
    private readonly db: BaseDatabase,
    private readonly guard: <T>(fn: () => Promise<T>, sql?: string) => Promise<T>,
  ) {}

  finish(): void {
    this.done = true
  }

  private assertOpen(): void {
    if (this.done) throw new Error('transaction already finished')
  }

  run(sql: string, params: readonly SqlValue[] = []): Promise<RunResult> {
    this.assertOpen()
    return this.guard(() => this.db.runRaw(sql, params), sql)
  }

  all<T extends SqlRow = SqlRow>(sql: string, params: readonly SqlValue[] = []): Promise<T[]> {
    this.assertOpen()
    return this.guard(() => this.db.allRaw(sql, params) as Promise<T[]>, sql)
  }

  async get<T extends SqlRow = SqlRow>(sql: string, params: readonly SqlValue[] = []): Promise<T | undefined> {
    return (await this.all<T>(sql, params))[0]
  }

  async transaction<T>(fn: (tx: SqlExecutor) => Promise<T>): Promise<T> {
    this.assertOpen()
    const name = `sp_${++savepointCounter}`
    await this.run(`SAVEPOINT ${name}`)
    try {
      const result = await fn(this)
      await this.run(`RELEASE ${name}`)
      return result
    } catch (error) {
      await this.run(`ROLLBACK TO ${name}`)
      await this.run(`RELEASE ${name}`)
      throw error
    }
  }
}
