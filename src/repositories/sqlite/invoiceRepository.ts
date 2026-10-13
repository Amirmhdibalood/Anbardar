import type { SqlExecutor, SqlRow, SqlValue } from '../../database/types'
import type { IsoDateTime } from '../../models/common'
import type { InvoiceFilter, InvoiceInput, InvoiceItem, InvoiceStatus, PurchaseCharge, PurchaseInvoice, SalesInvoice } from '../../models/invoice'
import { prepareInvoice, type PreparedInvoice } from '../../utils/invoiceMath'
import { newId } from '../../utils/id'
import { nowIso } from '../../utils/time'
import type { InvoiceRepository, InvoiceWithItems, SequenceName } from '../types'
import { SqliteSequenceRepository } from './sequenceRepository'
import { baseFromRow, insertSql, notFound, num, str, strOrNull } from './helpers'

interface InvoiceConfig {
  table: string
  itemsTable: string
  partyColumn: 'customer_id' | 'supplier_id'
  sequence: SequenceName
  label: string
}

const SALES: InvoiceConfig = { table: 'sales_invoices', itemsTable: 'sales_items', partyColumn: 'customer_id', sequence: 'sales_invoice', label: 'فاکتور فروش' }
const PURCHASE: InvoiceConfig = { table: 'purchase_invoices', itemsTable: 'purchase_items', partyColumn: 'supplier_id', sequence: 'purchase_invoice', label: 'فاکتور خرید' }

function itemFromRow(r: SqlRow): InvoiceItem {
  return {
    ...baseFromRow(r),
    invoiceId: str(r, 'invoice_id'),
    productId: str(r, 'product_id'),
    quantity: num(r, 'quantity'),
    unitId: strOrNull(r, 'unit_id'),
    unitFactor: r['unit_factor'] === undefined || r['unit_factor'] === null ? 1000 : num(r, 'unit_factor'),
    unitQuantity: r['unit_quantity'] === undefined || r['unit_quantity'] === null ? num(r, 'quantity') : num(r, 'unit_quantity'),
    unitPrice: num(r, 'unit_price'),
    priceMode: r['price_mode'] === 'total' ? 'total' : 'unit',
    grossAmount: r['gross_amount'] === undefined || r['gross_amount'] === null ? num(r, 'line_total') + num(r, 'discount') : num(r, 'gross_amount'),
    landedShare: r['landed_share'] === undefined || r['landed_share'] === null ? 0 : num(r, 'landed_share'),
    discount: num(r, 'discount'),
    lineTotal: num(r, 'line_total'),
    invoiceDiscountShare: num(r, 'invoice_discount_share'),
    note: strOrNull(r, 'note'),
    costs: r['cost_fifo'] === undefined ? null : { fifo: num(r, 'cost_fifo'), average: num(r, 'cost_average'), last: num(r, 'cost_last') },
  }
}

function headerFromRow(r: SqlRow) {
  return {
    ...baseFromRow(r),
    invoiceNumber: num(r, 'invoice_number'),
    reference: strOrNull(r, 'reference'),
    invoiceDate: str(r, 'invoice_date'),
    warehouseId: str(r, 'warehouse_id'),
    subtotalAmount: num(r, 'subtotal_amount'),
    discount: num(r, 'discount'),
    totalAmount: num(r, 'total_amount'),
    status: str(r, 'status') as InvoiceStatus,
    cancelledAt: strOrNull(r, 'cancelled_at'),
    cancelReason: strOrNull(r, 'cancel_reason'),
    note: strOrNull(r, 'note'),
  }
}

class SqliteInvoiceRepository<I> implements InvoiceRepository<I> {
  constructor(
    private readonly db: SqlExecutor,
    private readonly cfg: InvoiceConfig,
    private readonly map: (r: SqlRow) => I,
  ) {}

  create(input: InvoiceInput): Promise<InvoiceWithItems<I>> {
    return this.insertPrepared(input, prepareInvoice(input))
  }

