import type { Migration } from './types'

/**
 * Migration 008 — کلید درخواست (request_id) برای ثبت یک‌باره اسناد.
 * طراحی: docs/stage3-notifications-safety.md. هر فرم یک کلید تصادفی می‌سازد؛ تکرار همان کلید
 * (دوبار زدن دکمه، تکرار درخواست) سند موجود را برمی‌گرداند و ایندکس UNIQUE جلوی ثبت دوم را می‌گیرد.
 */
const TABLES = ['sales_invoices', 'purchase_invoices', 'sale_returns', 'purchase_returns', 'warehouse_transfers'] as const

export const migration008: Migration = {
  version: 8,
  name: 'request_keys',
  statements: TABLES.flatMap((t) => [
    `ALTER TABLE ${t} ADD COLUMN request_id TEXT`,
    `CREATE UNIQUE INDEX ux_${t}_request_id ON ${t} (request_id) WHERE request_id IS NOT NULL`,
    `CREATE TRIGGER trg_${t}_request_id_locked BEFORE UPDATE OF request_id ON ${t}
WHEN OLD.request_id IS NOT NULL AND NEW.request_id IS NOT OLD.request_id
BEGIN SELECT RAISE(ABORT, 'document_immutable'); END`,
  ]),
}
