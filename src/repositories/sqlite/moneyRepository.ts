import type { SqlExecutor, SqlRow } from '../../database/types'
import type { IsoDateTime, Money } from '../../models/common'
import {
  MONEY_KIND_SIGN,
  paymentStatusOf,
  type InvoiceSettlement,
  type LedgerEntry,
  type LedgerEntryType,
  type MoneyDocument,
  type MoneyKind,
  type MoneyMethod,
  type MoneySource,
  type MoneyStatus,
  type PartyBalance,
  type Settlement,
} from '../../models/money'
import type { InvoiceKind } from '../../models/invoice'
import { newId } from '../../utils/id'
import { nowIso } from '../../utils/time'
import { SqliteSequenceRepository } from './sequenceRepository'
import { baseFromRow, insertSql, notFound, num, str, strOrNull } from './helpers'

function docFromRow(r: SqlRow): MoneyDocument {
  return {
    ...baseFromRow(r),
    kind: str(r, 'kind') as MoneyKind,
    docNumber: num(r, 'doc_number'),
    partyId: str(r, 'party_id'),
    amount: num(r, 'amount'),
    docDate: str(r, 'doc_date'),
    method: strOrNull(r, 'method') as MoneyMethod | null,
    note: strOrNull(r, 'note'),
    source: str(r, 'source') as MoneySource,
    sourceId: strOrNull(r, 'source_id'),
    requestId: strOrNull(r, 'request_id'),
    status: str(r, 'status') as MoneyStatus,
    cancelledAt: strOrNull(r, 'cancelled_at'),
    cancelReason: strOrNull(r, 'cancel_reason'),
  }
}

function settlementFromRow(r: SqlRow): Settlement {
  return {
    ...baseFromRow(r),
    documentId: str(r, 'document_id'),
    salesInvoiceId: strOrNull(r, 'sales_invoice_id'),
    purchaseInvoiceId: strOrNull(r, 'purchase_invoice_id'),
    amount: num(r, 'amount'),
  }
}

export interface MoneyDocumentInsert {
  kind: MoneyKind
  partyId: string
  amount: Money
  docDate: IsoDateTime
  method: MoneyMethod | null
  note: string | null
  source: MoneySource
  sourceId: string | null
  requestId: string | null
}

export interface MoneyListFilter {
  partyId?: string
  kinds?: MoneyKind[]
  status?: MoneyStatus
  limit?: number
}

const SEQUENCE: Record<MoneyKind, 'receipt' | 'payment' | 'opening'> = {
  receipt: 'receipt',
  payment: 'payment',
  opening_debit: 'opening',
  opening_credit: 'opening',
}

const INV = {
  sales: { table: 'sales_invoices', party: 'customer_id', col: 'sales_invoice_id', returns: 'sale_returns', refundSource: 'sale_return' },
  purchase: { table: 'purchase_invoices', party: 'supplier_id', col: 'purchase_invoice_id', returns: 'purchase_returns', refundSource: 'purchase_return' },
} as const

/** همه اثرهای فعال روی مانده طرف حساب (مثبت = طرف بدهکار) */
const ACTIVE_EFFECTS = `
SELECT customer_id AS party_id, total_amount AS delta FROM sales_invoices WHERE status = 'active'
UNION ALL SELECT i.customer_id, -r.total_amount FROM sale_returns r JOIN sales_invoices i ON i.id = r.sales_invoice_id WHERE r.status = 'active'
UNION ALL SELECT supplier_id, -total_amount FROM purchase_invoices WHERE status = 'active'
UNION ALL SELECT i.supplier_id, r.total_amount FROM purchase_returns r JOIN purchase_invoices i ON i.id = r.purchase_invoice_id WHERE r.status = 'active'
UNION ALL SELECT party_id, CASE WHEN kind IN ('payment', 'opening_debit') THEN amount ELSE -amount END FROM money_documents WHERE status = 'active'`

export class SqliteMoneyRepository {
  constructor(private readonly db: SqlExecutor) {}

  async insertDocument(input: MoneyDocumentInsert): Promise<MoneyDocument> {
    return this.db.transaction(async (tx) => {
      const number = await new SqliteSequenceRepository(tx).next(SEQUENCE[input.kind])
      const id = newId()
      const now = nowIso()
      const { sql, params } = insertSql('money_documents', {
        id,
        kind: input.kind,
        doc_number: number,
        party_id: input.partyId,
        amount: input.amount,
        doc_date: input.docDate,
        method: input.method,
        note: input.note,
        source: input.source,
        source_id: input.sourceId,
        request_id: input.requestId,
        status: 'active',
        created_at: now,
        updated_at: now,
        is_active: 1,
        created_by: null,
      })
      await tx.run(sql, params)
      return docFromRow((await tx.get('SELECT * FROM money_documents WHERE id = ?', [id])) as SqlRow)
    })
  }

