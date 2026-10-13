import type { Money } from '../models/common'
import type { Party, PartyInput } from '../models/party'
import type { Product, ProductGroup, ProductGroupInput, ProductInput, Unit, UnitInput, Warehouse, WarehouseInput } from '../models/catalog'
import type { InvoiceFilter, InvoiceInput, InvoiceItem, PurchaseInvoice, SalesInvoice } from '../models/invoice'
import type { Payment, PaymentInput } from '../models/payment'
import type { MoneyRepository } from './sqlite/moneyRepository'
import type { AppSettings, CostMethod } from '../models/settings'
import type { MovementCosts, StockInconsistency, StockLevel, StockMovement, StockMovementInput } from '../models/stock'
import type { CostInconsistency, CostLot, LotAllocation } from '../models/costing'
import type { Expense, ExpenseCategory, ExpenseFilter, ExpenseInput } from '../models/expense'
import type { IsoDateTime } from '../models/common'
import type { PreparedInvoice } from '../utils/invoiceMath'

/**
 * رابط‌های دسترسی به داده. UI و سرویس‌ها فقط به این رابط‌ها وابسته‌اند؛
 * پیاده‌سازی SQLite در repositories/sqlite است و برای Web/Windows قابل تعویض است.
 * مخزن‌ها ورودی را اعتبارسنجی نمی‌کنند (کار لایه services/validation است)؛ دیتابیس فقط آخرین سد دفاعی است.
 */

export interface ListOptions {
  includeInactive?: boolean
}

export interface CrudRepository<T, Input> {
  getById(id: string): Promise<T | null>
  list(options?: ListOptions): Promise<T[]>
  create(input: Input): Promise<T>
  /** جایگزینی فیلدهای قابل‌ویرایش با مقادیر ورودی */
  update(id: string, input: Input): Promise<T>
  setActive(id: string, active: boolean): Promise<void>
  /** حذف واقعی؛ فقط برای ردیفی که هیچ‌جا استفاده نشده (در غیر این صورت خطای in_use) */
  remove(id: string): Promise<void>
}

export interface ProductGroupRepository extends CrudRepository<ProductGroup, ProductGroupInput> {
  /** تعداد کالاهای هر گروه (شناسه گروه ← تعداد؛ شامل کالاهای غیرفعال) */
  productCounts(): Promise<Record<string, number>>
}

export interface UnitRepository extends CrudRepository<Unit, UnitInput> {
  getByName(name: string): Promise<Unit | null>
  /** آیا حداقل یک کالا از این واحد استفاده می‌کند؟ */
  isUsed(id: string): Promise<boolean>
}
export interface WarehouseRepository extends CrudRepository<Warehouse, WarehouseInput> {
  /** آیا انبار در حرکت موجودی یا فاکتوری آمده است؟ */
  isUsed(id: string): Promise<boolean>
  /** تعداد کالاهایی که در این انبار موجودی غیرصفر دارند */
  stockedProductCount(id: string): Promise<number>
}
export interface PartyRepository extends CrudRepository<Party, PartyInput> {
  isUsed(id: string): Promise<boolean>
}
export type CustomerRepository = PartyRepository
export type SupplierRepository = PartyRepository

export interface ProductFilter extends ListOptions {
  groupId?: string
  /** بخشی از نام (متن باید از قبل نرمال شده باشد) */
  nameContains?: string
  /** بخشی از کد (متن باید از قبل نرمال شده باشد)؛ با nameContains به‌صورت «یا» ترکیب می‌شود */
  codeContains?: string
  limit?: number
  offset?: number
}

export interface ProductWithStock {
  product: Product
  /** هزارم واحد؛ موجودی انبار انتخاب‌شده یا جمع همه انبارها */
  quantity: number
}

export interface ProductRepository extends Omit<CrudRepository<Product, ProductInput & { code: string }>, 'list'> {
  list(filter?: ProductFilter): Promise<Product[]>
  getByCode(code: string): Promise<Product | null>
  count(options?: ListOptions): Promise<number>
  /** آیا کالا در دفتر حرکت یا اسناد خرید/فروش آمده است؟ (اگر آمده باشد حذف و تغییر واحد ممنوع است) */
  isUsed(id: string): Promise<boolean>
  /** فهرست کالاها همراه موجودی (یک انبار یا جمع همه انبارها) */
  listWithStock(filter?: ProductFilter & { warehouseId?: string }): Promise<ProductWithStock[]>
  /** همگام‌سازی واحدهای فرعی کالا */
  syncSubUnits(productId: string, list: readonly import('../models/catalog').ProductUnitInput[]): Promise<void>
}

