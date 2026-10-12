import type { Migration } from './types'

/**
 * Migration 006 — طرف حساب واحد (parties)، اسناد دریافت/پرداخت/مانده اول دوره (money_documents) و تخصیص به فاکتور (settlements).
 * طراحی کامل: docs/parties-and-money.md
 *
 * - customers و suppliers با همان شناسه‌ها به parties منتقل و حذف می‌شوند (UUID؛ تداخل ندارند).
 * - فاکتورهای فروش/خرید بازسازی می‌شوند تا به parties ارجاع دهند (ستون‌ها و داده بدون تغییر).
 * - ردیف‌های جدول قدیمی payments (همه نقدی) به اسناد خودکار + تخصیص تبدیل می‌شوند؛ برگشت‌های قبلی استرداد خودکار می‌گیرند،
 *   پس مانده همه طرف‌ها پس از ارتقا صفر است. payments فقط برای تاریخچه می‌ماند.
 */

const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')"

const STD = `
  created_at TEXT NOT NULL DEFAULT (${NOW}),
  updated_at TEXT NOT NULL DEFAULT (${NOW}),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_by TEXT`

const STD_COLS = 'created_at, updated_at, is_active, created_by'

const SQL_UUID = `lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))`

const INVOICE_COLS = `id, invoice_number, reference, invoice_date, warehouse_id, subtotal_amount, discount, total_amount, status, cancelled_at, cancel_reason, note`

function invoiceTable(table: string, partyCol: string): string {
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
  ${partyCol} TEXT NOT NULL REFERENCES parties (id),${STD},
  CHECK ((status = 'cancelled') = (cancelled_at IS NOT NULL)),
  CHECK (discount <= subtotal_amount),
  CHECK (total_amount = subtotal_amount - discount)
)`
}

function rebuildInvoice(table: string, items: string, partyCol: string, prefix: string): string[] {
  return [
    `DROP TRIGGER IF EXISTS trg_${table}_immutable`,
    `DROP TRIGGER IF EXISTS trg_${table}_no_delete`,
    `DROP TRIGGER IF EXISTS trg_${items}_only_active`,
    invoiceTable(table, partyCol),
    `INSERT INTO ${table}_new (${INVOICE_COLS}, ${partyCol}, ${STD_COLS}) SELECT ${INVOICE_COLS}, ${partyCol}, ${STD_COLS} FROM ${table}`,
    `DROP TABLE ${table}`,
    `ALTER TABLE ${table}_new RENAME TO ${table}`,
    `CREATE UNIQUE INDEX ux_${prefix}_number ON ${table} (invoice_number)`,
    `CREATE INDEX ix_${prefix}_date ON ${table} (invoice_date)`,
    `CREATE INDEX ix_${prefix}_warehouse ON ${table} (warehouse_id)`,
    `CREATE INDEX ix_${prefix}_${partyCol === 'customer_id' ? 'customer' : 'supplier'} ON ${table} (${partyCol})`,
    `CREATE TRIGGER trg_${table}_immutable BEFORE UPDATE ON ${table}
WHEN OLD.status = 'cancelled'
  OR NEW.invoice_number IS NOT OLD.invoice_number
  OR NEW.invoice_date IS NOT OLD.invoice_date
  OR NEW.${partyCol} IS NOT OLD.${partyCol}
  OR NEW.warehouse_id IS NOT OLD.warehouse_id
  OR NEW.subtotal_amount IS NOT OLD.subtotal_amount
  OR NEW.discount IS NOT OLD.discount
  OR NEW.total_amount IS NOT OLD.total_amount
BEGIN SELECT RAISE(ABORT, 'document_immutable'); END`,
    `CREATE TRIGGER trg_${table}_no_delete BEFORE DELETE ON ${table}
BEGIN SELECT RAISE(ABORT, 'document_immutable'); END`,
    `CREATE TRIGGER trg_${items}_only_active BEFORE INSERT ON ${items}
