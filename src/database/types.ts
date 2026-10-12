/** مقادیری که به SQLite داده می‌شوند. boolean باید قبل از ارسال به 0/1 تبدیل شود. */
export type SqlValue = string | number | null
export type SqlRow = Record<string, SqlValue>

export interface RunResult {
  changes: number
}

/**
 * رابط اجرای SQL. هم دیتابیس اصلی و هم «تراکنش جاری» همین رابط را دارند،
 * پس مخزن‌ها (repositories) نمی‌دانند داخل تراکنش‌اند یا نه.
 */
export interface SqlExecutor {
  run(sql: string, params?: readonly SqlValue[]): Promise<RunResult>
  all<T extends SqlRow = SqlRow>(sql: string, params?: readonly SqlValue[]): Promise<T[]>
  get<T extends SqlRow = SqlRow>(sql: string, params?: readonly SqlValue[]): Promise<T | undefined>
  /**
   * اجرای چند عملیات به‌صورت یک‌جا: یا همه انجام می‌شوند یا هیچ‌کدام (Rollback خودکار با خطا).
   * اگر داخل یک تراکنش صدا زده شود، از SAVEPOINT استفاده می‌کند.
   * خطاها همیشه به AppError با پیام فارسی تبدیل می‌شوند.
   */
  transaction<T>(fn: (tx: SqlExecutor) => Promise<T>): Promise<T>
}

export interface Database extends SqlExecutor {
  readonly kind: 'native' | 'sqljs'
  /** روشن/خاموش کردن کلیدهای خارجی (فقط برای Migration و بیرون از تراکنش) */
  setForeignKeys(enabled: boolean): Promise<void>
  isForeignKeysEnabled(): Promise<boolean>
  close(): Promise<void>
}
