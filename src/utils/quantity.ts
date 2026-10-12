import { MAX_AMOUNT, MAX_QUANTITY } from '../models/limits'
import type { Money } from '../models/common'
import { toEnglishDigits, toPersianDigits } from './persian'

/**
 * تعداد همیشه به‌صورت «هزارم واحد» (عدد صحیح) ذخیره و جابه‌جا می‌شود:
 * ۱٫۵ کیلو = ۱۵۰۰ و ۳ عدد = ۳۰۰۰. هیچ جای برنامه عدد اعشاری (float) برای تعداد نیست.
 */
export type Quantity = number

export const QUANTITY_SCALE = 1000
export const QUANTITY_DECIMALS = 3
/** جداکننده اعشار فارسی */
export const DECIMAL_SEPARATOR = '٫'

/** تبدیل تعداد صحیح (مثلاً ۳ عدد) به مقدار ذخیره‌ای */
export function wholeQuantity(units: number): Quantity {
  return units * QUANTITY_SCALE
}

export function isWholeQuantity(quantity: Quantity): boolean {
  return quantity % QUANTITY_SCALE === 0
}

/** نمایش تعداد با ارقام فارسی، بدون صفرهای بی‌مورد: ۱۵۰۰ ← «۱٫۵»، ۱۲۳۴۰۰۰ ← «۱,۲۳۴» */
export function formatQuantity(quantity: Quantity): string {
  const sign = quantity < 0 ? '-' : ''
  const abs = Math.abs(quantity)
  const whole = Math.floor(abs / QUANTITY_SCALE)
  const fraction = String(abs % QUANTITY_SCALE).padStart(QUANTITY_DECIMALS, '0').replace(/0+$/, '')
  const grouped = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return toPersianDigits(sign + grouped + (fraction ? DECIMAL_SEPARATOR + fraction : ''))
}

/** تعداد همراه با نام واحد: «۱٫۵ کیلو» */
export function formatQuantityWithUnit(quantity: Quantity, unitName: string): string {
  return `${formatQuantity(quantity)} ${unitName}`
}

/** مقدار برای نمایش داخل فیلد ورودی (بدون جداکننده هزارگان) */
export function quantityToInputText(quantity: Quantity): string {
  return formatQuantity(quantity).replace(/,/g, '')
}

export type QuantityParseResult =
  | { ok: true; value: Quantity }
  | { ok: false; reason: 'invalid' | 'fraction_not_allowed' | 'too_many_decimals' | 'too_large' | 'negative' }

/**
 * تبدیل متن کاربر به تعداد. ارقام فارسی/عربی، «٫» و «.» و «/» به‌عنوان اعشار و «,» «٬» به‌عنوان هزارگان پذیرفته می‌شوند.
 * متن خالی = ۰. اگر واحد اعشار نداشته باشد (allowFraction=false) فقط عدد صحیح معتبر است.
 */
export function parseQuantityInput(text: string, allowFraction: boolean): QuantityParseResult {
  const cleaned = toEnglishDigits(text)
    .replace(/[,\u066C\u060C\s]/g, '')
    .replace(/[\u066B/]/g, '.')
  if (cleaned === '') return { ok: true, value: 0 }
  if (cleaned.startsWith('-')) return { ok: false, reason: 'negative' }
  const match = /^(\d+)(?:\.(\d*))?$/.exec(cleaned)
  if (!match) return { ok: false, reason: 'invalid' }
  const wholePart = match[1] ?? '0'
  const fractionPart = match[2] ?? ''
  if (fractionPart.length > QUANTITY_DECIMALS) return { ok: false, reason: 'too_many_decimals' }
  if (/[1-9]/.test(fractionPart) && !allowFraction) return { ok: false, reason: 'fraction_not_allowed' }
  if (wholePart.length > 9) return { ok: false, reason: 'too_large' }
  const value = Number(wholePart) * QUANTITY_SCALE + Number(fractionPart.padEnd(QUANTITY_DECIMALS, '0'))
  if (value > MAX_QUANTITY) return { ok: false, reason: 'too_large' }
  return { ok: true, value }
}

/** پیام فارسی برای خطای تبدیل تعداد */
export function quantityParseMessage(reason: Exclude<QuantityParseResult, { ok: true }>['reason'], label: string, unitName?: string): string {
  switch (reason) {
    case 'fraction_not_allowed':
      return `${label} باید عدد صحیح باشد${unitName ? ` (واحد «${unitName}» اعشار ندارد)` : ''}.`
    case 'too_many_decimals':
      return `${label} حداکثر تا سه رقم اعشار می‌تواند داشته باشد.`
    case 'too_large':
      return `${label} بیش از حد مجاز است.`
    case 'negative':
      return `${label} نمی‌تواند منفی باشد.`
    default:
      return `${label} را به‌صورت عدد وارد کنید.`
  }
}

/**
 * مبلغ ناخالص ردیف = تعداد × قیمت واحد، با گرد کردن «نیم به بالا» به تومان.
 * با BigInt محاسبه می‌شود چون حاصل‌ضرب خام ممکن است از ۲^۵۳ بزرگ‌تر شود؛ همان فرمول CHECK دیتابیس است:
 * (quantity * unit_price + 500) / 1000
 * اگر نتیجه از سقف مجاز مبلغ بیشتر شود، null برمی‌گرداند.
 */
export function lineGross(quantity: Quantity, unitPrice: Money): Money | null {
  const gross = (BigInt(quantity) * BigInt(unitPrice) + 500n) / 1000n
  if (gross > BigInt(MAX_AMOUNT)) return null
  return Number(gross)
}
