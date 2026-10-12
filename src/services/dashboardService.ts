import type { Money } from '../models/common'
import { getApp } from './appContext'
import { createStockService } from './inventoryService'
import { createSaleService } from './saleService'

export interface DashboardSummary {
  productCount: number
  todaySales: Money
  lowStockCount: number
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
  const [productCount, { counts }, todaySales] = await Promise.all([
    app.repos.products.count(),
    createStockService(app.db).overview(),
    createSaleService(app.db).totalActive(startOfLocalDay(), endOfLocalDay()),
  ])
  return { productCount, todaySales, lowStockCount: counts.attention }
}
