import type { SqlExecutor } from '../../database/types'
import type { ExpenseCategory } from '../../models/expense'
import type { CostMethod } from '../../models/settings'
import type { DateRange, ExpenseTotal, ProductSalesRow, PurchaseTotals, ReportRepository, SalesTotals, StockLossTotals } from '../types'
import { num, str } from './helpers'

/** نام ستون بها از فهرست ثابت انتخاب می‌شود (هرگز از ورودی کاربر) */
const COST_COLUMN: Record<CostMethod, string> = { fifo: 'cost_fifo', average: 'cost_average', last: 'cost_last' }

function costColumn(method: CostMethod): string {
  const col = COST_COLUMN[method]
  if (!col) throw new Error(`unknown cost method ${String(method)}`)
  return col
}

export class SqliteReportRepository implements ReportRepository {
  constructor(private readonly db: SqlExecutor) {}

  async salesTotals(range: DateRange, method: CostMethod): Promise<SalesTotals> {
    const head = await this.db.get(
      `SELECT COUNT(*) AS n, COALESCE(SUM(subtotal_amount), 0) AS subtotal, COALESCE(SUM(discount), 0) AS discount, COALESCE(SUM(total_amount), 0) AS total
       FROM sales_invoices WHERE status = 'active' AND invoice_date >= ? AND invoice_date < ?`,
      [range.from, range.to],
    )
    const lines = await this.db.get(
      `SELECT COALESCE(SUM(i.discount), 0) AS line_discount, COALESCE(SUM(i.${costColumn(method)}), 0) AS cost
       FROM sales_items i JOIN sales_invoices s ON s.id = i.invoice_id
       WHERE s.status = 'active' AND s.invoice_date >= ? AND s.invoice_date < ?`,
      [range.from, range.to],
    )
    const lineDiscount = num(lines ?? {}, 'line_discount') || 0
    const subtotal = num(head ?? {}, 'subtotal') || 0
    const invoiceDiscount = num(head ?? {}, 'discount') || 0
    return {
      invoiceCount: num(head ?? {}, 'n') || 0,
      gross: subtotal + lineDiscount,
      discounts: lineDiscount + invoiceDiscount,
      net: num(head ?? {}, 'total') || 0,
      cost: num(lines ?? {}, 'cost') || 0,
    }
  }

  async purchaseTotals(range: DateRange): Promise<PurchaseTotals> {
    const row = await this.db.get(
      `SELECT COUNT(*) AS n, COALESCE(SUM(total_amount), 0) AS total FROM purchase_invoices
       WHERE status = 'active' AND invoice_date >= ? AND invoice_date < ?`,
      [range.from, range.to],
    )
    return { invoiceCount: num(row ?? {}, 'n') || 0, total: num(row ?? {}, 'total') || 0 }
  }

  async stockLossTotals(range: DateRange, method: CostMethod): Promise<StockLossTotals> {
    const rows = await this.db.all(
      `SELECT movement_type AS t, COUNT(*) AS n, COALESCE(SUM(${costColumn(method)}), 0) AS cost FROM stock_movements
       WHERE movement_type IN ('shortage', 'waste') AND occurred_at >= ? AND occurred_at < ? GROUP BY movement_type`,
      [range.from, range.to],
    )
    const surplus = await this.db.get(
      `SELECT COUNT(*) AS n, COALESCE(SUM(l.total_cost), 0) AS cost FROM stock_movements m JOIN cost_lots l ON l.movement_id = m.id
       WHERE m.movement_type = 'adjustment' AND m.occurred_at >= ? AND m.occurred_at < ?`,
      [range.from, range.to],
    )
    const pick = (t: string) => {
      const r = rows.find((x) => str(x, 't') === t)
      return { count: r ? num(r, 'n') : 0, cost: r ? num(r, 'cost') : 0 }
    }
    return { shortage: pick('shortage'), waste: pick('waste'), surplus: { count: num(surplus ?? {}, 'n') || 0, cost: num(surplus ?? {}, 'cost') || 0 } }
  }

  async expenseTotals(range: DateRange): Promise<ExpenseTotal[]> {
    const rows = await this.db.all(
      `SELECT category, COUNT(*) AS n, COALESCE(SUM(amount), 0) AS amount FROM expenses
       WHERE status = 'active' AND expense_date >= ? AND expense_date < ? GROUP BY category`,
      [range.from, range.to],
    )
    return rows.map((r) => ({ category: str(r, 'category') as ExpenseCategory, amount: num(r, 'amount'), count: num(r, 'n') }))
  }

  async productSales(range: DateRange, method: CostMethod): Promise<ProductSalesRow[]> {
    const rows = await this.db.all(
      `SELECT i.product_id AS product_id, SUM(i.quantity) AS qty, SUM(i.line_total - i.invoice_discount_share) AS sales, SUM(i.${costColumn(method)}) AS cost
       FROM sales_items i JOIN sales_invoices s ON s.id = i.invoice_id
       WHERE s.status = 'active' AND s.invoice_date >= ? AND s.invoice_date < ?
       GROUP BY i.product_id`,
      [range.from, range.to],
    )
    return rows.map((r) => ({ productId: str(r, 'product_id'), quantity: num(r, 'qty'), sales: num(r, 'sales'), cost: num(r, 'cost') }))
  }
}
