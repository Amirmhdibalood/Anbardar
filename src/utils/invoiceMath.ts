import type { InvoiceInput } from '../models/invoice'
import type { MovementCosts } from '../models/stock'
import { AppError } from './errors'
import { newId } from './id'
import { lineGross } from './quantity'

export interface PreparedLine {
  id: string
  productId: string
  /** هزارم واحد */
  quantity: number
  unitPrice: number
  /** تخفیف ردیف */
  discount: number
  /** round(تعداد × قیمت) − تخفیف ردیف */
  lineTotal: number
  /** سهم این ردیف از تخفیف کل فاکتور */
  invoiceDiscountShare: number
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
  lines: PreparedLine[]
}

/**
 * تقسیم تخفیف کل فاکتور بین ردیف‌ها به نسبت مبلغ ردیف (عدد صحیح، جمع سهم‌ها دقیقاً برابر تخفیف).
 * باقی‌مانده تقسیم به ترتیب «بزرگ‌ترین کسر» داده می‌شود و هیچ سهمی از مبلغ ردیفش بیشتر نمی‌شود.
 */
export function splitDiscount(discount: number, lineTotals: readonly number[]): number[] {
  const subtotal = lineTotals.reduce((a, b) => a + b, 0)
  if (discount <= 0 || subtotal <= 0) return lineTotals.map(() => 0)
  if (discount > subtotal) throw new AppError('validation', 'تخفیف فاکتور نمی‌تواند از جمع فاکتور بیشتر باشد.')
  const D = BigInt(discount)
  const S = BigInt(subtotal)
  const shares = lineTotals.map((t) => Number((D * BigInt(t)) / S))
  const remainders = lineTotals.map((t, i) => ({ i, r: (D * BigInt(t)) % S }))
  let left = discount - shares.reduce((a, b) => a + b, 0)
  remainders.sort((a, b) => (a.r === b.r ? a.i - b.i : a.r > b.r ? -1 : 1))
  for (const { i } of remainders) {
    if (left === 0) break
    if ((shares[i] ?? 0) < (lineTotals[i] ?? 0)) {
      shares[i] = (shares[i] ?? 0) + 1
      left--
    }
  }
  return shares
}

/** محاسبه مبلغ ردیف‌ها، سهم تخفیف و جمع‌ها؛ ورودی باید قبلاً اعتبارسنجی شده باشد */
export function prepareInvoice(input: InvoiceInput, ids?: { invoiceId?: string; lineIds?: readonly string[] }): PreparedInvoice {
  const totals = input.items.map((it) => {
    const gross = lineGross(it.quantity, it.unitPrice)
    if (gross === null) throw new AppError('validation', 'مبلغ یکی از ردیف‌ها بیش از حد مجاز است.')
    const discount = it.discount ?? 0
    if (discount > gross) throw new AppError('validation', 'تخفیف ردیف نمی‌تواند از مبلغ ردیف بیشتر باشد.')
    return gross - discount
  })
  const discount = input.discount ?? 0
  const shares = splitDiscount(discount, totals)
  const subtotal = totals.reduce((a, b) => a + b, 0)
  return {
    id: ids?.invoiceId ?? newId(),
    subtotal,
    discount,
    total: subtotal - discount,
    lines: input.items.map((it, i) => ({
      id: ids?.lineIds?.[i] ?? newId(),
      productId: it.productId,
      quantity: it.quantity,
      unitPrice: it.unitPrice,
      discount: it.discount ?? 0,
      lineTotal: totals[i] ?? 0,
      invoiceDiscountShare: shares[i] ?? 0,
      note: it.note ?? null,
    })),
  }
}
