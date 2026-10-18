import { searchTokens } from '../utils/search'
import type { SqlExecutor } from '../database/types'
import {
  FIFO_CONSUMING_TYPES,
  INBOUND_TYPES,
  LOT_CREATING_TYPES,
  stockStatus,
  type MovementCosts,
  type StockInconsistency,
  type StockMovement,
  type StockMovementInput,
  type StockStatus,
} from '../models/stock'
import type { CostInconsistency } from '../models/costing'
import type { Product } from '../models/catalog'
import type { IsoDateTime } from '../models/common'
import { ValidationError } from '../utils/errors'
import { compareFa } from '../utils/collate'
import { cleanText } from '../validation/fields'
import { createRepositories } from '../repositories'
import type { MovementFilter, StockFilter } from '../repositories'
import { AppError } from '../utils/errors'
import { formatQuantityWithUnit, isWholeQuantity, type Quantity } from '../utils/quantity'
import { MAX_AMOUNT, MAX_QUANTITY, MAX_UNIT_PRICE } from '../models/limits'
import { nowIso } from '../utils/time'
import { mulDivRound } from '../utils/money'
import { validateMovement } from '../validation/entities'
import { createCostEngine } from './costing'
import { factorFor } from './lineUnits'
import { toBaseQuantity } from '../utils/invoiceMath'

/** برای این نوع حرکت‌ها، کالا و انبار باید فعال باشند (ابطال/برگشت روی موارد غیرفعال هم مجاز است) */
const ACTIVE_REQUIRED = new Set(['purchase', 'sale', 'transfer_in', 'transfer_out', 'adjustment', 'opening', 'shortage', 'waste', 'sale_return', 'purchase_return'])

/**
 * اثر حرکت روی لایه‌های بها:
 * - lot: ساخت لایه با بهای کل مشخص (خرید، موجودی اولیه، اضافه در شمارش، ورود انتقال)
 * - fifo: برداشت از قدیمی‌ترین لایه‌ها (فروش، کسری، ضایعات، برگشت از خرید، خروج انتقال) — پیش‌فرض این نوع‌ها
 * - cancel_lot: ابطال خرید؛ کل لایه همان خرید برداشته می‌شود (فقط اگر دست‌نخورده باشد)
 * - reverse: ابطال فروش؛ برداشت‌های همان حرکت به همان لایه‌ها برمی‌گردد
 */
export type CostEffect =
  | { kind: 'lot'; totalCost: number; lotDate?: IsoDateTime }
  | { kind: 'fifo'; preferLotMovementId?: string }
  | { kind: 'cancel_lot'; lotMovementId: string }
  | { kind: 'reverse'; originalMovementId: string }

/**
 * هسته موجودی: هر تغییر موجودی = یک ردیف در دفتر حرکت + اثر روی لایه‌های بها + به‌روزرسانی کش موجودی و میانگین،
 * همه در یک تراکنش. دفتر حرکت منبع حقیقت است و تغییرناپذیر.
 */
