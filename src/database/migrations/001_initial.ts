import type { Migration } from './types'

/**
 * Schema اولیه «انباردار».
 *
 * قواعد عمومی:
 * - شناسه‌ها UUID متنی؛ مبلغ‌ها و تعدادها INTEGER؛ تاریخ‌ها ISO 8601 (UTC) متنی.
 * - همه جدول‌های کسب‌وکار: created_at, updated_at, is_active, created_by (خالی برای تک‌کاربره).
 * - کلید خارجی‌ها عمداً بدون ON DELETE / ON UPDATE هستند (رفتار پیش‌فرض = جلوگیری از حذف)؛
 *   حذف فقط برای ردیف‌های استفاده‌نشده ممکن است و بقیه باید غیرفعال شوند.
 * - اصلاح سند ثبت‌شده با Trigger ممنوع است؛ فقط ابطال (status = 'cancelled').
 */

const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')"

/** ستون‌های مشترک همه جدول‌های کسب‌وکار */
const STD = `
  created_at TEXT NOT NULL DEFAULT (${NOW}),
  updated_at TEXT NOT NULL DEFAULT (${NOW}),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_by TEXT`

const INVOICE_COMMON = `
  invoice_number INTEGER NOT NULL,
  reference TEXT,
  invoice_date TEXT NOT NULL,
  warehouse_id TEXT NOT NULL REFERENCES warehouses (id),
  total_amount INTEGER NOT NULL CHECK (total_amount >= 0),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cancelled')),
  cancelled_at TEXT,
  cancel_reason TEXT,
  note TEXT`

const INVOICE_CHECK = `CHECK ((status = 'cancelled') = (cancelled_at IS NOT NULL))`

function itemsTable(table: string, invoiceTable: string): string {
  return `CREATE TABLE ${table} (
  id TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL REFERENCES ${invoiceTable} (id),
  product_id TEXT NOT NULL REFERENCES products (id),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_price INTEGER NOT NULL CHECK (unit_price >= 0),
  discount INTEGER NOT NULL DEFAULT 0 CHECK (discount >= 0),
  line_total INTEGER NOT NULL,
  note TEXT,${STD},
  CHECK (discount <= quantity * unit_price),
  CHECK (line_total = quantity * unit_price - discount)
)`
}

function invoiceTriggers(invoice: string, items: string, party: string): string[] {
  return [
    // سند ابطال‌شده یا تغییر فیلدهای مالی سند فعال ممنوع است (فقط ابطال و ویرایش یادداشت)
    `CREATE TRIGGER trg_${invoice}_immutable BEFORE UPDATE ON ${invoice}
WHEN OLD.status = 'cancelled'
  OR NEW.invoice_number IS NOT OLD.invoice_number
  OR NEW.invoice_date IS NOT OLD.invoice_date
  OR NEW.${party} IS NOT OLD.${party}
  OR NEW.warehouse_id IS NOT OLD.warehouse_id
  OR NEW.total_amount IS NOT OLD.total_amount
BEGIN SELECT RAISE(ABORT, 'document_immutable'); END`,
    `CREATE TRIGGER trg_${invoice}_no_delete BEFORE DELETE ON ${invoice}
BEGIN SELECT RAISE(ABORT, 'document_immutable'); END`,
    `CREATE TRIGGER trg_${items}_no_update BEFORE UPDATE ON ${items}
BEGIN SELECT RAISE(ABORT, 'document_immutable'); END`,
    `CREATE TRIGGER trg_${items}_no_delete BEFORE DELETE ON ${items}
BEGIN SELECT RAISE(ABORT, 'document_immutable'); END`,
    `CREATE TRIGGER trg_${items}_only_active BEFORE INSERT ON ${items}
WHEN (SELECT status FROM ${invoice} WHERE id = NEW.invoice_id) = 'cancelled'
BEGIN SELECT RAISE(ABORT, 'document_immutable'); END`,
  ]
}