WHEN (SELECT status FROM ${table} WHERE id = NEW.invoice_id) = 'cancelled'
BEGIN SELECT RAISE(ABORT, 'document_immutable'); END`,
    `CREATE TRIGGER trg_${table}_party_role BEFORE INSERT ON ${table}
WHEN NOT EXISTS (SELECT 1 FROM parties WHERE id = NEW.${partyCol} AND ${partyCol === 'customer_id' ? 'is_customer' : 'is_supplier'} = 1)
BEGIN SELECT RAISE(ABORT, 'party_wrong_role'); END`,
  ]
}

/** تبدیل payments قدیمی به سند خودکار (kind/source/جدول فاکتور) */
function migratePayments(kind: 'receipt' | 'payment', invoiceCol: 'sales_invoice_id' | 'purchase_invoice_id', invoiceTable: string, partyCol: string, source: string): string[] {
  return [
    `INSERT INTO money_documents (id, kind, doc_number, party_id, amount, doc_date, method, note, source, source_id, status, cancelled_at, cancel_reason, ${STD_COLS})
SELECT p.id, '${kind}', 0, i.${partyCol}, p.amount, p.paid_at, 'cash', p.note, '${source}', i.id, i.status, i.cancelled_at,
  CASE WHEN i.status = 'cancelled' THEN 'ابطال فاکتور' END, p.created_at, p.updated_at, 1, p.created_by
FROM payments p JOIN ${invoiceTable} i ON i.id = p.${invoiceCol} WHERE p.is_active = 1`,
    `INSERT INTO settlements (id, document_id, ${invoiceCol}, amount, ${STD_COLS})
SELECT ${SQL_UUID}, p.id, p.${invoiceCol}, p.amount, p.created_at, p.updated_at, 1, p.created_by
FROM payments p JOIN money_documents d ON d.id = p.id WHERE p.${invoiceCol} IS NOT NULL`,
  ]
}

/** استرداد خودکار برای برگشت‌های قبلی (نسخه قبل همه نقدی بود) */
function migrateReturnRefunds(kind: 'receipt' | 'payment', returns: string, invoiceCol: string, invoiceTable: string, partyCol: string, source: string): string {
  return `INSERT INTO money_documents (id, kind, doc_number, party_id, amount, doc_date, method, note, source, source_id, status, cancelled_at, cancel_reason, ${STD_COLS})
SELECT ${SQL_UUID}, '${kind}', 0, i.${partyCol}, r.total_amount, r.doc_date, 'cash', 'استرداد برگشت', '${source}', r.id, r.status, r.cancelled_at,
  CASE WHEN r.status = 'cancelled' THEN 'ابطال برگشت' END, r.created_at, r.updated_at, 1, r.created_by
FROM ${returns} r JOIN ${invoiceTable} i ON i.id = r.${invoiceCol} WHERE r.total_amount > 0`
}

/** شماره‌گذاری اسناد منتقل‌شده به ترتیب تاریخ و تنظیم شمارنده */
function numberDocs(kind: string): string[] {
  return [
    `UPDATE money_documents SET doc_number = (
  SELECT COUNT(*) FROM money_documents d2 WHERE d2.kind = money_documents.kind
    AND (d2.doc_date < money_documents.doc_date OR (d2.doc_date = money_documents.doc_date AND d2.id <= money_documents.id))
) WHERE kind = '${kind}'`,
    `INSERT INTO sequences (name, last_value) VALUES ('${kind}', (SELECT COUNT(*) FROM money_documents WHERE kind = '${kind}'))`,
  ]
}

export const migration006: Migration = {
  version: 6,
  name: 'parties, receipts/payments, settlements',
  statements: [
    // ---- ۱) طرف حساب واحد
    `CREATE TABLE parties (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  phone TEXT,
  address TEXT,
  description TEXT,
  is_customer INTEGER NOT NULL DEFAULT 0 CHECK (is_customer IN (0, 1)),
  is_supplier INTEGER NOT NULL DEFAULT 0 CHECK (is_supplier IN (0, 1)),
  is_system INTEGER NOT NULL DEFAULT 0 CHECK (is_system IN (0, 1)),${STD},
  CHECK (is_customer = 1 OR is_supplier = 1)
)`,
    `INSERT INTO parties (id, name, phone, address, description, is_customer, is_supplier, is_system, ${STD_COLS})
