import type { Quantity } from '../utils/quantity'
import type { MovementCosts } from './stock'
import type { BaseEntity, IsoDateTime, Money } from './common'

export type InvoiceStatus = 'active' | 'cancelled'
export type InvoiceKind = 'sales' | 'purchase'

interface InvoiceBase extends BaseEntity {
  /** شماره خودکار و یکتا */
  invoiceNumber: number
  /** شماره سند کاغذی/فروشنده (اختیاری) */
  reference: string | null
  invoiceDate: IsoDateTime
  warehouseId: string
  /** جمع ردیف‌ها (قبل از تخفیف فاکتور) */
  subtotalAmount: Money
  /** تخفیف سطح فاکتور (پیش‌فرض ۰) */
  discount: Money
  /** subtotalAmount - discount */
  totalAmount: Money
  status: InvoiceStatus
  cancelledAt: IsoDateTime | null
  cancelReason: string | null
  note: string | null
}

export interface SalesInvoice extends InvoiceBase {
  customerId: string
}

export interface PurchaseInvoice extends InvoiceBase {
  supplierId: string
  /** جمع هزینه‌های جانبی (به بهای کالا اضافه می‌شود؛ جزو بدهی تأمین‌کننده نیست) */
  landedTotal: Money
  landedMethod: 'value' | 'quantity'
}

/** تفسیر قیمت واردشده: قیمت هر واحد یا مبلغ کل ردیف (فقط خرید و موجودی اولیه) */
export type PriceMode = 'unit' | 'total'

export interface InvoiceItem extends BaseEntity {
  invoiceId: string
  productId: string
  /** هزارم واحد «پایه» (دفتر انبار و بها با همین) */
  quantity: Quantity
  /** واحد واردشده (null = واحد پایه) و ضریب آن (هزارم واحد پایه در یک واحد) */
  unitId: string | null
  unitFactor: number
  /** تعداد به واحد واردشده (هزارم) */
  unitQuantity: Quantity
  /** قیمت هر «واحد واردشده»؛ در حالت total فقط نمایشی (گردشده) */
  unitPrice: Money
  priceMode: PriceMode
  /** مبلغ ناخالص ردیف (پیش از تخفیف ردیف) — در حالت total دقیقاً همان مبلغ واردشده */
  grossAmount: Money
  /** فقط خرید: سهم هزینه‌های جانبی این ردیف */
  landedShare: Money
  discount: Money
  /** round(quantity × unitPrice ÷ 1000) - discount */
  lineTotal: Money
  /** سهم این ردیف از تخفیف کل فاکتور؛ مبلغ خالص ردیف = lineTotal − invoiceDiscountShare */
  invoiceDiscountShare: Money
  note: string | null
  /** فقط ردیف فروش: بهای تمام‌شده به سه روش در لحظه فروش */
  costs: MovementCosts | null
}

export interface InvoiceItemInput {
  productId: string
  /** هزارم «واحد ردیف» (اگر unitId نباشد همان واحد پایه) */
  quantity: Quantity
  /** واحد فرعی کالا (خالی = واحد پایه) */
  unitId?: string | null
  /** قیمت هر واحد ردیف (در حالت total نادیده گرفته می‌شود) */
  unitPrice: Money
  /** پیش‌فرض unit؛ total فقط برای خرید */
  priceMode?: PriceMode
  /** حالت total: مبلغ کل ردیف (پیش از تخفیف ردیف) */
  lineAmount?: Money
  discount?: Money
  note?: string | null
}

/** ورودی ثبت فاکتور (فروش یا خرید)؛ جمع کل را مخزن از آیتم‌ها محاسبه می‌کند */
export interface InvoiceInput {
  /** مشتری (فروش) یا تأمین‌کننده (خرید) */
  partyId: string
  warehouseId: string
  invoiceDate?: IsoDateTime
  reference?: string | null
  note?: string | null
  /** تخفیف کل فاکتور (پیش‌فرض ۰): در فروش از مبلغ دریافتی و در خرید از مبلغ پرداختی (و بهای لایه‌ها) کم می‌شود */
  discount?: Money
  items: InvoiceItemInput[]
  /** فقط خرید: هزینه‌های جانبی (حمل، بیمه، ...) و روش تسهیم */
  charges?: { title: string; amount: Money }[]
  landedMethod?: LandedMethod
}

/** هزینه جانبی خرید (حمل، بیمه، ...) */
export interface PurchaseCharge {
  id: string
  title: string
  amount: Money
}

export type LandedMethod = 'value' | 'quantity'

export interface InvoiceFilter {
  from?: IsoDateTime
  to?: IsoDateTime
  partyId?: string
  warehouseId?: string
  status?: InvoiceStatus
  invoiceNumber?: number
  /** جستجوی متنی: طرف حساب یکی از این‌ها باشد یا شماره مرجع شامل متن باشد */
  text?: { partyIds: string[]; reference: string }
  limit?: number
  offset?: number
}
