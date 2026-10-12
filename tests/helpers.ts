import { createRequire } from 'node:module'
import initSqlJs, { type SqlJsStatic } from 'sql.js'
import { SqlJsDatabase } from '../src/database/drivers/sqlJsDatabase'
import { MIGRATIONS } from '../src/database/migrations'
import { runMigrations } from '../src/database/migrations/runner'
import { seedIfNeeded } from '../src/database/seed'
import { MemorySnapshotStore } from '../src/database/snapshot'
import { createRepositories, type Repositories } from '../src/repositories'
import { createCatalogService } from '../src/services/catalogService'
import { createInventoryService } from '../src/services/inventoryService'
import { SETTING_KEYS } from '../src/database/seed'
import type { Database } from '../src/database/types'
import { AppError } from '../src/utils/errors'
import assert from 'node:assert/strict'

const require = createRequire(import.meta.url)
let sqlPromise: Promise<SqlJsStatic> | null = null

export function loadSql(): Promise<SqlJsStatic> {
  sqlPromise ??= initSqlJs({ locateFile: (f: string) => require.resolve(`sql.js/dist/${f}`) })
  return sqlPromise
}

export async function freshDb(): Promise<SqlJsDatabase> {
  return SqlJsDatabase.open(await loadSql())
}

export interface Fixture {
  db: SqlJsDatabase
  repos: Repositories
  snapshots: MemorySnapshotStore
  catalog: ReturnType<typeof createCatalogService>
  inventory: ReturnType<typeof createInventoryService>
  warehouseId: string
  customerId: string
  groupId: string
}

/** دیتابیس تازه + Migration + Seed */
export async function setup(): Promise<Fixture> {
  const db = await freshDb()
  const snapshots = new MemorySnapshotStore()
  await runMigrations(db, MIGRATIONS, snapshots)
  await seedIfNeeded(db)
  const repos = createRepositories(db)
  return {
    db,
    repos,
    snapshots,
    catalog: createCatalogService(db),
    inventory: createInventoryService(db),
    warehouseId: (await repos.settings.getValue(SETTING_KEYS.defaultWarehouseId)) as string,
    customerId: (await repos.settings.getValue(SETTING_KEYS.defaultCustomerId)) as string,
    groupId: (await repos.settings.getValue(SETTING_KEYS.defaultProductGroupId)) as string,
  }
}

export async function rowCount(db: Database, table: string): Promise<number> {
  return Number((await db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`))?.n)
}

/** انتظار می‌رود promise با AppError و کد مشخص رد شود و پیامش فارسی (بدون متن فنی) باشد */
export async function expectAppError(promise: Promise<unknown>, code: string, messagePart?: string): Promise<AppError> {
  try {
    await promise
  } catch (e) {
    assert.ok(e instanceof AppError, `expected AppError, got ${String(e)}`)
    assert.equal(e.code, code, `code (message: ${e.userMessage})`)
    assert.match(e.userMessage, /[\u0600-\u06FF]/, 'message must be Persian')
    assert.doesNotMatch(e.userMessage, /constraint|SQLITE|sqlite|UNIQUE|FOREIGN KEY/i, 'no technical text for the user')
    if (messagePart) assert.ok(e.userMessage.includes(messagePart), `message "${e.userMessage}" should include "${messagePart}"`)
    return e
  }
  assert.fail('expected promise to reject')
}

/** تعداد به هزارم واحد: Q(2) = ۲ واحد، Q(1.5) = ۱٫۵ واحد */
export const Q = (units: number): number => Math.round(units * 1000)

/** اثر بها برای حرکت‌های ورودی آزمایشی (لایه با بهای صفر) */
export const LOT0 = { kind: 'lot', totalCost: 0 } as const
/** لایه با بهای مشخص */
export const lot = (totalCost: number) => ({ kind: 'lot', totalCost }) as const