SELECT id, name, phone, address, description, 1, 0, is_system, ${STD_COLS} FROM customers`,
    `INSERT INTO parties (id, name, phone, address, description, is_customer, is_supplier, is_system, ${STD_COLS})
SELECT id, name, phone, address, description, 0, 1, is_system, ${STD_COLS} FROM suppliers`,
    `CREATE INDEX ix_parties_name ON parties (name)`,

    // ---- ۲) فاکتورها → parties
    ...rebuildInvoice('sales_invoices', 'sales_items', 'customer_id', 'sales'),
    ...rebuildInvoice('purchase_invoices', 'purchase_items', 'supplier_id', 'purchase'),
    `DROP TRIGGER IF EXISTS trg_customers_system_update`,
    `DROP TRIGGER IF EXISTS trg_customers_system_delete`,
    `DROP TRIGGER IF EXISTS trg_suppliers_system_update`,
    `DROP TRIGGER IF EXISTS trg_suppliers_system_delete`,
    `DROP TABLE customers`,
    `DROP TABLE suppliers`,
    `CREATE TRIGGER trg_parties_system_update BEFORE UPDATE ON parties
WHEN OLD.is_system = 1 AND (NEW.is_active = 0 OR NEW.is_system = 0 OR NEW.is_customer <> OLD.is_customer OR NEW.is_supplier <> OLD.is_supplier)
BEGIN SELECT RAISE(ABORT, 'system_row_protected'); END`,
    `CREATE TRIGGER trg_parties_system_delete BEFORE DELETE ON parties
WHEN OLD.is_system = 1
BEGIN SELECT RAISE(ABORT, 'system_row_protected'); END`,
    // نقش طرفی که سند دارد برداشته نمی‌شود
    `CREATE TRIGGER trg_parties_role_in_use BEFORE UPDATE OF is_customer, is_supplier ON parties
WHEN (OLD.is_customer = 1 AND NEW.is_customer = 0 AND EXISTS (SELECT 1 FROM sales_invoices WHERE customer_id = OLD.id))
  OR (OLD.is_supplier = 1 AND NEW.is_supplier = 0 AND EXISTS (SELECT 1 FROM purchase_invoices WHERE supplier_id = OLD.id))
BEGIN SELECT RAISE(ABORT, 'party_role_in_use'); END`,

    // ---- ۳) اسناد مالی
    `CREATE TABLE money_documents (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('receipt', 'payment', 'opening_debit', 'opening_credit')),
  doc_number INTEGER NOT NULL,
  party_id TEXT NOT NULL REFERENCES parties (id),
  amount INTEGER NOT NULL CHECK (amount > 0 AND amount <= 1000000000000000),
  doc_date TEXT NOT NULL,
  method TEXT CHECK (method IN ('cash', 'card', 'transfer', 'cheque', 'other')),
  note TEXT,
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'sale', 'purchase', 'sale_return', 'purchase_return')),
  source_id TEXT,
  request_id TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cancelled')),
  cancelled_at TEXT,
  cancel_reason TEXT,${STD},
  CHECK ((status = 'cancelled') = (cancelled_at IS NOT NULL)),
  CHECK ((kind IN ('opening_debit', 'opening_credit')) = (method IS NULL)),
  CHECK ((source = 'manual') = (source_id IS NULL))
)`,
    `CREATE UNIQUE INDEX ux_money_request ON money_documents (request_id) WHERE request_id IS NOT NULL`,
    `CREATE INDEX ix_money_party ON money_documents (party_id, doc_date)`,
    `CREATE INDEX ix_money_source ON money_documents (source, source_id)`,
    `CREATE INDEX ix_money_kind_number ON money_documents (kind, doc_number)`,
    `CREATE TRIGGER trg_money_no_delete BEFORE DELETE ON money_documents
