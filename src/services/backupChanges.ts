import type { SqlExecutor } from '../database/types'

export const LAST_BACKUP_SETTING = 'last_backup_at'
export const BACKUP_INTRO_KEY = 'backup_intro_seen'

/** جدول‌هایی که تغییرشان «داده فروشگاه» حساب نمی‌شود */
const IGNORED = new Set(['settings', 'schema_migrations'])

/** آخرین زمان ایجاد/ویرایش در جدول‌های داده (بر اساس ستون‌های created_at / updated_at) */
export async function latestDataChangeAt(db: SqlExecutor): Promise<string | null> {
  const tables = await db.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
  let latest: string | null = null
  for (const { name } of tables) {
    if (IGNORED.has(name)) continue
    const cols = (await db.all<{ name: string }>(`PRAGMA table_info("${name}")`)).map((c) => c.name)
    const parts = ['created_at', 'updated_at'].filter((c) => cols.includes(c)).map((c) => `MAX(${c})`)
    if (parts.length === 0) continue
    const expr = parts.length === 1 ? parts[0] : `MAX(COALESCE(${parts[0]}, ''), COALESCE(${parts[1]}, ''))`
    const row = await db.get<{ m: string | null }>(`SELECT ${expr} AS m FROM "${name}"`)
    const m = row?.m || null
    if (m && (!latest || m > latest)) latest = m
  }
  return latest
}

/** آیا از آخرین پشتیبان (یا هرگز) داده‌ای تغییر کرده است؟ */
export async function hasChangesSinceBackup(db: SqlExecutor): Promise<boolean> {
  const last = (await db.get<{ value: string | null }>('SELECT value FROM settings WHERE key = ?', [LAST_BACKUP_SETTING]))?.value ?? null
  const changed = await latestDataChangeAt(db)
  if (!changed) return false
  if (last) return changed > last
  // هرگز پشتیبان گرفته نشده: داده‌های اولیه (Seed) تغییر حساب نمی‌شوند؛ مبنا = زمان نصب + چند ثانیه
  const seed = (await db.get<{ m: string | null }>('SELECT MIN(applied_at) AS m FROM schema_migrations'))?.m
  if (!seed) return true
  return changed > new Date(Date.parse(seed) + 10_000).toISOString()
}
