import type { Migration } from './types'

/**
 * Migration 007 — واحدهای فرعی کالا، حالت قیمت (واحد/کل)، هزینه‌های جانبی خرید، چک‌ها.
 * طراحی: docs/stage2-units-landed-cheques.md. Runner پیش از اجرا Snapshot کامل می‌گیرد.
 *
 * - product_units: ضریب هر واحد فرعی به «هزارم واحد پایه» (کارتن = ۲۴ عدد → 24000). ضریب تغییرناپذیر است.
 * - sales_items / purchase_items بازسازی می‌شوند (CHECK جدید):
 *     quantity (پایه) = unit_quantity × unit_factor / 1000 (بخش‌پذیر دقیق)
 *     price_mode='unit' → gross_amount = round(unit_quantity × unit_price / 1000)؛ 'total' → gross_amount همان مبلغ واردشده
 *     line_total = gross_amount − discount
 *   ردیف‌های قبلی: واحد پایه، ضریب 1000، unit_quantity = quantity، gross طبق فرمول قبلی (بدون تغییر هیچ مبلغی).
 * - purchase_items.landed_share و purchase_invoices.landed_total/landed_method + purchase_charges
 * - ردیف‌های برگشت: unit_id/unit_factor/unit_quantity (فقط نمایش؛ مبالغ همچنان از ردیف اصلی)
 * - cheques: یک چک برای هر سند دریافت/پرداخت با روش «چک».
 */

const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')"
const STD = `
  created_at TEXT NOT NULL DEFAULT (${NOW}),
  updated_at TEXT NOT NULL DEFAULT (${NOW}),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_by TEXT`
const STD_COLS = 'created_at, updated_at, is_active, created_by'

function itemsTable(table: string, invoiceTable: string, purchase: boolean): string {
  return `CREATE TABLE ${table}_new (
  id TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL REFERENCES ${invoiceTable} (id),
  product_id TEXT NOT NULL REFERENCES products (id),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_id TEXT REFERENCES units (id),
  unit_factor INTEGER NOT NULL DEFAULT 1000 CHECK (unit_factor > 0),
  unit_quantity INTEGER NOT NULL CHECK (unit_quantity > 0),
  unit_price INTEGER NOT NULL CHECK (unit_price >= 0),
  price_mode TEXT NOT NULL DEFAULT 'unit' CHECK (price_mode IN ('unit', 'total')),
  gross_amount INTEGER NOT NULL CHECK (gross_amount >= 0),
  discount INTEGER NOT NULL DEFAULT 0 CHECK (discount >= 0),
  line_total INTEGER NOT NULL,
  invoice_discount_share INTEGER NOT NULL DEFAULT 0 CHECK (invoice_discount_share >= 0),
  line_no INTEGER NOT NULL DEFAULT 0 CHECK (line_no >= 0),${purchase ? `
  landed_share INTEGER NOT NULL DEFAULT 0 CHECK (landed_share >= 0),` : `
  cost_fifo INTEGER NOT NULL DEFAULT 0 CHECK (cost_fifo >= 0),
  cost_average INTEGER NOT NULL DEFAULT 0 CHECK (cost_average >= 0),
  cost_last INTEGER NOT NULL DEFAULT 0 CHECK (cost_last >= 0),`}
  note TEXT,${STD},
  CHECK ((unit_quantity * unit_factor) % 1000 = 0 AND quantity = unit_quantity * unit_factor / 1000),
  CHECK ((unit_id IS NULL) = (unit_factor = 1000) OR unit_id IS NOT NULL),
  CHECK (price_mode = 'total' OR gross_amount = (unit_quantity * unit_price + 500) / 1000),
  CHECK (discount <= gross_amount),
  CHECK (line_total = gross_amount - discount)${purchase ? '' : `,
  CHECK (price_mode = 'unit')`}
)`
}

const COMMON_COLS = 'id, invoice_id, product_id, quantity, unit_price, discount, line_total, invoice_discount_share, line_no, note'

