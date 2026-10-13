import type { InvoiceInput, LandedMethod, PriceMode } from '../models/invoice'
import type { MovementCosts } from '../models/stock'
import { MAX_AMOUNT } from '../models/limits'
import { AppError, ValidationError } from './errors'
import { newId } from './id'
import { lineGross } from './quantity'

export interface PreparedLine {
  id: string
  productId: string
  /** هزارم واحد پایه */
  quantity: number
  unitId: string | null
  unitFactor: number
  /** هزارم واحد ردیف */
  unitQuantity: number
  /** قیمت هر واحد ردیف (در حالت total: گردشده برای نمایش) */
  unitPrice: number
  priceMode: PriceMode
  grossAmount: number
  /** تخفیف ردیف */
  discount: number
  /** grossAmount − تخفیف ردیف */
  lineTotal: number
  /** سهم این ردیف از تخفیف کل فاکتور */
  invoiceDiscountShare: number
  /** فقط خرید: سهم هزینه‌های جانبی */
  landedShare: number
  note: string | null
  /** فقط فروش: بهای این ردیف به سه روش */
  costs?: MovementCosts
}

export interface PreparedInvoice {
  id: string
  /** جمع ردیف‌ها (بعد از تخفیف ردیف‌ها) */
  subtotal: number
  /** تخفیف کل فاکتور */
  discount: number
  /** مبلغ نهایی = subtotal − discount (پرداختی در خرید، دریافتی در فروش) */
  total: number
  /** هزینه‌های جانبی خرید (جزو total نیست) */
  landedTotal: number
  landedMethod: LandedMethod
  lines: PreparedLine[]
}

/** تقسیم دقیق یک مبلغ صحیح به نسبت وزن‌ها با روش «بزرگ‌ترین باقی‌مانده» (جمع سهم‌ها دقیقاً برابر مبلغ) */
export function allocateExact(amount: number, weights: readonly number[], cap?: readonly number[]): number[] {
  const total = weights.reduce((a, b) => a + b, 0)
  if (amount <= 0 || total <= 0) return weights.map(() => 0)
  const A = BigInt(amount)
  const W = BigInt(total)
  const shares = weights.map((w) => Number((A * BigInt(w)) / W))
  const remainders = weights.map((w, i) => ({ i, r: (A * BigInt(w)) % W }))
  let left = amount - shares.reduce((a, b) => a + b, 0)
  remainders.sort((a, b) => (a.r === b.r ? a.i - b.i : a.r > b.r ? -1 : 1))
  while (left > 0) {
    let progressed = false
    for (const { i } of remainders) {
      if (left === 0) break
      if ((weights[i] ?? 0) <= 0) continue
      if (cap && (shares[i] ?? 0) >= (cap[i] ?? 0)) continue
      shares[i] = (shares[i] ?? 0) + 1
      left--
      progressed = true
    }
    if (!progressed) throw new AppError('validation', 'تقسیم مبلغ ممکن نیست.')
  }
  return shares
}

/**
 * تقسیم تخفیف کل فاکتور بین ردیف‌ها به نسبت مبلغ ردیف (عدد صحیح، جمع سهم‌ها دقیقاً برابر تخفیف).
 * باقی‌مانده تقسیم به ترتیب «بزرگ‌ترین کسر» داده می‌شود و هیچ سهمی از مبلغ ردیفش بیشتر نمی‌شود.
 */
export function splitDiscount(discount: number, lineTotals: readonly number[]): number[] {
  const subtotal = lineTotals.reduce((a, b) => a + b, 0)
  if (discount <= 0 || subtotal <= 0) return lineTotals.map(() => 0)
  if (discount > subtotal) throw new AppError('validation', 'تخفیف فاکتور نمی‌تواند از جمع فاکتور بیشتر باشد.')
  return allocateExact(discount, lineTotals, lineTotals)
}

/** تبدیل تعداد واحد ردیف به واحد پایه؛ null اگر بخش‌پذیر دقیق نباشد (بیش از سه رقم اعشار در واحد پایه) */
export function toBaseQuantity(unitQuantity: number, factor: number): number | null {
  const raw = BigInt(unitQuantity) * BigInt(factor)
  if (raw % 1000n !== 0n) return null
  const q = raw / 1000n
  return q > BigInt(Number.MAX_SAFE_INTEGER) ? null : Number(q)
}

