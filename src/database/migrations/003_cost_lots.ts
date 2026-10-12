import type { Migration } from './types'

/**
 * Migration 003 — لایه‌های بهای تمام‌شده (Cost lots)، حذف «قیمت خرید» از کالا، تأمین‌کننده سیستمی و تنظیمات قیمت/سود.
 *
 * قاعده ثابت (Invariant) برای هر کالا در هر انبار:
 *   Σ cost_lots.remaining = warehouse_stock.quantity = Σ stock_movements.quantity_delta
 * - هر حرکت ورودی که «کالای تازه» وارد می‌کند (purchase، opening، adjustment، transfer_in) دقیقاً یک لایه می‌سازد
 *   (cost_lots.movement_id یکتا).
 * - هر حرکت خروجی (sale، shortage، waste، purchase_cancel، purchase_return، transfer_out) از لایه‌ها برداشت می‌کند و
 *   هر برداشت یک ردیف lot_allocations است (تعداد + بهای همان برداشت).
 * - ابطال فروش (sale_cancel) لایه نمی‌سازد؛ برداشت‌های همان فروش را «برگشت‌خورده» علامت می‌زند و به همان لایه‌ها برمی‌گرداند.
 * - average_costs کش میانگین متحرک (دائمی) در سطح کالاست و از داده خام قابل بازسازی است.
 * - روی هر حرکت خروجی (و ردیف فروش) بهای هر سه روش (FIFO، میانگین، آخرین خرید) در همان لحظه ذخیره می‌شود؛
 *   سهم تخفیف کل فاکتور هم روی هر ردیف (خرید و فروش) ذخیره می‌شود.
 *
 * داده‌های قبلی: موجودی فعلی هر کالا/انبار (از روی دفتر حرکت) یک لایه می‌گیرد با بهای واحد = «قیمت خرید» قدیمی کالا،
 * سپس ستون products.purchase_price حذف می‌شود. حرکت‌های قدیمی با علامت ناسازگار با نوعشان برچسب درست می‌گیرند
 * (کاهش‌های قدیمی «اصلاح/موجودی اولیه» → «کسری»).
 * فروش بیش از موجودی دیگر هیچ‌وقت مجاز نیست (تنظیم allow_negative_stock حذف شد).
 */

const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')"

const STD = `
  created_at TEXT NOT NULL DEFAULT (${NOW}),
  updated_at TEXT NOT NULL DEFAULT (${NOW}),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_by TEXT`

const STD_COLS = 'created_at, updated_at, is_active, created_by'

const SQL_UUID = `lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))`

/** شناسه ثابت تأمین‌کننده سیستمی «متفرقه» (باید با src/models/party.ts یکی باشد) */
const MISC_SUPPLIER_ID = 'e4238491-7f1a-4f2e-95bd-1df38fa5a6e6'

const INBOUND = "'purchase', 'sale_cancel', 'sale_return', 'transfer_in', 'adjustment', 'opening'"
const OUTBOUND = "'sale', 'purchase_cancel', 'purchase_return', 'transfer_out', 'shortage', 'waste'"

const ALL_V2_TRIGGERS = [
  'trg_customers_system_delete',
  'trg_customers_system_update',
  'trg_movements_no_delete',
  'trg_movements_no_update',
  'trg_movements_whole_units',
  'trg_products_unit_locked',
  'trg_purchase_invoices_immutable',
  'trg_purchase_invoices_no_delete',
  'trg_purchase_items_no_delete',
  'trg_purchase_items_no_update',
  'trg_purchase_items_only_active',
  'trg_purchase_items_whole_units',
  'trg_sales_invoices_immutable',
  'trg_sales_invoices_no_delete',
  'trg_sales_items_no_delete',
  'trg_sales_items_no_update',
  'trg_sales_items_only_active',
  'trg_sales_items_whole_units',
  'trg_stock_no_negative_insert',
  'trg_stock_no_negative_update',
  'trg_units_fraction_locked',
  'trg_units_system_delete',
  'trg_units_system_update',
]

