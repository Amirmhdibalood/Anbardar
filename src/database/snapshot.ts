import { AppError } from '../utils/errors'
import { logger } from '../utils/logger'
import { nowIso } from '../utils/time'
import type { SqlExecutor } from './types'

/** محل نگهداری Snapshotها؛ در اندروید پوشه خصوصی برنامه، در وب IndexedDB، در تست حافظه */
export interface SnapshotStore {
  save(name: string, content: string): Promise<void>
  list(): Promise<string[]>
  read(name: string): Promise<string | null>
  remove(name: string): Promise<void>
}

export class MemorySnapshotStore implements SnapshotStore {
  readonly files = new Map<string, string>()
  async save(name: string, content: string) {
    this.files.set(name, content)
  }
  async list() {
    return [...this.files.keys()].sort()
  }
  async read(name: string) {
    return this.files.get(name) ?? null
  }
  async remove(name: string) {
    this.files.delete(name)
  }
}

export interface DatabaseDump {
  format: 'anbardar-dump'
  formatVersion: 1
  createdAt: string
  schemaVersion: number
  reason: string
  /** CREATE ... statements (جدول، ایندکس، Trigger) */
  schema: string[]
  tables: Record<string, Record<string, string | number | null>[]>
}

const KEEP_SNAPSHOTS = 5

/** خروجی کامل منطقی همه جدول‌ها؛ مستقل از درایور (مبنای Backup فاز ۷ هم می‌تواند باشد) */
export async function dumpDatabase(db: SqlExecutor, schemaVersion: number, reason: string): Promise<DatabaseDump> {
  const objects = await db.all<{ type: string; name: string; sql: string | null }>(
    "SELECT type, name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND sql IS NOT NULL ORDER BY rowid",
  )
  const tables: DatabaseDump['tables'] = {}
  for (const obj of objects) {
    if (obj.type !== 'table') continue
    tables[obj.name] = await db.all(`SELECT * FROM "${obj.name.replace(/"/g, '""')}"`)
  }
  return {
    format: 'anbardar-dump',
    formatVersion: 1,
    createdAt: nowIso(),
    schemaVersion,
    reason,
    schema: objects.map((o) => o.sql as string),
    tables,
  }
}

/** گرفتن Snapshot ایمنی. اگر ذخیره نشود، خطا می‌دهد تا Migration شروع نشود. */
export async function takeSnapshot(
  db: SqlExecutor,
  store: SnapshotStore,
  schemaVersion: number,
  reason: string,
): Promise<string> {
  try {
    const dump = await dumpDatabase(db, schemaVersion, reason)
    const stamp = dump.createdAt.replace(/[:.]/g, '-')
    const name = `pre-migration-v${schemaVersion}-${stamp}.json`
    await store.save(name, JSON.stringify(dump))
    const saved = await store.read(name)
    if (!saved || saved.length !== JSON.stringify(dump).length) throw new Error('snapshot verification failed')

    const all = (await store.list()).filter((n) => n.startsWith('pre-migration-'))
    for (const old of all.slice(0, Math.max(0, all.length - KEEP_SNAPSHOTS))) {
      await store.remove(old).catch((e) => logger.warn('حذف Snapshot قدیمی ناموفق بود', e))
    }
    return name
  } catch (error) {
    throw new AppError(
      'migration',
      'پیش از به‌روزرسانی پایگاه داده نتوانستیم نسخه ایمنی بسازیم، پس به‌روزرسانی انجام نشد. اطلاعات شما سالم است. حافظه خالی دستگاه را بررسی کنید.',
      { cause: error },
    )
  }
}

const REQUIRED_TABLES = [
  'schema_migrations',
  'settings',
  'products',
  'warehouses',
  'stock_movements',
  'warehouse_stock',
] as const

export type DumpValidation =
  | { ok: true; dump: DatabaseDump }
  | { ok: false; error: string }

