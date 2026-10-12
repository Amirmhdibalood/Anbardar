import type { Migration } from './types'

/**
 * Migration 002 — تعداد اعشاری، جدول واحدها و تخفیف سطح فاکتور.
 *
 * ۱) تعدادها از این به بعد «هزارم واحد» هستند (عدد صحیح؛ ۱٫۵ کیلو = ۱۵۰۰). هیچ ستون REAL وجود ندارد.
 *    ستون‌های دارای مقیاس ×۱۰۰۰: products.reorder_point، stock_movements.quantity_delta،
 *    warehouse_stock.quantity، sales_items.quantity، purchase_items.quantity.
 *    داده‌های قبلی در همین Migration ×۱۰۰۰ می‌شوند.
 * ۲) جدول `units`: هر واحد مشخص می‌کند اعشار مجاز است یا نه. products.unit (متن آزاد) → products.unit_id.
 * ۳) فاکتورها: ستون‌های `subtotal_amount` و `discount` + CHECK ریاضی
 *    total_amount = subtotal_amount - discount. (جمع ردیف‌ها = subtotal را مخزن تضمین و تست سلامت بررسی می‌کند.)
 * ۴) مبلغ ردیف = round(تعداد(هزارم) × قیمت واحد ÷ ۱۰۰۰) - تخفیف ردیف؛ گرد کردن «نیم به بالا» و کاملاً با عدد صحیح.
 *
 * SQLite امکان تغییر CHECK ندارد؛ پس جدول‌های متأثر به روش رسمی (جدید بساز ← کپی ← حذف قدیمی ← تغییر نام) بازسازی می‌شوند.
 * Triggerها اول حذف و در پایان دوباره ساخته می‌شوند. کلیدهای خارجی را Runner موقتاً خاموش می‌کند و
 * پس از اجرا `foreign_key_check` را اجرا می‌کند.
 */

const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')"

const STD = `
  created_at TEXT NOT NULL DEFAULT (${NOW}),
  updated_at TEXT NOT NULL DEFAULT (${NOW}),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_by TEXT`

const STD_COLS = 'created_at, updated_at, is_active, created_by'

/** شناسه‌های ثابت واحدهای سیستمی (باید با src/models/units.ts یکی باشد؛ تست آن را بررسی می‌کند) */
const SYSTEM_UNITS: ReadonlyArray<readonly [id: string, name: string, fraction: 0 | 1]> = [
  ['4717669a-870c-4fe9-9be6-61b5eb0ad73d', 'عدد', 0],
  ['59314b41-9bae-4f98-be5c-a57116ad1727', 'کیلو', 1],
  ['fbdc8a87-4ded-461e-9c11-0805fd569cfb', 'گرم', 1],
  ['97929e17-b3c2-4b36-a61d-3454f460b08b', 'لیتر', 1],
  ['787fe859-a2bd-4c8a-b625-2e8641a13eb6', 'متر', 1],
  ['ade77cba-84bc-433d-927a-86e9149ddf7d', 'بسته', 0],
  ['69cb3c94-0732-4e03-80ee-367d4e246e09', 'کارتن', 0],
  ['c4bf7b25-84e2-469d-8a1e-6efd240c5f9b', 'جفت', 0],
  ['40d5095e-ec3a-4773-8e6c-34dccc4ce303', 'دست', 0],
]

/** UUID نسخه ۴ تصادفی با SQL (برای واحدهای سفارشی قدیمی) */
const SQL_UUID = `lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))`

/** مبلغ ناخالص ردیف: نیم به بالا، با عدد صحیح (مقادیر همیشه نامنفی‌اند) */
const GROSS = '(quantity * unit_price + 500) / 1000'

function rebuild(table: string, createNew: string, copySql: string): string[] {
  return [createNew, copySql, `DROP TABLE ${table}`, `ALTER TABLE ${table}_new RENAME TO ${table}`]
}