function invoiceTriggers(invoice: string, items: string, party: string): string[] {
  return [
    `CREATE TRIGGER trg_${invoice}_immutable BEFORE UPDATE ON ${invoice}
WHEN OLD.status = 'cancelled'
  OR NEW.invoice_number IS NOT OLD.invoice_number
  OR NEW.invoice_date IS NOT OLD.invoice_date
  OR NEW.${party} IS NOT OLD.${party}
  OR NEW.warehouse_id IS NOT OLD.warehouse_id
  OR NEW.subtotal_amount IS NOT OLD.subtotal_amount
  OR NEW.discount IS NOT OLD.discount
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
    `CREATE TRIGGER trg_${items}_whole_units BEFORE INSERT ON ${items}
WHEN NEW.quantity % 1000 <> 0
  AND EXISTS (SELECT 1 FROM products p JOIN units u ON u.id = p.unit_id WHERE p.id = NEW.product_id AND u.allows_fraction = 0)
BEGIN SELECT RAISE(ABORT, 'fraction_not_allowed'); END`,
    `CREATE TRIGGER trg_${items}_share_limit BEFORE INSERT ON ${items}
WHEN NEW.invoice_discount_share > NEW.line_total
BEGIN SELECT RAISE(ABORT, 'amount_mismatch'); END`,
  ]
}

export const migration003: Migration = {
  version: 3,
  name: 'cost lots, lot allocations, misc supplier, pricing settings',
  statements: [
    // ---- ۰) همه Triggerها (به جدول‌هایی که بازسازی می‌شوند ارجاع دارند)
    ...ALL_V2_TRIGGERS.map((name) => `DROP TRIGGER IF EXISTS ${name}`),

    // ---- ۱) دفتر حرکت: نوع‌های «کسری» و «ضایعات»، علامت اجباری هر نوع، ارجاع به ردیف سند
    `CREATE TABLE stock_movements_new (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products (id),
  warehouse_id TEXT NOT NULL REFERENCES warehouses (id),
  quantity_delta INTEGER NOT NULL CHECK (quantity_delta <> 0),
  movement_type TEXT NOT NULL CHECK (movement_type IN (${INBOUND}, ${OUTBOUND})),
  document_type TEXT CHECK (document_type IS NULL OR document_type IN (
    'purchase_invoice', 'sales_invoice', 'transfer', 'adjustment')),
  document_id TEXT,
  document_line_id TEXT,
  occurred_at TEXT NOT NULL,
  note TEXT,
  cost_fifo INTEGER CHECK (cost_fifo IS NULL OR cost_fifo >= 0),
  cost_average INTEGER CHECK (cost_average IS NULL OR cost_average >= 0),
  cost_last INTEGER CHECK (cost_last IS NULL OR cost_last >= 0),${STD},
  CHECK ((document_type IS NULL) = (document_id IS NULL)),
  CHECK (document_line_id IS NULL OR document_id IS NOT NULL),
  CHECK ((cost_fifo IS NULL) = (cost_average IS NULL) AND (cost_fifo IS NULL) = (cost_last IS NULL)),
  CHECK ((movement_type IN (${INBOUND}) AND quantity_delta > 0) OR (movement_type IN (${OUTBOUND}) AND quantity_delta < 0))
)`,
    `INSERT INTO stock_movements_new (id, product_id, warehouse_id, quantity_delta, movement_type, document_type, document_id, document_line_id, occurred_at, note, ${STD_COLS})
SELECT id, product_id, warehouse_id, quantity_delta,
  CASE
    WHEN quantity_delta < 0 AND movement_type IN (${INBOUND}) THEN 'shortage'
    WHEN quantity_delta > 0 AND movement_type IN (${OUTBOUND}) THEN 'adjustment'
    ELSE movement_type
  END,
  document_type, document_id, NULL, occurred_at, note, ${STD_COLS} FROM stock_movements`,
    `DROP TABLE stock_movements`,
    `ALTER TABLE stock_movements_new RENAME TO stock_movements`,
    `CREATE INDEX ix_movements_product_wh ON stock_movements (product_id, warehouse_id)`,
    `CREATE INDEX ix_movements_document ON stock_movements (document_type, document_id)`,
    `CREATE INDEX ix_movements_line ON stock_movements (document_line_id)`,
    `CREATE INDEX ix_movements_date ON stock_movements (occurred_at)`,

    // کش موجودی دقیقاً برابر دفتر حرکت می‌شود (منبع حقیقت)
    `UPDATE warehouse_stock SET quantity = COALESCE((SELECT SUM(m.quantity_delta) FROM stock_movements m
  WHERE m.warehouse_id = warehouse_stock.warehouse_id AND m.product_id = warehouse_stock.product_id), 0)`,

    // ---- ۲) لایه‌های بها و برداشت‌ها
    `CREATE TABLE cost_lots (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products (id),
  warehouse_id TEXT NOT NULL REFERENCES warehouses (id),
  movement_id TEXT NOT NULL REFERENCES stock_movements (id),
  lot_date TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  remaining INTEGER NOT NULL CHECK (remaining >= 0 AND remaining <= quantity),
  total_cost INTEGER NOT NULL CHECK (total_cost >= 0),${STD}
)`,
    `CREATE UNIQUE INDEX ux_lots_movement ON cost_lots (movement_id)`,
    `CREATE INDEX ix_lots_fifo ON cost_lots (product_id, warehouse_id, lot_date, created_at)`,

    `CREATE TABLE lot_allocations (
  id TEXT PRIMARY KEY,
  lot_id TEXT NOT NULL REFERENCES cost_lots (id),
  movement_id TEXT NOT NULL REFERENCES stock_movements (id),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  cost_amount INTEGER NOT NULL CHECK (cost_amount >= 0),
  reversal_movement_id TEXT REFERENCES stock_movements (id),${STD}
)`,
    `CREATE INDEX ix_alloc_lot ON lot_allocations (lot_id)`,
    `CREATE INDEX ix_alloc_movement ON lot_allocations (movement_id)`,

    `CREATE TABLE average_costs (
  product_id TEXT PRIMARY KEY REFERENCES products (id),
  quantity INTEGER NOT NULL CHECK (quantity >= 0),
  value INTEGER NOT NULL CHECK (value >= 0),
  updated_at TEXT NOT NULL DEFAULT (${NOW})
)`,

    // لایه آغازین برای موجودی فعلی (بهای واحد = قیمت خرید قدیمی کالا؛ محاسبه بدون سرریز Int64)
    `INSERT INTO cost_lots (id, product_id, warehouse_id, movement_id, lot_date, quantity, remaining, total_cost, ${STD_COLS})
SELECT ${SQL_UUID}, t.product_id, t.warehouse_id, t.movement_id, t.lot_date, t.total, t.total,
  MIN(1000000000000000, (t.total / 1000) * t.price + ((t.total % 1000) * t.price + 500) / 1000),
  ${NOW}, ${NOW}, 1, NULL
FROM (
  SELECT g.product_id, g.warehouse_id, g.total, p.purchase_price AS price,
    (SELECT m.id FROM stock_movements m WHERE m.product_id = g.product_id AND m.warehouse_id = g.warehouse_id AND m.quantity_delta > 0
      ORDER BY m.occurred_at DESC, m.created_at DESC, m.id DESC LIMIT 1) AS movement_id,
    (SELECT m.occurred_at FROM stock_movements m WHERE m.product_id = g.product_id AND m.warehouse_id = g.warehouse_id AND m.quantity_delta > 0
      ORDER BY m.occurred_at DESC, m.created_at DESC, m.id DESC LIMIT 1) AS lot_date
  FROM (SELECT product_id, warehouse_id, SUM(quantity_delta) AS total FROM stock_movements GROUP BY product_id, warehouse_id) g
  JOIN products p ON p.id = g.product_id
  WHERE g.total > 0
) t`,
    `INSERT INTO average_costs (product_id, quantity, value)
SELECT product_id, SUM(remaining), MIN(1000000000000000, SUM(total_cost)) FROM cost_lots GROUP BY product_id`,

    // ---- ۳) کالا بدون قیمت خرید (قیمت خرید فقط روی ردیف فاکتور خرید است)
    `CREATE TABLE products_new (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL CHECK (length(trim(code)) > 0),
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  group_id TEXT NOT NULL REFERENCES product_groups (id),
  unit_id TEXT NOT NULL REFERENCES units (id),
  sub_unit TEXT,
  conversion_ratio INTEGER CHECK (conversion_ratio IS NULL OR conversion_ratio > 0),
  reorder_point INTEGER NOT NULL DEFAULT 0 CHECK (reorder_point >= 0),
  sale_price INTEGER NOT NULL DEFAULT 0 CHECK (sale_price >= 0),
  description TEXT,${STD},
  CHECK ((sub_unit IS NULL) = (conversion_ratio IS NULL))
)`,
    `INSERT INTO products_new (id, code, name, group_id, unit_id, sub_unit, conversion_ratio, reorder_point, sale_price, description, ${STD_COLS})
SELECT id, code, name, group_id, unit_id, sub_unit, conversion_ratio, reorder_point, sale_price, description, ${STD_COLS} FROM products`,
    `DROP TABLE products`,
    `ALTER TABLE products_new RENAME TO products`,
    `CREATE UNIQUE INDEX ux_products_code ON products (code)`,
    `CREATE INDEX ix_products_name ON products (name)`,
    `CREATE INDEX ix_products_group ON products (group_id)`,
    `CREATE INDEX ix_products_unit ON products (unit_id)`,

    // ---- ۴) ستون‌های جدید
    `ALTER TABLE purchase_items ADD COLUMN invoice_discount_share INTEGER NOT NULL DEFAULT 0 CHECK (invoice_discount_share >= 0)`,
    `ALTER TABLE sales_items ADD COLUMN invoice_discount_share INTEGER NOT NULL DEFAULT 0 CHECK (invoice_discount_share >= 0)`,
    // ترتیب ردیف‌ها همان ترتیب ورود کاربر (شناسه‌ها در یک میلی‌ثانیه ترتیب ندارند)
    `ALTER TABLE purchase_items ADD COLUMN line_no INTEGER NOT NULL DEFAULT 0 CHECK (line_no >= 0)`,
    `ALTER TABLE sales_items ADD COLUMN line_no INTEGER NOT NULL DEFAULT 0 CHECK (line_no >= 0)`,
    `ALTER TABLE sales_items ADD COLUMN cost_fifo INTEGER NOT NULL DEFAULT 0 CHECK (cost_fifo >= 0)`,
    `ALTER TABLE sales_items ADD COLUMN cost_average INTEGER NOT NULL DEFAULT 0 CHECK (cost_average >= 0)`,
    `ALTER TABLE sales_items ADD COLUMN cost_last INTEGER NOT NULL DEFAULT 0 CHECK (cost_last >= 0)`,
    // درصد سود گروه به صدم درصد (۱۲٫۵٪ = ۱۲۵۰)؛ NULL = از درصد سراسری استفاده شود
    `ALTER TABLE product_groups ADD COLUMN markup_bp INTEGER CHECK (markup_bp IS NULL OR (markup_bp >= 0 AND markup_bp <= 100000))`,
    `ALTER TABLE suppliers ADD COLUMN is_system INTEGER NOT NULL DEFAULT 0 CHECK (is_system IN (0, 1))`,
    `INSERT INTO suppliers (id, name, is_system) VALUES ('${MISC_SUPPLIER_ID}', 'متفرقه', 1)`,

    // ---- ۵) تنظیمات
    `DELETE FROM settings WHERE key = 'allow_negative_stock'`,
    `INSERT OR IGNORE INTO settings (key, value, updated_at) VALUES ('cost_method', 'fifo', ${NOW})`,
    `INSERT OR IGNORE INTO settings (key, value, updated_at) VALUES ('sale_price_mode', 'last_sale', ${NOW})`,
    `INSERT OR IGNORE INTO settings (key, value, updated_at) VALUES ('markup_bp', '0', ${NOW})`,

    // ---- ۶) Triggerها
    `CREATE TRIGGER trg_stock_no_negative_insert BEFORE INSERT ON warehouse_stock
WHEN NEW.quantity < 0
BEGIN SELECT RAISE(ABORT, 'negative_stock'); END`,
    `CREATE TRIGGER trg_stock_no_negative_update BEFORE UPDATE OF quantity ON warehouse_stock
WHEN NEW.quantity < 0
BEGIN SELECT RAISE(ABORT, 'negative_stock'); END`,
    `CREATE TRIGGER trg_movements_no_update BEFORE UPDATE ON stock_movements
BEGIN SELECT RAISE(ABORT, 'ledger_immutable'); END`,
    `CREATE TRIGGER trg_movements_no_delete BEFORE DELETE ON stock_movements
BEGIN SELECT RAISE(ABORT, 'ledger_immutable'); END`,
    `CREATE TRIGGER trg_movements_whole_units BEFORE INSERT ON stock_movements
WHEN NEW.quantity_delta % 1000 <> 0
  AND EXISTS (SELECT 1 FROM products p JOIN units u ON u.id = p.unit_id WHERE p.id = NEW.product_id AND u.allows_fraction = 0)
BEGIN SELECT RAISE(ABORT, 'fraction_not_allowed'); END`,
    ...invoiceTriggers('sales_invoices', 'sales_items', 'customer_id'),
    ...invoiceTriggers('purchase_invoices', 'purchase_items', 'supplier_id'),
    `CREATE TRIGGER trg_products_unit_locked BEFORE UPDATE OF unit_id ON products
WHEN NEW.unit_id <> OLD.unit_id AND (
  EXISTS (SELECT 1 FROM stock_movements WHERE product_id = OLD.id)
  OR EXISTS (SELECT 1 FROM sales_items WHERE product_id = OLD.id)
  OR EXISTS (SELECT 1 FROM purchase_items WHERE product_id = OLD.id))
BEGIN SELECT RAISE(ABORT, 'unit_locked'); END`,
    `CREATE TRIGGER trg_units_fraction_locked BEFORE UPDATE OF allows_fraction ON units
WHEN NEW.allows_fraction <> OLD.allows_fraction AND EXISTS (SELECT 1 FROM products WHERE unit_id = OLD.id)
BEGIN SELECT RAISE(ABORT, 'unit_locked'); END`,
    `CREATE TRIGGER trg_units_system_update BEFORE UPDATE ON units
WHEN OLD.is_system = 1 AND (NEW.is_active = 0 OR NEW.is_system = 0 OR NEW.name <> OLD.name OR NEW.allows_fraction <> OLD.allows_fraction)
BEGIN SELECT RAISE(ABORT, 'system_row_protected'); END`,
    `CREATE TRIGGER trg_units_system_delete BEFORE DELETE ON units
WHEN OLD.is_system = 1
BEGIN SELECT RAISE(ABORT, 'system_row_protected'); END`,
    `CREATE TRIGGER trg_customers_system_update BEFORE UPDATE ON customers
WHEN OLD.is_system = 1 AND (NEW.is_active = 0 OR NEW.is_system = 0)
BEGIN SELECT RAISE(ABORT, 'system_row_protected'); END`,
    `CREATE TRIGGER trg_customers_system_delete BEFORE DELETE ON customers
WHEN OLD.is_system = 1
BEGIN SELECT RAISE(ABORT, 'system_row_protected'); END`,
    `CREATE TRIGGER trg_suppliers_system_update BEFORE UPDATE ON suppliers
WHEN OLD.is_system = 1 AND (NEW.is_active = 0 OR NEW.is_system = 0)
BEGIN SELECT RAISE(ABORT, 'system_row_protected'); END`,
    `CREATE TRIGGER trg_suppliers_system_delete BEFORE DELETE ON suppliers
WHEN OLD.is_system = 1
BEGIN SELECT RAISE(ABORT, 'system_row_protected'); END`,
    // لایه: فقط «باقی‌مانده» تغییر می‌کند و حذف نمی‌شود
    `CREATE TRIGGER trg_lots_immutable BEFORE UPDATE ON cost_lots
WHEN NEW.product_id IS NOT OLD.product_id OR NEW.warehouse_id IS NOT OLD.warehouse_id OR NEW.movement_id IS NOT OLD.movement_id
  OR NEW.lot_date IS NOT OLD.lot_date OR NEW.quantity IS NOT OLD.quantity OR NEW.total_cost IS NOT OLD.total_cost
BEGIN SELECT RAISE(ABORT, 'ledger_immutable'); END`,
    `CREATE TRIGGER trg_lots_no_delete BEFORE DELETE ON cost_lots
BEGIN SELECT RAISE(ABORT, 'ledger_immutable'); END`,
    // برداشت: فقط یک بار «برگشت» می‌خورد؛ هیچ تغییر دیگری و حذف ممنوع
    `CREATE TRIGGER trg_alloc_immutable BEFORE UPDATE ON lot_allocations
WHEN NEW.lot_id IS NOT OLD.lot_id OR NEW.movement_id IS NOT OLD.movement_id OR NEW.quantity IS NOT OLD.quantity
  OR NEW.cost_amount IS NOT OLD.cost_amount OR OLD.reversal_movement_id IS NOT NULL OR NEW.reversal_movement_id IS NULL
BEGIN SELECT RAISE(ABORT, 'ledger_immutable'); END`,
    `CREATE TRIGGER trg_alloc_no_delete BEFORE DELETE ON lot_allocations
BEGIN SELECT RAISE(ABORT, 'ledger_immutable'); END`,
  ],
}