  insertPrepared(input: InvoiceInput, prepared: PreparedInvoice): Promise<InvoiceWithItems<I>> {
    // سربرگ، ردیف‌ها و شماره‌گذاری یا کاملاً ثبت می‌شوند یا هیچ‌کدام
    return this.db.transaction(async (tx) => {
      // شمارنده باید روی همین تراکنش اجرا شود (نه روی اتصال اصلی) وگرنه منتظر پایان تراکنش می‌ماند
      const number = await new SqliteSequenceRepository(tx).next(this.cfg.sequence)
      const now = nowIso()
      const header = insertSql(this.cfg.table, {
        id: prepared.id,
        invoice_number: number,
        reference: input.reference ?? null,
        invoice_date: input.invoiceDate ?? now,
        warehouse_id: input.warehouseId,
        subtotal_amount: prepared.subtotal,
        discount: prepared.discount,
        total_amount: prepared.total,
        status: 'active',
        note: input.note ?? null,
        ...(this.cfg.table === 'purchase_invoices' ? { landed_total: prepared.landedTotal, landed_method: prepared.landedMethod } : {}),
        [this.cfg.partyColumn]: input.partyId,
        created_at: now,
        updated_at: now,
        is_active: 1,
        created_by: null,
      })
      await tx.run(header.sql, header.params)

      for (const [lineNo, line] of prepared.lines.entries()) {
        const costs: Record<string, number> =
          this.cfg.itemsTable === 'sales_items'
            ? { cost_fifo: line.costs?.fifo ?? 0, cost_average: line.costs?.average ?? 0, cost_last: line.costs?.last ?? 0 }
            : { landed_share: line.landedShare }
        const row = insertSql(this.cfg.itemsTable, {
          id: line.id,
          invoice_id: prepared.id,
          product_id: line.productId,
          quantity: line.quantity,
          unit_id: line.unitId,
          unit_factor: line.unitFactor,
          unit_quantity: line.unitQuantity,
          unit_price: line.unitPrice,
          price_mode: line.priceMode,
          gross_amount: line.grossAmount,
          discount: line.discount,
          line_total: line.lineTotal,
          invoice_discount_share: line.invoiceDiscountShare,
          line_no: lineNo + 1,
          ...costs,
          note: line.note,
          created_at: now,
          updated_at: now,
          is_active: 1,
          created_by: null,
        })
        await tx.run(row.sql, row.params)
      }
      if (this.cfg.table === 'purchase_invoices') {
        for (const [i, c] of (input.charges ?? []).entries()) {
          const row = insertSql('purchase_charges', { id: newId(), invoice_id: prepared.id, title: c.title, amount: c.amount, line_no: i + 1, created_at: now, updated_at: now, is_active: 1, created_by: null })
          await tx.run(row.sql, row.params)
        }
      }
      const invoice = await this.getByIdWith(tx, prepared.id)
      if (!invoice) throw notFound(this.cfg.label)
      return { invoice, items: await this.getItemsWith(tx, prepared.id) }
    })
  }

  /** آخرین قیمت «هر واحد پایه» (برای واحد فرعی: × ضریب ÷ ۱۰۰۰) */
  async lastUnitPrice(productId: string): Promise<number | null> {
    const row = await this.db.get<{ unit_price: number }>(
      `SELECT CASE WHEN it.unit_factor = 1000 AND it.price_mode = 'unit' THEN it.unit_price
              ELSE (it.gross_amount * 1000 * 2 + it.quantity) / (it.quantity * 2) END AS unit_price FROM ${this.cfg.itemsTable} it JOIN ${this.cfg.table} i ON i.id = it.invoice_id
       WHERE it.product_id = ? AND i.status = 'active' ORDER BY i.invoice_date DESC, i.created_at DESC, i.invoice_number DESC LIMIT 1`,
      [productId],
    )
    return row ? Number(row.unit_price) : null
  }

  private async getByIdWith(db: SqlExecutor, id: string): Promise<I | null> {
    const row = await db.get(`SELECT * FROM ${this.cfg.table} WHERE id = ?`, [id])
    return row ? this.map(row) : null
  }

  private async getItemsWith(db: SqlExecutor, invoiceId: string): Promise<InvoiceItem[]> {
    const rows = await db.all(`SELECT * FROM ${this.cfg.itemsTable} WHERE invoice_id = ? ORDER BY line_no, created_at, id`, [invoiceId])
    return rows.map(itemFromRow)
  }

  getById(id: string) {
    return this.getByIdWith(this.db, id)
  }

