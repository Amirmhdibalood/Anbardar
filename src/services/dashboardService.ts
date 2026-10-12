import type { Money } from '../models/common'
import { getApp } from './appContext'
import { createStockService } from './inventoryService'
import { createSaleService } from './saleService'

export interface DashboardSummary {
  productCount: number
  todaySales: Money
  lowStockCount: number
  /** جمع طلب از بدهکاران و بدهی به بستانکاران (فقط از اسناد) */
  receivable: Money
  payable: Money
  debtorCount: number
  creditorCount: number
}

function startOfLocalDay(d = new Date()): string {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x.toISOString()
}

function endOfLocalDay(d = new Date()): string {
  const x = new Date(d)
  x.setHours(23, 59, 59, 999)
  return x.toISOString()
}

/** خلاصه صفحه اصلی: تعداد کالا، فروش امروز (فاکتورهای فعال)، کم‌موجودی */
export async function getDashboardSummary(): Promise<DashboardSummary> {
  const app = getApp()
  const [productCount, { counts }, todaySales, balances] = await Promise.all([
    app.repos.products.count(),
    createStockService(app.db).overview(),
    createSaleService(app.db).totalActive(startOfLocalDay(), endOfLocalDay()),
    app.repos.money.balances(),
  ])
  const debtors = balances.filter((b) => b.balance > 0)
  const creditors = balances.filter((b) => b.balance < 0)
  return {
    productCount,
    todaySales,
    lowStockCount: counts.attention,
    receivable: debtors.reduce((s, b) => s + b.balance, 0),
    payable: -creditors.reduce((s, b) => s + b.balance, 0),
    debtorCount: debtors.length,
    creditorCount: creditors.length,
  }
}