function rebuildItems(table: string, invoiceTable: string, purchase: boolean): string[] {
  const extra = purchase ? '' : ', cost_fifo, cost_average, cost_last'
  return [
    ...['no_update', 'no_delete', 'whole_units', 'share_limit', 'only_active'].map((t) => `DROP TRIGGER IF EXISTS trg_${table}_${t}`),
    itemsTable(table, invoiceTable, purchase),
    `INSERT INTO ${table}_new (${COMMON_COLS}${extra}, unit_id, unit_factor, unit_quantity, price_mode, gross_amount, ${STD_COLS})
SELECT ${COMMON_COLS}${extra}, NULL, 1000, quantity, 'unit', (quantity * unit_price + 500) / 1000, ${STD_COLS} FROM ${table}`,
    `DROP TABLE ${table}`,
    `ALTER TABLE ${table}_new RENAME TO ${table}`,
    `CREATE INDEX ix_${table}_invoice ON ${table} (invoice_id)`,
    `CREATE INDEX ix_${table}_product ON ${table} (product_id)`,
    `CREATE TRIGGER trg_${table}_no_update BEFORE UPDATE ON ${table}
BEGIN SELECT RAISE(ABORT, 'document_immutable'); END`,
    `CREATE TRIGGER trg_${table}_no_delete BEFORE DELETE ON ${table}
BEGIN SELECT RAISE(ABORT, 'document_immutable'); END`,
    `CREATE TRIGGER trg_${table}_whole_units BEFORE INSERT ON ${table}
WHEN NEW.quantity % 1000 <> 0
  AND EXISTS (SELECT 1 FROM products p JOIN units u ON u.id = p.unit_id WHERE p.id = NEW.product_id AND u.allows_fraction = 0)
BEGIN SELECT RAISE(ABORT, 'fraction_not_allowed'); END`,
    `CREATE TRIGGER trg_${table}_unit_whole BEFORE INSERT ON ${table}
WHEN NEW.unit_id IS NOT NULL AND NEW.unit_quantity % 1000 <> 0
  AND EXISTS (SELECT 1 FROM units u WHERE u.id = NEW.unit_id AND u.allows_fraction = 0)
BEGIN SELECT RAISE(ABORT, 'fraction_not_allowed'); END`,
    `CREATE TRIGGER trg_${table}_unit_valid BEFORE INSERT ON ${table}
WHEN NEW.unit_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM products p WHERE p.id = NEW.product_id AND p.unit_id = NEW.unit_id AND NEW.unit_factor = 1000)
  AND NOT EXISTS (SELECT 1 FROM product_units pu WHERE pu.product_id = NEW.product_id AND pu.unit_id = NEW.unit_id AND pu.factor = NEW.unit_factor)
BEGIN SELECT RAISE(ABORT, 'unit_mismatch'); END`,
    `CREATE TRIGGER trg_${table}_share_limit BEFORE INSERT ON ${table}
WHEN NEW.invoice_discount_share > NEW.line_total
BEGIN SELECT RAISE(ABORT, 'amount_mismatch'); END`,
    `CREATE TRIGGER trg_${table}_only_active BEFORE INSERT ON ${table}
WHEN (SELECT status FROM ${invoiceTable} WHERE id = NEW.invoice_id) = 'cancelled'
BEGIN SELECT RAISE(ABORT, 'document_immutable'); END`,
  ]
}