  async getByNumber(invoiceNumber: number): Promise<I | null> {
    const row = await this.db.get(`SELECT * FROM ${this.cfg.table} WHERE invoice_number = ?`, [invoiceNumber])
    return row ? this.map(row) : null
  }

  getItems(invoiceId: string) {
    return this.getItemsWith(this.db, invoiceId)
  }

  async list(filter: InvoiceFilter = {}): Promise<I[]> {
    const where: string[] = []
    const params: SqlValue[] = []
    const add = (clause: string, value: string | undefined) => {
      if (value) {
        where.push(clause)
        params.push(value)
      }
    }
    add('invoice_date >= ?', filter.from)
    add('invoice_date <= ?', filter.to)
    add(`${this.cfg.partyColumn} = ?`, filter.partyId)
    add('warehouse_id = ?', filter.warehouseId)
    add('status = ?', filter.status)
    if (filter.invoiceNumber !== undefined) {
      where.push('invoice_number = ?')
      params.push(filter.invoiceNumber)
    }
    if (filter.text) {
      const ors = ["COALESCE(reference, '') LIKE ? ESCAPE '\\'"]
      params.push(`%${filter.text.reference.replace(/[\\%_]/g, (c) => '\\' + c)}%`)
      if (filter.text.partyIds.length) {
        ors.push(`${this.cfg.partyColumn} IN (${filter.text.partyIds.map(() => '?').join(', ')})`)
        params.push(...filter.text.partyIds)
      }
      where.push(`(${ors.join(' OR ')})`)
    }
    let sql = `SELECT * FROM ${this.cfg.table} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY invoice_date DESC, invoice_number DESC`
    if (filter.limit !== undefined) {
      sql += ' LIMIT ? OFFSET ?'
      params.push(filter.limit, filter.offset ?? 0)
    }
    const rows = await this.db.all(sql, params)
    return rows.map((r) => this.map(r))
  }

  async itemCounts(invoiceIds: readonly string[]): Promise<Record<string, number>> {
    if (invoiceIds.length === 0) return {}
    const rows = await this.db.all(
      `SELECT invoice_id, COUNT(*) AS n FROM ${this.cfg.itemsTable} WHERE invoice_id IN (${invoiceIds.map(() => '?').join(', ')}) GROUP BY invoice_id`,
      [...invoiceIds],
    )
    return Object.fromEntries(rows.map((r) => [str(r, 'invoice_id'), num(r, 'n')]))
  }

  async findTotalMismatches(): Promise<string[]> {
    const rows = await this.db.all<{ id: string }>(
      `SELECT i.id AS id FROM ${this.cfg.table} i
       WHERE i.subtotal_amount <> COALESCE((SELECT SUM(line_total) FROM ${this.cfg.itemsTable} WHERE invoice_id = i.id), 0)`,
    )
    return rows.map((r) => String(r.id))
  }

  async getCharges(invoiceId: string): Promise<PurchaseCharge[]> {
    if (this.cfg.table !== 'purchase_invoices') return []
    const rows = await this.db.all('SELECT id, title, amount FROM purchase_charges WHERE invoice_id = ? ORDER BY line_no, id', [invoiceId])
    return rows.map((r) => ({ id: str(r, 'id'), title: str(r, 'title'), amount: num(r, 'amount') }))
  }

  async markCancelled(id: string, reason: string | null, at: IsoDateTime): Promise<void> {
    const result = await this.db.run(
      `UPDATE ${this.cfg.table} SET status = 'cancelled', cancelled_at = ?, cancel_reason = ?, updated_at = ? WHERE id = ?`,
      [at, reason, nowIso(), id],
    )
    if (result.changes === 0) throw notFound(this.cfg.label)
  }
}

export function createSalesInvoiceRepository(db: SqlExecutor) {
  return new SqliteInvoiceRepository<SalesInvoice>(db, SALES, (r) => ({ ...headerFromRow(r), customerId: str(r, 'customer_id') }))
}

export function createPurchaseInvoiceRepository(db: SqlExecutor) {
  return new SqliteInvoiceRepository<PurchaseInvoice>(db, PURCHASE, (r) => ({
    ...headerFromRow(r),
    supplierId: str(r, 'supplier_id'),
    landedTotal: r['landed_total'] == null ? 0 : num(r, 'landed_total'),
    landedMethod: r['landed_method'] === 'quantity' ? 'quantity' : 'value',
  }))
}