export function createInventoryService(db: SqlExecutor) {
  return {
    /**
     * ثبت یک حرکت. quantityDelta بر حسب هزارم واحد است (۱٫۵ کیلو = ۱۵۰۰) و علامتش باید با نوع حرکت بخواند.
     * موجودی منفی هرگز مجاز نیست. اگر داخل تراکنش بزرگ‌تر (مثلاً ثبت فاکتور) صدا زده شود، خطا کل آن را Rollback می‌کند.
     */
    async applyMovement(input: StockMovementInput, effect?: CostEffect): Promise<StockMovement> {
      const clean = validateMovement(input)
      const inbound = INBOUND_TYPES.has(clean.movementType)
      if (inbound !== clean.quantityDelta > 0) throw new AppError('validation', 'جهت حرکت انبار با نوع آن نمی‌خواند.')
      const cost: CostEffect | undefined = effect ?? (FIFO_CONSUMING_TYPES.has(clean.movementType) ? ({ kind: 'fifo' } satisfies CostEffect) : undefined)
      const expected = LOT_CREATING_TYPES.has(clean.movementType)
        ? 'lot'
        : FIFO_CONSUMING_TYPES.has(clean.movementType)
          ? 'fifo'
          : clean.movementType === 'purchase_cancel'
            ? 'cancel_lot'
            : clean.movementType === 'sale_cancel'
              ? 'reverse'
              : null
      if (expected === null) throw new AppError('validation', 'این نوع حرکت انبار هنوز پشتیبانی نمی‌شود.')
      if (!cost || cost.kind !== expected) throw new Error(`applyMovement: ${clean.movementType} needs cost effect "${expected}"`)
      if (cost.kind === 'lot' && (!Number.isSafeInteger(cost.totalCost) || cost.totalCost < 0 || cost.totalCost > MAX_AMOUNT)) {
        throw new AppError('validation', 'بهای کالا در محدوده مجاز نیست.')
      }

      return db.transaction(async (tx) => {
        const r = createRepositories(tx)
        const engine = createCostEngine(tx)
        const product = await r.products.getById(clean.productId)
        const warehouse = await r.warehouses.getById(clean.warehouseId)
        if (!product) throw new AppError('not_found', 'کالای انتخاب‌شده پیدا نشد.')
        if (!warehouse) throw new AppError('not_found', 'انبار انتخاب‌شده پیدا نشد.')
        if (ACTIVE_REQUIRED.has(clean.movementType) && (!product.isActive || !warehouse.isActive)) {
          throw new AppError('validation', !product.isActive ? `کالای «${product.name}» غیرفعال است.` : `انبار «${warehouse.name}» غیرفعال است.`)
        }
        if (!product.unitAllowsFraction && !isWholeQuantity(clean.quantityDelta)) {
          throw new AppError('validation', `تعداد «${product.name}» باید عدد صحیح باشد (واحد «${product.unitName}» اعشار ندارد).`)
        }
        const quantity = Math.abs(clean.quantityDelta)
        const occurredAt = clean.occurredAt ?? nowIso()

        // ---- محاسبه بها قبل از ثبت حرکت
        let costs: MovementCosts | null = null
        let plan: Awaited<ReturnType<typeof engine.planOutbound>> | null = null
        let cancelLot = null
        let reversed: StockMovement | null = null
        if (cost.kind === 'cancel_lot') {
          cancelLot = await r.costs.getLotByMovement(cost.lotMovementId)
          if (!cancelLot || cancelLot.productId !== clean.productId || cancelLot.warehouseId !== clean.warehouseId || cancelLot.quantity !== quantity) {
            throw new AppError('integrity', 'لایه بهای این خرید پیدا نشد یا با آن نمی‌خواند.')
          }
          if (cancelLot.remaining !== cancelLot.quantity) {
            throw new AppError('in_use', `بخشی از «${product.name}» این خرید فروخته یا مصرف شده است، پس خرید ابطال نمی‌شود. برای پس دادن کالا به فروشنده از «برگشت از خرید» استفاده کنید.`)
          }
          costs = { fifo: cancelLot.totalCost, average: cancelLot.totalCost, last: cancelLot.totalCost }
        }
        if (!inbound) {
          const current = await r.stock.getQuantity(clean.warehouseId, clean.productId)
          if (current - quantity < 0) {
            throw new AppError(
              'insufficient_stock',
              `موجودی «${product.name}» در «${warehouse.name}» کافی نیست. موجودی فعلی: ${formatQuantityWithUnit(current, product.unitName)}`,
            )
          }
        }
        if (cost.kind === 'fifo') {
          plan = await engine.planOutbound(clean.productId, clean.warehouseId, quantity, cost.preferLotMovementId)
          costs = plan.costs
        } else if (cost.kind === 'reverse') {
          reversed = await r.stock.getMovement(cost.originalMovementId)
          if (!reversed || !reversed.costs || reversed.productId !== clean.productId || reversed.warehouseId !== clean.warehouseId || reversed.quantityDelta !== -clean.quantityDelta) {
            throw new AppError('integrity', 'حرکت اصلی برای ابطال پیدا نشد یا با آن نمی‌خواند.')
          }
          costs = reversed.costs
        }

        const movement = await r.stock.insertMovement({ ...clean, occurredAt, costs })

        // ---- اثر روی لایه‌ها و میانگین
        if (cost.kind === 'lot') {
          await r.costs.insertLot({ productId: clean.productId, warehouseId: clean.warehouseId, movementId: movement.id, lotDate: cost.lotDate ?? occurredAt, quantity, totalCost: cost.totalCost })
          await engine.addToAverage(clean.productId, quantity, cost.totalCost)
        } else if (plan && costs) {
          for (const a of plan.allocations) {
            await r.costs.insertAllocation({ lotId: a.lot.id, movementId: movement.id, quantity: a.quantity, costAmount: a.cost })
            await r.costs.setRemaining(a.lot.id, a.lot.remaining - a.quantity)
          }
          await engine.removeFromAverage(clean.productId, quantity, costs.average)
        } else if (cancelLot) {
          await r.costs.insertAllocation({ lotId: cancelLot.id, movementId: movement.id, quantity, costAmount: cancelLot.totalCost })
          await r.costs.setRemaining(cancelLot.id, 0)
          await engine.removeFromAverage(clean.productId, quantity, cancelLot.totalCost)
        } else if (reversed?.costs) {
          const allocations = await r.costs.allocationsForMovement(reversed.id)
          if (allocations.length === 0 || allocations.some((a) => a.reversalMovementId !== null)) {
            throw new AppError('immutable', 'این حرکت قبلاً ابطال شده است.')
          }
          for (const a of allocations) {
            const lot = await r.costs.getLot(a.lotId)
            if (!lot) throw new AppError('integrity', 'لایه بها پیدا نشد.')
            await r.costs.markReversed(a.id, movement.id)
            await r.costs.setRemaining(lot.id, lot.remaining + a.quantity)
          }
          await engine.addToAverage(clean.productId, quantity, reversed.costs.average)
        }

        await r.stock.addToCache(clean.warehouseId, clean.productId, clean.quantityDelta)
        return movement
      })
    },

    getQuantity: (warehouseId: string, productId: string) => createRepositories(db).stock.getQuantity(warehouseId, productId),
    listLevels: (filter?: StockFilter) => createRepositories(db).stock.listLevels(filter),
    listMovements: (filter?: MovementFilter) => createRepositories(db).stock.listMovements(filter),

    /** مقایسه کش با جمع دفتر حرکت؛ لیست خالی یعنی سالم */
    verifyConsistency: (): Promise<StockInconsistency[]> => createRepositories(db).stock.findInconsistencies(),
    /** قاعده ثابت لایه‌ها: جمع باقی‌مانده لایه‌ها = موجودی، باقی‌مانده هر لایه = تعداد − برداشت‌ها، تعداد میانگین = موجودی کل */
    verifyCosts: (): Promise<CostInconsistency[]> => createRepositories(db).costs.findInconsistencies(),
    /** بازسازی کش موجودی از دفتر حرکت */
    rebuildCache: () => createRepositories(db).stock.rebuildCache(),

    /**
     * بازسازی کش میانگین متحرک فقط از داده خام (لایه‌ها + بهای ذخیره‌شده روی حرکت‌ها)، به ترتیب ثبت حرکت‌ها.
     */
    rebuildAverages: () =>
      db.transaction(async (tx) => {
        const r = createRepositories(tx)
        const engine = createCostEngine(tx)
        await r.costs.clearAverages()
        const movements = (await r.stock.listMovements()).sort((a, b) => (a.createdAt === b.createdAt ? a.id.localeCompare(b.id) : a.createdAt < b.createdAt ? -1 : 1))
        for (const m of movements) {
          const q = Math.abs(m.quantityDelta)
          if (LOT_CREATING_TYPES.has(m.movementType)) {
            const lot = await r.costs.getLotByMovement(m.id)
            await engine.addToAverage(m.productId, q, lot?.totalCost ?? 0)
          } else if (m.quantityDelta < 0) {
            await engine.removeFromAverage(m.productId, q, m.costs?.average ?? 0)
          } else {
            await engine.addToAverage(m.productId, q, m.costs?.average ?? 0)
          }
        }
      }),
  }
}