export const migration007: Migration = {
  version: 7,
  name: 'product sub-units, price mode, landed costs, cheques',
  statements: [
    // ---- واحدهای فرعی
    `CREATE TABLE product_units (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products (id),
  unit_id TEXT NOT NULL REFERENCES units (id),
  factor INTEGER NOT NULL CHECK (factor > 0 AND factor <= 1000000000),${STD}
)`,
    `CREATE UNIQUE INDEX ux_product_units ON product_units (product_id, unit_id)`,
    `CREATE TRIGGER trg_product_units_valid BEFORE INSERT ON product_units
WHEN EXISTS (SELECT 1 FROM products p WHERE p.id = NEW.product_id AND p.unit_id = NEW.unit_id)
  OR (NEW.factor % 1000 <> 0 AND EXISTS (SELECT 1 FROM products p JOIN units u ON u.id = p.unit_id WHERE p.id = NEW.product_id AND u.allows_fraction = 0))
BEGIN SELECT RAISE(ABORT, 'unit_mismatch'); END`,
    `CREATE TRIGGER trg_product_units_no_delete BEFORE DELETE ON product_units
BEGIN SELECT RAISE(ABORT, 'unit_locked'); END`,

    // ---- ردیف فاکتورها (Trigger کالا که به این جدول‌ها اشاره دارد موقتاً حذف و بعد بازسازی می‌شود)
    'DROP TRIGGER IF EXISTS trg_products_unit_locked',
    ...rebuildItems('sales_items', 'sales_invoices', false),
    ...rebuildItems('purchase_items', 'purchase_invoices', true),
    `CREATE TRIGGER trg_products_unit_locked BEFORE UPDATE OF unit_id ON products
WHEN NEW.unit_id <> OLD.unit_id AND (
  EXISTS (SELECT 1 FROM stock_movements WHERE product_id = OLD.id)
  OR EXISTS (SELECT 1 FROM sales_items WHERE product_id = OLD.id)
  OR EXISTS (SELECT 1 FROM purchase_items WHERE product_id = OLD.id)
  OR EXISTS (SELECT 1 FROM product_units WHERE product_id = OLD.id AND is_active = 1))
BEGIN SELECT RAISE(ABORT, 'unit_locked'); END`,
    `CREATE TRIGGER trg_product_units_immutable BEFORE UPDATE ON product_units
WHEN NEW.unit_id IS NOT OLD.unit_id OR NEW.product_id IS NOT OLD.product_id
  OR (NEW.factor IS NOT OLD.factor AND (
    EXISTS (SELECT 1 FROM sales_items WHERE product_id = OLD.product_id AND unit_id = OLD.unit_id)
    OR EXISTS (SELECT 1 FROM purchase_items WHERE product_id = OLD.product_id AND unit_id = OLD.unit_id)))
BEGIN SELECT RAISE(ABORT, 'unit_locked'); END`,

    // ---- هزینه‌های جانبی خرید
    `ALTER TABLE purchase_invoices ADD COLUMN landed_total INTEGER NOT NULL DEFAULT 0 CHECK (landed_total >= 0)`,
    `ALTER TABLE purchase_invoices ADD COLUMN landed_method TEXT NOT NULL DEFAULT 'value' CHECK (landed_method IN ('value', 'quantity'))`,
    `CREATE TABLE purchase_charges (
  id TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL REFERENCES purchase_invoices (id),
  title TEXT NOT NULL CHECK (length(trim(title)) > 0),
  amount INTEGER NOT NULL CHECK (amount > 0 AND amount <= 1000000000000000),
  line_no INTEGER NOT NULL DEFAULT 0,${STD}
)`,
    `CREATE INDEX ix_purchase_charges_invoice ON purchase_charges (invoice_id)`,
    `CREATE TRIGGER trg_purchase_charges_no_update BEFORE UPDATE ON purchase_charges
BEGIN SELECT RAISE(ABORT, 'document_immutable'); END`,
    `CREATE TRIGGER trg_purchase_charges_no_delete BEFORE DELETE ON purchase_charges
BEGIN SELECT RAISE(ABORT, 'document_immutable'); END`,
    `CREATE TRIGGER trg_purchase_landed_immutable BEFORE UPDATE OF landed_total, landed_method ON purchase_invoices
WHEN NEW.landed_total IS NOT OLD.landed_total OR NEW.landed_method IS NOT OLD.landed_method
BEGIN SELECT RAISE(ABORT, 'document_immutable'); END`,

    // ---- ردیف برگشت‌ها (نمایش واحد واردشده)
    `ALTER TABLE sale_return_items ADD COLUMN unit_id TEXT REFERENCES units (id)`,
    `ALTER TABLE sale_return_items ADD COLUMN unit_factor INTEGER NOT NULL DEFAULT 1000 CHECK (unit_factor > 0)`,
    `ALTER TABLE sale_return_items ADD COLUMN unit_quantity INTEGER CHECK (unit_quantity IS NULL OR unit_quantity > 0)`,
    `ALTER TABLE purchase_return_items ADD COLUMN unit_id TEXT REFERENCES units (id)`,
    `ALTER TABLE purchase_return_items ADD COLUMN unit_factor INTEGER NOT NULL DEFAULT 1000 CHECK (unit_factor > 0)`,
    `ALTER TABLE purchase_return_items ADD COLUMN unit_quantity INTEGER CHECK (unit_quantity IS NULL OR unit_quantity > 0)`,

    // ---- چک‌ها
    `CREATE TABLE cheques (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES money_documents (id),
  direction TEXT NOT NULL CHECK (direction IN ('received', 'issued')),
  cheque_number TEXT NOT NULL CHECK (length(trim(cheque_number)) > 0),
  bank TEXT NOT NULL CHECK (length(trim(bank)) > 0),
  due_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'cleared', 'bounced', 'spent')),
  spent_document_id TEXT REFERENCES money_documents (id),
  status_at TEXT,
  note TEXT,${STD},
  CHECK (status <> 'spent' OR spent_document_id IS NOT NULL),
  CHECK (spent_document_id IS NULL OR status IN ('spent', 'bounced', 'cleared')),
  CHECK (direction = 'received' OR spent_document_id IS NULL)
)`,
    `CREATE UNIQUE INDEX ux_cheques_document ON cheques (document_id)`,
    `CREATE INDEX ix_cheques_due ON cheques (status, due_date)`,
    `CREATE TRIGGER trg_cheques_valid BEFORE INSERT ON cheques
WHEN NOT EXISTS (SELECT 1 FROM money_documents d WHERE d.id = NEW.document_id AND d.method = 'cheque'
  AND ((NEW.direction = 'received' AND d.kind = 'receipt') OR (NEW.direction = 'issued' AND d.kind = 'payment')))
BEGIN SELECT RAISE(ABORT, 'cheque_mismatch'); END`,
    `CREATE TRIGGER trg_cheques_immutable BEFORE UPDATE ON cheques
WHEN NEW.document_id IS NOT OLD.document_id OR NEW.direction IS NOT OLD.direction OR NEW.cheque_number IS NOT OLD.cheque_number
  OR NEW.bank IS NOT OLD.bank OR NEW.due_date IS NOT OLD.due_date OR OLD.status IN ('cleared', 'bounced')
  OR (OLD.status = 'spent' AND NEW.status NOT IN ('spent', 'bounced', 'cleared'))
BEGIN SELECT RAISE(ABORT, 'document_immutable'); END`,
    `CREATE TRIGGER trg_cheques_no_delete BEFORE DELETE ON cheques
BEGIN SELECT RAISE(ABORT, 'document_immutable'); END`,
    `INSERT OR IGNORE INTO sequences (name, last_value) VALUES ('cheque', 0)`,
  ],
}
