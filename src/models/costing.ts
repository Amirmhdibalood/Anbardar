import type { Quantity } from '../utils/quantity'
import type { BaseEntity, IsoDateTime, Money } from './common'

/**
 * لایه بها: هر ورود کالای تازه (خرید، موجودی اولیه، اضافه در شمارش، ورود انتقال) یک لایه است.
 * بهای واحد = totalCost ÷ quantity (مشتق؛ برای جلوگیری از خطای گرد کردن، جمع بها ذخیره می‌شود).
 */
export interface CostLot extends BaseEntity {
  productId: string
  warehouseId: string
  /** حرکت ورودی که این لایه را ساخته (نوع منبع از نوع همین حرکت معلوم است) */
  movementId: string
  /** تاریخ لایه برای ترتیب FIFO (تاریخ فاکتور) */
  lotDate: IsoDateTime
  /** هزارم واحد */
  quantity: Quantity
  remaining: Quantity
  /** بهای کل لایه به تومان (بعد از کسر تخفیف ردیف و سهم تخفیف فاکتور) */
  totalCost: Money
}

/** یک برداشت از یک لایه توسط یک حرکت خروجی */
export interface LotAllocation extends BaseEntity {
  lotId: string
  movementId: string
  quantity: Quantity
  costAmount: Money
  /** اگر حرکت خروجی ابطال شده باشد، حرکت ابطال (برداشت به لایه برگشته است) */
  reversalMovementId: string | null
}

/** گزارش ناسازگاری بین لایه‌ها، کش موجودی و میانگین (باید همیشه خالی باشد) */
export interface CostInconsistency {
  kind: 'lots_vs_stock' | 'lot_remaining' | 'average_quantity'
  productId: string
  warehouseId: string | null
  expected: number
  actual: number
}