export interface SequenceRepository {
  /** عدد بعدیِ شمارنده (باید داخل تراکنش صدا زده شود؛ خودش هم SAVEPOINT می‌سازد) */
  next(name: SequenceName): Promise<number>
}
export type SequenceName = 'sales_invoice' | 'purchase_invoice' | 'product_code' | 'sale_return' | 'purchase_return' | 'transfer' | 'receipt' | 'payment' | 'opening'

export interface StockFilter {
  warehouseId?: string
  productId?: string
}

export interface MovementFilter extends StockFilter {
  from?: IsoDateTime
  to?: IsoDateTime
  documentId?: string
  documentLineId?: string
}

export interface StockRepository {
  /** هزارم واحد */
  getQuantity(warehouseId: string, productId: string): Promise<number>
  listLevels(filter?: StockFilter): Promise<StockLevel[]>
  /** افزودن مقدار به کش موجودی (ساخت ردیف در صورت نبود) */
  addToCache(warehouseId: string, productId: string, delta: number): Promise<void>
  insertMovement(input: StockMovementInput & { occurredAt: IsoDateTime; costs?: MovementCosts | null }): Promise<StockMovement>
  getMovement(id: string): Promise<StockMovement | null>
  listMovements(filter?: MovementFilter): Promise<StockMovement[]>
  findInconsistencies(): Promise<StockInconsistency[]>
  /** بازسازی کش از دفتر حرکت (دفتر منبع حقیقت است) */
  rebuildCache(): Promise<void>
}

export interface InvoiceWithItems<I> {
  invoice: I
  items: InvoiceItem[]
}

export interface InvoiceRepository<I> {
  /** ثبت سربرگ + ردیف‌ها با شماره خودکار؛ جمع کل از ردیف‌ها محاسبه می‌شود. اثر روی موجودی/پرداخت با سرویس است. */
  create(input: InvoiceInput): Promise<InvoiceWithItems<I>>
  /** ثبت با مبالغ/شناسه‌های ازپیش‌محاسبه‌شده (سرویس‌ها؛ برای ردیف‌های فروش شامل بها) */
  insertPrepared(input: InvoiceInput, prepared: PreparedInvoice): Promise<InvoiceWithItems<I>>
  /** قیمت واحد آخرین ردیف فعال این کالا (بر اساس تاریخ فاکتور) */
  lastUnitPrice(productId: string): Promise<number | null>
  getById(id: string): Promise<I | null>
  getByNumber(invoiceNumber: number): Promise<I | null>
  getItems(invoiceId: string): Promise<InvoiceItem[]>
  list(filter?: InvoiceFilter): Promise<I[]>
  /** تعداد ردیف‌های هر فاکتور (شناسه ← تعداد) */
  itemCounts(invoiceIds: readonly string[]): Promise<Record<string, number>>
  /** فقط خرید: هزینه‌های جانبی فاکتور */
  getCharges(invoiceId: string): Promise<import("../models/invoice").PurchaseCharge[]>
  /** شناسه فاکتورهایی که «جمع ردیف‌ها» با subtotal سربرگشان نمی‌خواند (باید همیشه خالی باشد) */
  findTotalMismatches(): Promise<string[]>
  /** تنها تغییر مجاز روی سند: ابطال (تغییر موجودی با سرویس انجام می‌شود) */
  markCancelled(id: string, reason: string | null, at: IsoDateTime): Promise<void>
}
export type SalesInvoiceRepository = InvoiceRepository<SalesInvoice>
export type PurchaseInvoiceRepository = InvoiceRepository<PurchaseInvoice>

export interface NewLot {
  productId: string
  warehouseId: string
  movementId: string
  lotDate: IsoDateTime
  quantity: number
  totalCost: number
}

export interface NewAllocation {
  lotId: string
  movementId: string
  quantity: number
  costAmount: number
}

/** وضعیت میانگین متحرک یک کالا: تعداد کل (هزارم واحد) و ارزش کل (تومان) */
export interface AverageState {
  quantity: number
  value: number
}

