import type { Product } from '../models/catalog'
import type { InvoiceItemInput, LandedMethod, PriceMode } from '../models/invoice'
import { toBaseQuantity, unitPriceFromTotal } from '../utils/invoiceMath'
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
  /** واحد ردیف (خالی = واحد اصلی کالا) */
  unitId?: string | null
  /** فقط خرید: unit = قیمت هر واحد، total = مبلغ کل ردیف */
  priceMode?: PriceMode
  /** حالت total: مبلغ کل ردیف (پیش از تخفیف ردیف) */
  amount?: string
}

export interface ChargeDraft {
  key: string
  title: string
  amount: string
}

export interface InvoiceDraft {
  partyId: string
  warehouseId: string
  day: JalaliDate
  reference: string
  discount: string
  note: string
  lines: LineDraft[]
  /** full = کامل نقدی (پیش‌فرض، جریان سریع)؛ credit = نسیه یا بخشی پرداخت‌شده */
  payMode?: 'full' | 'credit'
  /** مبلغ پرداختی در حالت نسیه (خالی = ۰) */
  paid?: string
  /** فقط خرید: هزینه‌های جانبی و روش تسهیم */
  charges?: ChargeDraft[]
  landedMethod?: LandedMethod
}

export interface DraftTotals {
  /** مبلغ هر ردیف بعد از تخفیف ردیف (null = نامعتبر) */
  lineTotals: Record<string, number | null>
  subtotal: number
  discount: number
  total: number
  /** قیمت هر واحد محاسبه‌شده در حالت مبلغ کل (برای نمایش «هر واحد ≈ ...») */
  lineUnitPrices: Record<string, number | null>
  /** مبلغ ناخالص هر ردیف (برای نمایش «جمع: ...») */
  lineGross: Record<string, number | null>
  landedTotal: number
}

export interface DraftInput {
  /** کلید یک‌باره فرم برای جلوگیری از ثبت تکراری */
  requestId?: string
  partyId: string
  warehouseId: string
  invoiceDate: string
  reference: string | null
  note: string | null
  discount: number
  /** فقط در حالت نسیه؛ نبودن = کل فاکتور */
  paidAmount?: number
  items: InvoiceItemInput[]
  charges?: { title: string; amount: number }[]
  landedMethod?: LandedMethod
}

export const lineError = (key: string, field: 'quantity' | 'unitPrice' | 'discount' | 'product' | 'unit' | 'amount') => `line:${key}:${field}`

/** واحد ردیف: نام، اعشار و ضریب (هزارم واحد پایه) */
export function lineUnit(line: Pick<LineDraft, 'product' | 'unitId'>): { id: string; name: string; allowsFraction: boolean; factor: number } {
  const p = line.product
  const sub = line.unitId && line.unitId !== p.unitId ? p.subUnits?.find((u) => u.unitId === line.unitId && u.isActive) : undefined
  return sub ? { id: sub.unitId, name: sub.unitName, allowsFraction: sub.allowsFraction, factor: sub.factor } : { id: p.unitId, name: p.unitName, allowsFraction: p.unitAllowsFraction, factor: 1000 }
}

/** آخرین انتخاب «قیمت واحد / مبلغ کل» (فقط خرید و موجودی اولیه) */
const PRICE_MODE_KEY = 'anbardar.priceMode.v1'
export function loadPriceMode(): PriceMode {
  try {
    return globalThis.localStorage?.getItem(PRICE_MODE_KEY) === 'total' ? 'total' : 'unit'
  } catch {
    return 'unit'
  }
}
export function savePriceMode(mode: PriceMode): void {
  try {
    globalThis.localStorage?.setItem(PRICE_MODE_KEY, mode)
  } catch {
    /* ignore */
  }
}

function money(text: string): number | null {
  if (text.trim() === '') return 0
  return parseIntegerInput(text)
}

export function lineQuantity(line: LineDraft): number | null {
  const r = parseQuantityInput(line.quantity, lineUnit(line).allowsFraction)
  return r.ok ? r.value : null
}

/** مبلغ ناخالص ردیف: حالت واحد = تعداد × قیمت؛ حالت کل = همان مبلغ */
function grossOf(line: LineDraft, q: number | null): number | null {
  if (line.priceMode === 'total') return money(line.amount ?? '')
  const price = money(line.unitPrice)
  return q !== null && price !== null ? lineGross(q, price) : null
}

