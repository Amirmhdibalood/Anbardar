import type { BaseEntity } from '../../models/common'
import type { SqlRow, SqlValue } from '../../database/types'
import { AppError } from '../../utils/errors'

export function str(row: SqlRow, key: string): string {
  return String(row[key])
}
export function strOrNull(row: SqlRow, key: string): string | null {
  const v = row[key]
  return v === null || v === undefined ? null : String(v)
}
export function num(row: SqlRow, key: string): number {
  return Number(row[key])
}
export function numOrNull(row: SqlRow, key: string): number | null {
  const v = row[key]
  return v === null || v === undefined ? null : Number(v)
}

/** ستون‌های مشترک همه موجودیت‌ها */
export function baseFromRow(row: SqlRow): BaseEntity {
  return {
    id: str(row, 'id'),
    createdAt: str(row, 'created_at'),
    updatedAt: str(row, 'updated_at'),
    isActive: num(row, 'is_active') === 1,
    createdBy: strOrNull(row, 'created_by'),
  }
}

export function notFound(what: string): AppError {
  return new AppError('not_found', `${what} پیدا نشد. ممکن است قبلاً تغییر کرده باشد.`)
}

/** ساخت INSERT از نگاشت ستون → مقدار (نام ستون‌ها همیشه ثابت‌های کد هستند، نه ورودی کاربر) */
export function insertSql(table: string, columns: Record<string, SqlValue>): { sql: string; params: SqlValue[] } {
  const names = Object.keys(columns)
  return {
    sql: `INSERT INTO ${table} (${names.join(', ')}) VALUES (${names.map(() => '?').join(', ')})`,
    params: names.map((n) => columns[n] as SqlValue),
  }
}

export function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (c) => `\\${c}`)
}
