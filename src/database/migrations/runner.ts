import { AppError } from '../../utils/errors'
import { logger } from '../../utils/logger'
import { nowIso } from '../../utils/time'
import { takeSnapshot, type SnapshotStore } from '../snapshot'
import type { Database } from '../types'
import type { Migration } from './types'

export interface MigrationReport {
  fromVersion: number
  toVersion: number
  applied: number[]
  snapshot: string | null
}

/** هش ساده (FNV-1a) برای تشخیص ویرایش Migrationهای قدیمی */
export function checksumOf(migration: Migration): string {
  let h = 0x811c9dc5
  for (const ch of migration.statements.join('\n')) {
    h ^= ch.codePointAt(0) ?? 0
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16)
}

function assertValidList(migrations: readonly Migration[]): void {
  migrations.forEach((m, i) => {
    if (m.version !== i + 1) throw new Error(`Migration versions must be 1..N without gaps (got ${m.version} at index ${i})`)
  })
}

/**
 * اجرای Migrationهای باقی‌مانده.
 * - نسخه فعلی از جدول schema_migrations خوانده می‌شود (نبودن جدول = نسخه ۰ = دیتابیس خالی).
 * - اگر دیتابیس از قبل داده دارد (نسخه > ۰)، پیش از هر تغییر یک Snapshot کامل ذخیره می‌شود؛
 *   اگر Snapshot ذخیره نشود، Migration اصلاً شروع نمی‌شود.
 * - هر Migration در یک تراکنش جداگانه اجرا می‌شود و با هر خطا کاملاً Rollback می‌شود.
 * - اگر دیتابیس از نسخه جدیدتری از برنامه باشد، هیچ تغییری روی آن داده نمی‌شود.
 */
export async function runMigrations(
  db: Database,
  migrations: readonly Migration[],
  snapshotStore: SnapshotStore,
): Promise<MigrationReport> {
  assertValidList(migrations)
  const latest = migrations.length

  await db.run(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    checksum TEXT NOT NULL,
    applied_at TEXT NOT NULL
  )`)

  const applied = await db.all<{ version: number; checksum: string }>('SELECT version, checksum FROM schema_migrations ORDER BY version')
  const current = applied.length > 0 ? Math.max(...applied.map((a) => a.version)) : 0

  if (current > latest) {
    throw new AppError(
      'database_newer',
      'اطلاعات این دستگاه با نسخه جدیدتری از انباردار ساخته شده است. برنامه را به‌روزرسانی کنید. تا آن زمان به اطلاعات دست زده نمی‌شود.',
    )
  }

  for (const row of applied) {
    const known = migrations[row.version - 1]
    if (!known || checksumOf(known) !== row.checksum) {
      throw new AppError(
        'migration',
        'ساختار پایگاه داده با این نسخه برنامه سازگار نیست. به اطلاعات دست زده نشد؛ لطفاً برنامه را دوباره نصب یا به‌روزرسانی کنید.',
        { cause: new Error(`checksum mismatch for migration ${row.version}`) },
      )
    }
  }

  const pending = migrations.filter((m) => m.version > current)
  if (pending.length === 0) return { fromVersion: current, toVersion: current, applied: [], snapshot: null }

  const snapshot = current > 0 ? await takeSnapshot(db, snapshotStore, current, `before migrating v${current} -> v${latest}`) : null

  const done: number[] = []
  await db.setForeignKeys(false) // برای بازسازی احتمالی جدول‌ها در Migrationهای بعدی
  try {
    for (const migration of pending) {
      try {
        await db.transaction(async (tx) => {
          for (const statement of migration.statements) await tx.run(statement)
          const violations = await tx.all('PRAGMA foreign_key_check')
          if (violations.length > 0) throw new Error(`foreign_key_check failed after migration ${migration.version}`)
          await tx.run('INSERT INTO schema_migrations (version, name, checksum, applied_at) VALUES (?, ?, ?, ?)', [
            migration.version,
            migration.name,
            checksumOf(migration),
            nowIso(),
          ])
        })
        done.push(migration.version)
      } catch (error) {
        logger.error(`Migration ${migration.version} (${migration.name}) ناموفق بود`, error)
        throw new AppError(
          'migration',
          'به‌روزرسانی پایگاه داده انجام نشد و تغییری روی اطلاعات شما اعمال نشد. برنامه را دوباره باز کنید؛ اگر مشکل ادامه داشت، با پشتیبانی تماس بگیرید.',
          { cause: error },
        )
      }
    }
  } finally {
    await db.setForeignKeys(true)
  }

  return { fromVersion: current, toVersion: latest, applied: done, snapshot }
}
