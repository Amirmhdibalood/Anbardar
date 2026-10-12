import { Capacitor } from '@capacitor/core'
import { logger } from '../utils/logger'
import { MIGRATIONS } from './migrations'
import { runMigrations, type MigrationReport } from './migrations/runner'
import { seedIfNeeded } from './seed'
import type { SnapshotStore } from './snapshot'
import type { Database } from './types'

export interface OpenedDatabase {
  db: Database
  snapshots: SnapshotStore
  migration: MigrationReport
  seeded: boolean
}

/**
 * باز کردن دیتابیس مناسب پلتفرم، اجرای Migrationها (با Snapshot ایمنی) و Seed.
 * - اندروید (Capacitor): SQLite بومی با @capacitor-community/sqlite
 * - وب/توسعه: sql.js (WebAssembly) با ذخیره در IndexedDB
 * همه خطاها به AppError فارسی تبدیل شده‌اند.
 */
export async function openAppDatabase(): Promise<OpenedDatabase> {
  let db: Database
  let snapshots: SnapshotStore

  if (Capacitor.isNativePlatform()) {
    const [{ CapacitorDatabase }, { fileSnapshotStore }] = await Promise.all([
      import('./drivers/capacitorDatabase'),
      import('./drivers/fileSnapshotStore'),
    ])
    db = await CapacitorDatabase.open('anbardar')
    snapshots = fileSnapshotStore
  } else {
    const [{ SqlJsDatabase }, { loadSqlJs }, { indexedDbPersist, indexedDbSnapshotStore }] = await Promise.all([
      import('./drivers/sqlJsDatabase'),
      import('./drivers/webSqlJs'),
      import('./drivers/indexedDbStorage'),
    ])
    const SQL = await loadSqlJs()
    const web = await SqlJsDatabase.open(SQL, indexedDbPersist)
    window.addEventListener('pagehide', () => void web.flush())
    db = web
    snapshots = indexedDbSnapshotStore
  }

  if (!(await db.isForeignKeysEnabled())) {
    await db.setForeignKeys(true)
    if (!(await db.isForeignKeysEnabled())) {
      logger.error('کلیدهای خارجی روشن نشد', null)
      throw new Error('foreign keys unavailable')
    }
  }

  const migration = await runMigrations(db, MIGRATIONS, snapshots)
  const seeded = await seedIfNeeded(db)
  return { db, snapshots, migration, seeded }
}