export interface StockRow {
  product: Product
  /** هزارم واحد؛ موجودی انبار انتخاب‌شده یا جمع همه انبارها */
  quantity: Quantity
  status: StockStatus
}

export interface StockOverviewFilter {
  /** خالی = جمع همه انبارها */
  warehouseId?: string
  /** جستجو در نام و کد */
  search?: string
  /** 'attention' = کم‌موجودی و ناموجود */
  only?: 'all' | 'attention'
}

export interface StockOverview {
  rows: StockRow[]
  /** شمارش‌ها مستقل از فیلتر «فقط کم‌موجودی» */
  counts: { all: number; low: number; out: number; attention: number }
}

/**
 * انواع اصلاح دستی موجودی:
 * - count (شمارش): عدد شمارش‌شده؛ اضافه → «اضافه در شمارش» با بهای میانگین فعلی، کم → «کسری»
 * - opening (موجودی اولیه): موجودی جدید + بهای هر واحد؛ فقط افزایش
 * - shortage (کسری: گم‌شده، سرقت، کسری شمارش) و waste (ضایعات / خرابی): مقدار کم‌شده
 */
export type AdjustKind = 'count' | 'opening' | 'shortage' | 'waste'

export interface AdjustStockInput {
  productId: string
  warehouseId: string
  kind: AdjustKind
  /** count/opening: موجودی جدید؛ shortage/waste: مقدار کم‌شده (هزارم واحد) */
  quantity: Quantity
  /** فقط موجودی اولیه: بهای یک واحد (واحد ردیف) به تومان */
  unitCost?: number
  /** فقط موجودی اولیه: واحد ورود (واحد فرعی کالا)؛ quantity و unitCost به همین واحدند */
  unitId?: string | null
  /** فقط موجودی اولیه: «total» یعنی totalCost بهای کل مقدار اضافه‌شده است (دقیق، بدون گرد کردن) */
  priceMode?: 'unit' | 'total'
  totalCost?: number
  note?: string | null
}