/** لایه‌های بها، برداشت‌ها و کش میانگین (فقط از مسیر سرویس موجودی نوشته می‌شوند) */
export interface CostRepository {
  insertLot(input: NewLot): Promise<CostLot>
  getLot(id: string): Promise<CostLot | null>
  getLotByMovement(movementId: string): Promise<CostLot | null>
  /** لایه‌های دارای باقی‌مانده به ترتیب FIFO (تاریخ لایه، سپس زمان ثبت) */
  openLots(productId: string, warehouseId: string): Promise<CostLot[]>
  listLots(filter?: { productId?: string; warehouseId?: string }): Promise<CostLot[]>
  setRemaining(lotId: string, remaining: number): Promise<void>
  insertAllocation(input: NewAllocation): Promise<LotAllocation>
  allocationsForMovement(movementId: string): Promise<LotAllocation[]>
  allocationsForLot(lotId: string): Promise<LotAllocation[]>
  /** جمع بهای برداشت‌های برگشت‌نخورده از یک لایه */
  activeAllocatedCost(lotId: string): Promise<number>
  markReversed(allocationId: string, reversalMovementId: string): Promise<void>
  getAverage(productId: string): Promise<AverageState>
  setAverage(productId: string, state: AverageState): Promise<void>
  clearAverages(): Promise<void>
  /** آخرین لایه کالا (جدیدترین تاریخ)، بدون لایه‌های خریدِ ابطال‌شده */
  latestLot(productId: string, options: { purchaseOnly: boolean }): Promise<CostLot | null>
  findInconsistencies(): Promise<CostInconsistency[]>
}

export interface PaymentRepository {
  create(input: PaymentInput & { paidAt: IsoDateTime }): Promise<Payment>
  listForSalesInvoice(invoiceId: string): Promise<Payment[]>
  listForPurchaseInvoice(invoiceId: string): Promise<Payment[]>
  totalForSalesInvoice(invoiceId: string): Promise<Money>
  totalForPurchaseInvoice(invoiceId: string): Promise<Money>
}

/** بازه گزارش: from شامل، to انحصاری (تا قبل از این لحظه) */
export interface DateRange {
  from: IsoDateTime
  to: IsoDateTime
}

export interface SalesTotals {
  invoiceCount: number
  /** جمع «تعداد × قیمت» قبل از هر تخفیف */
  gross: Money
  /** تخفیف ردیف‌ها + تخفیف فاکتورها */
  discounts: Money
  /** مبلغ دریافتی فاکتورها (gross − discounts) */
  net: Money
  /** بهای تمام‌شده کالای فروش‌رفته با روش انتخاب‌شده */
  cost: Money
}

export interface PurchaseTotals {
  invoiceCount: number
  /** مبلغ پرداختی فاکتورهای خرید (پس از تخفیف) */
  total: Money
}

export interface StockLossTotals {
  /** «کسری» (گم‌شده، سرقت، کسری شمارش): تعداد حرکت و بها */
  shortage: { count: number; cost: Money }
  /** «ضایعات / خرابی» */
  waste: { count: number; cost: Money }
  /** «اضافه در شمارش»: بهای کالایی که بیشتر از دفتر پیدا شد */
  surplus: { count: number; cost: Money }
}

export interface ExpenseTotal {
  category: ExpenseCategory
  amount: Money
  count: number
}

export interface ProductSalesRow {
  productId: string
  /** هزارم واحد */
  quantity: number
  /** فروش خالص (پس از تخفیف ردیف و سهم تخفیف فاکتور) */
  sales: Money
  cost: Money
}

/** پرس‌وجوهای تجمیعی گزارش‌ها (فقط خواندن؛ فقط اسناد فعال) */
export interface ReportRepository {
  salesTotals(range: DateRange, method: CostMethod): Promise<SalesTotals>
  purchaseTotals(range: DateRange): Promise<PurchaseTotals>
  stockLossTotals(range: DateRange, method: CostMethod): Promise<StockLossTotals>
  expenseTotals(range: DateRange): Promise<ExpenseTotal[]>
  productSales(range: DateRange, method: CostMethod): Promise<ProductSalesRow[]>
}