  async insertSettlement(documentId: string, kind: InvoiceKind, invoiceId: string, amount: Money): Promise<void> {
    const now = nowIso()
    const { sql, params } = insertSql('settlements', {
      id: newId(),
      document_id: documentId,
      sales_invoice_id: kind === 'sales' ? invoiceId : null,
      purchase_invoice_id: kind === 'purchase' ? invoiceId : null,
      amount,
      created_at: now,
      updated_at: now,
      is_active: 1,
      created_by: null,
    })
    await this.db.run(sql, params)
  }

  async getDocument(id: string): Promise<MoneyDocument | null> {
    const row = await this.db.get('SELECT * FROM money_documents WHERE id = ?', [id])
    return row ? docFromRow(row) : null
  }

  async getByRequestId(requestId: string): Promise<MoneyDocument | null> {
    const row = await this.db.get('SELECT * FROM money_documents WHERE request_id = ?', [requestId])
    return row ? docFromRow(row) : null
  }

  async listDocuments(filter: MoneyListFilter = {}): Promise<MoneyDocument[]> {
    const where: string[] = []
    const params: (string | number)[] = []
    if (filter.partyId) {
      where.push('party_id = ?')
      params.push(filter.partyId)
    }
    if (filter.kinds?.length) {
      where.push(`kind IN (${filter.kinds.map(() => '?').join(', ')})`)
      params.push(...filter.kinds)
    }
    if (filter.status) {
      where.push('status = ?')
      params.push(filter.status)
    }
    let sql = `SELECT * FROM money_documents ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY doc_date DESC, created_at DESC`
    if (filter.limit) {
      sql += ' LIMIT ?'
      params.push(filter.limit)
    }
    return (await this.db.all(sql, params)).map(docFromRow)
  }

  /** اسناد خودکارِ یک سند مبدأ (فاکتور یا برگشت) */
  async listBySource(source: MoneySource, sourceId: string): Promise<MoneyDocument[]> {
    return (await this.db.all('SELECT * FROM money_documents WHERE source = ? AND source_id = ? ORDER BY created_at', [source, sourceId])).map(docFromRow)
  }

  async settlementsOfDocument(documentId: string): Promise<Settlement[]> {
    return (await this.db.all('SELECT * FROM settlements WHERE document_id = ? ORDER BY created_at', [documentId])).map(settlementFromRow)
  }

  /** دریافت/پرداخت‌های فعالی که به این فاکتور تخصیص یافته‌اند */
  async documentsForInvoice(kind: InvoiceKind, invoiceId: string): Promise<{ document: MoneyDocument; amount: Money }[]> {
    const c = INV[kind]
    const rows = await this.db.all(
      `SELECT d.*, s.amount AS settled_amount FROM settlements s JOIN money_documents d ON d.id = s.document_id
       WHERE s.${c.col} = ? ORDER BY d.doc_date, d.created_at`,
      [invoiceId],
    )
    return rows.map((r) => ({ document: docFromRow(r), amount: num(r, 'settled_amount') }))
  }

  async markCancelled(id: string, reason: string | null, at: IsoDateTime): Promise<void> {
    const result = await this.db.run("UPDATE money_documents SET status = 'cancelled', cancelled_at = ?, cancel_reason = ?, updated_at = ? WHERE id = ? AND status = 'active'", [
      at,
      reason,
      at,
      id,
    ])
    if (result.changes === 0) throw notFound('سند')
  }

  /** وضعیت پرداخت فاکتورها؛ برای فاکتور ابطال‌شده هم مقدار برمی‌گرداند ولی در مانده اثری ندارد */
  async invoiceSettlements(kind: InvoiceKind, invoiceIds: string[]): Promise<Map<string, InvoiceSettlement>> {
    const out = new Map<string, InvoiceSettlement>()
    const c = INV[kind]
    for (let i = 0; i < invoiceIds.length; i += 400) {
      const chunk = invoiceIds.slice(i, i + 400)
      if (!chunk.length) continue
      const rows = await this.db.all(
        `SELECT inv.id, inv.total_amount,
  COALESCE((SELECT SUM(r.total_amount) FROM ${c.returns} r WHERE r.${c.col} = inv.id AND r.status = 'active'), 0) AS returned,
  COALESCE((SELECT SUM(s.amount) FROM settlements s JOIN money_documents d ON d.id = s.document_id WHERE s.${c.col} = inv.id AND d.status = 'active'), 0) AS allocated,
  COALESCE((SELECT SUM(d.amount) FROM money_documents d JOIN ${c.returns} r ON r.id = d.source_id
            WHERE d.source = '${c.refundSource}' AND d.status = 'active' AND r.${c.col} = inv.id), 0) AS refunded
FROM ${c.table} inv WHERE inv.id IN (${chunk.map(() => '?').join(', ')})`,
        chunk,
      )
      for (const r of rows) {
        const total = num(r, 'total_amount')
        const returned = num(r, 'returned')
        const settled = num(r, 'allocated') - num(r, 'refunded')
        const net = total - returned
        out.set(str(r, 'id'), { invoiceId: str(r, 'id'), total, returned, settled, remaining: Math.max(0, net - settled), status: paymentStatusOf(net, settled) })
      }
    }
    return out
  }

