import type { SqlExecutor, SqlRow } from '../../database/types'
import type { IsoDateTime, Money } from '../../models/common'
import type { Payment, PaymentInput } from '../../models/payment'
import { newId } from '../../utils/id'
import { nowIso } from '../../utils/time'
import type { PaymentRepository } from '../types'
import { baseFromRow, insertSql, num, str, strOrNull } from './helpers'

function fromRow(r: SqlRow): Payment {
  return {
    ...baseFromRow(r),
    salesInvoiceId: strOrNull(r, 'sales_invoice_id'),
    purchaseInvoiceId: strOrNull(r, 'purchase_invoice_id'),
    amount: num(r, 'amount'),
    paidAt: str(r, 'paid_at'),
    note: strOrNull(r, 'note'),
  }
}

export class SqlitePaymentRepository implements PaymentRepository {
  constructor(private readonly db: SqlExecutor) {}

  async create(input: PaymentInput & { paidAt: IsoDateTime }): Promise<Payment> {
    const id = newId()
    const now = nowIso()
    const { sql, params } = insertSql('payments', {
      id,
      sales_invoice_id: input.salesInvoiceId ?? null,
      purchase_invoice_id: input.purchaseInvoiceId ?? null,
      amount: input.amount,
      paid_at: input.paidAt,
      note: input.note ?? null,
      created_at: now,
      updated_at: now,
      is_active: 1,
      created_by: null,
    })
    await this.db.run(sql, params)
    return fromRow((await this.db.get('SELECT * FROM payments WHERE id = ?', [id])) as SqlRow)
  }

  private async list(column: string, invoiceId: string): Promise<Payment[]> {
    const rows = await this.db.all(`SELECT * FROM payments WHERE ${column} = ? AND is_active = 1 ORDER BY paid_at, created_at`, [invoiceId])
    return rows.map(fromRow)
  }
  private async total(column: string, invoiceId: string): Promise<Money> {
    const row = await this.db.get<{ total: number | null }>(`SELECT SUM(amount) AS total FROM payments WHERE ${column} = ? AND is_active = 1`, [invoiceId])
    return Number(row?.total ?? 0)
  }

  listForSalesInvoice(id: string) {
    return this.list('sales_invoice_id', id)
  }
  listForPurchaseInvoice(id: string) {
    return this.list('purchase_invoice_id', id)
  }
  totalForSalesInvoice(id: string) {
    return this.total('sales_invoice_id', id)
  }
  totalForPurchaseInvoice(id: string) {
    return this.total('purchase_invoice_id', id)
  }
}
