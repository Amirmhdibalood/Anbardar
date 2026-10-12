import type { Migration } from './types'

/**
 * Migration 005 — برگشت فروش، برگشت خرید، انتقال بین انبارها.
 * سندها تغییرناپذیرند (فقط ابطال). حرکت‌های انبار با نوع sale_return / purchase_return / transfer_* ثبت می‌شوند.
 * document_type موجود (sales_invoice / purchase_invoice / transfer) برای ارجاع به این سندها استفاده می‌شود
 * تا نیازی به بازسازی stock_movements و FK لایه‌ها نباشد؛ نوع حرکت تمایز را نگه می‌دارد.
 */

const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')"
const STD = `
  created_at TEXT NOT NULL DEFAULT (${NOW}),
  updated_at TEXT NOT NULL DEFAULT (${NOW}),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_by TEXT`

const DOC_CHECK = `CHECK ((status = 'cancelled') = (cancelled_at IS NOT NULL))`

export const migration005: Migration = {
  version: 5,
  name: 'sale/purchase returns and warehouse transfers',
  statements: [
    `INSERT OR IGNORE INTO sequences (name, last_value) VALUES ('sale_return', 0)`,
    `INSERT OR IGNORE INTO sequences (name, last_value) VALUES ('purchase_return', 0)`,
    `INSERT OR IGNORE INTO sequences (name, last_value) VALUES ('transfer', 0)`,

    // ---- برگشت فروش (کالا از مشتری برمی‌گردد → ورود انبار + لایه با بهای فروش اصلی)
    `CREATE TABLE sale_returns (
  id TEXT PRIMARY KEY,
  return_number INTEGER NOT NULL,
  sales_invoice_id TEXT NOT NULL REFERENCES sales_invoices (id),
  warehouse_id TEXT NOT NULL REFERENCES warehouses (id),
  doc_date TEXT NOT NULL,
  total_amount INTEGER NOT NULL CHECK (total_amount >= 0),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cancelled')),
  cancelled_at TEXT,
  cancel_reason TEXT,
  note TEXT,${STD},
  ${DOC_CHECK}
)`,
    `CREATE UNIQUE INDEX ux_sale_returns_number ON sale_returns (return_number)`,
    `CREATE INDEX ix_sale_returns_invoice ON sale_returns (sales_invoice_id)`,

    `CREATE TABLE sale_return_items (
  id TEXT PRIMARY KEY,
  return_id TEXT NOT NULL REFERENCES sale_returns (id),
  sales_item_id TEXT NOT NULL REFERENCES sales_items (id),
  product_id TEXT NOT NULL REFERENCES products (id),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_price INTEGER NOT NULL CHECK (unit_price >= 0),
  line_total INTEGER NOT NULL CHECK (line_total >= 0),
  cost_fifo INTEGER NOT NULL CHECK (cost_fifo >= 0),
  cost_average INTEGER NOT NULL CHECK (cost_average >= 0),
  cost_last INTEGER NOT NULL CHECK (cost_last >= 0),
  line_no INTEGER NOT NULL DEFAULT 0,${STD}
)`,
    `CREATE INDEX ix_sale_return_items_return ON sale_return_items (return_id)`,
    `CREATE INDEX ix_sale_return_items_sales_item ON sale_return_items (sales_item_id)`,

    // ---- برگشت خرید (کالا به تأمین‌کننده برمی‌گردد → خروج FIFO، ترجیحاً از لایه همان خرید)
    `CREATE TABLE purchase_returns (
  id TEXT PRIMARY KEY,
  return_number INTEGER NOT NULL,
  purchase_invoice_id TEXT NOT NULL REFERENCES purchase_invoices (id),
  warehouse_id TEXT NOT NULL REFERENCES warehouses (id),
  doc_date TEXT NOT NULL,
  total_amount INTEGER NOT NULL CHECK (total_amount >= 0),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cancelled')),
  cancelled_at TEXT,
  cancel_reason TEXT,
  note TEXT,${STD},
  ${DOC_CHECK}
)`,
    `CREATE UNIQUE INDEX ux_purchase_returns_number ON purchase_returns (return_number)`,
    `CREATE INDEX ix_purchase_returns_invoice ON purchase_returns (purchase_invoice_id)`,

    `CREATE TABLE purchase_return_items (
  id TEXT PRIMARY KEY,
  return_id TEXT NOT NULL REFERENCES purchase_returns (id),
  purchase_item_id TEXT NOT NULL REFERENCES purchase_items (id),
  product_id TEXT NOT NULL REFERENCES products (id),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_price INTEGER NOT NULL CHECK (unit_price >= 0),
  line_total INTEGER NOT NULL CHECK (line_total >= 0),
  cost_fifo INTEGER NOT NULL CHECK (cost_fifo >= 0),
  cost_average INTEGER NOT NULL CHECK (cost_average >= 0),
  cost_last INTEGER NOT NULL CHECK (cost_last >= 0),
  line_no INTEGER NOT NULL DEFAULT 0,${STD}
)`,
    `CREATE INDEX ix_purchase_return_items_return ON purchase_return_items (return_id)`,
    `CREATE INDEX ix_purchase_return_items_pi ON purchase_return_items (purchase_item_id)`,

    // ---- انتقال بین انبارها (خروج FIFO از مبدأ + ورود لایه با همان بها در مقصد)
    `CREATE TABLE warehouse_transfers (
  id TEXT PRIMARY KEY,
  transfer_number INTEGER NOT NULL,
  from_warehouse_id TEXT NOT NULL REFERENCES warehouses (id),
  to_warehouse_id TEXT NOT NULL REFERENCES warehouses (id),
  doc_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cancelled')),
  cancelled_at TEXT,
  cancel_reason TEXT,
  note TEXT,${STD},
  ${DOC_CHECK},
  CHECK (from_warehouse_id <> to_warehouse_id)
)`,
    `CREATE UNIQUE INDEX ux_transfers_number ON warehouse_transfers (transfer_number)`,

    `CREATE TABLE warehouse_transfer_items (
  id TEXT PRIMARY KEY,
  transfer_id TEXT NOT NULL REFERENCES warehouse_transfers (id),
  product_id TEXT NOT NULL REFERENCES products (id),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  cost_fifo INTEGER NOT NULL CHECK (cost_fifo >= 0),
  cost_average INTEGER NOT NULL CHECK (cost_average >= 0),
  cost_last INTEGER NOT NULL CHECK (cost_last >= 0),
  line_no INTEGER NOT NULL DEFAULT 0,${STD}
)`,
    `CREATE INDEX ix_transfer_items_transfer ON warehouse_transfer_items (transfer_id)`,

    // Triggerهای تغییرناپذیری
    `CREATE TRIGGER trg_sale_returns_immutable BEFORE UPDATE ON sale_returns
WHEN OLD.status = 'cancelled'
  OR NEW.return_number IS NOT OLD.return_number
  OR NEW.doc_date IS NOT OLD.doc_date
  OR NEW.sales_invoice_id IS NOT OLD.sales_invoice_id
  OR NEW.warehouse_id IS NOT OLD.warehouse_id
  OR NEW.total_amount IS NOT OLD.total_amount
BEGIN SELECT RAISE(ABORT, 'document_immutable'); END`,
    `CREATE TRIGGER trg_sale_returns_no_delete BEFORE DELETE ON sale_returns
BEGIN SELECT RAISE(ABORT, 'document_immutable'); END`,
    `CREATE TRIGGER trg_sale_return_items_no_update BEFORE UPDATE ON sale_return_items
BEGIN SELECT RAISE(ABORT, 'document_immutable'); END`,
    `CREATE TRIGGER trg_sale_return_items_no_delete BEFORE DELETE ON sale_return_items
BEGIN SELECT RAISE(ABORT, 'document_immutable'); END`,

    `CREATE TRIGGER trg_purchase_returns_immutable BEFORE UPDATE ON purchase_returns
WHEN OLD.status = 'cancelled'
  OR NEW.return_number IS NOT OLD.return_number
  OR NEW.doc_date IS NOT OLD.doc_date
  OR NEW.purchase_invoice_id IS NOT OLD.purchase_invoice_id
  OR NEW.warehouse_id IS NOT OLD.warehouse_id
  OR NEW.total_amount IS NOT OLD.total_amount
BEGIN SELECT RAISE(ABORT, 'document_immutable'); END`,
    `CREATE TRIGGER trg_purchase_returns_no_delete BEFORE DELETE ON purchase_returns
BEGIN SELECT RAISE(ABORT, 'document_immutable'); END`,
    `CREATE TRIGGER trg_purchase_return_items_no_update BEFORE UPDATE ON purchase_return_items
BEGIN SELECT RAISE(ABORT, 'document_immutable'); END`,
    `CREATE TRIGGER trg_purchase_return_items_no_delete BEFORE DELETE ON purchase_return_items
BEGIN SELECT RAISE(ABORT, 'document_immutable'); END`,

    `CREATE TRIGGER trg_warehouse_transfers_immutable BEFORE UPDATE ON warehouse_transfers
WHEN OLD.status = 'cancelled'
  OR NEW.transfer_number IS NOT OLD.transfer_number
  OR NEW.doc_date IS NOT OLD.doc_date
  OR NEW.from_warehouse_id IS NOT OLD.from_warehouse_id
  OR NEW.to_warehouse_id IS NOT OLD.to_warehouse_id
BEGIN SELECT RAISE(ABORT, 'document_immutable'); END`,
    `CREATE TRIGGER trg_warehouse_transfers_no_delete BEFORE DELETE ON warehouse_transfers
BEGIN SELECT RAISE(ABORT, 'document_immutable'); END`,
    `CREATE TRIGGER trg_warehouse_transfer_items_no_update BEFORE UPDATE ON warehouse_transfer_items
BEGIN SELECT RAISE(ABORT, 'document_immutable'); END`,
    `CREATE TRIGGER trg_warehouse_transfer_items_no_delete BEFORE DELETE ON warehouse_transfer_items
BEGIN SELECT RAISE(ABORT, 'document_immutable'); END`,
  ],
}
