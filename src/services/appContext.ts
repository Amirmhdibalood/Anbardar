import type { Database } from '../database/types'
import { openAppDatabase } from '../database/open'
import type { SnapshotStore } from '../database/snapshot'
import { createRepositories, type Repositories } from '../repositories'
import { createCatalogService } from './catalogService'
import { createStockService } from './inventoryService'
import { createPurchaseService } from './purchaseService'
import { createSaleService } from './saleService'
import { createExpenseService } from './expenseService'
import { createMoneyService } from './moneyService'
import { createReportService } from './reportService'
import { createReturnService, createTransferService } from './returnService'
import { AppError } from '../utils/errors'
import { logger } from '../utils/logger'
import { importLegacySettings } from './legacySettingsMigration'

export interface AppContext {
  db: Database
  repos: Repositories
  snapshots: SnapshotStore
}

let pending: Promise<AppContext> | null = null
let ready: AppContext | null = null

/**
 * راه‌اندازی یک‌باره برنامه: باز کردن دیتابیس، Migration، Seed و انتقال تنظیمات قدیمی.
 * در صورت خطا، دفعه بعد دوباره تلاش می‌شود (دکمه «تلاش دوباره»).
 */
export function initApp(): Promise<AppContext> {
  pending ??= (async () => {
    try {
      const { db, snapshots } = await openAppDatabase()
      const repos = createRepositories(db)
      await importLegacySettings(repos)
      ready = { db, repos, snapshots }
      return ready
    } catch (error) {
      pending = null
      if (error instanceof AppError) throw error
      logger.error('راه‌اندازی دیتابیس ناموفق بود', error)
      throw new AppError('database', 'باز کردن اطلاعات برنامه ممکن نشد. اطلاعات شما حذف نشده است. برنامه را ببندید و دوباره باز کنید.', { cause: error })
    }
  })()
  return pending
}

/** دسترسی همگام پس از موفقیت initApp (SettingsProvider/DatabaseGate تضمین می‌کنند) */
export function getApp(): AppContext {
  if (!ready) throw new Error('App is not initialized')
  return ready
}

let catalogService: ReturnType<typeof createCatalogService> | null = null

/** سرویس اطلاعات پایه (کالا، گروه، واحد، ...) برای صفحه‌ها؛ پس از آماده شدن برنامه صدا زده شود */
export function getCatalog(): ReturnType<typeof createCatalogService> {
  catalogService ??= createCatalogService(getApp().db)
  return catalogService
}

let stockService: ReturnType<typeof createStockService> | null = null

/** سرویس موجودی (فهرست، اصلاح، تاریخچه) برای صفحه‌ها */
export function getStock(): ReturnType<typeof createStockService> {
  stockService ??= createStockService(getApp().db)
  return stockService
}

let purchaseService: ReturnType<typeof createPurchaseService> | null = null

/** سرویس فاکتور خرید برای صفحه‌ها */
export function getPurchases(): ReturnType<typeof createPurchaseService> {
  purchaseService ??= createPurchaseService(getApp().db)
  return purchaseService
}

let saleService: ReturnType<typeof createSaleService> | null = null

/** سرویس فاکتور فروش برای صفحه‌ها */
export function getSales(): ReturnType<typeof createSaleService> {
  saleService ??= createSaleService(getApp().db)
  return saleService
}

let expenseService: ReturnType<typeof createExpenseService> | null = null

/** سرویس هزینه‌های جاری برای صفحه‌ها */
export function getExpenses(): ReturnType<typeof createExpenseService> {
  expenseService ??= createExpenseService(getApp().db)
  return expenseService
}

let reportService: ReturnType<typeof createReportService> | null = null

/** سرویس گزارش‌ها برای صفحه‌ها */
export function getReports(): ReturnType<typeof createReportService> {
  reportService ??= createReportService(getApp().db)
  return reportService
}

let returnService: ReturnType<typeof createReturnService> | null = null
export function getReturns(): ReturnType<typeof createReturnService> {
  returnService ??= createReturnService(getApp().db)
  return returnService
}

let transferService: ReturnType<typeof createTransferService> | null = null
export function getTransfers(): ReturnType<typeof createTransferService> {
  transferService ??= createTransferService(getApp().db)
  return transferService
}

let moneyService: ReturnType<typeof createMoneyService> | null = null
/** سرویس دریافت/پرداخت، مانده و دفتر طرف حساب */
export function getMoney(): ReturnType<typeof createMoneyService> {
  moneyService ??= createMoneyService(getApp().db)
  return moneyService
}
