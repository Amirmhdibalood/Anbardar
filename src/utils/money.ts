import type { Money } from '../models/common'
import { formatInteger } from './persian'

/** واحد پول برنامه: فقط تومان. همه مبلغ‌ها به تومان و به‌صورت عدد صحیح ذخیره می‌شوند. */
export const MONEY_UNIT = 'تومان'

/** مبلغ باید عدد صحیح و امن باشد؛ در غیر این صورت خطای برنامه‌نویسی است */
export function assertMoney(amount: number): asserts amount is Money {
  if (!Number.isSafeInteger(amount)) {
    throw new RangeError('مبلغ باید عدد صحیح باشد')
  }
}

/** نمایش مبلغ: ۴,۵۲۰,۰۰۰ تومان */
export function formatMoney(amount: Money, options: { withUnit?: boolean } = {}): string {
  assertMoney(amount)
  const { withUnit = true } = options
  const number = formatInteger(amount)
  return withUnit ? `${number} ${MONEY_UNIT}` : number
}

/**
 * ضرب و تقسیم صحیح با گرد کردن «نیم به بالا» برای مقادیر نامنفی: round(a × b ÷ c).
 * با BigInt محاسبه می‌شود تا حاصل‌ضرب‌های بزرگ (تعداد × مبلغ) دقیق بمانند.
 */
export function mulDivRound(a: number, b: number, c: number): number {
  if (c <= 0) throw new Error('mulDivRound: divisor must be positive')
  const bc = BigInt(c)
  return Number((BigInt(a) * BigInt(b) + bc / 2n) / bc)
}

/** گرد کردن به بالا: ceil(a × b ÷ c) برای مقادیر نامنفی */
export function mulDivCeil(a: number, b: number, c: number): number {
  if (c <= 0) throw new Error('mulDivCeil: divisor must be positive')
  const bc = BigInt(c)
  return Number((BigInt(a) * BigInt(b) + bc - 1n) / bc)
}