  /** فاکتورهای فعال و تسویه‌نشده یک طرف حساب، قدیمی‌ترین اول */
  async openInvoices(kind: InvoiceKind, partyId: string): Promise<{ id: string; number: number; date: IsoDateTime; settlement: InvoiceSettlement }[]> {
    const c = INV[kind]
    const rows = await this.db.all(`SELECT id, invoice_number, invoice_date FROM ${c.table} WHERE ${c.party} = ? AND status = 'active' ORDER BY invoice_date, invoice_number`, [partyId])
    const settlements = await this.invoiceSettlements(kind, rows.map((r) => str(r, 'id')))
    return rows
      .map((r) => ({ id: str(r, 'id'), number: num(r, 'invoice_number'), date: str(r, 'invoice_date'), settlement: settlements.get(str(r, 'id'))! }))
      .filter((r) => r.settlement.remaining > 0)
  }

  async balanceOf(partyId: string): Promise<Money> {
    const row = await this.db.get<{ b: number | null }>(`SELECT SUM(delta) AS b FROM (${ACTIVE_EFFECTS}) WHERE party_id = ?`, [partyId])
    return Number(row?.b ?? 0)
  }

  /** مانده همه طرف‌هایی که مانده غیرصفر دارند */
  async balances(): Promise<PartyBalance[]> {
    const rows = await this.db.all(`SELECT party_id, SUM(delta) AS b FROM (${ACTIVE_EFFECTS}) GROUP BY party_id HAVING SUM(delta) <> 0`)
    return rows.map((r) => ({ partyId: str(r, 'party_id'), balance: num(r, 'b') }))
  }

  /** دفتر طرف حساب: همه اسناد (ابطال‌شده‌ها هم برای شفافیت، بدون اثر)، به ترتیب تاریخ با مانده جاری */
  async ledger(partyId: string): Promise<LedgerEntry[]> {
    const rows = await this.db.all(
      `SELECT 'sale' AS type, id, invoice_number AS number, invoice_date AS date, total_amount AS delta, status, NULL AS source, note, created_at FROM sales_invoices WHERE customer_id = ?
UNION ALL SELECT 'sale_return', r.id, r.return_number, r.doc_date, -r.total_amount, r.status, NULL, r.note, r.created_at FROM sale_returns r JOIN sales_invoices i ON i.id = r.sales_invoice_id WHERE i.customer_id = ?
UNION ALL SELECT 'purchase', id, invoice_number, invoice_date, -total_amount, status, NULL, note, created_at FROM purchase_invoices WHERE supplier_id = ?
UNION ALL SELECT 'purchase_return', r.id, r.return_number, r.doc_date, r.total_amount, r.status, NULL, r.note, r.created_at FROM purchase_returns r JOIN purchase_invoices i ON i.id = r.purchase_invoice_id WHERE i.supplier_id = ?
UNION ALL SELECT kind, id, doc_number, doc_date, amount, status, source, note, created_at FROM money_documents WHERE party_id = ?
ORDER BY date, created_at`,
      [partyId, partyId, partyId, partyId, partyId],
    )
    let balance = 0
    return rows.map((r) => {
      const type = str(r, 'type') as LedgerEntryType
      const raw = num(r, 'delta')
      const delta = type in MONEY_KIND_SIGN ? raw * MONEY_KIND_SIGN[type as MoneyKind] : raw
      const status = str(r, 'status') as MoneyStatus
      if (status === 'active') balance += delta
      return {
        type,
        id: str(r, 'id'),
        number: num(r, 'number'),
        date: str(r, 'date'),
        delta,
        status,
        source: strOrNull(r, 'source') as MoneySource | null,
        note: strOrNull(r, 'note'),
        balance,
      }
    })
  }
}

export type MoneyRepository = SqliteMoneyRepository