/** جمع‌های زنده فرم (برای نمایش؛ ردیف نامعتبر صفر حساب می‌شود) */
export function draftTotals(draft: InvoiceDraft): DraftTotals {
  const lineTotals: Record<string, number | null> = {}
  const lineUnitPrices: Record<string, number | null> = {}
  const grossMap: Record<string, number | null> = {}
  let subtotal = 0
  for (const line of draft.lines) {
    const q = lineQuantity(line)
    const disc = money(line.discount)
    const gross = grossOf(line, q)
    const total = gross !== null && disc !== null && disc <= gross ? gross - disc : null
    lineTotals[line.key] = total
    grossMap[line.key] = gross
    lineUnitPrices[line.key] = line.priceMode === 'total' && gross !== null && q !== null && q > 0 ? unitPriceFromTotal(gross, q) : null
    subtotal += total ?? 0
  }
  const discount = money(draft.discount) ?? 0
  const landedTotal = (draft.charges ?? []).reduce((a, c) => a + (money(c.amount) ?? 0), 0)
  return { lineTotals, lineUnitPrices, lineGross: grossMap, subtotal, discount, total: Math.max(0, subtotal - discount), landedTotal }
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
    const u = lineUnit(line)
    const unitId = u.factor === 1000 && u.id === line.product.unitId ? null : u.id
    const q = parseQuantityInput(line.quantity, u.allowsFraction)
    if (!q.ok) errors[lineError(line.key, 'quantity')] = quantityParseMessage(q.reason, label, u.name)
    else if (q.value <= 0) errors[lineError(line.key, 'quantity')] = `${label} را بیشتر از صفر وارد کنید.`
    else if (toBaseQuantity(q.value, u.factor) === null) errors[lineError(line.key, 'quantity')] = `${label} به واحد «${line.product.unitName}» بیش از سه رقم اعشار می‌شود.`
    const total = line.priceMode === 'total'
    const priceText = total ? (line.amount ?? '') : line.unitPrice
    const priceKey = total ? 'amount' : 'unitPrice'
    const price = money(priceText)
    if (/[.٫]/.test(priceText)) errors[lineError(line.key, priceKey)] = 'مبلغ باید عدد صحیح (تومان) باشد.'
    else if (priceText.trim() === '') errors[lineError(line.key, priceKey)] = total ? `مبلغ کل «${line.product.name}» را وارد کنید.` : `قیمت واحد «${line.product.name}» را وارد کنید.`
    else if (price === null || price > (total ? MAX_AMOUNT : MAX_UNIT_PRICE)) errors[lineError(line.key, priceKey)] = total ? 'مبلغ کل معتبر نیست.' : 'قیمت واحد معتبر نیست.'
    const disc = money(line.discount)
    if (disc === null) errors[lineError(line.key, 'discount')] = 'تخفیف ردیف معتبر نیست.'
    if (q.ok && q.value > 0 && price !== null && disc !== null) {
      const gross = total ? price : lineGross(q.value, price)
      if (gross === null) errors[lineError(line.key, priceKey)] = 'مبلغ این ردیف بیش از حد مجاز است.'
      else if (disc > gross) errors[lineError(line.key, 'discount')] = 'تخفیف ردیف نمی‌تواند از مبلغ ردیف بیشتر باشد.'
      items.push(
        total
          ? { productId: line.product.id, unitId, quantity: q.value, unitPrice: 0, priceMode: 'total', lineAmount: price, discount: disc }
          : { productId: line.product.id, unitId, quantity: q.value, unitPrice: price, discount: disc },
      )
    }
  })
  const totals = draftTotals(draft)
  const discount = money(draft.discount)
  if (discount === null || discount > MAX_AMOUNT) errors['discount'] = 'تخفیف فاکتور معتبر نیست.'
  else if (discount > totals.subtotal) errors['discount'] = 'تخفیف فاکتور نمی‌تواند از جمع فاکتور بیشتر باشد.'
  if (totals.subtotal > MAX_AMOUNT) errors['items'] = 'جمع فاکتور بیش از حد مجاز است.'
  let paidAmount: number | undefined
  if (draft.payMode === 'credit') {
    const paid = money(draft.paid ?? '')
    if (paid === null || /[.٫]/.test(draft.paid ?? '')) errors['paidAmount'] = 'مبلغ پرداختی باید عدد صحیح (تومان) باشد.'
    else if (paid > totals.total) errors['paidAmount'] = 'مبلغ پرداختی از جمع فاکتور بیشتر است.'
    else paidAmount = paid
  }
  let charges: { title: string; amount: number }[] | undefined
  if (draft.charges) {
    charges = []
    for (const c of draft.charges) {
      const title = c.title.trim()
      const amount = money(c.amount)
      if (!title && c.amount.trim() === '') continue
      if (!title) errors[`charge:${c.key}:title`] = 'عنوان هزینه را وارد کنید.'
      if (amount === null || amount <= 0 || /[.٫]/.test(c.amount)) errors[`charge:${c.key}:amount`] = 'مبلغ هزینه را عدد صحیح بیشتر از صفر وارد کنید.'
      else if (title) charges.push({ title, amount })
    }
  }
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
      ...(paidAmount === undefined ? {} : { paidAmount }),
      items,
      ...(charges ? { charges, landedMethod: draft.landedMethod ?? 'value' } : {}),
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
    const c = /^charges\.(\d+)\.(title|amount)$/.exec(k)
    const charge = c ? draft.charges?.filter((x) => x.title.trim() || x.amount.trim())[Number(c[1])] : undefined
    if (m && line) {
      const field = m[2] === 'productId' ? 'product' : m[2] === 'unitId' ? 'unit' : m[2] === 'lineAmount' ? 'amount' : (m[2] as 'quantity' | 'unitPrice' | 'discount')
      out[lineError(line.key, field)] = v
    } else if (c && charge) out[`charge:${charge.key}:${c[2]}`] = v
    else if (k === 'partyId') out['party'] = v
    else if (k === 'warehouseId') out['warehouse'] = v
    else out[k] = v
  }
  return out
}

/** تغییر تعداد با دکمه + / − (یک واحد کامل) */
export function stepQuantity(text: string, product: Product, delta: 1 | -1, allowsFraction = product.unitAllowsFraction): string {
  const r = parseQuantityInput(text, true)
  const current = r.ok ? r.value : 0
  const next = Math.max(QUANTITY_SCALE, current + delta * QUANTITY_SCALE)
  return quantityToInputText(allowsFraction ? next : Math.round(next / QUANTITY_SCALE) * QUANTITY_SCALE)
}