BEGIN SELECT RAISE(ABORT, 'document_immutable'); END`,

    // ---- ۴) تخصیص
    `CREATE TABLE settlements (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES money_documents (id),
  sales_invoice_id TEXT REFERENCES sales_invoices (id),
  purchase_invoice_id TEXT REFERENCES purchase_invoices (id),
  amount INTEGER NOT NULL CHECK (amount > 0),${STD},
  CHECK ((sales_invoice_id IS NULL) <> (purchase_invoice_id IS NULL))
)`,
    `CREATE INDEX ix_settlements_doc ON settlements (document_id)`,
    `CREATE INDEX ix_settlements_sales ON settlements (sales_invoice_id)`,
    `CREATE INDEX ix_settlements_purchase ON settlements (purchase_invoice_id)`,
    `CREATE TRIGGER trg_settlements_no_update BEFORE UPDATE ON settlements
BEGIN SELECT RAISE(ABORT, 'document_immutable'); END`,
    `CREATE TRIGGER trg_settlements_no_delete BEFORE DELETE ON settlements
BEGIN SELECT RAISE(ABORT, 'document_immutable'); END`,

    // ---- ۵) انتقال payments قدیمی و استرداد برگشت‌ها
    ...migratePayments('receipt', 'sales_invoice_id', 'sales_invoices', 'customer_id', 'sale'),
    ...migratePayments('payment', 'purchase_invoice_id', 'purchase_invoices', 'supplier_id', 'purchase'),
    migrateReturnRefunds('payment', 'sale_returns', 'sales_invoice_id', 'sales_invoices', 'customer_id', 'sale_return'),
    migrateReturnRefunds('receipt', 'purchase_returns', 'purchase_invoice_id', 'purchase_invoices', 'supplier_id', 'purchase_return'),
    ...numberDocs('receipt'),
    ...numberDocs('payment'),
    `INSERT INTO sequences (name, last_value) VALUES ('opening', 0)`,

    `CREATE TRIGGER trg_money_immutable BEFORE UPDATE ON money_documents
WHEN OLD.status = 'cancelled'
  OR NEW.kind IS NOT OLD.kind OR NEW.doc_number IS NOT OLD.doc_number OR NEW.party_id IS NOT OLD.party_id
  OR NEW.amount IS NOT OLD.amount OR NEW.doc_date IS NOT OLD.doc_date OR NEW.method IS NOT OLD.method
  OR NEW.source IS NOT OLD.source OR NEW.source_id IS NOT OLD.source_id OR NEW.created_at IS NOT OLD.created_at
BEGIN SELECT RAISE(ABORT, 'document_immutable'); END`,
    // Triggerهای درج تخصیص بعد از انتقال (داده قدیمی همه سازگار است)
    `CREATE TRIGGER trg_settlements_valid BEFORE INSERT ON settlements
WHEN NOT EXISTS (
  SELECT 1 FROM money_documents d
  LEFT JOIN sales_invoices s ON s.id = NEW.sales_invoice_id
  LEFT JOIN purchase_invoices p ON p.id = NEW.purchase_invoice_id
  WHERE d.id = NEW.document_id AND d.status = 'active'
    AND ((d.kind = 'receipt' AND s.id IS NOT NULL AND s.status = 'active' AND s.customer_id = d.party_id)
      OR (d.kind = 'payment' AND p.id IS NOT NULL AND p.status = 'active' AND p.supplier_id = d.party_id))
)
BEGIN SELECT RAISE(ABORT, 'settlement_invalid'); END`,
    `CREATE TRIGGER trg_settlements_doc_limit BEFORE INSERT ON settlements
WHEN NEW.amount + COALESCE((
  SELECT SUM(s.amount) FROM settlements s
  LEFT JOIN sales_invoices si ON si.id = s.sales_invoice_id
  LEFT JOIN purchase_invoices pi ON pi.id = s.purchase_invoice_id
  WHERE s.document_id = NEW.document_id AND COALESCE(si.status, pi.status) = 'active'), 0)
  > (SELECT amount FROM money_documents WHERE id = NEW.document_id)
BEGIN SELECT RAISE(ABORT, 'settlement_exceeds'); END`,
  ],
}
