import type { Quantity } from '../utils/quantity'
import type { BaseEntity, IsoDateTime } from './common'

export const MOVEMENT_TYPES = [
  'purchase',
  'sale',
  'purchase_cancel',
  'sale_cancel',
  'purchase_return',
  'sale_return',
  'transfer_in',
  'transfer_out',
  'adjustment',
  'opening',
  'shortage',
  'waste',
] as const
export type MovementType = (typeof MOVEMENT_TYPES)[number]

/** نوع‌های ورودی (تعداد مثبت) و خروجی (تعداد منفی)؛ دیتابیس هم علامت را اجبار می‌کند */
export const INBOUND_TYPES: ReadonlySet<MovementType> = new Set(['purchase', 'sale_cancel', 'sale_return', 'transfer_in', 'adjustment', 'opening'])
export const OUTBOUND_TYPES: ReadonlySet<MovementType> = new Set(['sale', 'purchase_cancel', 'purchase_return', 'transfer_out', 'shortage', 'waste'])
/** حرکت‌های ورودی که کالای تازه وارد می‌کنند و یک لایه بها می‌سازند */
export const LOT_CREATING_TYPES: ReadonlySet<MovementType> = new Set(['purchase', 'opening', 'adjustment', 'transfer_in', 'sale_return'])
/** حرکت‌های خروجی که از قدیمی‌ترین لایه‌ها (FIFO) برداشت می‌کنند */
export const FIFO_CONSUMING_TYPES: ReadonlySet<MovementType> = new Set(['sale', 'shortage', 'waste', 'purchase_return', 'transfer_out'])

export const DOCUMENT_TYPES = ['purchase_invoice', 'sales_invoice', 'transfer', 'adjustment'] as const
export type DocumentType = (typeof DOCUMENT_TYPES)[number]

/** یک ردیف دفتر حرکت کالا؛ تغییرناپذیر و فقط افزودنی */
export interface StockMovement extends BaseEntity {
  productId: string
  warehouseId: string
  /** هزارم واحد؛ مثبت = ورود، منفی = خروج */
  quantityDelta: Quantity
  movementType: MovementType
  documentType: DocumentType | null
  documentId: string | null
  occurredAt: IsoDateTime
  note: string | null
  /** شناسه ردیف سند (ردیف فاکتور خرید/فروش) */
  documentLineId: string | null
  /** بهای خروج به سه روش (فقط حرکت‌های خروجی و ابطال فروش؛ برای بقیه null) */
  costs: MovementCosts | null
}

/** بهای یک خروج کالا به تومان، با هر سه روش؛ هر سه در لحظه ثبت ذخیره می‌شوند */
export interface MovementCosts {
  fifo: number
  average: number
  last: number
}

export interface StockMovementInput {
  productId: string
  warehouseId: string
  /** هزارم واحد (۱٫۵ کیلو = ۱۵۰۰) */
  quantityDelta: Quantity
  movementType: MovementType
  documentType?: DocumentType | null
  documentId?: string | null
  occurredAt?: IsoDateTime
  note?: string | null
  documentLineId?: string | null
}

/** موجودی یک کالا در یک انبار (کش سریع؛ منبع حقیقت دفتر حرکت است) */
export interface StockLevel {
  warehouseId: string
  productId: string
  /** هزارم واحد */
  quantity: Quantity
}

export interface StockInconsistency {
  warehouseId: string
  productId: string
  cached: Quantity
  ledger: Quantity
}

export type StockStatus = 'ok' | 'low' | 'out'

/**
 * وضعیت موجودی: ناموجود (≤ ۰)، کم‌موجودی (نقطه سفارش تعریف شده و موجودی ≤ آن) یا کافی.
 * «به نقطه سفارش رسیدن» هم کم‌موجودی حساب می‌شود.
 */
export function stockStatus(quantity: Quantity, reorderPoint: Quantity): StockStatus {
  if (quantity <= 0) return 'out'
  if (reorderPoint > 0 && quantity <= reorderPoint) return 'low'
  return 'ok'
}

const MOVEMENT_LABELS: Record<MovementType, string> = {
  purchase: 'خرید',
  sale: 'فروش',
  purchase_cancel: 'ابطال خرید',
  sale_cancel: 'ابطال فروش',
  purchase_return: 'برگشت خرید',
  sale_return: 'برگشت فروش',
  transfer_in: 'ورود از انتقال',
  transfer_out: 'خروج با انتقال',
  adjustment: 'اضافه در شمارش',
  opening: 'موجودی اولیه',
  shortage: 'کسری',
  waste: 'ضایعات / خرابی',
}

export function movementLabel(type: MovementType): string {
  return MOVEMENT_LABELS[type]
}