function itemsTable(table: string, invoiceTable: string): string {
  return `CREATE TABLE ${table}_new (
  id TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL REFERENCES ${invoiceTable} (id),
  product_id TEXT NOT NULL REFERENCES products (id),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_price INTEGER NOT NULL CHECK (unit_price >= 0),
  discount INTEGER NOT NULL DEFAULT 0 CHECK (discount >= 0),
  line_total INTEGER NOT NULL,
  note TEXT,${STD},
  CHECK (discount <= ${GROSS}),
  CHECK (line_total = ${GROSS} - discount)
)`
}

function itemsCopy(table: string): string {
  return `INSERT INTO ${table}_new (id, invoice_id, product_id, quantity, unit_price, discount, line_total, note, ${STD_COLS})
SELECT id, invoice_id, product_id, quantity * 1000, unit_price, discount, line_total, note, ${STD_COLS} FROM ${table}`
}

function invoiceTable(table: string, partyCol: string, partyTable: string): string {
  return `CREATE TABLE ${table}_new (
  id TEXT PRIMARY KEY,
  invoice_number INTEGER NOT NULL,
  reference TEXT,
  invoice_date TEXT NOT NULL,
  warehouse_id TEXT NOT NULL REFERENCES warehouses (id),
  subtotal_amount INTEGER NOT NULL CHECK (subtotal_amount >= 0),
  discount INTEGER NOT NULL DEFAULT 0 CHECK (discount >= 0),
  total_amount INTEGER NOT NULL CHECK (total_amount >= 0),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cancelled')),
  cancelled_at TEXT,
  cancel_reason TEXT,
  note TEXT,
  ${partyCol} TEXT NOT NULL REFERENCES ${partyTable} (id),${STD},
  CHECK ((status = 'cancelled') = (cancelled_at IS NOT NULL)),
  CHECK (discount <= subtotal_amount),
  CHECK (total_amount = subtotal_amount - discount)
)`
}

function invoiceCopy(table: string, partyCol: string): string {
  return `INSERT INTO ${table}_new (id, invoice_number, reference, invoice_date, warehouse_id, subtotal_amount, discount, total_amount,
  status, cancelled_at, cancel_reason, note, ${partyCol}, ${STD_COLS})
SELECT id, invoice_number, reference, invoice_date, warehouse_id, total_amount, 0, total_amount,
  status, cancelled_at, cancel_reason, note, ${partyCol}, ${STD_COLS} FROM ${table}`
}

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
    // کالاهایی که واحدشان اعشار ندارد فقط تعداد صحیح می‌پذیرند
    `CREATE TRIGGER trg_${items}_whole_units BEFORE INSERT ON ${items}
WHEN NEW.quantity % 1000 <> 0
  AND EXISTS (SELECT 1 FROM products p JOIN units u ON u.id = p.unit_id WHERE p.id = NEW.product_id AND u.allows_fraction = 0)
BEGIN SELECT RAISE(ABORT, 'fraction_not_allowed'); END`,
  ]
}

const OLD_TRIGGERS = [
  'trg_stock_no_negative_insert',
  'trg_stock_no_negative_update',
  'trg_movements_no_update',
  'trg_movements_no_delete',
  ...['sales_invoices', 'purchase_invoices'].flatMap((t) => [`trg_${t}_immutable`, `trg_${t}_no_delete`]),
  ...['sales_items', 'purchase_items'].flatMap((t) => [`trg_${t}_no_update`, `trg_${t}_no_delete`, `trg_${t}_only_active`]),
]

