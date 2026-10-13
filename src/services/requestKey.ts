import type { SqlExecutor } from '../database/types'
import { ValidationError } from '../utils/errors'

export type RequestTable = 'sales_invoices' | 'purchase_invoices' | 'sale_returns' | 'purchase_returns' | 'warehouse_transfers'

function clean(requestId: string | null | undefined): string | null {
  if (requestId == null || requestId === '') return null
  if (typeof requestId !== 'string' || requestId.length > 100) throw new ValidationError({ requestId: 'کلید درخواست معتبر نیست.' })
  return requestId
}

/** اگر سندی با همین کلید قبلاً ثبت شده، شناسه‌اش را برمی‌گرداند */
export async function findByRequestId(tx: SqlExecutor, table: RequestTable, requestId: string | null | undefined): Promise<string | null> {
  const key = clean(requestId)
  if (!key) return null
  const row = await tx.get<{ id: string }>(`SELECT id FROM ${table} WHERE request_id = ?`, [key])
  return row?.id ?? null
}

/** کلید را روی سند تازه ثبت می‌کند (ایندکس UNIQUE نگهبان نهایی است) */
export async function claimRequestId(tx: SqlExecutor, table: RequestTable, id: string, requestId: string | null | undefined): Promise<void> {
  const key = clean(requestId)
  if (!key) return
  await tx.run(`UPDATE ${table} SET request_id = ? WHERE id = ?`, [key, id])
}

/** کلید تصادفی برای هر بار باز شدن فرم */
export function newRequestId(): string {
  const c = globalThis.crypto
  if (c?.randomUUID) return c.randomUUID()
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`
}
