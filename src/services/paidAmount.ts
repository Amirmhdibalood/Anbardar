import { ValidationError } from '../utils/errors'
import { formatMoney } from '../utils/money'

/**
 * مبلغ پرداختی هنگام ثبت فاکتور. خالی = کل فاکتور (جریان سریع نقدی).
 * برای طرف‌های سیستمی («مشتری نقدی»، «متفرقه») نسیه معنا ندارد، پس باید کامل پرداخت شود.
 */
export function resolvePaidAmount(paid: number | undefined | null, total: number, isSystemParty: boolean, partyName: string): number {
  if (paid === undefined || paid === null) return total
  if (!Number.isSafeInteger(paid) || paid < 0) throw new ValidationError({ paidAmount: 'مبلغ پرداختی باید عدد صحیح و غیرمنفی باشد.' })
  if (paid > total) throw new ValidationError({ paidAmount: `مبلغ پرداختی از جمع فاکتور (${formatMoney(total, { withUnit: true })}) بیشتر است.` })
  if (isSystemParty && paid !== total) {
    throw new ValidationError({ paidAmount: `برای «${partyName}» نسیه ثبت نمی‌شود. مبلغ کامل را بزنید یا یک طرف حساب با نام انتخاب کنید.` })
  }
  return paid
}