export const migration002: Migration = {
  version: 2,
  name: 'fractional quantities, units, invoice discount',
  statements: [
    // ---- ۰) Triggerهای قدیمی (به جدول‌هایی که بازسازی می‌شوند وابسته‌اند)
    ...OLD_TRIGGERS.map((name) => `DROP TRIGGER IF EXISTS ${name}`),

    // ---- ۱) واحدها
    `CREATE TABLE units (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  allows_fraction INTEGER NOT NULL DEFAULT 0 CHECK (allows_fraction IN (0, 1)),
  is_system INTEGER NOT NULL DEFAULT 0 CHECK (is_system IN (0, 1)),
  sort_order INTEGER NOT NULL DEFAULT 0,${STD}
)`,
    `CREATE UNIQUE INDEX ux_units_name ON units (name)`,
    ...SYSTEM_UNITS.map(
      ([id, name, fraction], i) =>
        `INSERT INTO units (id, name, allows_fraction, is_system, sort_order) VALUES ('${id}', '${name}', ${fraction}, 1, ${(i + 1) * 10})`,
    ),
    // واحدهای متنی قدیمیِ کالاها که در فهرست سیستمی نیستند، به واحد سفارشی (فقط عدد صحیح) تبدیل می‌شوند
    `INSERT INTO units (id, name, allows_fraction, is_system, sort_order)
SELECT ${SQL_UUID}, unit, 0, 0, 1000 FROM (SELECT DISTINCT trim(unit) AS unit FROM products WHERE trim(unit) NOT IN (SELECT name FROM units))`,

    // ---- ۲) کالاها
    ...rebuild(
      'products',
      `CREATE TABLE products_new (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL CHECK (length(trim(code)) > 0),
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  group_id TEXT NOT NULL REFERENCES product_groups (id),
  unit_id TEXT NOT NULL REFERENCES units (id),
  sub_unit TEXT,
  conversion_ratio INTEGER CHECK (conversion_ratio IS NULL OR conversion_ratio > 0),
  reorder_point INTEGER NOT NULL DEFAULT 0 CHECK (reorder_point >= 0),
  purchase_price INTEGER NOT NULL DEFAULT 0 CHECK (purchase_price >= 0),
  sale_price INTEGER NOT NULL DEFAULT 0 CHECK (sale_price >= 0),
  description TEXT,${STD},
  CHECK ((sub_unit IS NULL) = (conversion_ratio IS NULL))
)`,
      `INSERT INTO products_new (id, code, name, group_id, unit_id, sub_unit, conversion_ratio, reorder_point, purchase_price, sale_price, description, ${STD_COLS})
SELECT id, code, name, group_id, (SELECT u.id FROM units u WHERE u.name = trim(products.unit)), sub_unit, conversion_ratio,
  reorder_point * 1000, purchase_price, sale_price, description, ${STD_COLS} FROM products`,
    ),
    `CREATE UNIQUE INDEX ux_products_code ON products (code)`,
    `CREATE INDEX ix_products_name ON products (name)`,
    `CREATE INDEX ix_products_group ON products (group_id)`,
    `CREATE INDEX ix_products_unit ON products (unit_id)`,

    // ---- ۳) دفتر حرکت و کش موجودی
    ...rebuild(
      'stock_movements',
      `CREATE TABLE stock_movements_new (
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
      `INSERT INTO stock_movements_new (id, product_id, warehouse_id, quantity_delta, movement_type, document_type, document_id, occurred_at, note, ${STD_COLS})
SELECT id, product_id, warehouse_id, quantity_delta * 1000, movement_type, document_type, document_id, occurred_at, note, ${STD_COLS} FROM stock_movements`,
    ),
    `CREATE INDEX ix_movements_product_wh ON stock_movements (product_id, warehouse_id)`,
    `CREATE INDEX ix_movements_document ON stock_movements (document_type, document_id)`,
    `CREATE INDEX ix_movements_date ON stock_movements (occurred_at)`,

    ...rebuild(
      'warehouse_stock',
      `CREATE TABLE warehouse_stock_new (
  id TEXT PRIMARY KEY,
  warehouse_id TEXT NOT NULL REFERENCES warehouses (id),
  product_id TEXT NOT NULL REFERENCES products (id),
  quantity INTEGER NOT NULL DEFAULT 0,${STD}
)`,
      `INSERT INTO warehouse_stock_new (id, warehouse_id, product_id, quantity, ${STD_COLS})
SELECT id, warehouse_id, product_id, quantity * 1000, ${STD_COLS} FROM warehouse_stock`,
    ),
    `CREATE UNIQUE INDEX ux_stock_wh_product ON warehouse_stock (warehouse_id, product_id)`,
    `CREATE INDEX ix_stock_product ON warehouse_stock (product_id)`,

    // ---- ۴) فاکتورها و ردیف‌ها
    ...rebuild('purchase_invoices', invoiceTable('purchase_invoices', 'supplier_id', 'suppliers'), invoiceCopy('purchase_invoices', 'supplier_id')),
    `CREATE UNIQUE INDEX ux_purchase_number ON purchase_invoices (invoice_number)`,
    `CREATE INDEX ix_purchase_date ON purchase_invoices (invoice_date)`,
    `CREATE INDEX ix_purchase_supplier ON purchase_invoices (supplier_id)`,
    `CREATE INDEX ix_purchase_warehouse ON purchase_invoices (warehouse_id)`,
    ...rebuild('purchase_items', itemsTable('purchase_items', 'purchase_invoices'), itemsCopy('purchase_items')),
    `CREATE INDEX ix_purchase_items_invoice ON purchase_items (invoice_id)`,
    `CREATE INDEX ix_purchase_items_product ON purchase_items (product_id)`,

    ...rebuild('sales_invoices', invoiceTable('sales_invoices', 'customer_id', 'customers'), invoiceCopy('sales_invoices', 'customer_id')),
    `CREATE UNIQUE INDEX ux_sales_number ON sales_invoices (invoice_number)`,
    `CREATE INDEX ix_sales_date ON sales_invoices (invoice_date)`,
    `CREATE INDEX ix_sales_customer ON sales_invoices (customer_id)`,
    `CREATE INDEX ix_sales_warehouse ON sales_invoices (warehouse_id)`,
    ...rebuild('sales_items', itemsTable('sales_items', 'sales_invoices'), itemsCopy('sales_items')),
    `CREATE INDEX ix_sales_items_invoice ON sales_items (invoice_id)`,
    `CREATE INDEX ix_sales_items_product ON sales_items (product_id)`,

    // ---- ۵) Triggerهای حفاظتی (بازسازی‌شده + جدید)
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
    `CREATE TRIGGER trg_movements_whole_units BEFORE INSERT ON stock_movements
WHEN NEW.quantity_delta % 1000 <> 0
  AND EXISTS (SELECT 1 FROM products p JOIN units u ON u.id = p.unit_id WHERE p.id = NEW.product_id AND u.allows_fraction = 0)
BEGIN SELECT RAISE(ABORT, 'fraction_not_allowed'); END`,
    ...invoiceTriggers('sales_invoices', 'sales_items', 'customer_id'),
    ...invoiceTriggers('purchase_invoices', 'purchase_items', 'supplier_id'),

    // واحد کالا بعد از اولین تراکنش قابل تغییر نیست (معنی تعدادهای قبلی عوض می‌شد)
    `CREATE TRIGGER trg_products_unit_locked BEFORE UPDATE OF unit_id ON products
WHEN NEW.unit_id <> OLD.unit_id AND (
  EXISTS (SELECT 1 FROM stock_movements WHERE product_id = OLD.id)
  OR EXISTS (SELECT 1 FROM sales_items WHERE product_id = OLD.id)
  OR EXISTS (SELECT 1 FROM purchase_items WHERE product_id = OLD.id))
BEGIN SELECT RAISE(ABORT, 'unit_locked'); END`,
    // «اعشاری بودن» واحد پس از استفاده در کالا عوض نمی‌شود
    `CREATE TRIGGER trg_units_fraction_locked BEFORE UPDATE OF allows_fraction ON units
WHEN NEW.allows_fraction <> OLD.allows_fraction AND EXISTS (SELECT 1 FROM products WHERE unit_id = OLD.id)
BEGIN SELECT RAISE(ABORT, 'unit_locked'); END`,
    `CREATE TRIGGER trg_units_system_update BEFORE UPDATE ON units
WHEN OLD.is_system = 1 AND (NEW.is_active = 0 OR NEW.is_system = 0 OR NEW.name <> OLD.name OR NEW.allows_fraction <> OLD.allows_fraction)
BEGIN SELECT RAISE(ABORT, 'system_row_protected'); END`,
    `CREATE TRIGGER trg_units_system_delete BEFORE DELETE ON units
WHEN OLD.is_system = 1
BEGIN SELECT RAISE(ABORT, 'system_row_protected'); END`,
  ],
}