export const migration001: Migration = {
  version: 1,
  name: 'initial schema',
  statements: [
    // ---- سیستمی
    `CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (${NOW})
)`,
    `CREATE TABLE sequences (
  name TEXT PRIMARY KEY,
  last_value INTEGER NOT NULL DEFAULT 0 CHECK (last_value >= 0)
)`,

    // ---- اطلاعات پایه
    `CREATE TABLE product_groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  description TEXT,${STD}
)`,
    `CREATE UNIQUE INDEX ux_product_groups_name ON product_groups (name)`,

    `CREATE TABLE warehouses (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  description TEXT,${STD}
)`,
    `CREATE UNIQUE INDEX ux_warehouses_name ON warehouses (name)`,

    `CREATE TABLE customers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  phone TEXT,
  address TEXT,
  description TEXT,
  is_system INTEGER NOT NULL DEFAULT 0 CHECK (is_system IN (0, 1)),${STD}
)`,
    `CREATE INDEX ix_customers_name ON customers (name)`,

    `CREATE TABLE suppliers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  phone TEXT,
  address TEXT,
  description TEXT,${STD}
)`,
    `CREATE INDEX ix_suppliers_name ON suppliers (name)`,

    `CREATE TABLE products (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL CHECK (length(trim(code)) > 0),
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  group_id TEXT NOT NULL REFERENCES product_groups (id),
  unit TEXT NOT NULL DEFAULT 'عدد' CHECK (length(trim(unit)) > 0),
  sub_unit TEXT,
  conversion_ratio INTEGER CHECK (conversion_ratio IS NULL OR conversion_ratio > 0),
  reorder_point INTEGER NOT NULL DEFAULT 0 CHECK (reorder_point >= 0),
  purchase_price INTEGER NOT NULL DEFAULT 0 CHECK (purchase_price >= 0),
  sale_price INTEGER NOT NULL DEFAULT 0 CHECK (sale_price >= 0),
  description TEXT,${STD},
  CHECK ((sub_unit IS NULL) = (conversion_ratio IS NULL))
)`,
    `CREATE UNIQUE INDEX ux_products_code ON products (code)`,
    `CREATE INDEX ix_products_name ON products (name)`,
    `CREATE INDEX ix_products_group ON products (group_id)`,

    // ---- موجودی: دفتر حرکت (منبع حقیقت) + کش سریع
    `CREATE TABLE stock_movements (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products (id),
  warehouse_id TEXT NOT NULL REFERENCES warehouses (id),
  quantity_delta INTEGER NOT NULL CHECK (quantity_delta <> 0),
  movement_type TEXT NOT NULL CHECK (movement_type IN (
    'purchase', 'sale', 'purchase_cancel', 'sale_cancel',
    'purchase_return', 'sale_return', 'transfer_in', 'transfer_out',
    'adjustment', 'opening')),
  document_type TEXT CHECK (document_type IS NULL OR document_type IN (
    'purchase_invoice', 'sales_invoice', 'transfer', 'adjustment')),
  document_id TEXT,
  occurred_at TEXT NOT NULL,
  note TEXT,${STD},
  CHECK ((document_type IS NULL) = (document_id IS NULL))
)`,
    `CREATE INDEX ix_movements_product_wh ON stock_movements (product_id, warehouse_id)`,
    `CREATE INDEX ix_movements_document ON stock_movements (document_type, document_id)`,
    `CREATE INDEX ix_movements_date ON stock_movements (occurred_at)`,

    `CREATE TABLE warehouse_stock (
  id TEXT PRIMARY KEY,
  warehouse_id TEXT NOT NULL REFERENCES warehouses (id),
  product_id TEXT NOT NULL REFERENCES products (id),
  quantity INTEGER NOT NULL DEFAULT 0,${STD}
)`,
    `CREATE UNIQUE INDEX ux_stock_wh_product ON warehouse_stock (warehouse_id, product_id)`,
    `CREATE INDEX ix_stock_product ON warehouse_stock (product_id)`,

    // ---- خرید
    `CREATE TABLE purchase_invoices (
  id TEXT PRIMARY KEY,${INVOICE_COMMON},
  supplier_id TEXT NOT NULL REFERENCES suppliers (id),${STD},
  ${INVOICE_CHECK}
)`,
    `CREATE UNIQUE INDEX ux_purchase_number ON purchase_invoices (invoice_number)`,
    `CREATE INDEX ix_purchase_date ON purchase_invoices (invoice_date)`,
    `CREATE INDEX ix_purchase_supplier ON purchase_invoices (supplier_id)`,
    `CREATE INDEX ix_purchase_warehouse ON purchase_invoices (warehouse_id)`,
    itemsTable('purchase_items', 'purchase_invoices'),
    `CREATE INDEX ix_purchase_items_invoice ON purchase_items (invoice_id)`,
    `CREATE INDEX ix_purchase_items_product ON purchase_items (product_id)`,

    // ---- فروش
    `CREATE TABLE sales_invoices (
  id TEXT PRIMARY KEY,${INVOICE_COMMON},
  customer_id TEXT NOT NULL REFERENCES customers (id),${STD},
  ${INVOICE_CHECK}
)`,
    `CREATE UNIQUE INDEX ux_sales_number ON sales_invoices (invoice_number)`,
    `CREATE INDEX ix_sales_date ON sales_invoices (invoice_date)`,
    `CREATE INDEX ix_sales_customer ON sales_invoices (customer_id)`,
    `CREATE INDEX ix_sales_warehouse ON sales_invoices (warehouse_id)`,
    itemsTable('sales_items', 'sales_invoices'),
    `CREATE INDEX ix_sales_items_invoice ON sales_items (invoice_id)`,
    `CREATE INDEX ix_sales_items_product ON sales_items (product_id)`,

    // ---- پرداخت/دریافت: دقیقاً به یکی از دو نوع فاکتور وصل است (کلید خارجی واقعی)
    `CREATE TABLE payments (
  id TEXT PRIMARY KEY,
  sales_invoice_id TEXT REFERENCES sales_invoices (id),
  purchase_invoice_id TEXT REFERENCES purchase_invoices (id),
  amount INTEGER NOT NULL CHECK (amount > 0),
  paid_at TEXT NOT NULL,
  note TEXT,${STD},
  CHECK ((sales_invoice_id IS NULL) <> (purchase_invoice_id IS NULL))
)`,
    `CREATE INDEX ix_payments_sales ON payments (sales_invoice_id)`,
    `CREATE INDEX ix_payments_purchase ON payments (purchase_invoice_id)`,

    // ---- Triggerهای حفاظتی
    `CREATE TRIGGER trg_stock_no_negative_insert BEFORE INSERT ON warehouse_stock
WHEN NEW.quantity < 0
  AND COALESCE((SELECT value FROM settings WHERE key = 'allow_negative_stock'), '0') <> '1'
BEGIN SELECT RAISE(ABORT, 'negative_stock'); END`,
    `CREATE TRIGGER trg_stock_no_negative_update BEFORE UPDATE OF quantity ON warehouse_stock
WHEN NEW.quantity < 0
  AND COALESCE((SELECT value FROM settings WHERE key = 'allow_negative_stock'), '0') <> '1'
BEGIN SELECT RAISE(ABORT, 'negative_stock'); END`,
    `CREATE TRIGGER trg_movements_no_update BEFORE UPDATE ON stock_movements
BEGIN SELECT RAISE(ABORT, 'ledger_immutable'); END`,
    `CREATE TRIGGER trg_movements_no_delete BEFORE DELETE ON stock_movements
BEGIN SELECT RAISE(ABORT, 'ledger_immutable'); END`,
    ...invoiceTriggers('sales_invoices', 'sales_items', 'customer_id'),
    ...invoiceTriggers('purchase_invoices', 'purchase_items', 'supplier_id'),
    `CREATE TRIGGER trg_customers_system_update BEFORE UPDATE ON customers
WHEN OLD.is_system = 1 AND (NEW.is_active = 0 OR NEW.is_system = 0)
BEGIN SELECT RAISE(ABORT, 'system_row_protected'); END`,
    `CREATE TRIGGER trg_customers_system_delete BEFORE DELETE ON customers
WHEN OLD.is_system = 1
BEGIN SELECT RAISE(ABORT, 'system_row_protected'); END`,

    // ---- مقادیر اولیه (شناسه‌های پیش‌فرض را Seed می‌سازد)
    `INSERT INTO settings (key, value) VALUES ('allow_negative_stock', '0')`,
    `INSERT INTO sequences (name, last_value) VALUES ('sales_invoice', 0), ('purchase_invoice', 0), ('product_code', 1000)`,
  ],
}
