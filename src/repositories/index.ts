import type { SqlExecutor } from '../database/types'
import { createPurchaseInvoiceRepository, createSalesInvoiceRepository } from './sqlite/invoiceRepository'
import { SqlitePaymentRepository } from './sqlite/paymentRepository'
import { SqliteCostRepository } from './sqlite/costRepository'
import { SqliteExpenseRepository } from './sqlite/expenseRepository'
import { SqliteReturnsRepository } from './sqlite/returnsRepository'
import { SqliteReportRepository } from './sqlite/reportRepository'
import { SqliteSequenceRepository } from './sqlite/sequenceRepository'
import { SqliteSettingsRepository } from './sqlite/settingsRepository'
import { SqliteStockRepository } from './sqlite/stockRepository'
import {
  SqliteCustomerRepository,
  SqliteProductGroupRepository,
  SqliteProductRepository,
  SqliteSupplierRepository,
  SqliteUnitRepository,
  SqliteWarehouseRepository,
} from './sqlite/simpleRepositories'
import type { Repositories } from './types'

export type * from './types'

/**
 * تنها نقطه‌ای که پیاده‌سازی واقعی مخزن‌ها انتخاب می‌شود (Composition Root).
 * با `db` یا با `tx` (داخل تراکنش) صدا زده می‌شود؛ مخزن‌ها فرق آن‌ها را نمی‌فهمند.
 * برای Web/Windows آینده فقط همین تابع (و درایور دیتابیس) عوض می‌شود.
 */
export function createRepositories(db: SqlExecutor): Repositories {
  const sequences = new SqliteSequenceRepository(db)
  return {
    settings: new SqliteSettingsRepository(db),
    sequences,
    productGroups: new SqliteProductGroupRepository(db),
    units: new SqliteUnitRepository(db),
    warehouses: new SqliteWarehouseRepository(db),
    customers: new SqliteCustomerRepository(db),
    suppliers: new SqliteSupplierRepository(db),
    products: new SqliteProductRepository(db),
    stock: new SqliteStockRepository(db),
    salesInvoices: createSalesInvoiceRepository(db),
    purchaseInvoices: createPurchaseInvoiceRepository(db),
    payments: new SqlitePaymentRepository(db),
    costs: new SqliteCostRepository(db),
    expenses: new SqliteExpenseRepository(db),
    reports: new SqliteReportRepository(db),
    returns: new SqliteReturnsRepository(db),
  }
}
