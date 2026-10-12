import type { Money } from '../models/common'
import { formatMoney } from '../utils/money'

/** قالب‌بندی مبلغ (همیشه به تومان) */
export function useMoney(): (amount: Money, options?: { withUnit?: boolean }) => string {
  return formatMoney
}
