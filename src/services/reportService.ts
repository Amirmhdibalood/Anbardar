import type { SqlExecutor } from '../database/types'
import type { Product } from '../models/catalog'
import type { Money } from '../models/common'
import { EXPENSE_CATEGORIES, type ExpenseCategory } from '../models/expense'
import type { CostMethod } from '../models/settings'
import { createRepositories } from '../repositories'
import type { DateRange, SalesTotals } from '../repositories'
import { compareFa } from '../utils/collate'
import { createStockService, type StockRow } from './inventoryService'

/**
 * گزارش‌ها (فقط خواندن). همه مبلغ‌ها تومان و عدد صحیح‌اند و فقط اسناد «فعال» (ابطال‌نشده) شمرده می‌شوند.
 *
 * سود و زیان (بر پایه بهای کالای فروش‌رفته، نه خرید):
 *   فروش خالص − بهای تمام‌شده کالای فروش‌رفته = سود ناخالص
 *   سود ناخالص − کسری − ضایعات / خرابی + اضافه در شمارش − هزینه‌های جاری = سود (زیان) خالص
 *
 * درآمد در برابر هزینه (نقدی): دریافتی فروش در برابر پرداختی خرید کالا + هزینه‌های جاری.
 */

export interface ExpenseLine {
  category: ExpenseCategory
  amount: Money
  count: number
}

export interface ProfitLoss {
  method: CostMethod
  sales: SalesTotals
  /** فروش خالص (مبلغ دریافتی) */
  revenue: Money
  /** بهای تمام‌شده کالای فروش‌رفته */
  cogs: Money
  grossProfit: Money
  shortage: { count: number; cost: Money }
  waste: { count: number; cost: Money }
  surplus: { count: number; cost: Money }
  /** هزینه‌های جاری به ترتیب ثابت دسته‌ها؛ فقط دسته‌های دارای مبلغ */
  expenses: ExpenseLine[]
  expenseTotal: Money
  netProfit: Money
}

export interface IncomeSpending {
  /** دریافتی فروش (پس از تخفیف) */
  income: Money
  /** پرداختی خرید کالا (پس از تخفیف) */
  purchases: Money
  purchaseCount: number
  saleCount: number
  expenses: ExpenseLine[]
  expenseTotal: Money
  /** خرید کالا + هزینه‌های جاری */
  spending: Money
  /** درآمد − هزینه */
  balance: Money
}

export interface ProductProfitRow {
  productId: string
  product: Product | null
  /** هزارم واحد */
  quantity: number
  sales: Money
  cost: Money
  profit: Money
}

export interface StockAlerts {
  /** ناموجود (موجودی صفر در جمع همه انبارها) */
  out: StockRow[]
  /** به نقطه سفارش رسیده یا کمتر (و هنوز موجود) */
  low: StockRow[]
}

function orderedExpenses(rows: { category: ExpenseCategory; amount: Money; count: number }[]): ExpenseLine[] {
  return EXPENSE_CATEGORIES.map((c) => rows.find((r) => r.category === c)).filter((r): r is ExpenseLine => !!r && r.amount > 0)
}

export function createReportService(db: SqlExecutor) {
  const repos = () => createRepositories(db)
  return {
    async profitLoss(range: DateRange, method: CostMethod): Promise<ProfitLoss> {
      const r = repos()
      const [sales, losses, expenseRows] = await Promise.all([r.reports.salesTotals(range, method), r.reports.stockLossTotals(range, method), r.reports.expenseTotals(range)])
      const expenses = orderedExpenses(expenseRows)
      const expenseTotal = expenses.reduce((s, e) => s + e.amount, 0)
      const revenue = sales.net
      const cogs = sales.cost
      const grossProfit = revenue - cogs
      const netProfit = grossProfit - losses.shortage.cost - losses.waste.cost + losses.surplus.cost - expenseTotal
      return { method, sales, revenue, cogs, grossProfit, ...losses, expenses, expenseTotal, netProfit }
    },

    async incomeSpending(range: DateRange): Promise<IncomeSpending> {
      const r = repos()
      const [sales, purchases, expenseRows] = await Promise.all([r.reports.salesTotals(range, 'fifo'), r.reports.purchaseTotals(range), r.reports.expenseTotals(range)])
      const expenses = orderedExpenses(expenseRows)
      const expenseTotal = expenses.reduce((s, e) => s + e.amount, 0)
      const spending = purchases.total + expenseTotal
      return {
        income: sales.net,
        saleCount: sales.invoiceCount,
        purchases: purchases.total,
        purchaseCount: purchases.invoiceCount,
        expenses,
        expenseTotal,
        spending,
        balance: sales.net - spending,
      }
    },

    /** سود هر کالا در بازه؛ پرسودترین اول، کالاهای زیان‌ده در انتها */
    async productProfit(range: DateRange, method: CostMethod): Promise<ProductProfitRow[]> {
      const r = repos()
      const rows = await r.reports.productSales(range, method)
      const out = await Promise.all(
        rows.map(async (row) => ({ ...row, product: await r.products.getById(row.productId), profit: row.sales - row.cost })),
      )
      return out.sort((a, b) => b.profit - a.profit || compareFa(a.product?.name ?? '', b.product?.name ?? ''))
    },

    /** هشدار موجودی (جمع همه انبارها، فقط کالاهای فعال) */
    async stockAlerts(): Promise<StockAlerts> {
      const { rows } = await createStockService(db).overview({ only: 'attention' })
      return { out: rows.filter((x) => x.status === 'out'), low: rows.filter((x) => x.status === 'low') }
    },
  }
}
