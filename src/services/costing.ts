import type { SqlExecutor } from '../database/types'
import type { CostLot } from '../models/costing'
import type { MovementCosts } from '../models/stock'
import { createRepositories } from '../repositories'
import type { AverageState } from '../repositories'
import { AppError } from '../utils/errors'
import { mulDivRound } from '../utils/money'

export interface PlannedAllocation {
  lot: CostLot
  quantity: number
  cost: number
}

export interface OutboundPlan {
  allocations: PlannedAllocation[]
  costs: MovementCosts
}

/**
 * موتور بهای تمام‌شده (فقط خواندن و محاسبه؛ نوشتن با سرویس موجودی و داخل همان تراکنش).
 *
 * - FIFO: برداشت از قدیمی‌ترین لایه‌ها. بهای برداشت جزئی = round(تعداد × بهای کل لایه ÷ تعداد لایه)؛
 *   برداشتی که لایه را تمام می‌کند «بهای باقی‌مانده لایه» را برمی‌دارد تا جمع بهای هر لایه دقیقاً برابر بهای آن شود.
 * - میانگین متحرک (در سطح کالا، همه انبارها): بهای خروج = round(ارزش × تعداد خروج ÷ تعداد کل).
 * - آخرین قیمت خرید: بهای واحد آخرین لایه خرید (بعد از تخفیف‌ها)؛ اگر خریدی نیست، آخرین لایه از هر نوع؛ اگر هیچ، صفر.
 */
export function createCostEngine(tx: SqlExecutor) {
  const repos = createRepositories(tx)

  async function lotRemainingCost(lot: CostLot): Promise<number> {
    return Math.max(0, lot.totalCost - (await repos.costs.activeAllocatedCost(lot.id)))
  }

  async function averageCostOf(productId: string, quantity: number): Promise<number> {
    const state = await repos.costs.getAverage(productId)
    if (state.quantity <= 0) return 0
    if (quantity >= state.quantity) return state.value
    return mulDivRound(state.value, quantity, state.quantity)
  }

  async function lastCostOf(productId: string, quantity: number): Promise<number> {
    const lot = (await repos.costs.latestLot(productId, { purchaseOnly: true })) ?? (await repos.costs.latestLot(productId, { purchaseOnly: false }))
    return lot ? mulDivRound(lot.totalCost, quantity, lot.quantity) : 0
  }

  return {
    averageCostOf,
    lastCostOf,

    /**
     * برنامه برداشت FIFO و بهای هر سه روش برای خروج `quantity` از یک کالا در یک انبار.
     * اگر preferLotMovementId داده شود، اول از لایه همان حرکت (مثلاً خرید مبدأ برگشت) برداشت می‌شود.
     */
    async planOutbound(productId: string, warehouseId: string, quantity: number, preferLotMovementId?: string): Promise<OutboundPlan> {
      let lots = await repos.costs.openLots(productId, warehouseId)
      if (preferLotMovementId) {
        const preferred = lots.filter((l) => l.movementId === preferLotMovementId)
        const rest = lots.filter((l) => l.movementId !== preferLotMovementId)
        lots = [...preferred, ...rest]
      }
      const allocations: PlannedAllocation[] = []
      let left = quantity
      for (const lot of lots) {
        if (left === 0) break
        const take = Math.min(left, lot.remaining)
        const remainingCost = await lotRemainingCost(lot)
        const cost = take === lot.remaining ? remainingCost : Math.min(remainingCost, mulDivRound(take, lot.totalCost, lot.quantity))
        allocations.push({ lot, quantity: take, cost })
        left -= take
      }
      if (left > 0) {
        // با قاعده ثابت (جمع لایه‌ها = موجودی) نباید رخ دهد؛ قبل از این، کافی بودن موجودی بررسی شده است
        throw new AppError('integrity', 'بهای کالا برای این مقدار پیدا نشد (لایه‌های بها با موجودی نمی‌خواند). از بخش پشتیبان‌گیری، «بررسی سلامت اطلاعات» را اجرا کنید.')
      }
      return {
        allocations,
        costs: {
          fifo: allocations.reduce((sum, a) => sum + a.cost, 0),
          average: await averageCostOf(productId, quantity),
          last: await lastCostOf(productId, quantity),
        },
      }
    },

    /**
     * بهای ورود کالایی که بدون فاکتور خرید پیدا شده (اضافه در شمارش): میانگین موزون فعلی کالا؛
     * اگر کالا الان موجودی ندارد، بهای واحد آخرین لایه؛ اگر هیچ لایه‌ای نبوده، صفر.
     */
    async foundStockCost(productId: string, quantity: number): Promise<number> {
      const state = await repos.costs.getAverage(productId)
      if (state.quantity > 0) return mulDivRound(state.value, quantity, state.quantity)
      return lastCostOf(productId, quantity)
    },

    async addToAverage(productId: string, quantity: number, value: number): Promise<void> {
      const s = await repos.costs.getAverage(productId)
      await repos.costs.setAverage(productId, { quantity: s.quantity + quantity, value: s.value + value })
    },

    async removeFromAverage(productId: string, quantity: number, value: number): Promise<void> {
      const s = await repos.costs.getAverage(productId)
      const q = s.quantity - quantity
      const next: AverageState = q <= 0 ? { quantity: Math.max(0, q), value: 0 } : { quantity: q, value: Math.max(0, s.value - value) }
      await repos.costs.setAverage(productId, next)
    },
  }
}
