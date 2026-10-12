import type { Product } from '../models/catalog'
import type { InvoiceItemInput } from '../models/invoice'
import { MAX_AMOUNT, MAX_UNIT_PRICE } from '../models/limits'
import { ValidationError } from '../utils/errors'
import { compareJalali, fromJalali, toJalali, type JalaliDate } from '../utils/jalali'
import { parseIntegerInput } from '../utils/persian'
import { lineGross, parseQuantityInput, quantityParseMessage, quantityToInputText, QUANTITY_SCALE } from '../utils/quantity'

/**
 * منطق فرم فاکتور (خرید و فروش) جدا از UI: متن‌های واردشده ← ورودی سرویس، جمع‌ها و پیام‌های خطا.
 * کلید خطاها: `party`، `warehouse`، `discount`، `items` و برای ردیف‌ها `line:<key>:quantity|unitPrice|discount|product`.
 */
export interface LineDraft {
  /** کلید پایدار ردیف در UI */
  key: string
  product: Product
  quantity: string
  unitPrice: string
  discount: string
}

export interface InvoiceDraft {
  partyId: string
  warehouseId: string
  day: JalaliDate
  reference: string
  discount: string
  note: string
  lines: LineDraft[]
}

export interface DraftTotals {
  /** مبلغ هر ردیف بعد از تخفیف ردیف (null = نامعتبر) */
  lineTotals: Record<string, number | null>
  subtotal: number
  discount: number
  total: number
}

export interface DraftInput {
  partyId: string
  warehouseId: string
  invoiceDate: string
  reference: string | null
  note: string | null
  discount: number
  items: InvoiceItemInput[]
}

export const lineError = (key: string, field: 'quantity' | 'unitPrice' | 'discount' | 'product') => `line:${key}:${field}`

function money(text: string): number | null {
  if (text.trim() === '') return 0
  return parseIntegerInput(text)
}

export function lineQuantity(line: LineDraft): number | null {
  const r = parseQuantityInput(line.quantity, line.product.unitAllowsFraction)
  return r.ok ? r.value : null
}

/** جمع‌های زنده فرم (برای نمایش؛ ردیف نامعتبر صفر حساب می‌شود) */
export function draftTotals(draft: InvoiceDraft): DraftTotals {
  const lineTotals: Record<string, number | null> = {}
  let subtotal = 0
  for (const line of draft.lines) {
    const q = lineQuantity(line)
    const price = money(line.unitPrice)
    const disc = money(line.discount)
    const gross = q !== null && price !== null ? lineGross(q, price) : null
    const total = gross !== null && disc !== null && disc <= gross ? gross - disc : null
    lineTotals[line.key] = total
    subtotal += total ?? 0
  }
  const discount = money(draft.discount) ?? 0
  return { lineTotals, subtotal, discount, total: Math.max(0, subtotal - discount) }
}

/** آیا روز انتخاب‌شده بعد از امروز است؟ (فقط هشدار؛ ثبت مجاز است) */
export function isFutureDay(day: JalaliDate, now = new Date()): boolean {
  return compareJalali(day, toJalali(now)) > 0
}

/** زمان سند: اگر امروز است «همین الان»، وگرنه همان روز با ساعت فعلی */
export function draftDate(day: JalaliDate, now = new Date()): string {
  if (compareJalali(day, toJalali(now)) === 0) return now.toISOString()
  return fromJalali(day, now.getHours(), now.getMinutes()).toISOString()
}

export function draftToInput(draft: InvoiceDraft, now = new Date()): { ok: true; input: DraftInput } | { ok: false; errors: Record<string, string> } {
  const errors: Record<string, string> = {}
  if (!draft.warehouseId) errors['warehouse'] = 'انبار را انتخاب کنید.'
  if (draft.lines.length === 0) errors['items'] = 'حداقل یک کالا به فاکتور اضافه کنید.'
  const items: InvoiceItemInput[] = []
  draft.lines.forEach((line) => {
    const label = `تعداد «${line.product.name}»`
    const q = parseQuantityInput(line.quantity, line.product.unitAllowsFraction)
    if (!q.ok) errors[lineError(line.key, 'quantity')] = quantityParseMessage(q.reason, label, line.product.unitName)
    else if (q.value <= 0) errors[lineError(line.key, 'quantity')] = `${label} را بیشتر از صفر وارد کنید.`
    const price = money(line.unitPrice)
    if (/[.٫]/.test(line.unitPrice)) errors[lineError(line.key, 'unitPrice')] = 'قیمت باید عدد صحیح (تومان) باشد.'
    else if (line.unitPrice.trim() === '') errors[lineError(line.key, 'unitPrice')] = `قیمت واحد «${line.product.name}» را وارد کنید.`
    else if (price === null || price > MAX_UNIT_PRICE) errors[lineError(line.key, 'unitPrice')] = 'قیمت واحد معتبر نیست.'
    const disc = money(line.discount)
    if (disc === null) errors[lineError(line.key, 'discount')] = 'تخفیف ردیف معتبر نیست.'
    if (q.ok && q.value > 0 && price !== null && disc !== null) {
      const gross = lineGross(q.value, price)
      if (gross === null) errors[lineError(line.key, 'unitPrice')] = 'مبلغ این ردیف بیش از حد مجاز است.'
      else if (disc > gross) errors[lineError(line.key, 'discount')] = 'تخفیف ردیف نمی‌تواند از مبلغ ردیف بیشتر باشد.'
      items.push({ productId: line.product.id, quantity: q.value, unitPrice: price, discount: disc })
    }
  })
  const totals = draftTotals(draft)
  const discount = money(draft.discount)
  if (discount === null || discount > MAX_AMOUNT) errors['discount'] = 'تخفیف فاکتور معتبر نیست.'
  else if (discount > totals.subtotal) errors['discount'] = 'تخفیف فاکتور نمی‌تواند از جمع فاکتور بیشتر باشد.'
  if (totals.subtotal > MAX_AMOUNT) errors['items'] = 'جمع فاکتور بیش از حد مجاز است.'
  if (Object.keys(errors).length) return { ok: false, errors }
  return {
    ok: true,
    input: {
      partyId: draft.partyId,
      warehouseId: draft.warehouseId,
      invoiceDate: draftDate(draft.day, now),
      reference: draft.reference.trim() || null,
      note: draft.note.trim() || null,
      discount: discount ?? 0,
      items,
    },
  }
}

/** خطای سرویس (کلیدهای items.i.x) ← کلیدهای فرم */
export function mapServiceErrors(error: unknown, draft: InvoiceDraft): Record<string, string> | null {
  if (!(error instanceof ValidationError)) return null
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(error.fieldErrors)) {
    const m = /^items\.(\d+)\.(\w+)$/.exec(k)
    const line = m ? draft.lines[Number(m[1])] : undefined
    if (m && line) out[lineError(line.key, m[2] === 'productId' ? 'product' : (m[2] as 'quantity' | 'unitPrice' | 'discount'))] = v
    else if (k === 'partyId') out['party'] = v
    else if (k === 'warehouseId') out['warehouse'] = v
    else out[k] = v
  }
  return out
}

/** تغییر تعداد با دکمه + / − (یک واحد کامل) */
export function stepQuantity(text: string, product: Product, delta: 1 | -1): string {
  const r = parseQuantityInput(text, true)
  const current = r.ok ? r.value : 0
  const next = Math.max(QUANTITY_SCALE, current + delta * QUANTITY_SCALE)
  return quantityToInputText(product.unitAllowsFraction ? next : Math.round(next / QUANTITY_SCALE) * QUANTITY_SCALE)
}
