import { createFiscalService } from './fiscalService'
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
import { createChequeService } from './chequeService'
import { createNotificationService } from './notificationService'
import { createUserService } from './userService'
import {
  securedCatalog,
  securedCheques,
  securedExpenses,
  securedMoney,
  securedPurchases,
  securedReports,
  securedReturns,
  securedSales,
  securedStock,
  securedTransfers,
} from './secured'
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
  catalogService ??= securedCatalog(getApp().db)
  return catalogService
}

let stockService: ReturnType<typeof createStockService> | null = null

/** سرویس موجودی (فهرست، اصلاح، تاریخچه) برای صفحه‌ها */
export function getStock(): ReturnType<typeof createStockService> {
  stockService ??= securedStock(getApp().db)
  return stockService
}

let purchaseService: ReturnType<typeof createPurchaseService> | null = null

/** سرویس فاکتور خرید برای صفحه‌ها */
export function getPurchases(): ReturnType<typeof createPurchaseService> {
  purchaseService ??= securedPurchases(getApp().db)
  return purchaseService
}

let saleService: ReturnType<typeof createSaleService> | null = null

/** سرویس فاکتور فروش برای صفحه‌ها */
export function getSales(): ReturnType<typeof createSaleService> {
  saleService ??= securedSales(getApp().db)
  return saleService
}

let expenseService: ReturnType<typeof createExpenseService> | null = null

/** سرویس هزینه‌های جاری برای صفحه‌ها */
export function getExpenses(): ReturnType<typeof createExpenseService> {
  expenseService ??= securedExpenses(getApp().db)
  return expenseService
}

let reportService: ReturnType<typeof createReportService> | null = null

/** سرویس گزارش‌ها برای صفحه‌ها */
export function getReports(): ReturnType<typeof createReportService> {
  reportService ??= securedReports(getApp().db)
  return reportService
}

let returnService: ReturnType<typeof createReturnService> | null = null
export function getReturns(): ReturnType<typeof createReturnService> {
  returnService ??= securedReturns(getApp().db)
  return returnService
}

let transferService: ReturnType<typeof createTransferService> | null = null
export function getTransfers(): ReturnType<typeof createTransferService> {
  transferService ??= securedTransfers(getApp().db)
  return transferService
}

let moneyService: ReturnType<typeof createMoneyService> | null = null
/** سرویس دریافت/پرداخت، مانده و دفتر طرف حساب */
export function getMoney(): ReturnType<typeof createMoneyService> {
  moneyService ??= securedMoney(getApp().db)
  return moneyService
}

let chequeService: ReturnType<typeof createChequeService> | null = null

export function getCheques(): ReturnType<typeof createChequeService> {
  chequeService ??= securedCheques(getApp().db)
  return chequeService
}

let notificationService: ReturnType<typeof createNotificationService> | null = null

export function getNotifications(): ReturnType<typeof createNotificationService> {
  notificationService ??= createNotificationService(getApp().db)
  return notificationService
}

/** رویداد «داده تغییر کرد / اعلان خوانده شد» برای تازه‌کردن نشان زنگ */
export const NOTIFY_EVENT = 'anbardar:notifications'
export const pingNotifications = () => window.dispatchEvent(new Event(NOTIFY_EVENT))

let userService: ReturnType<typeof createUserService> | null = null
/** کاربران، ورود/خروج */
export function getUsers(): ReturnType<typeof createUserService> {
  userService ??= createUserService(getApp().db)
  return userService
}

let fiscalService: ReturnType<typeof createFiscalService> | null = null
/** دوره‌های مالی (مجوز داخل سرویس: فقط مالک) */
export function getFiscal(): ReturnType<typeof createFiscalService> {
  fiscalService ??= createFiscalService(getApp().db)
  return fiscalService
}