/** خدمات خواندن و اصلاح موجودی؛ همه تغییرها از مسیر applyMovement (دفتر حرکت + لایه‌های بها) انجام می‌شود */
export function createStockService(db: SqlExecutor) {
  const inventory = createInventoryService(db)
  return {
    /** فهرست موجودی با وضعیت (کافی/کم‌موجودی/ناموجود) برای فقط کالاهای فعال */
    async overview(filter: StockOverviewFilter = {}): Promise<StockOverview> {
      const repos = createRepositories(db)
      const items = await repos.products.listWithStock({ warehouseId: filter.warehouseId || undefined, tokens: searchTokens(filter.search) })
      const all: StockRow[] = [...items].sort((a, b) => compareFa(a.product.name, b.product.name)).map(({ product, quantity }) => ({ product, quantity, status: stockStatus(quantity, product.reorderPoint) }))
      const low = all.filter((r) => r.status === 'low').length
      const out = all.filter((r) => r.status === 'out').length
      const rows = filter.only === 'attention' ? all.filter((r) => r.status !== 'ok') : all
      return { rows, counts: { all: all.length, low, out, attention: low + out } }
    },

    /** جستجوی سریع کالا برای انتخاب‌گرها (فاکتور، انتقال): فیلتر داخل SQL، حداکثر `limit` ردیف مرتب */
    async search(filter: { warehouseId?: string; search?: string; limit?: number } = {}): Promise<{ rows: { product: Product; quantity: Quantity }[]; total: number }> {
      const repos = createRepositories(db)
      const tokens = searchTokens(filter.search)
      const items = await repos.products.listWithStock({ warehouseId: filter.warehouseId || undefined, tokens, limit: tokens.length ? 400 : undefined })
      const rows = [...items].sort((a, b) => compareFa(a.product.name, b.product.name)).slice(0, filter.limit ?? 80)
      return { rows, total: items.length }
    },

    /** جمع موجودی همه انبارها برای هر کالا (شناسه کالا ← هزارم واحد)، شامل کالاهای غیرفعال */
    async totals(): Promise<Record<string, Quantity>> {
      const items = await createRepositories(db).products.listWithStock({ includeInactive: true })
      return Object.fromEntries(items.map((i) => [i.product.id, i.quantity]))
    },

    /** موجودی یک کالا در هر انبار (فقط انبارهای دارای ردیف) */
    levelsForProduct: (productId: string) => inventory.listLevels({ productId }),

    /** آخرین حرکت‌های یک کالا (جدیدترین اول) */
    async recentMovements(productId: string, limit = 20): Promise<StockMovement[]> {
      const list = await inventory.listMovements({ productId })
      return list.slice(-limit).reverse()
    },

    /** پیشنهاد بهای واحد برای موجودی اولیه: قیمت واحد آخرین خرید این کالا (اگر هست) */
    suggestedUnitCost: (productId: string) => createRepositories(db).purchaseInvoices.lastUnitPrice(productId),

    /** ثبت اصلاح دستی موجودی (هرگز عدد موجودی مستقیماً عوض نمی‌شود؛ همیشه یک حرکت + اثر روی لایه‌ها) */
    async adjust(input: AdjustStockInput): Promise<StockMovement> {
      const { kind } = input
      if (!['count', 'opening', 'shortage', 'waste'].includes(kind)) throw new ValidationError({ kind: 'نوع اصلاح موجودی معتبر نیست.' })
      const label = kind === 'count' || kind === 'opening' ? 'موجودی جدید' : 'مقدار'
      const minimum = kind === 'count' || kind === 'opening' ? 0 : 1
      if (!Number.isSafeInteger(input.quantity) || input.quantity < minimum || input.quantity > MAX_QUANTITY) {
        throw new ValidationError({ quantity: minimum === 0 ? `${label} باید صفر یا بیشتر و در محدوده مجاز باشد.` : `${label} را بیشتر از صفر وارد کنید.` })
      }
      const totalMode = kind === 'opening' && input.priceMode === 'total'
      if (totalMode && (input.totalCost === undefined || !Number.isSafeInteger(input.totalCost) || input.totalCost < 0 || input.totalCost > MAX_AMOUNT)) {
        throw new ValidationError({ totalCost: 'مبلغ کل را وارد کنید (عدد صحیح تومان؛ اگر رایگان بوده ۰).' })
      }
      if (kind === 'opening' && !totalMode && (input.unitCost === undefined || !Number.isSafeInteger(input.unitCost) || input.unitCost < 0 || input.unitCost > MAX_UNIT_PRICE)) {
        throw new ValidationError({ unitCost: 'بهای هر واحد را وارد کنید (عدد صحیح تومان؛ اگر رایگان بوده ۰).' })
      }
      const note = cleanText(input.note)
      if (note.length > 200) throw new ValidationError({ note: 'توضیح نباید بیشتر از ۲۰۰ نویسه باشد.' })

      return db.transaction(async (tx) => {
        const inv = createInventoryService(tx)
        const current = await inv.getQuantity(input.warehouseId, input.productId)
        // واحد فرعی فقط در موجودی اولیه: مقدار جدید به واحد ردیف → واحد پایه
        let factor = 1000
        let quantity = input.quantity
        if (kind === 'opening' && input.unitId) {
          const product = await createRepositories(tx).products.getById(input.productId)
          if (!product) throw new ValidationError({ productId: 'کالا پیدا نشد.' })
          const f = factorFor(product, input.unitId)
          if (f === null) throw new ValidationError({ unitId: 'این واحد برای کالا تعریف نشده است.' })
          const sub = product.subUnits?.find((u) => u.unitId === input.unitId)
          if (sub && !sub.allowsFraction && !isWholeQuantity(input.quantity)) throw new ValidationError({ quantity: `واحد «${sub.unitName}» اعشار ندارد.` })
          const b = toBaseQuantity(input.quantity, f)
          if (b === null || b > MAX_QUANTITY) throw new ValidationError({ quantity: 'مقدار به واحد اصلی بیش از سه رقم اعشار یا خارج از محدوده است.' })
          if (!product.unitAllowsFraction && !isWholeQuantity(b)) throw new ValidationError({ quantity: `مقدار به واحد «${product.unitName}» عدد صحیح نمی‌شود.` })
          factor = f
          quantity = b
        }
        const base = { productId: input.productId, warehouseId: input.warehouseId, note: note || null }
        if (kind === 'shortage' || kind === 'waste') {
          if (input.quantity > current) {
            throw new ValidationError({ quantity: `مقدار کم‌شده از موجودی فعلی بیشتر است.` })
          }
          return inv.applyMovement({ ...base, quantityDelta: -input.quantity, movementType: kind })
        }
        const delta = quantity - current
        if (delta === 0) throw new ValidationError({ quantity: 'موجودی جدید با موجودی فعلی یکی است؛ تغییری ثبت نشد.' })
        if (kind === 'opening') {
          if (delta < 0) throw new ValidationError({ quantity: 'موجودی اولیه فقط موجودی را زیاد می‌کند. برای کم کردن، «کسری» یا «ضایعات / خرابی» را انتخاب کنید.' })
          // بهای واحدِ ردیف × (افزایش به واحد ردیف) = delta × unitCost / factor ؛ در حالت مبلغ کل همان عدد واردشده
          const totalCost = totalMode ? (input.totalCost ?? 0) : mulDivRound(delta, input.unitCost ?? 0, factor)
          if (totalCost > MAX_AMOUNT) throw new ValidationError({ unitCost: 'بهای کل بیش از حد مجاز است.' })
          return inv.applyMovement({ ...base, quantityDelta: delta, movementType: 'opening' }, { kind: 'lot', totalCost })
        }
        // شمارش
        if (delta < 0) return inv.applyMovement({ ...base, quantityDelta: delta, movementType: 'shortage' })
        const totalCost = await createCostEngine(tx).foundStockCost(input.productId, delta)
        return inv.applyMovement({ ...base, quantityDelta: delta, movementType: 'adjustment' }, { kind: 'lot', totalCost })
      })
    },
  }
}