export interface ExpenseRepository {
  create(input: ExpenseInput & { expenseDate: IsoDateTime }): Promise<Expense>
  getById(id: string): Promise<Expense | null>
  /** جدیدترین اول */
  list(filter?: ExpenseFilter): Promise<Expense[]>
  /** تنها تغییر مجاز: ابطال */
  markCancelled(id: string, reason: string | null, at: IsoDateTime): Promise<void>
}

export interface SettingsRepository {
  load(): Promise<AppSettings>
  save(settings: AppSettings): Promise<void>
  getValue(key: string): Promise<string | null>
  setValue(key: string, value: string): Promise<void>
}


/** برگشت فروش/خرید و انتقال انبار */
export interface ReturnsRepository {
  insertSaleReturn(row: {
    id: string
    returnNumber: number
    salesInvoiceId: string
    warehouseId: string
    docDate: string
    totalAmount: number
    note: string | null
  }): Promise<import('../models/returns').SaleReturn>
  insertSaleReturnItem(row: {
    id: string
    returnId: string
    salesItemId: string
    productId: string
    quantity: number
    unitPrice: number
    lineTotal: number
    costs: import('../models/stock').MovementCosts
    lineNo: number
    unitId?: string | null
    unitFactor?: number
    unitQuantity?: number
  }): Promise<void>
  getSaleReturn(id: string): Promise<import('../models/returns').SaleReturn | null>
  listSaleReturns(limit?: number): Promise<import('../models/returns').SaleReturn[]>
  saleReturnItems(returnId: string): Promise<import('../models/returns').SaleReturnItem[]>
  returnedQtyForSalesItem(salesItemId: string): Promise<number>
  markSaleReturnCancelled(id: string, reason: string | null, at: string): Promise<void>

  insertPurchaseReturn(row: {
    id: string
    returnNumber: number
    purchaseInvoiceId: string
    warehouseId: string
    docDate: string
    totalAmount: number
    note: string | null
  }): Promise<import('../models/returns').PurchaseReturn>
  insertPurchaseReturnItem(row: {
    id: string
    returnId: string
    purchaseItemId: string
    productId: string
    quantity: number
    unitPrice: number
    lineTotal: number
    costs: import('../models/stock').MovementCosts
    lineNo: number
    unitId?: string | null
    unitFactor?: number
    unitQuantity?: number
  }): Promise<void>
  getPurchaseReturn(id: string): Promise<import('../models/returns').PurchaseReturn | null>
  listPurchaseReturns(limit?: number): Promise<import('../models/returns').PurchaseReturn[]>
  purchaseReturnItems(returnId: string): Promise<import('../models/returns').PurchaseReturnItem[]>
  returnedQtyForPurchaseItem(purchaseItemId: string): Promise<number>
  markPurchaseReturnCancelled(id: string, reason: string | null, at: string): Promise<void>

  insertTransfer(row: {
    id: string
    transferNumber: number
    fromWarehouseId: string
    toWarehouseId: string
    docDate: string
    note: string | null
  }): Promise<import('../models/returns').WarehouseTransfer>
  insertTransferItem(row: {
    id: string
    transferId: string
    productId: string
    quantity: number
    costs: import('../models/stock').MovementCosts
    lineNo: number
    unitId?: string | null
    unitFactor?: number
    unitQuantity?: number
  }): Promise<void>
  getTransfer(id: string): Promise<import('../models/returns').WarehouseTransfer | null>
  listTransfers(limit?: number): Promise<import('../models/returns').WarehouseTransfer[]>
  transferItems(transferId: string): Promise<import('../models/returns').WarehouseTransferItem[]>
  markTransferCancelled(id: string, reason: string | null, at: string): Promise<void>
}

/** مجموعه همه مخزن‌ها روی یک اتصال یا یک تراکنش */
export interface Repositories {
  settings: SettingsRepository
  sequences: SequenceRepository
  productGroups: ProductGroupRepository
  units: UnitRepository
  warehouses: WarehouseRepository
  parties: PartyRepository
  customers: CustomerRepository
  suppliers: SupplierRepository
  money: MoneyRepository
  products: ProductRepository
  stock: StockRepository
  salesInvoices: SalesInvoiceRepository
  purchaseInvoices: PurchaseInvoiceRepository
  payments: PaymentRepository
  costs: CostRepository
  expenses: ExpenseRepository
  reports: ReportRepository
  returns: ReturnsRepository
}
