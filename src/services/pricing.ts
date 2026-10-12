import type { Product } from '../models/catalog'
import type { AppSettings, CostMethod, SalePriceMode } from '../models/settings'
import { MAX_MARKUP_BP } from '../models/settings'
import { MAX_AMOUNT, MAX_UNIT_PRICE } from '../models/limits'
import { createRepositories } from '../repositories'
import type { SqlExecutor } from '../database/types'
import { AppError } from '../utils/errors'
import { mulDivCeil } from '../utils/money'

/** نتیجه ماشین‌حساب قیمت (هر دو تفسیر سود، با گرد به بالا) */
export interface PriceCalcResult {
  cost: number
  /** قیمت فروش با «سود روی خرید»: cost × (1 + p) */
  markupPrice: number
  /** قیمت فروش با «سود از فروش»: cost ÷ (1 − p) — تضمین همان درصد از مبلغ دریافتی */
  marginPrice: number
}

/**
 * ماشین‌حساب حداقل قیمت فروش.
 * درصد به صدم درصد است (۱۳٪ = ۱۳۰۰). هر دو تفسیر جداگانه با توضیح فارسی در UI نشان داده می‌شود.
 */
export function calcMinSalePrice(purchasePrice: number, extraCost: number, markupBp: number): PriceCalcResult {
  if (![purchasePrice, extraCost, markupBp].every((n) => Number.isSafeInteger(n) && n >= 0)) {
    throw new AppError('validation', 'مبالغ و درصد باید عدد صحیح نامنفی باشند.')
  }
  if (markupBp > MAX_MARKUP_BP) throw new AppError('validation', 'درصد سود بیش از حد مجاز است.')
  if (purchasePrice > MAX_UNIT_PRICE || extraCost > MAX_AMOUNT) throw new AppError('validation', 'مبلغ بیش از حد مجاز است.')
  const cost = purchasePrice + extraCost
  if (cost > MAX_AMOUNT) throw new AppError('validation', 'جمع هزینه بیش از حد مجاز است.')
  const markupPrice = mulDivCeil(cost, 10_000 + markupBp, 10_000)
  // حاشیه ۱۰۰٪ یا بیشتر تعریف ندارد (هزینه باید صفر باشد)
  const marginPrice = markupBp >= 10_000 ? MAX_AMOUNT : mulDivCeil(cost, 10_000, 10_000 - markupBp)
  return { cost, markupPrice: Math.min(markupPrice, MAX_AMOUNT), marginPrice: Math.min(marginPrice, MAX_AMOUNT) }
}

/** درصد سود مؤثر برای یک کالا: درصد گروه اگر تنظیم شده، وگرنه درصد سراسری */
export function effectiveMarkupBp(settings: AppSettings, groupMarkupBp: number | null | undefined): number {
  return groupMarkupBp != null ? groupMarkupBp : settings.markupBp
}

/**
 * پیشنهاد قیمت واحد فروش بر اساس تنظیمات.
 * null = فیلد خالی بماند (حالت دستی، یا اولین فروش در حالت last_sale، یا نبود قیمت خرید در حالت markup).
 */
export async function suggestSaleUnitPrice(db: SqlExecutor, product: Product, settings: AppSettings): Promise<number | null> {
  const repos = createRepositories(db)
  if (settings.salePriceMode === 'manual') return null
  if (settings.salePriceMode === 'last_sale') return repos.salesInvoices.lastUnitPrice(product.id)
  // markup: آخرین قیمت خرید + درصد
  const lastBuy = await repos.purchaseInvoices.lastUnitPrice(product.id)
  if (lastBuy === null) return null
  const group = await repos.productGroups.getById(product.groupId)
  const bp = effectiveMarkupBp(settings, group?.markupBp)
  return calcMinSalePrice(lastBuy, 0, bp).markupPrice
}

/** انتخاب بهای ذخیره‌شده روی ردیف/حرکت بر اساس روش تنظیمات */
export function pickCost(costs: { fifo: number; average: number; last: number } | null | undefined, method: CostMethod): number {
  if (!costs) return 0
  return costs[method]
}

export function salePriceModeLabel(mode: SalePriceMode): string {
  return mode === 'manual' ? 'دستی (خالی)' : mode === 'last_sale' ? 'آخرین قیمت فروش همین کالا' : 'آخرین قیمت خرید + درصد سود'
}

export function costMethodLabel(method: CostMethod): string {
  return method === 'fifo' ? 'اولین ورودی، اولین خروجی (FIFO)' : method === 'average' ? 'میانگین موزون متحرک' : 'آخرین قیمت خرید'
}