/** قیمت هر واحد ردیف برای حالت «مبلغ کل» (فقط نمایش؛ نیم به بالا) */
export function unitPriceFromTotal(gross: number, unitQuantity: number): number {
  if (unitQuantity <= 0) return 0
  return Number((BigInt(gross) * 1000n * 2n + BigInt(unitQuantity)) / (BigInt(unitQuantity) * 2n))
}

export interface PrepareOptions {
  /** ضریب واحد فرعی کالا (هزارم واحد پایه)؛ null = این واحد برای کالا تعریف نشده */
  factorOf?: (productId: string, unitId: string) => number | null
  /** هزینه‌های جانبی خرید */
  landed?: { total: number; method: LandedMethod }
}

/** محاسبه مبلغ ردیف‌ها، سهم تخفیف و جمع‌ها؛ ورودی باید قبلاً اعتبارسنجی شده باشد */
export function prepareInvoice(input: InvoiceInput, ids?: { invoiceId?: string; lineIds?: readonly string[] }, opts: PrepareOptions = {}): PreparedInvoice {
  const errors: Record<string, string> = {}
  const lines = input.items.map((it, i) => {
    const unitId = it.unitId || null
    const factor = unitId ? (opts.factorOf?.(it.productId, unitId) ?? null) : 1000
    if (factor === null) {
      errors[`items.${i}.unitId`] = `واحد ردیف ${i + 1} برای این کالا تعریف نشده است.`
      return null
    }
    const base = toBaseQuantity(it.quantity, factor)
    if (base === null || base <= 0) {
      errors[`items.${i}.quantity`] = `تعداد ردیف ${i + 1} به واحد اصلی بیش از سه رقم اعشار می‌شود.`
      return null
    }
    const priceMode: PriceMode = it.priceMode === 'total' ? 'total' : 'unit'
    const gross = priceMode === 'total' ? (it.lineAmount ?? 0) : lineGross(it.quantity, it.unitPrice)
    if (gross === null || gross > MAX_AMOUNT || gross < 0) throw new AppError('validation', 'مبلغ یکی از ردیف‌ها بیش از حد مجاز است.')
    const discount = it.discount ?? 0
    if (discount > gross) throw new AppError('validation', 'تخفیف ردیف نمی‌تواند از مبلغ ردیف بیشتر باشد.')
    return {
      id: ids?.lineIds?.[i] ?? newId(),
      productId: it.productId,
      quantity: base,
      unitId,
      unitFactor: factor,
      unitQuantity: it.quantity,
      unitPrice: priceMode === 'total' ? unitPriceFromTotal(gross, it.quantity) : it.unitPrice,
      priceMode,
      grossAmount: gross,
      discount,
      lineTotal: gross - discount,
      invoiceDiscountShare: 0,
      landedShare: 0,
      note: it.note ?? null,
    } satisfies PreparedLine
  })
  if (Object.keys(errors).length) throw new ValidationError(errors)
  const ready = lines as PreparedLine[]
  const totals = ready.map((l) => l.lineTotal)
  const discount = input.discount ?? 0
  const shares = splitDiscount(discount, totals)
  ready.forEach((l, i) => (l.invoiceDiscountShare = shares[i] ?? 0))
  const landedTotal = opts.landed?.total ?? 0
  const landedMethod: LandedMethod = opts.landed?.method ?? 'value'
  if (landedTotal > 0) {
    const byValue = ready.map((l) => l.lineTotal - l.invoiceDiscountShare)
    const weights = landedMethod === 'quantity' || byValue.every((v) => v === 0) ? ready.map((l) => l.quantity) : byValue
    const landed = allocateExact(landedTotal, weights)
    ready.forEach((l, i) => (l.landedShare = landed[i] ?? 0))
  }
  const subtotal = totals.reduce((a, b) => a + b, 0)
  return { id: ids?.invoiceId ?? newId(), subtotal, discount, total: subtotal - discount, landedTotal, landedMethod, lines: ready }
}