/** بررسی ساختار فایل پشتیبان قبل از بازیابی */
export function validateDump(raw: unknown, maxSchemaVersion: number): DumpValidation {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'فایل پشتیبان معتبر نیست.' }
  const d = raw as Partial<DatabaseDump>
  if (d.format !== 'anbardar-dump') return { ok: false, error: 'این فایل مربوط به انباردار نیست.' }
  if (d.formatVersion !== 1) return { ok: false, error: 'نسخه قالب این فایل پشتیبانی نمی‌شود. برنامه را به‌روز کنید.' }
  if (typeof d.schemaVersion !== 'number' || !Number.isInteger(d.schemaVersion) || d.schemaVersion < 1) {
    return { ok: false, error: 'نسخه پایگاه داده در فایل نامعتبر است.' }
  }
  if (d.schemaVersion > maxSchemaVersion) {
    return { ok: false, error: 'این نسخه پشتیبان با برنامه جدیدتری ساخته شده. اول برنامه را به‌روز کنید، بعد بازیابی کنید.' }
  }
  if (!Array.isArray(d.schema) || typeof d.tables !== 'object' || d.tables === null) {
    return { ok: false, error: 'محتوای فایل پشتیبان ناقص است.' }
  }
  // از نسخه ۶ مشتری/تأمین‌کننده در parties است و اسناد مالی جدول‌های خودشان را دارند
  const partyTables = d.schemaVersion >= 6 ? ['parties', 'money_documents', 'settlements'] : ['customers', 'suppliers']
  if (d.schemaVersion >= 7) partyTables.push('product_units', 'purchase_charges', 'cheques')
  if (d.schemaVersion >= 9) partyTables.push('users', 'audit_log')
  for (const name of [...REQUIRED_TABLES, ...partyTables]) {
    if (!Array.isArray(d.tables[name])) return { ok: false, error: `جدول ضروری «${name}» در فایل نیست.` }
  }
  return { ok: true, dump: d as DatabaseDump }
}

/**
 * بازیابی کامل از Dump: همه اشیای فعلی حذف و Schema + داده فایل جایگزین می‌شود.
 * اگر نسخه Schema فایل قدیمی‌تر باشد، بعداً Migrationها را اجرا کنید.
 * باید بیرون از تراکنش صدا زده شود؛ کلیدهای خارجی موقتاً خاموش می‌شوند.
 */
export async function restoreDump(db: import('./types').Database, dump: DatabaseDump): Promise<void> {
  await db.setForeignKeys(false)
  try {
    await db.transaction(async (tx) => {
      const objects = await tx.all<{ type: string; name: string }>(
        "SELECT type, name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY rowid DESC",
      )
      for (const obj of objects) {
        if (obj.type === 'table') await tx.run(`DROP TABLE IF EXISTS "${obj.name.replace(/"/g, '""')}"`)
        else if (obj.type === 'index') await tx.run(`DROP INDEX IF EXISTS "${obj.name.replace(/"/g, '""')}"`)
        else if (obj.type === 'trigger') await tx.run(`DROP TRIGGER IF EXISTS "${obj.name.replace(/"/g, '""')}"`)
        else if (obj.type === 'view') await tx.run(`DROP VIEW IF EXISTS "${obj.name.replace(/"/g, '""')}"`)
      }
      // Triggerها بعد از درج داده ساخته می‌شوند؛ وگرنه Triggerهای «فقط سند فعال» درج ردیف‌های فاکتورِ ابطال‌شده را رد می‌کنند
      const isTrigger = (sql: string) => /^\s*CREATE\s+(TEMP\s+|TEMPORARY\s+)?TRIGGER\b/i.test(sql)
      for (const sql of dump.schema) {
        if (sql.trim() && !isTrigger(sql)) await tx.run(sql)
      }
      for (const [table, rows] of Object.entries(dump.tables)) {
        if (!rows.length) continue
        const cols = Object.keys(rows[0]!)
        const placeholders = cols.map(() => '?').join(', ')
        const colList = cols.map((c) => `"${c.replace(/"/g, '""')}"`).join(', ')
        const insert = `INSERT INTO "${table.replace(/"/g, '""')}" (${colList}) VALUES (${placeholders})`
        for (const row of rows) {
          await tx.run(
            insert,
            cols.map((c) => {
              const v = row[c]
              return v === undefined ? null : (v as string | number | null)
            }),
          )
        }
      }
      for (const sql of dump.schema) {
        if (sql.trim() && isTrigger(sql)) await tx.run(sql)
      }
    })
  } finally {
    await db.setForeignKeys(true)
  }
}
